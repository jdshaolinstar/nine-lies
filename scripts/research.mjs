// The viral scenario engine. Telem searches the live web for which spy-film
// moments people love, the evidence is scored, and the winner becomes the next
// mission. Run: node scripts/research.mjs   (restart the server to load it)
import fs from 'node:fs'
import { loadEnv } from '../server/env.js'
import { chat, parseJson } from '../server/llm.js'
import { DEFAULT_SCENARIO, SET_PIECES } from '../shared/scenario.js'

loadEnv()
const KEY = process.env.TELEM_API_KEY
if (!KEY) { console.error('Set TELEM_API_KEY in .env first'); process.exit(1) }

// Neutral on purpose: no query names a trope, so none gets a head start.
const QUERIES = [
  'most iconic spy movie scenes of all time ranked',
  'best heist movie scenes fans love most',
  'viral spy thriller scene social media reaction 2026',
  'what makes a spy movie scene memorable to audiences',
  'fan favorite moments in spy and heist movies discussion',
]
// Generic trope words only. The game copies no film's scene, names or art.
const TROPES = {
  wire_drop: /\b(wire|ceiling|rope|suspended|harness|rappel|dangling|hang(s|ing)?)\b/gi,
  laser_hall: /\b(lasers?|laser grid|tripwires?|beams?)\b/gi,
  blackout: /\b(blackout|night vision|power cut|lights (go )?out|dark(ness)?)\b/gi,
  rooftop: /\b(rooftops?|helicopters?|escape|getaway|parachut\w+|skyscraper)\b/gi,
  double_cross: /\b(double[- ]cross\w*|betray\w*|traitor|double agent|mole|turncoat|twist)\b/gi,
}

async function search(query) {
  const r = await fetch('https://router.telem.ai/v1/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user_input: { query }, search: { num_results: 6 } }),
    signal: AbortSignal.timeout(30000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Telem ${r.status}: ${text.slice(0, 200)}`)
  const out = []
  for (const run of JSON.parse(text).preprocessor_runs ?? []) {
    for (const x of run.output_payload?.results ?? []) {
      out.push({ provider: run.preprocessor_name, rank: x.rank, url: x.url, title: x.title ?? x.url, text: [x.title, x.description, x.snippet, x.text, x.content, x.summary, ...(x.highlights ?? [])].filter((s) => typeof s === 'string').join(' ').slice(0, 4000) })
    }
  }
  return out
}

const evidence = []
for (const q of QUERIES) {
  try {
    const rows = await search(q)
    console.log(`${rows.length} results: ${q}`)
    rows.forEach((r) => evidence.push({ ...r, query: q }))
  } catch (e) { console.error(q, '->', e.message) }
}
// One vote per page, weighted by search rank, so a long page can't win alone.
// Only pages whose title is about films: news about real spies says nothing about taste in movies.
const pages = [...new Map(evidence.map((e) => [e.url, e])).values()].filter((p) => /\b(movies?|films?|scenes?|heists?|cinema|thrillers?)\b/i.test(p.title))
const board = Object.entries(TROPES).map(([id, re]) => {
  const hits = pages.filter((p) => p.text.match(re))
  return { id, pages: hits.length, score: +hits.reduce((s, p) => s + 1 / Math.sqrt(p.rank || 1), 0).toFixed(2), sources: hits.slice(0, 5).map((p) => ({ title: p.title, url: p.url })) }
}).sort((a, b) => b.score - a.score)
console.table(board.map(({ id, pages: n, score }) => ({ id, pages: n, score })))
const top = board[0]
if (!top || !top.pages) { console.error('No usable evidence, keeping the current scenario.'); process.exit(1) }

let skin = {}
if (process.env.RUNWARE_API_KEY) {
  try {
    skin = parseJson(await chat([
      { role: 'system', content: 'You write original, funny mission briefings for a game about ninja spy cats robbing a dog villain. Use no names, quotes, characters or plots from any existing film, book or game. Reply with ONE JSON object: {"title": "2-3 words", "villain": "a dog villain name", "villainLine": "max 22 words, smug", "target": "what they steal", "briefing": "max 26 words; must say: hold both generators, take the core, reach the helipad, one cat is a mole"}' },
      { role: 'user', content: `Featured set piece: ${SET_PIECES[top.id]}. The object being stolen must be a glowing core that cats cannot resist.` },
    ], { maxTokens: 400, timeout: 25000 })) ?? {}
  } catch (e) { console.error('briefing fell back to the default:', e.message) }
}
const pick = (k) => (typeof skin[k] === 'string' && skin[k].length < 260 ? skin[k] : DEFAULT_SCENARIO[k])
const scenario = {
  ...DEFAULT_SCENARIO, id: `viral-${top.id}`, title: pick('title'), villain: pick('villain'), villainLine: pick('villainLine'), target: pick('target'), briefing: pick('briefing'),
  setPiece: top.id,
  why: `Telem found ${pages.length} pages about the spy and heist scenes people love. ${SET_PIECES[top.id].split(':')[0]} led with ${top.pages}.`,
  sources: top.sources, board: board.map(({ id, pages: n, score }) => ({ id, pages: n, score })), researchedAt: new Date().toISOString(),
}
fs.mkdirSync('data', { recursive: true })
fs.writeFileSync('data/scenario.json', JSON.stringify(scenario, null, 2))
console.log(`Next mission: ${scenario.title} (${top.id})`)

// Keep the evidence where Bruin can rank it (bruin/assets/60_trope_ranking.sql).
if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : true })
  await pool.query('create table if not exists trope_evidence (run_at timestamptz not null default now(), trope text not null, url text not null, title text, query text, provider text, rank int)')
  for (const p of pages) {
    for (const [id, re] of Object.entries(TROPES)) {
      if (p.text.match(re)) await pool.query('insert into trope_evidence (trope, url, title, query, provider, rank) values ($1,$2,$3,$4,$5,$6)', [id, p.url, p.title, p.query, p.provider, p.rank ?? null])
    }
  }
  await pool.end()
}
