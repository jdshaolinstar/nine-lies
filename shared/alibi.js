// The alibi check, in plain JS. The Bruin version asks the same question in SQL
// (see bruin/); this one covers solo play and outages.
import { CAT_NAME } from './sim.js'
import { roomName } from './map.js'

export function localAlibiScan(m) {
  const ev = m.events
  const saws = ev.filter((e) => e.type === 'saw')
  const claims = ev.filter((e) => e.type === 'radio' && e.data.kind === 'at')
  const rows = []
  for (const c of claims) {
    const s = saws.find((w) => w.target === c.actor && w.actor !== c.actor && w.data.room !== c.data.room && Math.abs(w.t - c.t) <= 5)
    if (s) rows.push({ kind: 'broken_alibi', suspect: c.actor, text: `${CAT_NAME[c.actor]} claimed ${roomName(c.data.room)} at ${c.t.toFixed(0)}s, but ${CAT_NAME[s.actor]} saw them in ${roomName(s.data.room)} at ${s.t.toFixed(0)}s` })
  }
  // Who was seen in the same room around the last sighting of each missing cat?
  for (const cat of m.cats) {
    if (cat.state === 'ok' || cat.state === 'cut') continue
    const last = [...saws].reverse().find((w) => w.target === cat.id)
    if (!last) continue
    const near = new Set(saws.filter((w) => w.target !== cat.id && w.data.room === last.data.room && Math.abs(w.t - last.t) <= 8).map((w) => w.target))
    near.add(last.actor)
    rows.push({ kind: 'last_seen_with', suspect: null, text: `${CAT_NAME[cat.id]} was last seen in ${roomName(last.data.room)} at ${last.t.toFixed(0)}s, near ${[...near].map((id) => CAT_NAME[id]).join(', ')}` })
  }
  const leaks = ev.filter((e) => e.type === 'leak')
  if (leaks.length) {
    const l = leaks[leaks.length - 1]
    const knew = new Set(ev.filter((e) => e.type === 'radio' && e.data.kind === 'going' && e.data.room === l.data.room && l.t - e.t < 25 && e.t <= l.t).flatMap((e) => (e.target ? [e.actor, e.target] : [])))
    rows.push({ kind: 'leak', suspect: null, text: `Dogs were tipped off about ${roomName(l.data.room)} at ${l.t.toFixed(0)}s${knew.size ? `. Whispered only to: ${[...knew].map((id) => CAT_NAME[id]).join(', ')}` : ', after it went out on open radio'}` })
  }
  return { source: 'local', rows: rows.slice(-6), sql: null }
}
