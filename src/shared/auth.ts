const GOOGLE_TOKEN_KEY = 'zen_google_oauth_token'
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000

type StoredGoogleToken = {
  accessToken: string
  expiresAt: number
  scopes: string[]
}

export async function getAuthToken(interactive: boolean): Promise<string> {
  const cachedToken = await getStoredGoogleToken()
  const requiredScopes = getRequiredScopes()

  if (
    cachedToken &&
    cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now() &&
    hasRequiredScopes(cachedToken.scopes, requiredScopes)
  ) {
    return cachedToken.accessToken
  }

  try {
    return await requestGoogleToken(false, requiredScopes)
  } catch (error) {
    if (!interactive) {
      throw new Error(
        `Google session expired. Click Connect Google again. ${getErrorMessage(error)}`,
        { cause: error },
      )
    }
  }

  return requestGoogleToken(true, requiredScopes)
}

export function clearStoredGoogleToken() {
  return storageRemove(GOOGLE_TOKEN_KEY)
}

async function requestGoogleToken(
  interactive: boolean,
  scopes: string[],
): Promise<string> {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`

  if (!clientId || clientId.includes('REPLACE_WITH')) {
    throw new Error('Set a Google OAuth Client ID in public/manifest.json.')
  }

  const state = createOAuthState()
  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'token')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('include_granted_scopes', 'true')

  const redirectUrl = await launchWebAuthFlow(authUrl.toString(), interactive)
  const token = parseGoogleOAuthRedirect(redirectUrl, state, scopes)
  await saveStoredGoogleToken(token)

  return token.accessToken
}

function launchWebAuthFlow(url: string, interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url, interactive },
      (redirectUrl) => {
        const error = chrome.runtime.lastError

        if (error || !redirectUrl) {
          reject(new Error(error?.message ?? 'No redirect URL returned from Google.'))
          return
        }

        resolve(redirectUrl)
      },
    )
  })
}

function getRequiredScopes() {
  return (
    chrome.runtime.getManifest().oauth2?.scopes ?? [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar.readonly',
    ]
  )
}

function hasRequiredScopes(tokenScopes: string[], requiredScopes: string[]) {
  const availableScopes = new Set(tokenScopes)

  return requiredScopes.every((scope) => availableScopes.has(scope))
}

function parseGoogleOAuthRedirect(
  redirectUrl: string,
  expectedState: string,
  fallbackScopes: string[],
): StoredGoogleToken {
  const hash = new URL(redirectUrl).hash.substring(1)
  const params = new URLSearchParams(hash)
  const error = params.get('error')

  if (error) {
    const description = params.get('error_description')
    throw new Error(description ? `${error}: ${description}` : error)
  }

  if (params.get('state') !== expectedState) {
    throw new Error('OAuth state mismatch. Try connecting Google again.')
  }

  const accessToken = params.get('access_token')

  if (!accessToken) {
    throw new Error('No token in redirect.')
  }

  const expiresInSeconds = Number(params.get('expires_in') ?? '3600')

  return {
    accessToken,
    expiresAt:
      Date.now() +
      (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000,
    scopes: params.get('scope')?.split(' ') ?? fallbackScopes,
  }
}

function createOAuthState() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  const values = new Uint8Array(16)
  crypto.getRandomValues(values)

  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function getStoredGoogleToken() {
  const token = await storageGet<StoredGoogleToken>(GOOGLE_TOKEN_KEY)

  if (!token?.accessToken || typeof token.expiresAt !== 'number') {
    return undefined
  }

  return token
}

function saveStoredGoogleToken(token: StoredGoogleToken) {
  return storageSet({ [GOOGLE_TOKEN_KEY]: token })
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

function storageRemove(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError

      if (error) {
        reject(new Error(error.message))
        return
      }

      resolve()
    })
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
