import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Minimal .env loader. Real environment variables win.
export function loadEnv() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
