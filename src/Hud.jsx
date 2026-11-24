import { useEffect, useRef, useState } from 'react'
import { ROOMS, roomName, roomOf } from '../shared/map.js'
import { dist } from '../shared/util.js'
import { guide, STEPS } from './guide.js'
import { sfx } from './audio.js'

export const clock = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`

const WHEEL = [
  { kind: 'going', label: 'I\'m going to…', need: 'room' },
  { kind: 'guard', label: 'Dog here!' },
  { kind: 'help', label: 'Help me!' },
  { kind: 'regroup', label: 'Come here' },
  { kind: 'where', label: 'Where are you?', need: 'cat' },
  { kind: 'suspect', label: "I don't trust…", need: 'cat' },
]

export function Steps({ s, step }) {
  return (
    <div className="steps">
      {STEPS.map((st, i) => (
        <div key={st.title} className={i < step ? 'done' : i === step ? 'now' : ''}>
          <b>{i < step ? '✓' : i + 1}</b><span>{st.title}<small>{st.text}</small></span>
          {i === 0 && step === 0 && <div className="pips">{s.gens.map((g) => <i key={g.id} className={g.held ? 'on' : ''} />)}<div className="bar"><i style={{ width: `${s.genProgress * 100}%` }} /></div></div>}
        </div>
      ))}
    </div>
  )
}

export default function Hud({ s, send, scan, scenario }) {
  const me = s.cats.find((c) => c.id === s.you)
  const myStatus = s.crew.find((c) => c.id === s.you)?.status
  const [wheel, setWheel] = useState(null) // null | {to, call?}
  const [intro, setIntro] = useState(true)
  const keys = useRef(new Set())
  const wheelRef = useRef(null)
  wheelRef.current = wheel
  const crewRef = useRef(s.crew)
  crewRef.current = s.crew

  useEffect(() => { const t = setTimeout(() => setIntro(false), 6500); return () => clearTimeout(t) }, [])

  const pick = (call, extra = {}) => {
    const to = wheelRef.current?.to ?? 'all'
    if (call.need && extra[call.need] === undefined) return setWheel({ to, call })
    send({ t: 'radio', kind: call.kind, to, ...extra })
    setWheel(null)
  }

  useEffect(() => {
    const K = keys.current
    const push = () => {
      const on = (...c) => c.some((k) => K.has(k))
      send({
        t: 'input', mx: (on('KeyD', 'ArrowRight') ? 1 : 0) - (on('KeyA', 'ArrowLeft') ? 1 : 0),
        mz: (on('KeyS', 'ArrowDown') ? 1 : 0) - (on('KeyW', 'ArrowUp') ? 1 : 0),
        sprint: on('ShiftLeft', 'ShiftRight'), sneak: on('ControlLeft', 'ControlRight', 'KeyC'),
      })
    }
    const down = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.ctrlKey && /^Key[WASDEQFX]$/.test(e.code))) e.preventDefault()
      if (e.repeat) return
      K.add(e.code)
      setIntro(false)
      if (e.code === 'Space') send({ t: 'act', a: 'claw' })
      else if (e.code === 'KeyF') send({ t: 'act', a: 'shoot' })
      else if (e.code === 'KeyE') send({ t: 'act', a: 'yarn' })
      else if (e.code === 'KeyV') send({ t: 'callVote' })
      else if (e.code === 'KeyX') send({ t: 'scan' })
      else if (e.code === 'KeyT') send({ t: 'tip' })
      else if (e.code === 'KeyQ') setWheel((w) => (w ? null : { to: 'all' }))
      else if (e.code === 'Escape') setWheel(null)
      else if (/^Digit[1-9]$/.test(e.code) && wheelRef.current) {
        const n = +e.code.slice(5) - 1
        const w = wheelRef.current
        if (!w.call) { if (WHEEL[n]) pick(WHEEL[n]) }
        else if (w.call.need === 'cat') { const c = crewRef.current.filter((k) => k.id !== s.you)[n]; if (c) pick(w.call, { cat: c.id }) }
        else if (ROOMS[n]) pick(w.call, { room: ROOMS[n].id })
      }
      push()
    }
    const up = (e) => { K.delete(e.code); push() }
    const blur = () => { K.clear(); push() }
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    const beat = setInterval(push, 250)
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); clearInterval(beat) }
  }, [])

  const prev = useRef({})
  useEffect(() => {
    const p = prev.current
    if (s.vote && !p.vote) sfx('vote')
    if (s.vaultOpen && !p.vault) sfx('vault')
    if (s.timeLeft < 30 && Math.ceil(s.timeLeft) !== p.sec) sfx('heart')
    prev.current = { vote: !!s.vote, vault: s.vaultOpen, sec: Math.ceil(s.timeLeft) }
  }, [s])

  const out = myStatus !== 'ok'
  const g = guide(s)
  const danger = me?.detected > 0.15 ? Math.min(1, me.detected) : 0
  const others = s.crew.filter((c) => c.id !== s.you)
  const dead = others.find((c) => c.status === 'dead')
  const missing = s.t > 40 ? others.find((c) => c.status === 'unseen' && (!c.lastSeen || c.lastSeen.ago > 35)) : null
  const trouble = dead ?? missing
  const near = me && s.dogs.filter((d) => d.state !== 'ko' && d.state !== 'chase' && dist(d, me) < 2.2)[0]
  const behind = near && Math.abs(Math.atan2(Math.sin(Math.atan2(me.z - near.z, me.x - near.x) - near.dir), Math.cos(Math.atan2(me.z - near.z, me.x - near.x) - near.dir))) > 1.75
  const dogNear = me && s.dogs.some((d) => d.state !== 'ko' && dist(d, me) < 7)
  const tip = behind ? 'SPACE: knock out this dog from behind' : near ? 'Get behind it, or back off' : null

  return (
    <>
      <div className="vignette" style={{ opacity: danger }} />
      <div className="top">
        {s.traitor ? <div className="steps"><div className="now bad"><b>!</b><span>You are the traitor<small>Stop the heist before the clock runs out. Dogs won&apos;t hurt you.</small></span></div><Steps s={s} step={g.step} /></div> : <Steps s={s} step={g.step} />}
        <div className={'timer small' + (s.timeLeft < 45 ? ' hot' : '')}>{clock(s.timeLeft)}</div>
      </div>

      {intro && !out && (
        <div className="howto panel">
          <p className="kicker">{scenario.title}</p>
          {s.traitor ? <>
            <h2>You are <span style={{ color: me?.color }}>{me?.name}</span>, the <span style={{ color: '#ff3048' }}>traitor</span>.</h2>
            <ul>
              <li><b>The dogs pay you 9 million fish</b> if this heist fails.</li>
              <li><b>Press T</b> to tell the dogs where a crewmate is.</li>
              <li><b>Catch someone alone, get behind them, press SPACE.</b> Don&apos;t be seen.</li>
            </ul>
          </> : <>
          <h2>You are <span style={{ color: me?.color }}>{me?.name}</span>. Steal the core.</h2>
          <ul>
            <li><b>Follow the glowing dots.</b> They always lead to your next step.</li>
            <li><b>Stay out of the dogs&apos; light cones.</b> Shift to run, C to sneak.</li>
            <li><b>One crewmate is paid by the dogs.</b> If time runs out, they win.</li>
          </ul></>}
          <p className="dim">Move with WASD to begin</p>
        </div>
      )}

      {!out && !intro && <div className={'todo' + (g.warn ? ' warn' : '')}>{g.warn ?? g.text}</div>}
      {!out && tip && !g.warn && <div className="tip">{tip}</div>}

      <Crew s={s} onWhisper={(id) => setWheel({ to: id })} />
      <Radio s={s} />
      <MiniMap s={s} target={g.target} />
      <ScanBox scan={scan} />

      {out && <div className="banner">{myStatus === 'captured' ? 'CAGED. A crewmate can free you, or wait while you pick the lock.' : myStatus === 'cut' ? 'The crew voted you out.' : 'You were taken out. Watch what happens as a ghost.'}</div>}
      {s.heardShot && <div className="banner shot">BANG! Gunshot to the {s.heardShot}</div>}
      {s.blackout > 0 && <div className="banner soft">Lights out! {s.blackout.toFixed(0)}s</div>}

      {!out && !s.traitor && trouble && !s.vote && !me?.calledVote && (
        <div className="suspect">
          <b style={{ color: trouble.color }}>{trouble.name}</b> {dead ? 'is dead.' : `hasn't been seen for ${trouble.lastSeen ? trouble.lastSeen.ago + 's' : 'a while'}.`}
          {s.scansLeft > 0 && <button onClick={() => send({ t: 'scan' })}><kbd>X</kbd> Check alibis</button>}
          <button onClick={() => send({ t: 'callVote' })}><kbd>V</kbd> Vote someone out</button>
        </div>
      )}

      {!out && me && (
        <div className="actions">
          <Btn k="Space" label="Claw" cd={me.clawCd} off={me.carry} onClick={() => send({ t: 'act', a: 'claw' })} />
          <Btn k="F" label={me.bullets ? 'Shoot (1 bullet)' : 'No bullet'} off={!me.bullets || me.carry} onClick={() => send({ t: 'act', a: 'shoot' })} />
          <Btn k="Q" label="Talk" onClick={() => setWheel({ to: 'all' })} />
          {s.traitor && <Btn k="T" label="Tip off the dogs" cd={s.tipIn} onClick={() => send({ t: 'tip' })} />}
          {!s.traitor && dogNear && me.yarn > 0 && <Btn k="E" label={`Yarn: distract dogs ×${me.yarn}`} onClick={() => send({ t: 'act', a: 'yarn' })} />}
        </div>
      )}

      {wheel && !out && (
        <div className="wheel panel">
          <div className="chips">
            <button className={wheel.to === 'all' ? 'sel' : ''} onClick={() => setWheel({ ...wheel, to: 'all' })}>Everyone</button>
            {others.filter((c) => c.status !== 'cut').map((c) => (
              <button key={c.id} className={wheel.to === c.id ? 'sel' : ''} style={{ borderColor: c.color }} onClick={() => setWheel({ ...wheel, to: c.id })}>Only {c.name}</button>
            ))}
          </div>
          {!wheel.call && <div className="grid three">{WHEEL.map((w, i) => <button key={w.kind} onClick={() => pick(w)}><b>{i + 1}</b> {w.label}</button>)}</div>}
          {wheel.call?.need === 'cat' && (
            <div className="grid">{others.map((c, i) => <button key={c.id} style={{ color: c.color }} onClick={() => pick(wheel.call, { cat: c.id })}><b>{i + 1}</b> {c.name}</button>)}</div>
          )}
          {wheel.call?.need === 'room' && <div className="grid three">{ROOMS.map((r) => <button key={r.id} onClick={() => pick(wheel.call, { room: r.id })}>{r.name}</button>)}</div>}
        </div>
      )}
      {s.vote && <Vote s={s} send={send} canVote={!out} />}
      <VoteResult s={s} />
    </>
  )
}

function Btn({ k, label, cd = 0, off, onClick }) {
  return <button className={'act' + (off || cd > 0.05 ? ' off' : '')} onClick={onClick}><kbd>{k}</kbd>{label}{cd > 0.05 && <em>{cd.toFixed(0)}</em>}</button>
}

export function MiniMap({ s, target }) {
  const me = s.cats.find((c) => c.id === s.you)
  const here = me ? roomOf(me) : null
  return (
    <svg className="mini" viewBox="0 0 42 32" aria-hidden="true">
      {ROOMS.map((r) => <rect key={r.id} x={r.x} y={r.z} width={r.w} height={r.h} rx="0.6" fill={r.color} opacity={r.id === here ? 0.85 : 0.3} />)}
      {s.crew.filter((c) => c.id !== s.you && c.lastSeen && c.status !== 'dead' && c.lastSeen.ago < 20).map((c) => {
        const cat = s.cats.find((k) => k.id === c.id)
        return cat ? <circle key={c.id} cx={cat.x} cy={cat.z} r="0.9" fill={c.color} /> : null
      })}
      {s.dogs.map((d) => <circle key={d.id} cx={d.x} cy={d.z} r="0.9" fill={d.state === 'ko' ? '#666' : '#ff3048'} />)}
      {target && <circle className="goal" cx={target.x} cy={target.z} r="1.5" fill="none" stroke="#fff" strokeWidth="0.5" />}
      {me && <circle cx={me.x} cy={me.z} r="1.1" fill={me.color} stroke="#fff" strokeWidth="0.4" />}
    </svg>
  )
}

export function Crew({ s, onWhisper }) {
  const text = (c) => {
    if (c.id === s.you) return 'you'
    if (c.status === 'ok') return 'in sight'
    if (c.status === 'dead') return 'DEAD'
    if (c.status === 'captured') return 'caged'
    if (c.status === 'cut') return 'voted out'
    return c.lastSeen ? `${roomName(c.lastSeen.room)}, ${c.lastSeen.ago}s ago` : 'not seen'
  }
  return (
    <div className="crew">
      {s.crew.map((c) => (
        <button key={c.id} className={'cat ' + c.status + (c.status === 'unseen' && (!c.lastSeen || c.lastSeen.ago > 35) && s.t > 40 ? ' missing' : '')} onClick={() => c.id !== s.you && onWhisper?.(c.id)} style={{ '--c': c.color }}>
          <span className="face" /><span><b>{c.name}</b><small>{text(c)}</small></span>
        </button>
      ))}
    </div>
  )
}

export function Radio({ s, n = 3 }) {
  const name = (id) => s.crew.find((c) => c.id === id)?.name ?? (id === 'captain' ? 'LOUDSPEAKER' : 'Hacker')
  const color = (id) => s.crew.find((c) => c.id === id)?.color ?? (id === 'captain' ? '#ff9a30' : '#9fe0ff')
  return (
    <div className="radio">
      {s.radio.slice(-n).map((m) => (
        <p key={m.id} className={m.to !== 'all' ? 'whisper' : ''}><b style={{ color: color(m.from) }}>{name(m.from)}</b>{m.to !== 'all' && <i> → {name(m.to)}</i>} {m.text}</p>
      ))}
    </div>
  )
}

export function ScanBox({ scan }) {
  const [hide, setHide] = useState(false)
  useEffect(() => { setHide(false); if (scan?.state === 'done') { const t = setTimeout(() => setHide(true), 14000); return () => clearTimeout(t) } }, [scan])
  if (!scan || hide) return null
  return (
    <div className="scan panel" onClick={() => setHide(true)}>
      <h3>Alibi check <em>{scan.state === 'running' ? 'asking Bruin…' : scan.source === 'bruin' ? `live Bruin query${scan.ms ? `, ${scan.ms} ms` : ''}` : 'local data'}</em></h3>
      {scan.rows?.map((r, i) => <p key={i} className={r.kind}>{r.text}</p>)}
      {scan.state === 'done' && !scan.rows?.length && <p>No contradictions on record yet.</p>}
      {scan.sql && <pre>{scan.sql}</pre>}
    </div>
  )
}

export function Vote({ s, send, canVote }) {
  const [mine, setMine] = useState(null)
  const by = s.crew.find((c) => c.id === s.vote.by)
  const cast = (id) => { setMine(id ?? 'skip'); send({ t: 'vote', cat: id }) }
  return (
    <div className="vote panel">
      <h3>Who is the traitor? <em>{Math.ceil(s.vote.left)}s</em></h3>
      <div className="chips">
        {s.vote.options.map((id) => {
          const c = s.crew.find((k) => k.id === id)
          return <button key={id} disabled={!canVote} className={mine === id ? 'sel' : ''} style={{ borderColor: c.color }} onClick={() => cast(id)}>{c.name}{id === s.you ? ' (you)' : ''}</button>
        })}
        <button disabled={!canVote} className={mine === 'skip' ? 'sel' : ''} onClick={() => cast(null)}>Not sure</button>
      </div>
      <small>{by?.name} called this vote. {Object.keys(s.vote.votes).length} voted. The clock is still running.</small>
    </div>
  )
}

export function VoteResult({ s }) {
  if (!s.lastVote) return null
  const c = s.crew.find((k) => k.id === s.lastVote.out)
  return <div className="banner">{c ? `${c.name} was voted out. ${s.lastVote.wasMole ? 'They WERE the traitor!' : 'They were innocent.'}` : 'No one was voted out.'}</div>
}
