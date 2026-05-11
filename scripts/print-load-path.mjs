import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionDir = resolve('dist')
const manifestPath = resolve(extensionDir, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json was not found. Run npm run build first.')
  process.exit(1)
}

console.log('')
console.log('Chrome Load unpacked folder:')
console.log(extensionDir)
console.log('')
console.log('Do not select the project root. Select the dist folder above.')
