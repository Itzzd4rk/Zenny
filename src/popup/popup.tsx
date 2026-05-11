import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bell,
  BellOff,
  Clapperboard,
  Copy,
  LogIn,
  LogOut,
  Plus,
  PlaySquare,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { EventList } from './components/EventList'
import { ScoreRing } from './components/ScoreRing'
import { TaskList } from './components/TaskList'
import '../index.css'
import {
  completeTask,
  createGoogleTask,
  disconnectGoogle,
  getConfiguredOAuthClientId,
  getConfiguredOAuthRedirectUri,
  signInAndSync,
  syncGoogleData,
  syncIfStale,
} from '../shared/google'
import { hasChromeStorage, updateZenState } from '../shared/storage'
import {
  CHECK_ACTIVE_TAB_BLOCKER_MESSAGE,
  STORAGE_KEY,
  createDefaultState,
  getDailyScore,
  getOpenTasks,
  getTaskCompletionCounts,
  getUpcomingEvents,
  normalizeZenState,
  type TimedSiteRule,
  type ZenState,
  type ZenTask,
} from '../shared/types'

function Popup() {
  const [state, setState] = useState<ZenState>(() => createDefaultState())
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'auth' | 'refresh' | 'signout'>()
  const [loadingTaskId, setLoadingTaskId] = useState<string>()
  const extensionId = getExtensionId()
  const oauthClientId = getConfiguredOAuthClientId()
  const oauthRedirectUri = getConfiguredOAuthRedirectUri()
  const [sitePattern, setSitePattern] = useState('')
  const [allowedMinutes, setAllowedMinutes] = useState('10')
  const [blockMinutes, setBlockMinutes] = useState('15')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [blockerStatus, setBlockerStatus] = useState<string>()

  const openTasks = useMemo(() => getOpenTasks(state).slice(0, 3), [state])
  const upcomingEvents = useMemo(() => getUpcomingEvents(state, 3), [state])
  const score = useMemo(() => getDailyScore(state), [state])
  const taskCounts = useMemo(() => getTaskCompletionCounts(state), [state])

  useEffect(() => {
    let mounted = true

    async function hydrate() {
      try {
        const cached = await syncIfStale()

        if (mounted) {
          setState(cached)
        }
      } catch (caughtError) {
        if (mounted) {
          setError(getErrorMessage(caughtError))
        }
      }
    }

    void hydrate()

    if (!hasChromeStorage()) {
      return () => {
        mounted = false
      }
    }

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName,
    ) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) {
        setState(normalizeZenState(changes[STORAGE_KEY].newValue as Partial<ZenState>))
      }
    }

    chrome.storage.onChanged.addListener(listener)

    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  async function handleSignIn() {
    setBusy('auth')
    setError(undefined)

    try {
      setState(await signInAndSync())
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setBusy(undefined)
    }
  }

  async function handleRefresh() {
    setBusy('refresh')
    setError(undefined)

    try {
      setState(await syncGoogleData(false))
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setBusy(undefined)
    }
  }

  async function handleCheckBlocker() {
    setError(undefined)
    setBlockerStatus('Checking active tab...')

    try {
      const response = await sendRuntimeMessage<{
        error?: string
        ok: boolean
        status?: string
        urlKey?: string
      }>({ type: CHECK_ACTIVE_TAB_BLOCKER_MESSAGE })

      if (!response.ok) {
        throw new Error(response.error ?? 'Blocker check failed.')
      }

      setBlockerStatus(`${response.status ?? 'Loaded'} (${response.urlKey ?? 'unknown URL'})`)
    } catch (caughtError) {
      const message = getErrorMessage(caughtError)
      setBlockerStatus(message)
      setError(message)
    }
  }

  async function handleSignOut() {
    setBusy('signout')
    setError(undefined)

    try {
      setState(await disconnectGoogle())
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setBusy(undefined)
    }
  }

  async function handleToggleBlocking() {
    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => ({
          ...currentState,
          settings: {
            ...currentState.settings,
            blockingEnabled: !currentState.settings.blockingEnabled,
          },
        })),
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleQuotaChange(
    setting: 'maxReelsPerDay' | 'maxShortsPerDay',
    value: string,
  ) {
    const limit = Math.max(0, Number(value) || 0)

    await updateSettings(
      setting === 'maxShortsPerDay'
        ? { maxShortsPerDay: limit }
        : { maxReelsPerDay: limit },
    )
  }

  async function handleToggleTaskReminder() {
    await updateSettings({
      taskReminderEnabled: !state.settings.taskReminderEnabled,
    })
  }

  async function handleResetDistractionUsage() {
    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => ({
          ...currentState,
          stats: {
            ...currentState.stats,
            reelsContentKeys: [],
            shortsContentKeys: [],
            timedSiteUsage: {},
          },
        })),
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleAddTimedSiteRule() {
    const pattern = sitePattern.trim()

    if (!pattern) {
      setError('Add a website link or domain first.')
      return
    }

    const rule: TimedSiteRule = {
      allowedMinutes: Math.max(0, Number(allowedMinutes) || 0),
      blockMinutes: Math.max(1, Number(blockMinutes) || 1),
      enabled: true,
      id: createRuleId(),
      pattern,
    }

    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => ({
          ...currentState,
          settings: {
            ...currentState.settings,
            timedSiteRules: [...currentState.settings.timedSiteRules, rule],
          },
        })),
      )
      setSitePattern('')
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleCreateTask() {
    const title = newTaskTitle.trim()

    if (!title) {
      setError('Write a task first.')
      return
    }

    setBusy('refresh')
    setError(undefined)

    try {
      setState(await createGoogleTask(title))
      setNewTaskTitle('')
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setBusy(undefined)
    }
  }

  async function handleRemoveTimedSiteRule(ruleId: string) {
    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => {
          const timedSiteUsage = { ...currentState.stats.timedSiteUsage }
          delete timedSiteUsage[ruleId]

          return {
            ...currentState,
            settings: {
              ...currentState.settings,
              timedSiteRules: currentState.settings.timedSiteRules.filter(
                (rule) => rule.id !== ruleId,
              ),
            },
            stats: {
              ...currentState.stats,
              timedSiteUsage,
            },
          }
        }),
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleToggleTimedSiteRule(ruleId: string) {
    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => ({
          ...currentState,
          settings: {
            ...currentState.settings,
            timedSiteRules: currentState.settings.timedSiteRules.map((rule) =>
              rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule,
            ),
          },
        })),
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleComplete(task: ZenTask) {
    setLoadingTaskId(task.id)
    setError(undefined)

    try {
      setState(await completeTask(task))
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setLoadingTaskId(undefined)
    }
  }

  async function updateSettings(settings: Partial<ZenState['settings']>) {
    setError(undefined)

    try {
      setState(
        await updateZenState((currentState) => ({
          ...currentState,
          settings: {
            ...currentState.settings,
            ...settings,
          },
        })),
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  return (
    <main className="zenny-shell w-[440px] min-h-[660px] bg-[#07100f] px-4 py-4 text-zinc-50">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            className="size-11 rounded-lg border border-teal-400/20 bg-black/40 p-1.5"
            src={getAssetUrl('icons/icon-48.png')}
            alt=""
          />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal text-white">Zenny</h1>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-teal-100/70">
              <ShieldCheck className="size-3.5 text-teal-300" aria-hidden="true" />
              <span>
                {state.signedIn
                  ? `Synced ${formatLastSync(state.lastSyncAt)}`
                  : 'Guard active'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.signedIn ? (
            <button
              className="grid size-9 place-items-center rounded-lg border border-teal-300/20 bg-black/30 text-teal-50/80 transition hover:border-teal-300/60 hover:text-white disabled:cursor-wait disabled:opacity-50"
              type="button"
              title="Refresh"
              aria-label="Refresh Google data"
              disabled={Boolean(busy)}
              onClick={handleRefresh}
            >
              <RefreshCw
                className={`size-4 ${busy === 'refresh' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : null}

          {state.signedIn ? (
            <button
              className="grid size-9 place-items-center rounded-lg border border-teal-300/20 bg-black/30 text-teal-50/80 transition hover:border-teal-300/60 hover:text-white disabled:cursor-wait disabled:opacity-50"
              type="button"
              title="Disconnect"
              aria-label="Disconnect Google"
              disabled={Boolean(busy)}
              onClick={handleSignOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <section className="zenny-panel mt-5 flex items-center gap-4 rounded-lg border border-teal-300/15 bg-black/25 p-4">
        <ScoreRing score={score} />
        <div className="min-w-0">
          <p className="text-sm text-teal-100/70">Today</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">
            {taskCounts.completedTasks}/{taskCounts.totalTasks} complete
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {openTasks.length === 0
              ? 'Clear mind.'
              : `${openTasks.length} open task${openTasks.length > 1 ? 's' : ''}`}
          </p>
        </div>
      </section>

      {!state.signedIn ? (
        <>
          <button
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-100 px-4 text-sm font-semibold text-teal-950 transition hover:bg-teal-200 disabled:cursor-wait disabled:opacity-60"
            type="button"
            disabled={busy === 'auth'}
            onClick={handleSignIn}
          >
            <LogIn className="size-4" aria-hidden="true" />
            Connect Google
          </button>
          <OAuthDiagnostics
            extensionId={extensionId}
            oauthClientId={oauthClientId}
            oauthRedirectUri={oauthRedirectUri}
          />
        </>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-900/70 bg-red-950/50 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Add task</h2>
          <span className="text-xs text-zinc-600">Google Tasks</span>
        </div>
        <div className="zenny-card grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-teal-300/15 bg-black/25 p-3">
          <input
            className="h-9 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
            placeholder="What needs doing?"
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleCreateTask()
              }
            }}
          />
          <button
            className="grid size-9 place-items-center rounded-lg border border-teal-300/20 bg-zinc-950 text-teal-100 transition hover:border-teal-300/70 hover:text-white disabled:cursor-wait disabled:opacity-50"
            type="button"
            title="Add Google task"
            aria-label="Add Google task"
            disabled={busy === 'refresh' || !state.signedIn}
            onClick={handleCreateTask}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">Guard rules</h2>
          <div className="flex items-center gap-2">
            <button
              className="flex h-8 items-center gap-1.5 rounded-lg border border-teal-300/15 bg-black/25 px-2 text-xs text-zinc-300 transition hover:border-teal-300/50 hover:text-white"
              type="button"
              onClick={handleResetDistractionUsage}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reset
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded-lg border border-teal-300/15 bg-black/25 px-2 text-xs text-zinc-300 transition hover:border-teal-300/50 hover:text-white"
              type="button"
              onClick={handleCheckBlocker}
            >
              Test
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <QuotaCard
              icon={<PlaySquare className="size-4" aria-hidden="true" />}
              label="YouTube Shorts"
              limit={state.settings.maxShortsPerDay}
              seen={state.stats.shortsContentKeys.length}
              onChange={(value) => {
                void handleQuotaChange('maxShortsPerDay', value)
              }}
            />
            <QuotaCard
              icon={<Clapperboard className="size-4" aria-hidden="true" />}
              label="Instagram Reels"
              limit={state.settings.maxReelsPerDay}
              seen={state.stats.reelsContentKeys.length}
              onChange={(value) => {
                void handleQuotaChange('maxReelsPerDay', value)
              }}
            />
          </div>

          <button
            className={`zenny-card flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left transition ${
              state.settings.taskReminderEnabled
                ? 'border-teal-300/30 bg-teal-950/25 text-teal-50'
                : 'border-zinc-800 bg-black/25 text-zinc-400'
            }`}
            type="button"
            onClick={handleToggleTaskReminder}
          >
            {state.settings.taskReminderEnabled ? (
              <Bell className="size-4 shrink-0 text-teal-300" aria-hidden="true" />
            ) : (
              <BellOff className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs font-semibold">30-minute task popup</span>
              <span className="text-[11px] text-zinc-500">
                {state.settings.taskReminderEnabled ? 'on' : 'off'}
              </span>
            </span>
          </button>
        </div>

        <div className="zenny-card mt-3 rounded-lg border border-teal-300/15 bg-black/25 p-3">
          <div className="grid gap-2">
            <input
              className="h-9 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
              placeholder="example.com or https://example.com/path"
              value={sitePattern}
              onChange={(event) => setSitePattern(event.target.value)}
            />
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                className="h-9 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
                min={0}
                title="Allowed minutes"
                type="number"
                value={allowedMinutes}
                onChange={(event) => setAllowedMinutes(event.target.value)}
              />
              <input
                className="h-9 min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
                min={1}
                title="Block minutes"
                type="number"
                value={blockMinutes}
                onChange={(event) => setBlockMinutes(event.target.value)}
              />
              <button
                className="grid size-9 place-items-center rounded-lg border border-teal-300/20 bg-zinc-950 text-teal-100 transition hover:border-teal-300/70 hover:text-white"
                type="button"
                title="Add timed site"
                aria-label="Add timed site"
                onClick={handleAddTimedSiteRule}
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex justify-between text-[11px] uppercase text-zinc-700">
              <span>site</span>
              <span>allowed / blocked minutes</span>
            </div>
          </div>

          <TimedSiteRuleList
            rules={state.settings.timedSiteRules}
            onRemove={handleRemoveTimedSiteRule}
            onToggle={handleToggleTimedSiteRule}
          />
        </div>

        {blockerStatus ? (
          <div className="mt-3 rounded-lg border border-zinc-900 bg-black p-3 text-xs leading-5 text-zinc-500">
            {blockerStatus}
          </div>
        ) : null}
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Tasks</h2>
          <span className="text-xs text-zinc-600">top {openTasks.length}</span>
        </div>
        <TaskList
          loadingTaskId={loadingTaskId}
          tasks={openTasks}
          onComplete={handleComplete}
        />
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Calendar</h2>
          <span className="text-xs text-zinc-600">next {upcomingEvents.length}</span>
        </div>
        <EventList events={upcomingEvents} />
      </section>

      <footer className="zenny-card mt-5 flex items-center justify-between rounded-lg border border-teal-300/15 bg-black/25 p-3">
        <span className="text-xs text-zinc-500">
          {state.settings.blockingEnabled ? 'Guard on' : 'Guard off'}
        </span>
        <button
          className={`grid size-8 place-items-center rounded-lg border transition hover:text-white ${
            state.settings.blockingEnabled
              ? 'border-teal-300/40 bg-teal-950/40 text-teal-200'
              : 'border-zinc-800 bg-zinc-950 text-zinc-400'
          }`}
          type="button"
          title={state.settings.blockingEnabled ? 'Turn guard off' : 'Turn guard on'}
          aria-label={state.settings.blockingEnabled ? 'Turn guard off' : 'Turn guard on'}
          onClick={handleToggleBlocking}
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
        </button>
      </footer>
    </main>
  )
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(response)
    })
  })
}

function QuotaCard({
  icon,
  label,
  limit,
  onChange,
  seen,
}: {
  icon: ReactNode
  label: string
  limit: number
  onChange: (value: string) => void
  seen: number
}) {
  const remaining = Math.max(0, limit - seen)

  return (
    <label className="zenny-card grid gap-2 rounded-lg border border-teal-300/15 bg-black/25 p-3">
      <span className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
        <span className="grid size-7 place-items-center rounded-lg bg-teal-400/10 text-teal-300">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <input
        className="h-9 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
        min={0}
        type="number"
        value={limit}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="text-[11px] text-zinc-500">
        {seen} watched, {limit === 0 ? 'locked' : `${remaining} left`}
      </span>
    </label>
  )
}

function TimedSiteRuleList({
  onRemove,
  onToggle,
  rules,
}: {
  onRemove: (ruleId: string) => void
  onToggle: (ruleId: string) => void
  rules: TimedSiteRule[]
}) {
  if (rules.length === 0) {
    return <p className="mt-3 text-xs text-zinc-600">No timed sites yet.</p>
  }

  return (
    <div className="mt-3 grid gap-2">
      {rules.map((rule) => (
        <div
          className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-teal-300/10 bg-zinc-950/80 p-2"
          key={rule.id}
        >
          <button
            className="min-w-0 text-left"
            type="button"
            title={rule.enabled ? 'Disable rule' : 'Enable rule'}
            onClick={() => onToggle(rule.id)}
          >
            <p className="truncate text-xs font-medium text-zinc-200">{rule.pattern}</p>
            <p className="mt-0.5 text-[11px] text-zinc-600">
              {rule.allowedMinutes}m allowed, {rule.blockMinutes}m blocked
            </p>
          </button>
          <span
            className={`rounded-md px-2 py-1 text-[11px] ${
              rule.enabled
                ? 'bg-teal-950 text-teal-300'
                : 'bg-zinc-900 text-zinc-500'
            }`}
          >
            {rule.enabled ? 'on' : 'off'}
          </span>
          <button
            className="grid size-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 transition hover:border-teal-300/60 hover:text-white"
            type="button"
            title="Remove rule"
            aria-label={`Remove ${rule.pattern}`}
            onClick={() => onRemove(rule.id)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

function OAuthDiagnostics({
  extensionId,
  oauthClientId,
  oauthRedirectUri,
}: {
  extensionId?: string
  oauthClientId?: string
  oauthRedirectUri?: string
}) {
  return (
    <section className="mt-3 rounded-lg border border-zinc-900 bg-black p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase text-zinc-500">OAuth setup</h2>
        <span className="text-[11px] text-zinc-600">Web application client</span>
      </div>

      <SetupValue label="Extension ID" value={extensionId} />
      <SetupValue label="OAuth Client ID" value={oauthClientId} />
      <SetupValue label="Redirect URI" value={oauthRedirectUri} />

      <p className="mt-3 text-xs leading-5 text-zinc-500">
        In Google Cloud, create a Web application OAuth client and add this exact
        Redirect URI under Authorized redirect URIs.
      </p>
    </section>
  )
}

function SetupValue({ label, value }: { label: string; value?: string }) {
  async function copyValue() {
    if (!value) {
      return
    }

    await navigator.clipboard.writeText(value)
  }

  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] uppercase text-zinc-600">{label}</div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <code className="min-w-0 truncate rounded-md border border-zinc-900 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-300">
          {value ?? 'Unavailable'}
        </code>
        <button
          className="grid size-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          title={`Copy ${label}`}
          aria-label={`Copy ${label}`}
          disabled={!value}
          onClick={copyValue}
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function getExtensionId() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    return undefined
  }

  return chrome.runtime.id
}

function getAssetUrl(path: string) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
    return path
  }

  return chrome.runtime.getURL(path)
}

function createRuleId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatLastSync(timestamp?: number) {
  if (!timestamp) {
    return 'pending'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went still and strange.'
}

createRoot(document.getElementById('root')!).render(<Popup />)
