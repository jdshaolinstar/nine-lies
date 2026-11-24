import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { connectLocal, connectServer, probeServer, apiBase } from './net.js'
import { GameView } from './view.js'
import { sfx, speak, unlock, audio } from './audio.js'
import Hud from './Hud.jsx'
import Hacker from './Hacker.jsx'
import Director from './Director.jsx'
import Watch from './Watch.jsx'
import Research from './Research.jsx'
import EndScreen from './EndScreen.jsx'
import DebugPanel, { VENDORS } from './Debug.jsx'
import { DEFAULT_SCENARIO } from '../shared/scenario.js'

const params = new URLSearchParams(location.search)
// Trailer footage: no HUD, low cameras, starts by itself.

export default function App() {
  const canvas = useRef(null)
  const view = useRef(null)
  const conn = useRef(null)
  const demo = useRef(null)
  const [status, setStatus] = useState(undefined) // undefined: checking, null: no server
  const [lobby, setLobby] = useState(null)
  const [snap, setSnap] = useState(null)
  const [learning, setLearning] = useState(null)
  const [role, setRole] = useState(null)
  const [scan, setScan] = useState(null)
  const [net, setNet] = useState('open')
  const [name, setName] = useState('')
  const roleRef = useRef(null)
  const [vlog, setVlog] = useState([])
  const [debug, setDebug] = useState(params.has('debug'))
  const debugRef = useRef(debug)
  debugRef.current = debug
  useEffect(() => {
    const key = (e) => { if (e.code === 'Backquote') setDebug((d) => !d) }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  const heard = useRef(-1)
  const [mission, setMission] = useState(null)
  const [research, setResearch] = useState(false)
  const opts = useRef({})
  const cine = useRef(params.has('cine'))
  useEffect(() => {
    const esc = (e) => { if (e.code === 'Escape' && cine.current) location.assign(location.pathname) }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [])
  const cineAgain = useRef(false)

  useEffect(() => {
    view.current = new GameView(canvas.current)
    probeServer().then(setStatus)
    fetch('scenario.json').then((r) => (r.headers.get('content-type')?.includes('json') ? r.json() : null)).then((d) => d?.title && setMission(d)).catch(() => {})
    // The menu plays a live match between agents behind the title.
    demo.current = connectLocal((m) => { if (m.t === 'snap' && !roleRef.current) view.current?.update(m.s, 'menu', null) })
    demo.current.send({ t: 'join', role: 'director' })
    demo.current.send({ t: 'start' })
    const again = setInterval(() => { if (demo.current?.session.match?.phase === 'end') { demo.current.send({ t: 'start' }) } }, 4000)
    return () => { clearInterval(again); demo.current?.close(); view.current?.dispose() }
  }, [])

  const onMsg = (m) => {
    if (m.t === 'lobby') setLobby(m)
    else if (m.t === 'started') { view.current?.reset(); heard.current = -1; setScan(null); setSnap(null); setVlog([]) }
    else if (m.t === 'vendor') {
      setVlog((l) => [...l.slice(-400), m.e])
      if (debugRef.current && m.e.sticker) view.current?.sticker(m.e.who ?? snapRef.current?.you, `${VENDORS[m.e.vendor].name.toUpperCase()} ${m.e.sticker}`, VENDORS[m.e.vendor].color)
    } else if (m.t === 'vendorAll') setVlog(m.log)
    else if (m.t === 'scan') setScan(m)
    else if (m.t === 'snap') {
      const s = m.s
      const r = roleRef.current
      view.current?.update(s, r === 'runner' && s.phase === 'play' ? 'runner' : cine.current ? 'cine' : r === 'watch' && s.phase === 'play' ? 'watch' : 'director', s.you)
      const last = s.radio[s.radio.length - 1]
      if (last && last.id > heard.current) {
        if (heard.current >= 0 || last.id < 3) {
          sfx('radio')
          view.current?.say(last.from, last.text)
          if (last.from !== s.you && ['suspect', 'body', 'help', 'taunt', 'at', 'saw'].includes(last.kind)) speak(last.from, last.text, !conn.current?.local && statusRef.current?.services?.voices, apiBase())
        }
        heard.current = last.id
      }
      setSnap(s)
      if (m.learning) setLearning(m.learning)
      if (cine.current && s.phase === 'end' && !cineAgain.current) { cineAgain.current = true; setTimeout(() => { cineAgain.current = false; conn.current?.send({ t: 'start' }) }, 1500) }
    }
  }
  const statusRef = useRef(null)
  const snapRef = useRef(null)
  snapRef.current = snap
  statusRef.current = status

  const enter = (mode, r, o = {}) => {
    opts.current = o
    if (o.cine) cine.current = true
    const alone = r === 'watch' || o.alone
    const begin = () => conn.current?.send({ t: 'start', traitor: o.traitor })
    unlock()
    demo.current?.close()
    demo.current = null
    roleRef.current = r
    setRole(r)
    view.current?.reset()
    conn.current = mode === 'solo' ? connectLocal(onMsg, { ...DEFAULT_SCENARIO, ...mission }) : connectServer(onMsg, (st) => { setNet(st); if (st === 'open') { conn.current?.send({ t: 'join', role: r === 'watch' ? 'director' : r, name }); if (alone) begin() } }, alone)
    if (mode === 'solo') {
      conn.current.send({ t: 'join', role: r === 'watch' ? 'director' : r, name })
      begin()
    }
  }
  const send = (m) => conn.current?.send(m)

  // Deep link for phones: /?join=hacker
  useEffect(() => {
    const j = params.get('join')
    if (j && status) enter('server', j)
    const solo = params.get('solo')
    if (status === undefined || roleRef.current) return
    if (cine.current) enter(status ? 'server' : 'solo', 'director', { alone: true })
    else if (solo) enter('solo', solo)
  }, [status])

  const story = { ...DEFAULT_SCENARIO, ...mission, ...status?.scenario }
  const inMatch = snap && (snap.phase === 'play' || snap.phase === 'end')
  const showHacker = role === 'hacker' && snap?.phase === 'play'
  return (
    <div className={'app' + (debug && role ? ' dbg' : '')}>
      <div className={'stage' + (showHacker ? ' hidden' : '')}><canvas ref={canvas} /></div>
      {!role && <Menu status={status} enter={enter} name={name} setName={setName} scenario={story} openResearch={() => setResearch(true)} />}
      {research && story.research && <Research scenario={story} close={() => setResearch(false)} />}
      {role && !inMatch && <Lobby lobby={lobby} status={status} send={send} role={role} net={net} />}
      {snap?.phase === 'play' && role === 'runner' && <Hud s={snap} send={send} scan={scan} scenario={lobby?.scenario ?? story} />}
      {showHacker && <Hacker s={snap} send={send} scan={scan} />}
      {snap?.phase === 'play' && role === 'director' && !cine.current && <Director s={snap} scan={scan} services={lobby?.services} />}
      {snap?.phase === 'play' && role === 'watch' && <Watch s={snap} services={lobby?.services} scenario={story} />}
      {snap?.phase === 'end' && !cine.current && <EndScreen s={snap} vlog={vlog} learning={learning} again={() => send({ t: 'start', traitor: opts.current.traitor })} menu={() => location.assign(location.pathname)} />}
      {!cine.current && role !== 'hacker' && <KeyBar mode={!role ? 'menu' : snap?.phase === 'end' ? 'end' : !inMatch ? 'lobby' : snap.traitor ? 'traitor' : role} debug={debug} toggle={() => setDebug((d) => !d)} />}
      {debug && role && !cine.current && snap?.phase === 'play' && role !== 'hacker' && <DebugPanel log={vlog} local={conn.current?.local} />}
      {role && net === 'closed' && <div className="toast bad">Lost the server. Reconnecting…</div>}
    </div>
  )
}

function Menu({ status, enter, name, setName, scenario, openResearch }) {
  const mode = status ? 'server' : 'solo'
  return (
    <div className="menu">
      <p className="kicker">A heist for cats who can&apos;t trust cats</p>
      <h1>Nine<span>Lies</span></h1>
      <p className="brief"><b>{scenario.villain}:</b> “{scenario.villainLine}”</p>
      {scenario.why && <p className="why"><b>Why this mission:</b> {scenario.why} {scenario.research && <button className="link" onClick={openResearch}>See how it was chosen</button>}</p>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Code name (optional)" maxLength={14} aria-label="Code name" />
      <div className="row">
        <button className="big" onClick={() => enter(mode, 'watch')}>Watch a heist</button>
        <button className="big alt" onClick={() => enter(mode, 'runner', { alone: true })}>Play</button>
        <button className="big dark" onClick={() => enter(mode, 'runner', { alone: true, traitor: 'me' })}>Be the traitor</button>
      </div>
      <div className="row small">
        <button onClick={() => enter(mode, 'director', { alone: true, cine: true })}>Cinematic (for video, Esc to exit)</button>
        {status && <button onClick={() => enter('server', 'runner')}>Play with friends</button>}
        {status && <button onClick={() => enter('server', 'hacker')}>Join as hacker</button>}
        {status && <button onClick={() => enter('server', 'director')}>Join as spectator</button>}
      </div>
      <p className="keys"><b>1. Power:</b> two cats stand on two rings at once. <b>2. Core:</b> grab it. <b>3. Escape:</b> reach the H. One cat is paid by the dogs to stop you.</p>
    </div>
  )
}

function Lobby({ lobby, status, send, role, net }) {
  const [any, setAny] = useState(false)
  const [qr, setQr] = useState(null)
  const link = useMemo(() => {
    if (!status) return null
    const base = status.publicUrl || (['localhost', '127.0.0.1'].includes(location.hostname) ? `http://${status.lan}:${location.port || status.port}` : location.origin)
    return `${base}/?join=hacker${params.get('room') ? '&room=' + params.get('room') : ''}`
  }, [status])
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr) }, [link])
  return (
    <div className="lobby panel">
      <h2>Briefing room</h2>
      {net !== 'open' && <p>Connecting…</p>}
      <ul>
        {lobby?.players.map((p) => <li key={p.id}><i style={{ background: p.color ?? '#7788aa' }} />{p.name} <em>{p.role}{p.id === lobby.you.id ? ' (you)' : ''}</em></li>)}
      </ul>
      <p className="dim">Empty seats are played by agents.</p>
      {qr && role !== 'hacker' && <div className="qr"><img src={qr} alt="QR code to join as hacker" /><p>Scan to join as the <b>hacker</b><br /><small>{link}</small></p></div>}
      <p><label><input type="checkbox" checked={any} onChange={(e) => setAny(e.target.checked)} /> The traitor can be a player</label></p>
      <button className="big" onClick={() => send({ t: 'start', traitor: any ? 'any' : undefined })}>Start the heist</button>
      {lobby?.services && <p className="svc">{Object.entries(lobby.services).map(([k, v]) => <span key={k} className={v ? 'on' : ''}>{k}</span>)}</p>}
    </div>
  )
}

const KEYS = {
  runner: [['WASD', 'move'], ['Shift', 'run'], ['C', 'sneak'], ['Space', 'claw'], ['F', 'shoot'], ['E', 'yarn'], ['Q', 'talk'], ['V', 'vote'], ['X', 'alibi check']],
  traitor: [['WASD', 'move'], ['Shift', 'run'], ['Space', 'claw from behind'], ['F', 'shoot'], ['T', 'tip off the dogs'], ['Q', 'talk (and lie)']],
  menu: [['WASD', 'move'], ['Shift', 'run'], ['C', 'sneak'], ['Space', 'claw'], ['F', 'shoot'], ['Q', 'talk']],
}

// Always on screen: the keys for this mode, and the debug switch.
function KeyBar({ mode, debug, toggle }) {
  return (
    <div className="keybar">
      <div>{(KEYS[mode] ?? []).map(([k, l]) => <span key={k}><kbd>{k}</kbd>{l}</span>)}{mode === 'watch' && <span>Agents are playing. Sit back and watch.</span>}</div>
      <button className={debug ? 'on' : ''} onClick={(e) => { toggle(); e.currentTarget.blur() }}><kbd>`</kbd>Debug {debug ? 'on' : 'off'}</button>
    </div>
  )
}
