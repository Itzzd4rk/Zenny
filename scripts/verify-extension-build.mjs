import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifestPath = resolve('dist', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const clientId = manifest.oauth2?.client_id

if (
  typeof clientId !== 'string' ||
  clientId.includes('REPLACE_WITH') ||
  !clientId.endsWith('.apps.googleusercontent.com')
) {
  console.error('')
  console.error('Invalid OAuth client_id in dist/manifest.json.')
  console.error('Edit public/manifest.json, run npm run extension:build, then reload the extension.')
  process.exit(1)
}

console.log(`Verified OAuth client_id in ${manifestPath}`)
