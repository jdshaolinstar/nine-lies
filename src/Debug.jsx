import { useState } from 'react'
import { clock } from './Hud.jsx'

// Which vendor did what. Every row comes from a real call the server made.
export const VENDORS = {
  band: { name: 'Band', color: '#5c8dff', job: 'Agents talking to each other' },
  runware: { name: 'Runware', color: '#2ee6a6', job: 'Agents thinking and speaking' },
  bruin: { name: 'Bruin', color: '#ffc857', job: 'Learning from what happened' },
  telem: { name: 'Telem', color: '#e86bff', job: 'Web research that picked the mission' },
  neon: { name: 'Neon Postgres', color: '#9fb2c9', job: 'Saving events (not a sponsor)' },
}
const ms = (n) => (n == null ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`)

export function totals(log) {
  const out = Object.fromEntries(Object.keys(VENDORS).map((k) => [k, { n: 0, ok: 0, ms: 0, timed: 0 }]))
  for (const e of log) {
    const t = out[e.vendor]
    if (!t) continue
    t.n += e.count ?? 1
    if (e.ok !== false) t.ok += e.count ?? 1
    if (e.ms != null) { t.ms += e.ms; t.timed++ }
  }
  return out
}

export function VendorTotals({ log }) {
  const t = totals(log)
  const unit = { neon: 'rows', band: 'sends', telem: 'mission' }
  return (
    <div className="vt">
      {Object.entries(VENDORS).map(([k, v]) => (
        <div key={k} style={{ '--v': v.color }} className={t[k].n ? '' : 'off'}>
          <b>{v.name}</b>
          <span>{t[k].n} {unit[k] ?? 'calls'}{t[k].timed ? ` · avg ${ms(t[k].ms / t[k].timed)}` : ''}{t[k].n > t[k].ok ? ` · ${t[k].n - t[k].ok} fell back` : ''}</span>
          <small>{v.job}</small>
        </div>
      ))}
    </div>
  )
}

export default function DebugPanel({ log, local }) {
  const [only, setOnly] = useState(null)
  const rows = log.filter((e) => (only ? e.vendor === only : e.vendor !== 'neon')).slice(-11).reverse()
  const t = totals(log)
  return (
    <aside className="debug">
      <h3>Who did what <small>press ` to hide</small></h3>
      <div className="dchips">
        {Object.entries(VENDORS).map(([k, v]) => (
          <button key={k} className={only === k ? 'sel' : ''} style={{ '--v': v.color }} onClick={() => setOnly(only === k ? null : k)}>{v.name} {t[k].n}</button>
        ))}
      </div>
      {local && <p className="dim">Offline match: no vendor calls. Agents are using the built-in rules.</p>}
      {!local && !rows.length && <p className="dim">Waiting for the first call…</p>}
      {rows.map((e) => (
        <p key={e.id} style={{ '--v': VENDORS[e.vendor]?.color }} className={e.ok === false ? 'bad' : ''}>
          <time>{clock(e.t)}</time><b>{VENDORS[e.vendor]?.name}</b> {e.what}
          <em>{e.ok === false ? 'fallback' : ms(e.ms)}</em>
        </p>
      ))}
    </aside>
  )
}
