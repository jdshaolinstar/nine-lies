// Connects the match to outside services. Every one is optional: the game runs
// with none of them, and /api/status says which are really live.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TACTICS } from '../shared/brain.js'
import { DEFAULT_SCENARIO } from '../shared/scenario.js'
import { thinkerFor, captainFor, chat, llmStats } from './llm.js'
import { connectBand, bandStats } from './band.js'
import { connectWarehouse, alibiScanner, learnedTactics, captainBriefing, bruinQuery, whStats } from './warehouse.js'
import { createTts, ttsReady, allowLine, ttsStats } from './tts.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')
const env = process.env

export async function createServices() {
  fs.mkdirSync(DATA, { recursive: true })
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) } catch { return undefined } }
  const scenario = { ...DEFAULT_SCENARIO, ...readJson('scenario.json') }
  const state = { llm: false, band: false, postgres: false, bruin: false, voices: false }
  const problems = {}
  const attempt = async (name, fn) => {
    try { await fn(); state[name] = true } catch (e) { problems[name] = e.message; console.error(`${name} is off:`, e.message) }
  }

  let wh, band
  const matches = new Map() // id -> match, for labelling vendor calls
  const lines = new Map() // who|text -> match
  const learning = { ...Object.fromEntries(TACTICS.map((t) => [t, { wins: 0, plays: 0 }])), ...readJson('learning.json') }
  if (env.RUNWARE_API_KEY) await attempt('llm', () => chat([{ role: 'user', content: 'Reply with the word ok' }], { maxTokens: 40, timeout: 15000 }))
  if (env.DATABASE_URL) await attempt('postgres', async () => { wh = await connectWarehouse(ROOT, (id) => matches.get(id)) })
  if (env.BRUIN_TOKEN && env.BRUIN_CONNECTION_SET_ID && wh) {
    await attempt('bruin', async () => {
      await bruinQuery('select 1 as ok')
      const t = await learnedTactics()
      for (const k of Object.keys(t)) if (learning[k]) learning[k] = t[k]
    })
  }
  if (fs.existsSync(path.join(DATA, 'band-agents.json'))) await attempt('band', async () => { band = await connectBand(DATA) })
  const tts = createTts(DATA, (who, text, ms, cached) => {
    lines.get(`${who}|${text}`)?.vendor?.({ vendor: 'runware', who, sticker: cached ? undefined : 'voice', ms: cached ? null : ms, count: cached ? 0 : 1, what: `${who[0].toUpperCase() + who.slice(1)}'s voice: "${text}"${cached ? ' (reused)' : ''}` })
  })
  if (ttsReady()) await attempt('voices', () => tts.get('captain', 'Good evening, kittens.'))

  const hooks = {
    thinkerFor: () => (state.llm ? thinkerFor() : null),
    scanner: state.bruin ? alibiScanner(wh) : undefined,
    onEvent(id, e) {
      if (e.type === 'radio' && e.data.text) {
        allowLine(e.actor ?? e.data.from, e.data.text)
        lines.set(`${e.actor ?? e.data.from}|${e.data.text}`, matches.get(id))
        if (lines.size > 2000) lines.delete(lines.keys().next().value)
      }
      wh?.event(id, e)
    },
    onMatch(m) {
      matches.set(m.id, m)
      if (matches.size > 30) matches.delete(matches.keys().next().value)
      if (band) m.transport = band
      if (state.llm) m.captainThinker = captainFor(scenario)
      if (state.bruin) captainBriefing().then((b) => {
        const dog = m.briefCaptain(b)
        m.vendor?.({ vendor: 'bruin', who: dog, sticker: 'past heists', ms: b.ms, secret: true, what: `Captain studied past heists: ${m.captain.habits ?? 'nothing yet'}`, hidden: 'The dog captain studied past heists' })
      }).catch((e) => { whStats.lastError = e.message })
    },
    async onEnd(m, table) {
      fs.writeFileSync(path.join(DATA, 'learning.json'), JSON.stringify(table, null, 2))
      if (!wh) return
      try {
        await wh.flush()
        await wh.match(m, state.llm)
        // Bruin is the source of truth for what the mole has learned.
        if (state.bruin) {
          const t0 = Date.now()
          const t = await learnedTactics()
          for (const k of Object.keys(t)) if (table[k]) table[k] = t[k]
          m.vendor?.({ vendor: 'bruin', ms: Date.now() - t0, what: 'Updated what the traitor has learned from every match on record' })
        }
      } catch (e) { whStats.lastError = e.message }
    },
  }
  return {
    hooks, learning, scenario,
    status: () => ({ ...state }),
    detail: () => ({ problems, llm: llmStats, band: bandStats, warehouse: whStats, voices: ttsStats }),
    tts: tts.handle,
  }
}
