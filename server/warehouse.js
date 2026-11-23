// Game events go into Postgres. Bruin reads them back: the SQL for every view
// lives in bruin/assets, and the alibi scan runs through Bruin's Query API.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

export const whStats = { rows: 0, queries: 0, ms: 0, lastError: null }
const esc = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '')

const TABLES = `
create table if not exists events (
  match_id text not null, seq int not null, t real not null, type text not null,
  actor text, target text, room text, x real, z real, data jsonb not null default '{}',
  created_at timestamptz not null default now(), primary key (match_id, seq)
);
create index if not exists events_match_type on events (match_id, type);
create table if not exists matches (
  match_id text primary key, mole text, tactic text, winner text, why text, mole_caught boolean,
  seconds real, humans int, llm boolean, created_at timestamptz not null default now()
);
create table if not exists trope_evidence (
  run_at timestamptz not null default now(), trope text not null, url text not null, title text, query text, provider text, rank int
);`

export async function connectWarehouse(root, matchById) {
  const url = process.env.DATABASE_URL
  const pool = new pg.Pool({ connectionString: url, max: 4, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : true })
  pool.on('error', (e) => { whStats.lastError = e.message })
  await pool.query(TABLES)
  // The same files `bruin run` uses. Applied here too, so the views exist without the CLI.
  const dir = path.join(root, 'bruin', 'assets')
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const name = src.match(/^name:\s*(\S+)/m)[1]
    const sql = src.replace(/\/\*\s*@bruin[\s\S]*?@bruin\s*\*\//, '').trim().replace(/;$/, '')
    await pool.query(`create or replace view ${name} as ${sql}`)
  }

  let queue = []
  const seq = new Map()
  const flush = async () => {
    if (!queue.length) return
    const batch = queue.splice(0, 400)
    const cols = 10
    const values = batch.map((_, i) => `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(',')})`).join(',')
    try {
      await pool.query(`insert into events (match_id, seq, t, type, actor, target, room, x, z, data) values ${values} on conflict do nothing`, batch.flat())
      whStats.rows += batch.length
      const per = {}
      for (const b of batch) per[b[0]] = (per[b[0]] ?? 0) + 1
      for (const [id, count] of Object.entries(per)) matchById?.(id)?.vendor?.({ vendor: 'neon', count, what: `Saved ${count} game events` })
    } catch (e) { whStats.lastError = e.message }
  }
  setInterval(flush, 700)

  return {
    pool,
    async flush() { while (queue.length) await flush() },
    event(matchId, e) {
      const n = (seq.get(matchId) ?? 0) + 1
      seq.set(matchId, n)
      queue.push([matchId, n, e.t, e.type, e.actor ?? null, e.target ?? null, e.room ?? null, e.x, e.z, JSON.stringify(e.data ?? {})])
      if (queue.length > 5000) queue = queue.slice(-2000)
    },
    async match(m, llm) {
      const r = m.result
      await pool.query('insert into matches (match_id, mole, tactic, winner, why, mole_caught, seconds, humans, llm) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing', [m.id, r.mole, r.tactic, r.winner, r.why, r.moleCaught, r.t, m.humans.size, llm])
    },
  }
}

export async function bruinQuery(sql) {
  const t0 = Date.now()
  const r = await fetch(`https://cloud.getbruin.com/api/v1/connection-sets/${process.env.BRUIN_CONNECTION_SET_ID}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.BRUIN_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ connection: process.env.BRUIN_CONNECTION || 'warehouse', query: sql }),
    signal: AbortSignal.timeout(12000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Bruin ${r.status}: ${text.slice(0, 240)}`)
  const out = JSON.parse(text)
  whStats.queries++
  whStats.ms = Date.now() - t0
  return { rows: out.rows.map((row) => Object.fromEntries(out.columns.map((c, i) => [c, row[i]]))), sql: out.rendered_sql ?? sql, ms: whStats.ms }
}

// One scan: broken alibis, who was near each missing cat, and traced leaks.
export function alibiScanner(wh) {
  return async (m, local) => {
    await wh.flush()
    const missing = m.cats.filter((c) => c.state !== 'ok' && c.state !== 'cut').map((c) => `'${esc(c.id)}'`).join(',') || "''"
    const sql = `select kind, suspect, detail from alibi_findings where match_id = '${esc(m.id)}' and (kind <> 'last_seen_with' or subject in (${missing})) order by t desc limit 6`
    try {
      const r = await bruinQuery(sql)
      m.vendor?.({ vendor: 'bruin', sticker: 'alibi check', ms: r.ms, what: `Alibi check: compared claims with sightings, found ${r.rows.length} lead${r.rows.length === 1 ? '' : 's'}` })
      return { source: 'bruin', rows: r.rows.map((x) => ({ kind: x.kind, suspect: x.suspect, text: x.detail })), sql: r.sql, ms: r.ms }
    } catch (e) {
      whStats.lastError = e.message
      m.vendor?.({ vendor: 'bruin', sticker: 'alibi check', ok: false, what: 'Alibi check failed, used local data instead' })
      return { ...local(), error: e.message }
    }
  }
}

// The captain studies past crews through Bruin before the match.
export async function captainBriefing() {
  const r = await bruinQuery('select habit, room, n, share from captain_briefing where n > 1 order by habit, n desc')
  const top = (h) => r.rows.find((x) => x.habit === h)
  return { first: top('first_generator'), caught: top('caught_in'), killed: top('killed_in'), sql: r.sql, ms: r.ms }
}

// What the mole has got away with, from every match on record.
export async function learnedTactics() {
  const r = await bruinQuery('select tactic, plays, wins from mole_learning')
  return Object.fromEntries(r.rows.map((x) => [x.tactic, { plays: Number(x.plays), wins: Number(x.wins) }]))
}
