import { getZenState, updateZenState } from '../shared/storage'
import {
  DEFAULT_BLOCKED_URL_HINTS,
  OPEN_DASHBOARD_MESSAGE,
  PING_CONTENT_SCRIPT_MESSAGE,
  SHOW_TASK_REMINDER_MESSAGE,
  STORAGE_KEY,
  getOpenTasks,
  getTodayKey,
  type TimedSiteRule,
  type TimedSiteUsage,
  type ZenState,
  type ZenTask,
} from '../shared/types'

const HOST_ID = 'zenny-blocker-root'
const COUNTER_HOST_ID = 'zenny-content-counter-root'
const TASK_REMINDER_HOST_ID = 'zenny-task-reminder-root'
const CHECK_INTERVAL_MS = 1000
const DISTRACTING_FEED_ITEM_INTERVAL_MS = 12 * 1000
const TASK_REMINDER_VISIBLE_MS = 60 * 1000
const CONTENT_SCRIPT_LOADED_KEY = '__ZENNY_CONTENT_SCRIPT_LOADED__'

let hostElement: HTMLDivElement | null = null
let mountElement: HTMLDivElement | null = null
let overlayDetailElement: HTMLParagraphElement | null = null
let overlayMessageElement: HTMLParagraphElement | null = null
let overlayTaskContainerElement: HTMLDivElement | null = null
let overlayTaskTitleElement: HTMLElement | null = null
let overlayTitleElement: HTMLHeadingElement | null = null
let counterHostElement: HTMLDivElement | null = null
let counterMountElement: HTMLDivElement | null = null
let counterCountElement: HTMLElement | null = null
let counterLabelElement: HTMLSpanElement | null = null
let counterMetaElement: HTMLElement | null = null
let taskReminderHostElement: HTMLDivElement | null = null
let taskReminderMountElement: HTMLDivElement | null = null
let taskReminderTaskElement: HTMLParagraphElement | null = null
let lastUrl = window.location.href
let checkTimer: number | undefined
let intervalTimer: number | undefined
let lastStatus = 'Starting'
let taskReminderTimer: number | undefined
let urlPollTimer: number | undefined
let destroyed = false

declare global {
  interface Window {
    [CONTENT_SCRIPT_LOADED_KEY]?: boolean
  }
}

if (!window[CONTENT_SCRIPT_LOADED_KEY]) {
  window[CONTENT_SCRIPT_LOADED_KEY] = true
  void checkAndRender()
  watchUrlChanges()
  watchStorageChanges()
  watchRuntimeMessages()
  intervalTimer = window.setInterval(scheduleCheck, CHECK_INTERVAL_MS)
  window.addEventListener('pagehide', () => {
    void finalizeTimedSiteSessions()
  })
}

type BlockDecision = {
  blockedUntil?: number
  detail?: string
  message: string
  title: string
}

type DistractingContentKind = 'reels' | 'shorts'

type DistractingContentContext = {
  contentKey: string
  kind: DistractingContentKind
}

type ContentQuotaProgress = {
  decision?: BlockDecision
  kind: DistractingContentKind
  label: string
  limit: number
  seen: number
}

async function checkAndRender() {
  if (destroyed) {
    return
  }

  try {
    const state = await getZenState()

    if (!state.settings.blockingEnabled) {
      lastStatus = 'Guard off'
      removeOverlay()
      removeContentCounter()
      return
    }

    const openTasks = getOpenTasks(state).slice(0, 3)
    const contentProgress = await evaluateDistractingContentQuota(state)
    const timedSiteDecision = await evaluateTimedSiteRules(state)
    const decision = contentProgress?.decision ?? timedSiteDecision

    renderContentCounter(contentProgress)

    if (decision) {
      lastStatus = `Blocked: ${decision.title}`
      renderOverlay(decision, openTasks)
      return
    }

    lastStatus = `Allowed: ${getCurrentUrlKey()}`
    removeOverlay()
  } catch (error) {
    const message = getErrorMessage(error)

    if (isExtensionContextInvalidated(message)) {
      teardownContentScript()
      return
    }

    lastStatus = `Error: ${message}`
    removeOverlay()
    removeContentCounter()
  }
}

async function evaluateDistractingContentQuota(
  state: ZenState,
): Promise<ContentQuotaProgress | undefined> {
  const context = getDistractingContentContext(state.settings.blockedUrlHints)

  if (!context) {
    return undefined
  }

  const label = getContentLabel(context.kind)
  const limit = getContentLimit(state, context.kind)
  const seenKeys = new Set(getContentKeys(state, context.kind))
  const alreadySeen = seenKeys.has(context.contentKey)
  let seen = seenKeys.size
  let decision: BlockDecision | undefined

  if (!alreadySeen && seenKeys.size < limit) {
    seen += 1
    await updateZenState((currentState) => {
      const currentKeys = getContentKeys(currentState, context.kind)

      if (currentKeys.includes(context.contentKey)) {
        return currentState
      }

      return {
        ...currentState,
        stats: {
          ...currentState.stats,
          ...getUpdatedContentKeys(context.kind, [
            ...currentKeys,
            context.contentKey,
          ]),
        },
      }
    })
  } else if (!alreadySeen || seenKeys.size > limit) {
    decision = {
      detail: `${seen} / ${limit} allowed today`,
      message:
        limit === 0
          ? `${label} are locked while Guard is on.`
          : `Your daily ${label} allowance is finished.`,
      title: context.kind === 'shorts' ? 'No more Shorts.' : 'No more Reels.',
    }
  }

  return {
    decision,
    kind: context.kind,
    label,
    limit,
    seen,
  }
}

async function evaluateTimedSiteRules(state: ZenState): Promise<BlockDecision | undefined> {
  let decision: BlockDecision | undefined
  const now = Date.now()
  const currentUrlKey = getCurrentUrlKey()
  const matchingRule = state.settings.timedSiteRules.find(
    (rule) => rule.enabled && matchesTimedSiteRule(rule, currentUrlKey),
  )
  const currentUsage = matchingRule
    ? normalizeUsage(state.stats.timedSiteUsage[matchingRule.id], matchingRule.id)
    : undefined
  const hasInactiveSession = Object.entries(state.stats.timedSiteUsage).some(
    ([ruleId, usage]) => ruleId !== matchingRule?.id && Boolean(usage.sessionStartedAt),
  )

  if (!matchingRule && !hasInactiveSession) {
    return undefined
  }

  if (matchingRule && currentUsage?.blockedUntil && currentUsage.blockedUntil > now) {
    return {
      blockedUntil: currentUsage.blockedUntil,
      detail: `Try again in ${formatDuration(currentUsage.blockedUntil - now)}.`,
      message: `${matchingRule.pattern} is cooling down.`,
      title: 'Black screen. Quiet mind.',
    }
  }

  if (
    matchingRule &&
    currentUsage?.sessionStartedAt &&
    currentUsage.activeUrl === currentUrlKey &&
    currentUsage.usedMs + (now - currentUsage.sessionStartedAt) <
      Math.max(0, matchingRule.allowedMinutes) * 60 * 1000
  ) {
    return undefined
  }

  await updateZenState((currentState) => {
    const currentMatchingRule = currentState.settings.timedSiteRules.find(
      (rule) => rule.enabled && matchesTimedSiteRule(rule, currentUrlKey),
    )
    const timedSiteUsage = { ...currentState.stats.timedSiteUsage }
    let changed = finalizeInactiveTimedSessions(timedSiteUsage, currentMatchingRule?.id, now)

    if (!currentMatchingRule) {
      return changed
        ? {
            ...currentState,
            stats: {
              ...currentState.stats,
              timedSiteUsage,
            },
          }
        : currentState
    }

    const usage = normalizeUsage(timedSiteUsage[currentMatchingRule.id], currentMatchingRule.id)
    const blockedUntil = usage.blockedUntil ?? 0

    if (blockedUntil > now) {
      decision = {
        blockedUntil,
        detail: `Try again in ${formatDuration(blockedUntil - now)}.`,
        message: `${currentMatchingRule.pattern} is cooling down.`,
        title: 'Black screen. Quiet mind.',
      }
      timedSiteUsage[currentMatchingRule.id] = usage
      return currentState
    }

    if (usage.blockedUntil && usage.blockedUntil <= now) {
      usage.blockedUntil = undefined
      usage.usedMs = 0
      changed = true
    }

    if (!usage.sessionStartedAt || usage.activeUrl !== currentUrlKey) {
      usage.activeUrl = currentUrlKey
      usage.sessionStartedAt = now
      changed = true
    }

    const elapsedMs = usage.usedMs + (now - usage.sessionStartedAt)
    const allowedMs = Math.max(0, currentMatchingRule.allowedMinutes) * 60 * 1000

    if (elapsedMs >= allowedMs) {
      usage.activeUrl = undefined
      usage.blockedUntil = now + Math.max(1, currentMatchingRule.blockMinutes) * 60 * 1000
      usage.sessionStartedAt = undefined
      usage.usedMs = 0
      changed = true
      decision = {
        blockedUntil: usage.blockedUntil,
        detail: `Blocked for ${currentMatchingRule.blockMinutes} minute${
          currentMatchingRule.blockMinutes === 1 ? '' : 's'
        }.`,
        message: `${currentMatchingRule.pattern} reached its time limit.`,
        title: 'Pause. Breathe. Return.',
      }
    }

    timedSiteUsage[currentMatchingRule.id] = usage

    return changed
      ? {
          ...currentState,
          stats: {
            ...currentState.stats,
            timedSiteUsage,
          },
        }
      : currentState
  })

  return decision
}

function renderOverlay(decision: BlockDecision, tasks: ZenTask[]) {
  if (!hostElement || !mountElement) {
    hostElement = document.createElement('div')
    hostElement.id = HOST_ID

    const shadowRoot = hostElement.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = overlayStyles
    mountElement = document.createElement('div')

    shadowRoot.append(style, mountElement)
    document.documentElement.appendChild(hostElement)
  }

  if (!overlayTitleElement || !overlayMessageElement) {
    mountElement.replaceChildren(createOverlayElement())
  }

  overlayTitleElement!.textContent = decision.title
  overlayMessageElement!.textContent = decision.message

  if (overlayDetailElement) {
    overlayDetailElement.hidden = !decision.detail
    overlayDetailElement.textContent = decision.detail ?? ''
  }

  if (overlayTaskContainerElement && overlayTaskTitleElement) {
    const task = tasks[0]
    overlayTaskContainerElement.hidden = !task
    overlayTaskTitleElement.textContent = task?.title ?? ''
  }
}

function createOverlayElement() {
  const overlay = createElement('div', 'zen-overlay')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')

  const shell = createElement('div', 'zen-shell')
  const ring = createElement('div', 'zen-ring')
  overlayTitleElement = createElement('h1')
  overlayMessageElement = createElement('p', 'zen-message')
  overlayDetailElement = createElement('p', 'zen-detail')
  overlayTaskContainerElement = createElement('div', 'zen-task')
  overlayTaskTitleElement = createElement('strong')
  ring.setAttribute('aria-hidden', 'true')
  overlayDetailElement.hidden = true
  overlayTaskContainerElement.hidden = true

  shell.append(
    ring,
    createElement('p', 'zen-kicker', 'Return to the work.'),
    overlayTitleElement,
    overlayMessageElement,
    overlayDetailElement,
  )

  overlayTaskContainerElement.append(createElement('span', undefined, 'Current task'))
  overlayTaskContainerElement.append(overlayTaskTitleElement)
  shell.append(overlayTaskContainerElement)

  const button = createElement('button', undefined, 'Open Zenny')
  button.type = 'button'
  button.addEventListener('click', openDashboard)
  shell.append(button)

  overlay.append(shell)
  return overlay
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
) {
  const element = document.createElement(tagName)

  if (className) {
    element.className = className
  }

  if (text !== undefined) {
    element.textContent = text
  }

  return element
}

function removeOverlay() {
  hostElement?.remove()
  hostElement = null
  mountElement = null
  overlayDetailElement = null
  overlayMessageElement = null
  overlayTaskContainerElement = null
  overlayTaskTitleElement = null
  overlayTitleElement = null
}

function renderContentCounter(progress?: ContentQuotaProgress) {
  if (!progress) {
    removeContentCounter()
    return
  }

  if (!counterHostElement || !counterMountElement) {
    counterHostElement = document.createElement('div')
    counterHostElement.id = COUNTER_HOST_ID

    const shadowRoot = counterHostElement.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = counterStyles
    counterMountElement = document.createElement('div')

    shadowRoot.append(style, counterMountElement)
    document.documentElement.appendChild(counterHostElement)
  }

  if (!counterCountElement || !counterLabelElement || !counterMetaElement) {
    counterMountElement.replaceChildren(createCounterElement())
  }

  counterCountElement!.textContent = String(progress.seen)
  counterLabelElement!.textContent = progress.label
  counterMetaElement!.textContent =
    progress.limit === 0 ? 'locked' : `limit ${progress.limit}`
}

function createCounterElement() {
  const counter = createElement('aside', 'zenny-counter')
  counter.setAttribute('aria-live', 'polite')

  counterCountElement = createElement('strong')
  counterLabelElement = createElement('span')
  counterMetaElement = createElement('small')

  counter.append(counterCountElement, counterLabelElement, counterMetaElement)
  return counter
}

function removeContentCounter() {
  counterHostElement?.remove()
  counterHostElement = null
  counterMountElement = null
  counterCountElement = null
  counterLabelElement = null
  counterMetaElement = null
}

function renderTaskReminder(taskTitle?: string) {
  if (!taskTitle) {
    return
  }

  if (!taskReminderHostElement || !taskReminderMountElement) {
    taskReminderHostElement = document.createElement('div')
    taskReminderHostElement.id = TASK_REMINDER_HOST_ID

    const shadowRoot = taskReminderHostElement.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = taskReminderStyles
    taskReminderMountElement = document.createElement('div')

    shadowRoot.append(style, taskReminderMountElement)
    document.documentElement.appendChild(taskReminderHostElement)
  }

  if (!taskReminderTaskElement) {
    taskReminderMountElement.replaceChildren(createTaskReminderElement())
  }

  taskReminderTaskElement!.textContent = taskTitle
  window.clearTimeout(taskReminderTimer)
  taskReminderTimer = window.setTimeout(removeTaskReminder, TASK_REMINDER_VISIBLE_MS)
}

function createTaskReminderElement() {
  const backdrop = createElement('div', 'zenny-reminder-backdrop')
  backdrop.setAttribute('role', 'alertdialog')
  backdrop.setAttribute('aria-modal', 'false')

  const shell = createElement('div', 'zenny-reminder')
  taskReminderTaskElement = createElement('p', 'zenny-reminder-task')
  shell.append(
    createElement('p', 'zenny-reminder-kicker', 'Zenny check-in'),
    createElement('h2', undefined, 'You are not doing this task.'),
    taskReminderTaskElement,
  )

  const actions = createElement('div', 'zenny-reminder-actions')
  const openButton = createElement('button', undefined, 'Open Zenny')
  const dismissButton = createElement('button', 'secondary', 'Dismiss')
  openButton.type = 'button'
  dismissButton.type = 'button'
  openButton.addEventListener('click', openDashboard)
  dismissButton.addEventListener('click', removeTaskReminder)
  actions.append(openButton, dismissButton)
  shell.append(actions)

  backdrop.append(shell)
  return backdrop
}

function removeTaskReminder() {
  window.clearTimeout(taskReminderTimer)
  taskReminderHostElement?.remove()
  taskReminderHostElement = null
  taskReminderMountElement = null
  taskReminderTaskElement = null
}

function getDistractingContentContext(
  blockedUrlHints = DEFAULT_BLOCKED_URL_HINTS,
): DistractingContentContext | undefined {
  const current = getCurrentUrlKey()
  const kind = getDistractingContentKind(current)

  if (
    !kind ||
    !blockedUrlHints.some((hint) => current.startsWith(normalizePattern(hint))) ||
    !isContentDetailPage(current)
  ) {
    return undefined
  }

  if (isAggregateReelsFeed(current)) {
    return {
      contentKey: `${current}#${Math.floor(
        Date.now() / DISTRACTING_FEED_ITEM_INTERVAL_MS,
      )}`,
      kind,
    }
  }

  return {
    contentKey: current,
    kind,
  }
}

function getDistractingContentKind(current: string): DistractingContentKind | undefined {
  if (/^youtube\.com\/shorts(\/|$)/.test(current)) {
    return 'shorts'
  }

  if (/^instagram\.com\/reel(s)?(\/|$)/.test(current)) {
    return 'reels'
  }

  return undefined
}

function getContentLabel(kind: DistractingContentKind) {
  return kind === 'shorts' ? 'Shorts' : 'Reels'
}

function getContentLimit(state: ZenState, kind: DistractingContentKind) {
  return Math.max(
    0,
    kind === 'shorts'
      ? state.settings.maxShortsPerDay
      : state.settings.maxReelsPerDay,
  )
}

function getContentKeys(state: ZenState, kind: DistractingContentKind) {
  return kind === 'shorts'
    ? state.stats.shortsContentKeys
    : state.stats.reelsContentKeys
}

function getUpdatedContentKeys(kind: DistractingContentKind, keys: string[]) {
  return kind === 'shorts'
    ? { shortsContentKeys: keys }
    : { reelsContentKeys: keys }
}

function isContentDetailPage(current: string) {
  return isAggregateReelsFeed(current) || isUniqueReelsOrShortsUrl(current)
}

function isAggregateReelsFeed(current: string) {
  return current === 'youtube.com/shorts' || current === 'instagram.com/reels'
}

function isUniqueReelsOrShortsUrl(current: string) {
  return (
    /^youtube\.com\/shorts\/[^/]+/.test(current) ||
    /^instagram\.com\/reel[s]?\/[^/]+/.test(current)
  )
}

function matchesTimedSiteRule(rule: TimedSiteRule, currentUrlKey: string) {
  const pattern = normalizePattern(rule.pattern)

  if (!pattern) {
    return false
  }

  if (pattern.includes('/')) {
    return currentUrlKey.startsWith(pattern)
  }

  const host = currentUrlKey.split('/')[0]

  return host === pattern || host.endsWith(`.${pattern}`)
}

function getCurrentUrlKey() {
  const url = new URL(window.location.href)
  const host = url.hostname.replace(/^(www|m)\./, '').toLowerCase()
  const path = url.pathname.replace(/\/+$/, '').toLowerCase()

  return `${host}${path || '/'}`
}

function normalizePattern(pattern: string) {
  try {
    const withProtocol = /^https?:\/\//i.test(pattern) ? pattern : `https://${pattern}`
    const url = new URL(withProtocol)
    const host = url.hostname.replace(/^(www|m)\./, '').toLowerCase()
    const path = url.pathname.replace(/\/+$/, '').toLowerCase()

    return `${host}${path === '/' ? '' : path}`
  } catch {
    return pattern
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^(www|m)\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  }
}

function watchUrlChanges() {
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args)
    scheduleCheck()
    return result
  }

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args)
    scheduleCheck()
    return result
  }

  window.addEventListener('popstate', scheduleCheck)
  window.addEventListener('yt-navigate-finish', scheduleCheck)

  urlPollTimer = window.setInterval(() => {
    if (lastUrl !== window.location.href) {
      lastUrl = window.location.href
      scheduleCheck()
    }
  }, 1000)
}

function watchStorageChanges() {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) {
        scheduleCheck()
      }
    })
  } catch (error) {
    if (isExtensionContextInvalidated(getErrorMessage(error))) {
      teardownContentScript()
    }
  }
}

function watchRuntimeMessages() {
  try {
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (isTaskReminderMessage(message)) {
        renderTaskReminder(message.taskTitle)
        sendResponse({ ok: true })
        return false
      }

      if (!isPingMessage(message)) {
        return false
      }

      void checkAndRender().then(() => {
        sendResponse({
          loaded: true,
          ok: true,
          status: lastStatus,
          urlKey: getCurrentUrlKey(),
        })
      })

      return true
    })
  } catch (error) {
    if (isExtensionContextInvalidated(getErrorMessage(error))) {
      teardownContentScript()
    }
  }
}

function isPingMessage(message: unknown) {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === PING_CONTENT_SCRIPT_MESSAGE
  )
}

function isTaskReminderMessage(
  message: unknown,
): message is { taskTitle?: string; type: typeof SHOW_TASK_REMINDER_MESSAGE } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === SHOW_TASK_REMINDER_MESSAGE
  )
}

function scheduleCheck() {
  if (destroyed) {
    return
  }

  window.clearTimeout(checkTimer)
  checkTimer = window.setTimeout(() => {
    if (destroyed) {
      return
    }

    lastUrl = window.location.href
    void checkAndRender()
  }, 100)
}

function openDashboard() {
  try {
    chrome.runtime.sendMessage({ type: OPEN_DASHBOARD_MESSAGE }, () => {
      if (chrome.runtime.lastError) {
        window.open(chrome.runtime.getURL('popup.html'), '_blank', 'noopener')
      }
    })
  } catch {
    teardownContentScript()
  }
}

async function finalizeTimedSiteSessions() {
  if (destroyed) {
    return
  }

  const now = Date.now()

  await updateZenState((state) => {
    const timedSiteUsage = { ...state.stats.timedSiteUsage }
    const changed = finalizeInactiveTimedSessions(timedSiteUsage, undefined, now)

    return changed
      ? {
          ...state,
          stats: {
            ...state.stats,
            timedSiteUsage,
          },
        }
      : state
  })
}

function finalizeInactiveTimedSessions(
  timedSiteUsage: Record<string, TimedSiteUsage>,
  activeRuleId: string | undefined,
  now: number,
) {
  let changed = false

  for (const [ruleId, usage] of Object.entries(timedSiteUsage)) {
    if (ruleId === activeRuleId || !usage.sessionStartedAt) {
      continue
    }

    timedSiteUsage[ruleId] = {
      ...usage,
      activeUrl: undefined,
      sessionStartedAt: undefined,
      usedMs: usage.usedMs + Math.max(0, now - usage.sessionStartedAt),
    }
    changed = true
  }

  return changed
}

function normalizeUsage(
  usage: TimedSiteUsage | undefined,
  ruleId: string,
): TimedSiteUsage {
  if (!usage || usage.dayKey !== getTodayKey()) {
    return {
      dayKey: getTodayKey(),
      ruleId,
      usedMs: 0,
    }
  }

  return { ...usage }
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes <= 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function teardownContentScript() {
  destroyed = true
  window.clearTimeout(checkTimer)

  if (intervalTimer) {
    window.clearInterval(intervalTimer)
  }

  if (urlPollTimer) {
    window.clearInterval(urlPollTimer)
  }

  removeOverlay()
  removeContentCounter()
  removeTaskReminder()
}

function isExtensionContextInvalidated(message: string) {
  return message.toLowerCase().includes('extension context invalidated')
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const overlayStyles = `
  :host {
    all: initial;
    color-scheme: dark;
  }

  * {
    box-sizing: border-box;
  }

  .zen-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
      linear-gradient(180deg, rgba(3, 13, 12, 0.96), rgba(0, 0, 0, 1)),
      #000;
    color: #fafafa;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .zen-shell {
    width: min(560px, 100%);
    display: grid;
    justify-items: center;
    gap: 18px;
    text-align: center;
    animation: zenny-rise 420ms ease-out both;
  }

  .zen-ring {
    width: 88px;
    height: 88px;
    border: 1px solid #52525b;
    border-top-color: #11b8b5;
    border-radius: 999px;
    box-shadow: 0 0 80px rgba(17, 184, 181, 0.18);
    animation: zenny-ring-in 520ms ease-out both;
  }

  .zen-kicker,
  .zen-message,
  .zen-detail,
  .zen-task span {
    margin: 0;
    color: #a1a1aa;
    font-size: 13px;
    line-height: 1.5;
  }

  h1 {
    max-width: 520px;
    margin: 0;
    color: #fafafa;
    font-size: clamp(32px, 5vw, 56px);
    font-weight: 500;
    line-height: 1.04;
  }

  .zen-message {
    max-width: 440px;
    font-size: 17px;
  }

  .zen-detail {
    color: #d4d4d8;
  }

  .zen-task {
    width: min(420px, 100%);
    display: grid;
    gap: 6px;
    padding: 14px 16px;
    border: 1px solid rgba(20, 184, 166, 0.28);
    border-radius: 8px;
    background: rgba(9, 9, 11, 0.82);
    text-align: left;
  }

  .zen-task strong {
    color: #f4f4f5;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.4;
  }

  button {
    min-height: 42px;
    padding: 0 16px;
    border: 1px solid #5eead4;
    border-radius: 8px;
    background: #ccfbf1;
    color: #042f2e;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    transition:
      background 160ms ease,
      border-color 160ms ease;
  }

  button:hover {
    background: #99f6e4;
  }

  @keyframes zenny-rise {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes zenny-ring-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .zen-shell,
    .zen-ring {
      animation: none;
    }
  }
`

const counterStyles = `
  :host {
    all: initial;
    color-scheme: dark;
  }

  * {
    box-sizing: border-box;
  }

  .zenny-counter {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483646;
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2px 8px;
    min-width: 124px;
    padding: 10px 12px;
    border: 1px solid rgba(94, 234, 212, 0.4);
    border-radius: 8px;
    background: rgba(3, 7, 18, 0.86);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
    color: #f8fafc;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1;
    backdrop-filter: blur(12px);
    animation: zenny-counter-in 260ms ease-out both;
  }

  strong {
    grid-row: span 2;
    min-width: 32px;
    color: #5eead4;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0;
    text-align: center;
  }

  span {
    color: #f8fafc;
    font-size: 13px;
    font-weight: 650;
  }

  small {
    color: #94a3b8;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  @keyframes zenny-counter-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 520px) {
    .zenny-counter {
      top: 10px;
      right: 10px;
      min-width: 108px;
      padding: 8px 10px;
    }

    strong {
      font-size: 24px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .zenny-counter {
      animation: none;
    }
  }
`

const taskReminderStyles = `
  :host {
    all: initial;
    color-scheme: dark;
  }

  * {
    box-sizing: border-box;
  }

  .zenny-reminder-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: grid;
    place-items: center;
    padding: 24px;
    pointer-events: none;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .zenny-reminder {
    width: min(420px, 100%);
    display: grid;
    gap: 12px;
    padding: 20px;
    border: 1px solid rgba(94, 234, 212, 0.36);
    border-radius: 8px;
    background: rgba(3, 7, 18, 0.94);
    color: #f8fafc;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
    pointer-events: auto;
    animation: zenny-reminder-in 320ms ease-out both;
    backdrop-filter: blur(16px);
  }

  .zenny-reminder-kicker,
  .zenny-reminder-task {
    margin: 0;
  }

  .zenny-reminder-kicker {
    color: #5eead4;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    color: #f8fafc;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.16;
  }

  .zenny-reminder-task {
    padding: 12px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.82);
    color: #cbd5e1;
    font-size: 14px;
    line-height: 1.45;
  }

  .zenny-reminder-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  button {
    min-height: 38px;
    padding: 0 14px;
    border: 1px solid #5eead4;
    border-radius: 8px;
    background: #ccfbf1;
    color: #042f2e;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    transition:
      background 160ms ease,
      border-color 160ms ease;
  }

  button.secondary {
    border-color: rgba(148, 163, 184, 0.32);
    background: rgba(15, 23, 42, 0.88);
    color: #cbd5e1;
  }

  button:hover {
    background: #99f6e4;
  }

  @keyframes zenny-reminder-in {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .zenny-reminder {
      animation: none;
    }
  }
`
