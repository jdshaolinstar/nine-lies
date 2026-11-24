import { useEffect } from 'react'
import { clock } from './Hud.jsx'
import { Ledger } from './Director.jsx'
import { roomName } from '../shared/map.js'
import { sfx } from './audio.js'
import { VendorTotals } from './Debug.jsx'

const TACTIC = { early_strike: 'Strike early', late_strike: 'Strike late', leak_only: 'Leak, never kill', frame: 'Frame someone' }

export default function EndScreen({ s, learning, vlog, again, menu }) {
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
      case 'body_found': return s.story.some((k) => k.type === 'kill' && k.actor === e.actor && k.target === e.target) ? null : `${A} found ${T}'s body`
      case 'turned': return `${A} got greedy and turned on the crew`
      case 'pilot_leaving': return 'The pilot started counting down'
      case 'power_cut': return 'The power went out'
      case 'end': return r.why
      default: return null
    }
  }
  return (
    <div className="end">
      <div className="panel result">
        <p className="kicker">{r.winner === 'crew' ? 'Heist complete' : 'The dogs win'}</p>
        <h1 className={'won-' + r.winner}>{r.why}</h1>
        <p>The traitor was <b style={{ color: mole?.color }}>{mole?.name}</b>. {TACTIC[r.tactic] ? <>Tactic: <b>{TACTIC[r.tactic]}</b>.</> : 'Played by a person.'} {r.moleCaught ? 'They were caught.' : 'They were never caught.'}</p>
        {s.you && <p className="you">{s.you === r.mole ? (r.winner === 'mole' && !r.moleCaught ? 'You were the traitor, and you got away with it.' : r.winner === 'mole' ? 'The dogs won, but you were caught. No pay for you.' : 'You were the traitor, and the crew beat you.') : r.escaped.includes(s.you) ? 'You escaped with the loot!' : r.winner === 'crew' ? 'The crew won, but left without you.' : 'You lost this one.'}</p>}
        {r.winner === 'mole' && <p>{r.spyPaid ? <>The dogs pay {mole?.name} <b>{r.spyPaid.toLocaleString()} fish</b>.</> : <>The dogs keep all 9,000,000 fish. Their spy was caught, so they pay nobody.</>}</p>}
        {r.winner === 'crew' && r.escaped.length > 0 && <p>Loot split {r.escaped.length} way{r.escaped.length > 1 ? 's' : ''}: <b>{r.share.toLocaleString()} fish</b> each for {r.escaped.map(name).join(', ')}.</p>}
        {learning && (
          <div className="learn">
            <h3>What AI traitors have learned</h3>
            {Object.entries(learning).map(([k, v]) => (
              <div key={k} className={k === r.tactic ? 'now' : ''}><span>{TACTIC[k]}</span><div className="bar"><i style={{ width: `${((v.wins + 1) / (v.plays + 2)) * 100}%` }} /></div><small>{v.wins}/{v.plays} won</small></div>
            ))}
          </div>
        )}
        <div className="row"><button className="big" onClick={again}>Again</button><button className="big alt" onClick={menu}>Menu</button></div>
        {vlog?.length > 0 && <><h3>What each vendor did this match</h3><VendorTotals log={vlog} /></>}
      </div>
      <div className="panel story">
        <h3>What really happened</h3>
        {s.story.map((e, i) => { const l = line(e); return l && <p key={i} className={'ev-' + e.type}><time>{clock(e.t)}</time>{l}</p> })}
      </div>
      <div className="panel"><Ledger s={s} full /></div>
    </div>
  )
}
