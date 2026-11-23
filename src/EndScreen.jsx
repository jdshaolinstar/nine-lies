import { useEffect } from 'react'
import { clock } from './Hud.jsx'
import { Ledger } from './Director.jsx'
import { roomName } from '../shared/map.js'
import { sfx } from './audio.js'

const TACTIC = { early_strike: 'Strike early', late_strike: 'Strike late', leak_only: 'Leak, never kill', frame: 'Frame someone' }

export default function EndScreen({ s, learning, again }) {
  const r = s.result
  const name = (id) => s.crew.find((c) => c.id === id)?.name ?? (String(id ?? '').startsWith('dog') ? 'A dog' : 'Someone')
  const mole = s.crew.find((c) => c.id === r.mole)
  useEffect(() => { sfx(r.winner === 'crew' ? 'win' : 'lose') }, [])
  const line = (e) => {
    const A = name(e.actor), T = name(e.target)
    switch (e.type) {
      case 'kill': return `${A} killed ${T} in ${roomName(e.data.room)} (${e.data.how === 'claw' ? 'silent claw' : 'pistol'})`
      case 'scuffle': return `${A} attacked ${T}, but was seen coming`
      case 'captured': return `${A} caught ${T} in ${roomName(e.data.room)}`
      case 'rescued': return e.actor ? `${A} freed ${T}` : `${T} picked the lock`
      case 'leak': return `${A} secretly told the dogs: ${e.data.why}`
      case 'gunshot': return `${A} fired${e.target ? ` at ${T}` : ' and missed'}`
      case 'vote_result': return e.target ? `The crew cut ${T} loose (${e.data.wasMole ? 'the mole' : 'loyal'})` : 'The vote was split'
      case 'vault_open': return 'Both generators held: the vault opened'
      case 'core_taken': return `${A} took the core`
      case 'body_found': return `${A} found ${T}'s body`
      case 'end': return r.why
      default: return null
    }
  }
  return (
    <div className="end">
      <div className="panel result">
        <p className="kicker">{r.winner === 'crew' ? 'Heist complete' : 'The dogs win'}</p>
        <h1 className={r.winner}>{r.why}</h1>
        <p>The mole was <b style={{ color: mole?.color }}>{mole?.name}</b>. Tactic: <b>{TACTIC[r.tactic]}</b>. {r.moleCaught ? 'They were caught.' : 'They were never caught.'}</p>
        {r.winner === 'crew' && r.escaped.length > 0 && <p>Loot split {r.escaped.length} way{r.escaped.length > 1 ? 's' : ''}: <b>{r.share.toLocaleString()} fish</b> each for {r.escaped.map(name).join(', ')}.</p>}
        {learning && (
          <div className="learn">
            <h3>What the mole has learned</h3>
            {Object.entries(learning).map(([k, v]) => (
              <div key={k} className={k === r.tactic ? 'now' : ''}><span>{TACTIC[k]}</span><div className="bar"><i style={{ width: `${((v.wins + 1) / (v.plays + 2)) * 100}%` }} /></div><small>{v.wins}/{v.plays} won</small></div>
            ))}
          </div>
        )}
        <button className="big" onClick={again}>Play again</button>
      </div>
      <div className="panel story">
        <h3>What really happened</h3>
        {s.story.map((e, i) => { const l = line(e); return l && <p key={i} className={e.type}><time>{clock(e.t)}</time>{l}</p> })}
      </div>
      <div className="panel"><Ledger s={s} full /></div>
    </div>
  )
}
