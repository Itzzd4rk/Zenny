export type ZenTaskStatus = 'needsAction' | 'completed'
export type ZenTaskSource = 'google-tasks' | 'local'

export type ZenTask = {
  id: string
  taskListId?: string
  title: string
  notes?: string
  due?: string
  completed?: string
  updated?: string
  status: ZenTaskStatus
  source: ZenTaskSource
}

export type ZenEvent = {
  id: string
  calendarId: string
  title: string
  start: string
  end?: string
  location?: string
}

export type ZenStats = {
  dayKey: string
  completedTaskIds: string[]
  lastCompletionAt?: number
  reelsContentKeys: string[]
  shortsContentKeys: string[]
  timedSiteUsage: Record<string, TimedSiteUsage>
}

export type ZenSettings = {
  blockingEnabled: boolean
  blockedUrlHints: string[]
  maxReelsPerDay: number
  maxShortsPerDay: number
  taskReminderEnabled: boolean
  timedSiteRules: TimedSiteRule[]
}

export type ZenState = {
  tasks: ZenTask[]
  events: ZenEvent[]
  lastSyncAt?: number
  signedIn: boolean
  stats: ZenStats
  settings: ZenSettings
}

export type TimedSiteRule = {
  id: string
  pattern: string
  allowedMinutes: number
  blockMinutes: number
  enabled: boolean
}

export type TimedSiteUsage = {
  activeUrl?: string
  blockedUntil?: number
  dayKey: string
  ruleId: string
  sessionStartedAt?: number
  usedMs: number
}

export const STORAGE_KEY = 'zen_state'
export const OPEN_DASHBOARD_MESSAGE = 'ZEN_OPEN_DASHBOARD'
export const GET_GOOGLE_TOKEN_MESSAGE = 'ZEN_GET_GOOGLE_TOKEN'
export const CLEAR_GOOGLE_TOKEN_MESSAGE = 'ZEN_CLEAR_GOOGLE_TOKEN'
export const PING_CONTENT_SCRIPT_MESSAGE = 'ZEN_PING_CONTENT_SCRIPT'
export const CHECK_ACTIVE_TAB_BLOCKER_MESSAGE = 'ZEN_CHECK_ACTIVE_TAB_BLOCKER'
export const SHOW_TASK_REMINDER_MESSAGE = 'ZEN_SHOW_TASK_REMINDER'

export const DEFAULT_BLOCKED_URL_HINTS = [
  'youtube.com/shorts',
  'instagram.com/reel',
  'instagram.com/reels',
]

export function getTodayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function createDefaultState(): ZenState {
  return {
    tasks: [],
    events: [],
    signedIn: false,
    stats: {
      dayKey: getTodayKey(),
      completedTaskIds: [],
      reelsContentKeys: [],
      shortsContentKeys: [],
      timedSiteUsage: {},
    },
    settings: {
      blockingEnabled: true,
      blockedUrlHints: DEFAULT_BLOCKED_URL_HINTS,
      maxReelsPerDay: 0,
      maxShortsPerDay: 0,
      taskReminderEnabled: true,
      timedSiteRules: [],
    },
  }
}

export function normalizeZenState(input?: Partial<ZenState>): ZenState {
  const base = createDefaultState()
  const statsInput = input?.stats as
    | (Partial<ZenStats> & { distractingContentKeys?: string[] })
    | undefined
  const settingsInput = input?.settings as
    | (Partial<ZenSettings> & { maxShortsReelsPerDay?: number })
    | undefined
  const legacyContentKeys = Array.isArray(statsInput?.distractingContentKeys)
    ? normalizeStringList(statsInput.distractingContentKeys)
    : []
  const legacyLimit = Number.isFinite(settingsInput?.maxShortsReelsPerDay)
    ? settingsInput?.maxShortsReelsPerDay
    : undefined
  const state: ZenState = {
    ...base,
    ...input,
    tasks: Array.isArray(input?.tasks) ? input.tasks : base.tasks,
    events: Array.isArray(input?.events) ? input.events : base.events,
    stats: {
      ...base.stats,
      dayKey: input?.stats?.dayKey ?? base.stats.dayKey,
      lastCompletionAt: input?.stats?.lastCompletionAt,
      completedTaskIds: Array.isArray(input?.stats?.completedTaskIds)
        ? normalizeStringList(input.stats.completedTaskIds)
        : base.stats.completedTaskIds,
      reelsContentKeys: Array.isArray(statsInput?.reelsContentKeys)
        ? normalizeStringList(statsInput.reelsContentKeys)
        : legacyContentKeys.filter(isReelsContentKey),
      shortsContentKeys: Array.isArray(statsInput?.shortsContentKeys)
        ? normalizeStringList(statsInput.shortsContentKeys)
        : legacyContentKeys.filter(isShortsContentKey),
      timedSiteUsage:
        input?.stats?.timedSiteUsage &&
        typeof input.stats.timedSiteUsage === 'object' &&
        !Array.isArray(input.stats.timedSiteUsage)
          ? normalizeTimedSiteUsageRecord(input.stats.timedSiteUsage)
          : base.stats.timedSiteUsage,
    },
    settings: {
      ...base.settings,
      blockingEnabled: settingsInput?.blockingEnabled !== false,
      blockedUrlHints: Array.isArray(input?.settings?.blockedUrlHints)
        ? normalizeStringList(input.settings.blockedUrlHints)
        : base.settings.blockedUrlHints,
      maxReelsPerDay: normalizeLimit(
        settingsInput?.maxReelsPerDay ?? legacyLimit ?? base.settings.maxReelsPerDay,
      ),
      maxShortsPerDay: normalizeLimit(
        settingsInput?.maxShortsPerDay ?? legacyLimit ?? base.settings.maxShortsPerDay,
      ),
      taskReminderEnabled: settingsInput?.taskReminderEnabled !== false,
      timedSiteRules: Array.isArray(input?.settings?.timedSiteRules)
        ? input.settings.timedSiteRules
            .map(normalizeTimedSiteRule)
            .filter((rule): rule is TimedSiteRule => Boolean(rule))
        : base.settings.timedSiteRules,
    },
  }

  if (state.stats.dayKey !== getTodayKey()) {
    state.stats = {
      dayKey: getTodayKey(),
      completedTaskIds: [],
      reelsContentKeys: [],
      shortsContentKeys: [],
      timedSiteUsage: {},
    }
  }

  return state
}

export function getOpenTasks(state: ZenState) {
  return [...state.tasks]
    .filter((task) => task.status !== 'completed')
    .sort(compareTasks)
}

export function getUpcomingEvents(state: ZenState, limit = 3) {
  const now = Date.now()

  return [...state.events]
    .filter((event) => parseDate(event.end ?? event.start) >= now)
    .sort((a, b) => parseDate(a.start) - parseDate(b.start))
    .slice(0, limit)
}

export function getDailyScore(state: ZenState) {
  const { completedTasks, totalTasks } = getTaskCompletionCounts(state)

  if (totalTasks === 0) {
    return 100
  }

  return Math.min(100, Math.round((completedTasks / totalTasks) * 100))
}

export function getTaskCompletionCounts(state: ZenState) {
  const totalTasks = state.tasks.length
  const completedTasks = state.tasks.filter((task) => task.status === 'completed').length

  return {
    completedTasks,
    totalTasks,
  }
}

function compareTasks(first: ZenTask, second: ZenTask) {
  const firstDue = parseDate(first.due)
  const secondDue = parseDate(second.due)

  if (firstDue !== secondDue) {
    return firstDue - secondDue
  }

  return first.title.localeCompare(second.title)
}

function parseDate(value?: string) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER
  }

  const timestamp = Date.parse(value)

  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function normalizeLimit(value: unknown) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0
}

function normalizeStringList(values: unknown[]) {
  return values.filter((value): value is string => typeof value === 'string')
}

function isShortsContentKey(key: string) {
  return key.startsWith('youtube.com/shorts')
}

function isReelsContentKey(key: string) {
  return (
    key.startsWith('instagram.com/reel') ||
    key.startsWith('instagram.com/reels')
  )
}

function normalizeTimedSiteRule(rule: unknown): TimedSiteRule | undefined {
  if (!rule || typeof rule !== 'object') {
    return undefined
  }

  const candidate = rule as Partial<TimedSiteRule>
  const pattern = candidate.pattern?.trim()

  if (!candidate.id || !pattern) {
    return undefined
  }

  return {
    allowedMinutes: Math.max(0, Number(candidate.allowedMinutes) || 0),
    blockMinutes: Math.max(1, Number(candidate.blockMinutes) || 1),
    enabled: candidate.enabled !== false,
    id: candidate.id,
    pattern,
  }
}

function normalizeTimedSiteUsageRecord(
  usageRecord: Record<string, unknown>,
): Record<string, TimedSiteUsage> {
  return Object.fromEntries(
    Object.entries(usageRecord)
      .map(([ruleId, usage]) => [ruleId, normalizeTimedSiteUsage(usage, ruleId)] as const)
      .filter((entry): entry is readonly [string, TimedSiteUsage] => Boolean(entry[1])),
  )
}

function normalizeTimedSiteUsage(
  usage: unknown,
  fallbackRuleId: string,
): TimedSiteUsage | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined
  }

  const candidate = usage as Partial<TimedSiteUsage>
  const dayKey = typeof candidate.dayKey === 'string' ? candidate.dayKey : getTodayKey()
  const ruleId =
    typeof candidate.ruleId === 'string' && candidate.ruleId.trim()
      ? candidate.ruleId
      : fallbackRuleId

  return {
    activeUrl:
      typeof candidate.activeUrl === 'string' ? candidate.activeUrl : undefined,
    blockedUntil: normalizeOptionalTimestamp(candidate.blockedUntil),
    dayKey,
    ruleId,
    sessionStartedAt: normalizeOptionalTimestamp(candidate.sessionStartedAt),
    usedMs: Math.max(0, Number(candidate.usedMs) || 0),
  }
}

function normalizeOptionalTimestamp(value: unknown) {
  const timestamp = Number(value)

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined
}
