// Plays many matches with rule-based agents: node test/balance.mjs [count]
import { Match } from '../shared/sim.js'
import { walkable } from '../shared/nav.js'

const N = +process.argv[2] || 40
const tally = {}
const count = (k, n = 1) => { tally[k] = (tally[k] ?? 0) + n }
let time = 0
const started = Date.now()
for (let s = 1; s <= N; s++) {
  const m = new Match({ seed: s * 7919 })
  let steps = 0
  while (m.phase === 'play' && steps++ < 20 * 260) {
    m.step(1 / 20)
    for (const b of [...m.cats.filter((c) => c.state === 'ok'), ...m.dogs]) {
      if (!Number.isFinite(b.x + b.z) || !walkable(Math.floor(b.x), Math.floor(b.z), new Set())) throw Error(`seed ${s}: ${b.id} in a wall at ${b.x},${b.z} t=${m.t}`)
    }
  }
  if (m.phase !== 'end') throw Error(`seed ${s} never ended`)
  for (const role of [['runner', 'ace'], ['hacker'], ['director']]) JSON.stringify(m.viewFor(...role))
  count(`win:${m.result.winner}`)
  count(`tactic:${m.tactic}:${m.result.winner}`)
  count(`why:${m.result.why.replace(/^\w+ got/, 'X got')}`)
  if (m.result.moleCaught) count('moleCaught')
  for (const e of m.events) if (['kill', 'captured', 'rescued', 'leak', 'gunshot', 'vote_called', 'vault_open', 'core_taken', 'scuffle', 'spotted', 'dog_ko'].includes(e.type)) count('ev:' + e.type)
  count('ev:radio', m.radio.length)
  if (m.events.some((e) => e.type === 'kill' && e.data.how === 'claw' && m.cat(e.actor).isMole)) count('matchesWithMoleClawKill')
  time += m.t
}
console.log(tally)
console.log('avg length', (time / N).toFixed(1), 's;', ((Date.now() - started) / N).toFixed(0), 'ms per match')
