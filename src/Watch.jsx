import { useEffect, useRef, useState } from 'react'
import { roomName } from '../shared/map.js'
import { clock, Steps, VoteResult } from './Hud.jsx'
import { stepOf } from './guide.js'

// A guided playthrough: the agents play, and captions say what is going on.
export function narrate(e, s) {
  const cat = (id) => s.cats.find((c) => c.id === id)
  const N = (id) => s.crew.find((c) => c.id === id)?.name ?? (String(id ?? '').startsWith('dog') ? 'A dog' : 'Someone')
  const mole = (id) => cat(id)?.mole
  const A = N(e.actor), T = N(e.target)
  switch (e.type) {
    case 'start': return { big: `${N(s.mole)} is the traitor.`, small: 'The dogs promised them all 9 million fish if this heist fails. The crew has no idea.' }
    case 'kill': return { big: `${A} kills ${T}${e.data.how === 'claw' ? ' silently, from behind' : ' with a single shot'}.`, small: mole(e.actor) ? 'The traitor strikes. Did anyone see?' : mole(e.target) ? 'That was the traitor!' : `${T} was innocent.`, hot: true }
    case 'witnessed': return { big: `${A} SAW ${T} do it!`, small: 'One witness can end the traitor.', hot: true }
    case 'scuffle': return { big: `${A} lunges at ${T}, but is seen coming.`, small: 'Attacks only kill from behind.', hot: true }
    case 'captured': return { big: `A dog catches ${T}.`, small: `${T} is caged in the Kennel until someone frees them.` }
    case 'rescued': return { big: e.actor ? `${A} frees ${T}.` : `${T} picks the lock and escapes.`, small: '' }
    case 'leak': return { big: `${A} secretly tells the dogs: "${e.data.why}"`, small: 'A private message to the dog captain, sent through Band.', hot: true }
    case 'gunshot': return { big: `BANG. ${A} fires${e.target ? ` at ${T}` : ' and misses'}.`, small: 'Everyone hears it. Dogs are coming.', hot: true }
    case 'vote_called': return { big: `${A} calls a vote.`, small: 'Who do they think the traitor is?' }
    case 'vote_result': return { big: e.target ? `The crew votes out ${T}.` : 'The vote is split.', small: e.target ? (e.data.wasMole ? 'They got the traitor!' : 'Wrong cat.') : '', hot: !!e.target }
    case 'vault_open': return { big: 'Both generators held. The vault opens!', small: 'Step 2: grab the core.' }
    case 'core_taken': return { big: `${A} has the core!`, small: 'Slow and defenseless now. Step 3: reach the helipad.' }
    case 'core_dropped': return { big: `${A} drops the core!`, small: 'Anyone can grab it.' }
    case 'body_found': return s.recent.some((k) => k.type === 'kill' && k.actor === e.actor && k.target === e.target) ? null : { big: `${A} finds ${T}'s body.`, small: 'Now the crew knows.' }
    case 'turned': return { big: `${A} gets greedy and turns on the crew!`, small: 'Why split nine million fish?', hot: true }
    case 'spotted': return { big: `A dog spots ${T}!`, small: 'Run.' }
    case 'radio': {
      if (!e.data.lie) return null
      return { big: `${A} says "${e.data.text}". That's a lie.`, small: `Really in ${roomName(e.data.trueRoom)}.`, hot: true }
    }
    case 'decision': {
      if (e.data.who === 'captain' && e.data.source === 'bruin') return { big: `The dog captain studied past heists: ${e.data.reason}.`, small: 'Queried live from Bruin.' }
      if (/^hunt/.test(e.data.goal) && mole(e.data.who)) return { big: `${N(e.data.who)} is ${e.data.goal.replace('hunt', 'hunting')}…`, small: `"${e.data.reason}"`, hot: true }
      return null
    }
    case 'pilot_leaving': return { big: 'The pilot starts counting down!', small: '' }
    case 'power_cut': return { big: 'The power goes out.', small: '' }
    default: return null
  }
}

export default function Watch({ s, services, scenario }) {
  const [lines, setLines] = useState([])
  const seen = useRef(0)
  useEffect(() => {
    const fresh = (s.recent ?? []).filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].n
    const out = fresh.map((e) => { const l = narrate(e, s); return l && { ...l, t: e.t, n: e.n } }).filter(Boolean)
    if (out.length) setLines((p) => [...p, ...out].slice(-6))
  }, [s])
  const last = lines[lines.length - 1]
  const show = last && s.t - last.t < (s.t < 12 ? 12 : 6)
  return (
    <>
      <div className="top"><Steps s={s} step={stepOf(s)} /><div className={'timer small' + (s.timeLeft < 45 ? ' hot' : '')}>{clock(s.timeLeft)}</div></div>
      <div className="minds">
        {s.cats.map((c) => (
          <div key={c.id} className={'mind ' + c.state + (c.mole ? ' mole' : '')} style={{ '--c': c.color }}>
            <b>{c.name}{c.mole ? ' · TRAITOR' : ''}{c.human ? ' · human' : ''}</b>
            {c.state === 'ok' ? <small>{c.human ? 'playing' : c.plan?.reason || 'thinking…'}</small> : <small>{c.state === 'dead' ? 'dead' : c.state === 'captured' ? 'caged' : 'voted out'}</small>}
          </div>
        ))}
      </div>
      <div className="feed">{lines.slice(0, -1).slice(-3).map((l) => <p key={l.n}><time>{clock(l.t)}</time>{l.big}</p>)}</div>
      {s.t < 5 && scenario && <div className="intro story"><p>{scenario.villain}: “{scenario.villainLine}”</p><h2>{scenario.title}</h2></div>}
      {show && s.t >= 4.5 && <div className={'caption' + (last.hot ? ' hot' : '')} key={last.n}><b>{last.big}</b>{last.small && <span>{last.small}</span>}</div>}
      <VoteResult s={s} />
      {services && <p className="svc corner">{Object.entries(services).filter(([, v]) => v).map(([k]) => <span key={k} className="on">{k}</span>)}</p>}
    </>
  )
}
