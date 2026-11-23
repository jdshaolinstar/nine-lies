import { useEffect, useRef, useState } from 'react'
import { ROOMS, roomName } from '../shared/map.js'
import { sfx } from './audio.js'

export const clock = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`

const WHEEL = [
  { kind: 'going', label: 'Heading to…', need: 'room' },
  { kind: 'guard', label: 'Dog here!' },
  { kind: 'clear', label: 'Clear' },
  { kind: 'help', label: 'Help!' },
  { kind: 'where', label: 'Where are you?', need: 'cat', all: true },
  { kind: 'saw', label: 'Saw… here', need: 'cat' },
  { kind: 'suspect', label: "Don't trust…", need: 'cat' },
  { kind: 'regroup', label: 'Regroup here' },
]

export default function Hud({ s, send, scan, scenario }) {
  const me = s.cats.find((c) => c.id === s.you)
  const myStatus = s.crew.find((c) => c.id === s.you)?.status
  const [wheel, setWheel] = useState(null) // null | {to, call?}
  const [intro, setIntro] = useState(true)
  const keys = useRef(new Set())
  const wheelRef = useRef(null)
  wheelRef.current = wheel

  useEffect(() => { const t = setTimeout(() => setIntro(false), 5200); return () => clearTimeout(t) }, [])

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
      if (e.code === 'Space') send({ t: 'act', a: 'claw' })
      else if (e.code === 'KeyF') send({ t: 'act', a: 'shoot' })
      else if (e.code === 'KeyE') send({ t: 'act', a: 'yarn' })
      else if (e.code === 'KeyG') send({ t: 'act', a: 'drop' })
      else if (e.code === 'KeyV') send({ t: 'callVote' })
      else if (e.code === 'KeyX') send({ t: 'scan' })
      else if (e.code === 'KeyQ') setWheel((w) => (w ? null : { to: 'all' }))
      else if (e.code === 'Escape') setWheel(null)
      else if (/^Digit[1-8]$/.test(e.code)) {
        const n = +e.code.slice(5) - 1
        const w = wheelRef.current
        if (!w?.call) pick(WHEEL[n])
        else if (w.call.need === 'cat') { const c = s.crew.filter((k) => k.id !== s.you)[n]; if (c) pick(w.call, { cat: c.id }) }
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

  // Cues
  const prev = useRef({})
  useEffect(() => {
    const p = prev.current
    if (s.vote && !p.vote) sfx('vote')
    if (s.vaultOpen && !p.vault) sfx('vault')
    if (s.timeLeft < 45 && Math.ceil(s.timeLeft) !== p.sec) sfx('heart')
    prev.current = { vote: !!s.vote, vault: s.vaultOpen, sec: Math.ceil(s.timeLeft) }
  }, [s])

  const out = myStatus !== 'ok'
  const objective = s.core.by === s.you ? 'Get to the helipad!' : s.core.taken ? 'Escort the core to the helipad' : s.vaultOpen ? 'Vault open: hold still over the core' : 'Hold BOTH generators at once'
  const danger = me?.detected > 0.15 ? Math.min(1, me.detected) : 0
  return (
    <>
      <div className="vignette" style={{ opacity: danger }} />
      {intro && <div className="intro"><p>{scenario.villain}</p><h2>{scenario.title}</h2><p className="dim">One of these cats works for the dogs.</p></div>}
      <div className="top">
        <div className={'timer' + (s.timeLeft < 45 ? ' hot' : '')}>{clock(s.timeLeft)}</div>
        <div className="objective">
          {objective}
          {!s.vaultOpen && (
            <div className="gens">
              {s.gens.map((g) => <span key={g.id} className={g.held ? 'on' : ''}>{g.id === 'gennorth' ? 'North' : 'South'} {g.held ? 'held' : 'empty'}</span>)}
              <div className="bar"><i style={{ width: `${s.genProgress * 100}%` }} /></div>
            </div>
          )}
        </div>
      </div>

      <Crew s={s} onWhisper={(id) => setWheel({ to: id })} />
      <Radio s={s} />
      <ScanBox scan={scan} />

      {out && <div className="banner">{myStatus === 'captured' ? 'CAGED. A crewmate can free you, or pick the lock yourself.' : myStatus === 'cut' ? 'The crew cut you loose.' : 'You were silenced. Watch as a ghost.'}</div>}
      {s.heardShot && <div className="banner shot">BANG! Gunshot to the {s.heardShot}</div>}
      {s.blackout > 0 && <div className="banner soft">Blackout {s.blackout.toFixed(0)}s</div>}
      {me?.wire > 0 && <div className="banner soft">On the wire… hold still</div>}

      {!out && me && (
        <div className="actions">
          <Btn k="Space" label="Claw" cd={me.clawCd} off={me.carry} onClick={() => send({ t: 'act', a: 'claw' })} />
          <Btn k="F" label={`Pistol ${me.bullets ? '●' : '○'}`} off={!me.bullets || me.carry} onClick={() => send({ t: 'act', a: 'shoot' })} />
          <Btn k="E" label={`Yarn ×${me.yarn}`} off={!me.yarn} onClick={() => send({ t: 'act', a: 'yarn' })} />
          <Btn k="Q" label="Radio" onClick={() => setWheel({ to: 'all' })} />
          <Btn k="V" label="Vote" off={me.calledVote || !!s.vote || s.t < 15} onClick={() => send({ t: 'callVote' })} />
          <Btn k="X" label={`Scan ×${s.scansLeft}`} off={!s.scansLeft} onClick={() => send({ t: 'scan' })} />
          {me.carry && <Btn k="G" label="Drop core" onClick={() => send({ t: 'act', a: 'drop' })} />}
        </div>
      )}

      {wheel && !out && (
        <div className="wheel panel">
          <div className="chips">
            <button className={wheel.to === 'all' ? 'sel' : ''} onClick={() => setWheel({ ...wheel, to: 'all' })}>Everyone</button>
            {s.crew.filter((c) => c.id !== s.you && c.status !== 'cut').map((c) => (
              <button key={c.id} className={wheel.to === c.id ? 'sel' : ''} style={{ borderColor: c.color }} onClick={() => setWheel({ ...wheel, to: c.id })}>Whisper {c.name}</button>
            ))}
          </div>
          {!wheel.call && <div className="grid">{WHEEL.map((w, i) => <button key={w.kind} onClick={() => pick(w)}><b>{i + 1}</b> {w.label}</button>)}</div>}
          {wheel.call?.need === 'cat' && (
            <div className="grid">{s.crew.filter((c) => c.id !== s.you).map((c, i) => <button key={c.id} style={{ color: c.color }} onClick={() => pick(wheel.call, { cat: c.id })}><b>{i + 1}</b> {c.name}</button>)}</div>
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

export function Crew({ s, onWhisper }) {
  const text = (c) => {
    if (c.id === s.you) return 'you'
    if (c.status === 'ok') return 'in sight'
    if (c.status === 'dead') return 'DEAD'
    if (c.status === 'captured') return 'caged'
    if (c.status === 'cut') return 'cut loose'
    return c.lastSeen ? `${roomName(c.lastSeen.room)}, ${c.lastSeen.ago}s ago` : 'not seen'
  }
  return (
    <div className="crew">
      {s.crew.map((c) => (
        <button key={c.id} className={'cat ' + c.status + (c.status === 'unseen' && (!c.lastSeen || c.lastSeen.ago > 30) && s.t > 30 ? ' missing' : '')} onClick={() => c.id !== s.you && onWhisper?.(c.id)} style={{ '--c': c.color }}>
          <span className="face" /><span><b>{c.name}</b><small>{text(c)}</small></span>
        </button>
      ))}
    </div>
  )
}

export function Radio({ s }) {
  const name = (id) => s.crew.find((c) => c.id === id)?.name ?? 'Hacker'
  const color = (id) => s.crew.find((c) => c.id === id)?.color ?? '#9fe0ff'
  return (
    <div className="radio">
      {s.radio.slice(-6).map((m) => (
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
      <h3>Alibi scan <em>{scan.state === 'running' ? 'querying…' : scan.source === 'bruin' ? `live Bruin query${scan.ms ? `, ${scan.ms} ms` : ''}` : 'local data'}</em></h3>
      {scan.rows?.map((r, i) => <p key={i} className={r.kind}>{r.text}</p>)}
      {scan.state === 'done' && !scan.rows?.length && <p>No contradictions on record yet.</p>}
      {scan.sql && <pre>{scan.sql}</pre>}
    </div>
  )
}

export function Vote({ s, send, canVote }) {
  const [mine, setMine] = useState(null)
  const by = s.crew.find((c) => c.id === s.vote.by)
  const cast = (id) => { setMine(id); send({ t: 'vote', cat: id }) }
  return (
    <div className="vote panel">
      <h3>{by?.name} called a vote <em>{Math.ceil(s.vote.left)}s</em></h3>
      <div className="chips">
        {s.vote.options.map((id) => {
          const c = s.crew.find((k) => k.id === id)
          return <button key={id} disabled={!canVote} className={mine === id ? 'sel' : ''} style={{ borderColor: c.color }} onClick={() => cast(id)}>{c.name}{id === s.you ? ' (you)' : ''}</button>
        })}
        <button disabled={!canVote} className={mine === 'skip' ? 'sel' : ''} onClick={() => cast(null) || setMine('skip')}>Skip</button>
      </div>
      <small>{Object.keys(s.vote.votes).length} voted. The clock is still running.</small>
    </div>
  )
}

export function VoteResult({ s }) {
  if (!s.lastVote) return null
  const c = s.crew.find((k) => k.id === s.lastVote.out)
  return <div className="banner">{c ? `${c.name} was cut loose. ${s.lastVote.wasMole ? 'They WERE the mole.' : 'They were loyal.'}` : 'No one was cut loose.'}</div>
}
