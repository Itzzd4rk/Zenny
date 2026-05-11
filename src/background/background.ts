import { clearStoredGoogleToken, getAuthToken } from '../shared/auth'
import { syncIfStale } from '../shared/google'
import { getZenState, updateZenState } from '../shared/storage'
import {
  CLEAR_GOOGLE_TOKEN_MESSAGE,
  CHECK_ACTIVE_TAB_BLOCKER_MESSAGE,
  GET_GOOGLE_TOKEN_MESSAGE,
  OPEN_DASHBOARD_MESSAGE,
  PING_CONTENT_SCRIPT_MESSAGE,
  SHOW_TASK_REMINDER_MESSAGE,
  getOpenTasks,
} from '../shared/types'

const TASK_REMINDER_ALARM = 'zenny:task-reminder'
const SYNC_ALARM = 'zen:google-sync'
const LEGACY_ALARMS = ['zen:no-progress-reminder', 'zen:two-hour-check-in']

runSafely(initializeBackground(), 'initialize background')

chrome.runtime.onInstalled.addListener(() => {
  runSafely(initializeBackground(), 'initialize after install')
})

chrome.runtime.onStartup.addListener(() => {
  runSafely(initializeBackground(), 'initialize after startup')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  runSafely(handleAlarm(alarm.name), `handle ${alarm.name}`)
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isOpenDashboardMessage(message)) {
    runSafely(openDashboard(), 'open dashboard from content script')
    sendResponse({ ok: true })
    return false
  }

  if (isGetGoogleTokenMessage(message)) {
    void getAuthToken(Boolean(message.interactive))
      .then((token) => sendResponse({ ok: true, token }))
      .catch((error: unknown) => {
        sendResponse({
          error: getErrorMessage(error),
          ok: false,
        })
      })

    return true
  }

  if (isClearGoogleTokenMessage(message)) {
    void clearStoredGoogleToken()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          error: getErrorMessage(error),
          ok: false,
        })
      })

    return true
  }

  if (isCheckActiveTabBlockerMessage(message)) {
    void checkActiveTabBlocker()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => {
        sendResponse({
          error: getErrorMessage(error),
          ok: false,
        })
      })

    return true
  }

  return false
})

async function initializeBackground() {
  await updateZenState((state) => state)
  await Promise.all(LEGACY_ALARMS.map(clearAlarm))
  await ensureAlarm(SYNC_ALARM, 1)
  await ensureAlarm(TASK_REMINDER_ALARM, 30)
}

async function handleAlarm(name: string) {
  if (name === SYNC_ALARM) {
    await syncIfStale(55 * 1000)
    return
  }

  if (name !== TASK_REMINDER_ALARM) {
    return
  }

  const syncedState = await syncIfStale(55 * 1000)
  const state = syncedState ?? (await getZenState())
  const openTasks = getOpenTasks(state)

  if (!state.settings.taskReminderEnabled || openTasks.length === 0) {
    return
  }

  await showTaskReminderInActiveTab(openTasks[0].title)
}

async function ensureAlarm(name: string, periodInMinutes: number) {
  const existing = await getAlarm(name)

  if (existing) {
    return
  }

  await createAlarm(name, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  })
}

function getAlarm(name: string): Promise<chrome.alarms.Alarm | undefined> {
  return new Promise((resolve) => {
    chrome.alarms.get(name, resolve)
  })
}

function createAlarm(
  name: string,
  alarmInfo: chrome.alarms.AlarmCreateInfo,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.alarms.create(name, alarmInfo, () => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve()
    })
  })
}

function clearAlarm(name: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.alarms.clear(name, (wasCleared) => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(wasCleared)
    })
  })
}

function openDashboard(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }, () => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve()
    })
  })
}

function isOpenDashboardMessage(message: unknown) {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === OPEN_DASHBOARD_MESSAGE
  )
}

function isGetGoogleTokenMessage(
  message: unknown,
): message is { interactive?: boolean; type: typeof GET_GOOGLE_TOKEN_MESSAGE } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === GET_GOOGLE_TOKEN_MESSAGE
  )
}

function isClearGoogleTokenMessage(message: unknown) {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === CLEAR_GOOGLE_TOKEN_MESSAGE
  )
}

function isCheckActiveTabBlockerMessage(message: unknown) {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === CHECK_ACTIVE_TAB_BLOCKER_MESSAGE
  )
}

function runSafely(task: Promise<unknown>, context: string) {
  task.catch((error: unknown) => {
    console.warn(`[Zenny] Failed to ${context}`, error)
  })
}

async function showTaskReminderInActiveTab(taskTitle: string) {
  const [tab] = await queryActiveTabs()

  if (!tab?.id || !isInjectableUrl(tab.url)) {
    return
  }

  const injection = await injectContentScript(tab.id)

  if (!injection.injected) {
    return
  }

  await sendMessageToTab(tab.id, {
    taskTitle,
    type: SHOW_TASK_REMINDER_MESSAGE,
  })
}

async function checkActiveTabBlocker() {
  const [tab] = await queryActiveTabs()

  if (!tab?.id || !isInjectableUrl(tab.url)) {
    return {
      injected: false,
      status: 'Open a normal http/https tab first.',
      url: tab?.url,
    }
  }

  const injection = await injectContentScript(tab.id)

  if (!injection.injected) {
    return {
      ...injection,
      url: tab.url,
    }
  }

  try {
    const response = await sendMessageToTab(tab.id, { type: PING_CONTENT_SCRIPT_MESSAGE })

    return {
      injected: true,
      ...response,
    }
  } catch (error) {
    return {
      injected: false,
      status: `Content script did not answer on this tab: ${getErrorMessage(error)}`,
      url: tab.url,
    }
  }
}

function queryActiveTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(tabs)
    })
  })
}

async function injectContentScript(tabId: number) {
  try {
    await executeScript(tabId)

    return {
      injected: true,
      status: 'Content script is running on this tab.',
    }
  } catch (error) {
    const message = getErrorMessage(error)

    if (
      message.includes('Cannot access') ||
      message.includes('Missing host permission') ||
      message.includes('No tab with id') ||
      message.includes('The extensions gallery cannot be scripted') ||
      message.includes('chrome://')
    ) {
      return {
        injected: false,
        status: `Chrome blocked script access on this page: ${message}`,
      }
    }

    return {
      injected: false,
      status: `Could not inject the blocker on this tab: ${message}`,
    }
  }
}

function executeScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        files: ['content.js'],
        target: { tabId },
      },
      () => {
        const error = chrome.runtime.lastError

        if (error) {
          reject(new Error(error.message))
          return
        }

        resolve()
      },
    )
  })
}

function sendMessageToTab(
  tabId: number,
  message: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(response as Record<string, unknown>)
    })
  })
}

function isInjectableUrl(url?: string) {
  return Boolean(url && /^https?:\/\//i.test(url))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
