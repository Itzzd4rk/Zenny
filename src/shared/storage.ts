import {
  STORAGE_KEY,
  normalizeZenState,
  type ZenState,
} from './types'

export async function getZenState(): Promise<ZenState> {
  if (!hasChromeStorage()) {
    return getLocalFallbackState()
  }

  const stored = await storageGet<Partial<ZenState>>(STORAGE_KEY)
  const normalized = normalizeZenState(stored)

  if (stored?.stats?.dayKey !== normalized.stats.dayKey) {
    await saveZenState(normalized)
  }

  return normalized
}

export async function saveZenState(state: ZenState) {
  const normalized = normalizeZenState(state)

  if (!hasChromeStorage()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  }

  await storageSet({ [STORAGE_KEY]: normalized })
  return normalized
}

export async function updateZenState(
  updater: (state: ZenState) => ZenState,
): Promise<ZenState> {
  const current = await getZenState()
  const next = normalizeZenState(updater(current))

  return saveZenState(next)
}

export function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function getLocalFallbackState() {
  try {
    const rawState = localStorage.getItem(STORAGE_KEY)
    return normalizeZenState(rawState ? JSON.parse(rawState) : undefined)
  } catch {
    return normalizeZenState()
  }
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve(result[key] as T | undefined)
    })
  })
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve()
    })
  })
}
