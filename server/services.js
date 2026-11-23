// Connects the match to outside services. Every one is optional: the game runs
// with none of them, and /api/status says which are really live.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')

export async function createServices() {
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return undefined } }
  const state = { llm: false, band: false, bruin: false, db: false, tts: false, telem: !!process.env.TELEM_API_KEY }
  const learning = readJson(path.join(DATA, 'learning.json'))
  const scenario = readJson(path.join(DATA, 'scenario.json'))

  const hooks = {
    onEnd(match, table) {
      fs.mkdirSync(DATA, { recursive: true })
      fs.writeFileSync(path.join(DATA, 'learning.json'), JSON.stringify(table, null, 2))
    },
  }
  return {
    hooks, learning, scenario,
    status: () => ({ ...state }),
    tts: (url, res) => { res.statusCode = 404; res.end() },
  }
}
