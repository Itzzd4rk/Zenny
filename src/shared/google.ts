import {
  clearStoredGoogleToken,
  getAuthToken as getDirectAuthToken,
} from './auth'
import { getZenState, updateZenState } from './storage'
import {
  CLEAR_GOOGLE_TOKEN_MESSAGE,
  GET_GOOGLE_TOKEN_MESSAGE,
  createDefaultState,
  type ZenEvent,
  type ZenState,
  type ZenTask,
} from './types'

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1'
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const SYNC_TTL_MS = 5 * 60 * 1000
const FALLBACK_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.readonly',
]

type AuthedRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

type GoogleTaskList = {
  id?: string
  title?: string
}

type GoogleTaskListsResponse = {
  items?: GoogleTaskList[]
}

type GoogleTask = {
  id?: string
  title?: string
  notes?: string
  due?: string
  completed?: string
  updated?: string
  status?: 'needsAction' | 'completed'
  deleted?: boolean
}

type GoogleTasksResponse = {
  items?: GoogleTask[]
}

type GoogleCalendarEvent = {
  id?: string
  summary?: string
  location?: string
  status?: string
  start?: {
    date?: string
    dateTime?: string
  }
  end?: {
    date?: string
    dateTime?: string
  }
}

type GoogleCalendarListItem = {
  hidden?: boolean
  id?: string
  primary?: boolean
  selected?: boolean
  summary?: string
}

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListItem[]
}

type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[]
}

export async function signInAndSync() {
  return syncGoogleData(true)
}

export function getConfiguredOAuthClientId() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) {
    return undefined
  }

  return chrome.runtime.getManifest().oauth2?.client_id
}

export function getConfiguredOAuthRedirectUri() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    return undefined
  }

  return `https://${chrome.runtime.id}.chromiumapp.org/`
}

export function getConfiguredOAuthScopes() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) {
    return FALLBACK_GOOGLE_SCOPES
  }

  return chrome.runtime.getManifest().oauth2?.scopes ?? FALLBACK_GOOGLE_SCOPES
}

export async function syncIfStale(maxAgeMs = SYNC_TTL_MS): Promise<ZenState> {
  const cached = await getZenState()

  if (!cached.signedIn) {
    return cached
  }

  if (cached.lastSyncAt && Date.now() - cached.lastSyncAt < maxAgeMs) {
    return cached
  }

  try {
    return await syncGoogleData(false)
  } catch {
    return cached
  }
}

export async function syncGoogleData(interactive = false): Promise<ZenState> {
  const token = await getGoogleToken(interactive)
  const [tasks, events] = await Promise.all([
    fetchGoogleTasks(token),
    fetchGoogleCalendarEvents(token),
  ])

  return updateZenState((state) => ({
    ...state,
    tasks,
    events,
    signedIn: true,
    lastSyncAt: Date.now(),
  }))
}

export async function completeTask(task: ZenTask): Promise<ZenState> {
  const completedAt = new Date().toISOString()

  if (task.source === 'google-tasks' && task.taskListId) {
    const token = await getGoogleToken(false)

    await authedFetch<GoogleTask>(
      token,
      `${TASKS_API_BASE}/lists/${encodeURIComponent(task.taskListId)}/tasks/${encodeURIComponent(task.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          completed: completedAt,
          status: 'completed',
        }),
      },
    )
  }

  return updateZenState((state) => {
    const completedTaskIds = new Set(state.stats.completedTaskIds)
    completedTaskIds.add(task.id)

    return {
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? { ...candidate, completed: completedAt, status: 'completed' }
          : candidate,
      ),
      stats: {
        ...state.stats,
        completedTaskIds: [...completedTaskIds],
        lastCompletionAt: Date.now(),
      },
    }
  })
}

export async function createGoogleTask(title: string, notes?: string): Promise<ZenState> {
  const trimmedTitle = title.trim()

  if (!trimmedTitle) {
    throw new Error('Task title is required.')
  }

  const token = await getGoogleToken(true)
  const taskListId = await fetchDefaultTaskListId(token)

  await authedFetch<GoogleTask>(
    token,
    `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify({
        notes: notes?.trim() || undefined,
        title: trimmedTitle,
      }),
    },
  )

  return syncGoogleData(false)
}

export async function disconnectGoogle(): Promise<ZenState> {
  await clearGoogleToken()

  return updateZenState((state) => ({
    ...createDefaultState(),
    settings: state.settings,
  }))
}

async function getGoogleToken(interactive: boolean): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.identity) {
    throw new Error('chrome.identity is only available inside Chrome.')
  }

  if (isServiceWorkerContext()) {
    return getDirectAuthToken(interactive)
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { interactive, type: GET_GOOGLE_TOKEN_MESSAGE },
      (response?: { error?: string; ok: boolean; token?: string }) => {
        const error = chrome.runtime.lastError

        if (error || !response?.ok || !response.token) {
          reject(new Error(error?.message ?? response?.error ?? 'No Google token returned.'))
          return
        }

        resolve(response.token)
      },
    )
  })
}

function clearGoogleToken(): Promise<void> {
  if (isServiceWorkerContext()) {
    return clearStoredGoogleToken()
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: CLEAR_GOOGLE_TOKEN_MESSAGE },
      (response?: { error?: string; ok: boolean }) => {
        const error = chrome.runtime.lastError

        if (error || !response?.ok) {
          reject(
            new Error(error?.message ?? response?.error ?? 'Could not clear Google token.'),
          )
          return
        }

        resolve()
      },
    )
  })
}

function isServiceWorkerContext() {
  return typeof window === 'undefined'
}

async function authedFetch<T>(
  token: string,
  url: string,
  init: AuthedRequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...init.headers,
  }

  if (init.body) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url, {
    ...init,
    headers,
  })

  if (response.status === 401) {
    await clearGoogleToken()
    throw new Error('Google authorization expired. Connect Google again.')
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Google API request failed (${response.status}): ${details}`)
  }

  return response.json() as Promise<T>
}

async function fetchGoogleTasks(token: string): Promise<ZenTask[]> {
  const taskListsResponse = await authedFetch<GoogleTaskListsResponse>(
    token,
    `${TASKS_API_BASE}/users/@me/lists`,
  )
  const taskLists = taskListsResponse.items?.filter((list) => list.id) ?? []

  const taskGroups = await Promise.all(
    taskLists.slice(0, 8).map(async (taskList) => {
      const response = await authedFetch<GoogleTasksResponse>(
        token,
        `${TASKS_API_BASE}/lists/${encodeURIComponent(taskList.id ?? '')}/tasks?${new URLSearchParams(
          {
            maxResults: '50',
            showCompleted: 'true',
            showDeleted: 'false',
            showHidden: 'true',
          },
        )}`,
      )

      return (
        response.items
          ?.map((task) => mapGoogleTask(task, taskList.id ?? ''))
          .filter((task): task is ZenTask => Boolean(task)) ?? []
      )
    }),
  )

  return taskGroups.flat().sort(compareTasks)
}

async function fetchDefaultTaskListId(token: string) {
  const taskListsResponse = await authedFetch<GoogleTaskListsResponse>(
    token,
    `${TASKS_API_BASE}/users/@me/lists`,
  )
  const taskListId = taskListsResponse.items?.find((list) => list.id)?.id

  if (!taskListId) {
    throw new Error('No Google Tasks list was found.')
  }

  return taskListId
}

async function fetchGoogleCalendarEvents(token: string): Promise<ZenEvent[]> {
  const calendars = await fetchCalendarList(token)
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    maxResults: '10',
    orderBy: 'startTime',
    singleEvents: 'true',
    timeMax,
    timeMin,
  })

  const eventGroups = await Promise.all(
    calendars.slice(0, 8).map(async (calendar) => {
      const response = await authedFetch<GoogleCalendarEventsResponse>(
        token,
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendar.id ?? 'primary')}/events?${params}`,
      )

      return (
        response.items
          ?.map((event) => mapCalendarEvent(event, calendar.id ?? 'primary'))
          .filter((event): event is ZenEvent => Boolean(event)) ?? []
      )
    }),
  )

  return eventGroups
    .flat()
    .sort((first, second) => Date.parse(first.start) - Date.parse(second.start))
}

async function fetchCalendarList(token: string) {
  const response = await authedFetch<GoogleCalendarListResponse>(
    token,
    `${CALENDAR_API_BASE}/users/me/calendarList?${new URLSearchParams({
      minAccessRole: 'reader',
    })}`,
  )

  const calendars =
    response.items?.filter(
      (calendar) =>
        calendar.id &&
        !calendar.hidden &&
        (calendar.primary || calendar.selected !== false),
    ) ?? []

  if (calendars.length === 0) {
    return [{ id: 'primary', primary: true, selected: true, summary: 'Primary' }]
  }

  return calendars.sort((first, second) => {
    if (first.primary) {
      return -1
    }

    if (second.primary) {
      return 1
    }

    return (first.summary ?? '').localeCompare(second.summary ?? '')
  })
}

function mapGoogleTask(task: GoogleTask, taskListId: string): ZenTask | null {
  const title = task.title?.trim()

  if (!task.id || !title || task.deleted) {
    return null
  }

  return {
    id: task.id,
    taskListId,
    title,
    notes: task.notes,
    due: task.due,
    completed: task.completed,
    updated: task.updated,
    status: task.status === 'completed' ? 'completed' : 'needsAction',
    source: 'google-tasks',
  }
}

function mapCalendarEvent(event: GoogleCalendarEvent, calendarId: string): ZenEvent | null {
  const start = event.start?.dateTime ?? event.start?.date

  if (!event.id || !start || event.status === 'cancelled') {
    return null
  }

  return {
    id: `${calendarId}:${event.id}`,
    calendarId,
    title: event.summary?.trim() || 'Untitled event',
    start,
    end: event.end?.dateTime ?? event.end?.date,
    location: event.location,
  }
}

function compareTasks(first: ZenTask, second: ZenTask) {
  const firstDue = parseDate(first.due)
  const secondDue = parseDate(second.due)

  if (first.status !== second.status) {
    return first.status === 'needsAction' ? -1 : 1
  }

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
