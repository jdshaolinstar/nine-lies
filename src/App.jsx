import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { connectLocal, connectServer, probeServer, apiBase } from './net.js'
import { GameView } from './view.js'
import { sfx, speak, unlock, audio } from './audio.js'
import Hud from './Hud.jsx'
import Hacker from './Hacker.jsx'
import Director from './Director.jsx'
import Watch from './Watch.jsx'
import EndScreen from './EndScreen.jsx'
import DebugPanel, { VENDORS } from './Debug.jsx'
import { DEFAULT_SCENARIO } from '../shared/scenario.js'

const params = new URLSearchParams(location.search)
// Trailer footage: no HUD, low cameras, starts by itself.
const CINE = params.has('cine')

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
  const cineAgain = useRef(false)

  useEffect(() => {
    view.current = new GameView(canvas.current)
    probeServer().then(setStatus)
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
      view.current?.update(s, r === 'runner' && s.phase === 'play' ? 'runner' : CINE ? 'cine' : r === 'watch' && s.phase === 'play' ? 'watch' : 'director', s.you)
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
      if (CINE && s.phase === 'end' && !cineAgain.current) { cineAgain.current = true; setTimeout(() => { cineAgain.current = false; conn.current?.send({ t: 'start' }) }, 1500) }
    }
  }
  const statusRef = useRef(null)
  const snapRef = useRef(null)
  snapRef.current = snap
  statusRef.current = status

  const enter = (mode, r) => {
    unlock()
    demo.current?.close()
    demo.current = null
    roleRef.current = r
    setRole(r)
    view.current?.reset()
    conn.current = mode === 'solo' ? connectLocal(onMsg) : connectServer(onMsg, (st) => { setNet(st); if (st === 'open') { conn.current?.send({ t: 'join', role: r === 'watch' ? 'director' : r, name }); if (r === 'watch') conn.current?.send({ t: 'start' }) } }, r === 'watch')
    if (mode === 'solo') {
      conn.current.send({ t: 'join', role: r === 'watch' ? 'director' : r, name })
      conn.current.send({ t: 'start' })
    }
  }
  const send = (m) => conn.current?.send(m)

  // Deep link for phones: /?join=hacker
  useEffect(() => {
    const j = params.get('join')
    if (j && status) enter('server', j)
    const solo = CINE ? 'director' : params.get('solo')
    if (solo && status !== undefined && !roleRef.current) enter('solo', solo)
  }, [status])

  const inMatch = snap && (snap.phase === 'play' || snap.phase === 'end')
  const showHacker = role === 'hacker' && snap?.phase === 'play'
  return (
    <div className={'app' + (debug && role ? ' dbg' : '')}>
      <div className={'stage' + (showHacker ? ' hidden' : '')}><canvas ref={canvas} /></div>
      {!role && <Menu status={status} enter={enter} name={name} setName={setName} scenario={status?.scenario ?? DEFAULT_SCENARIO} />}
      {role && !inMatch && <Lobby lobby={lobby} status={status} send={send} role={role} net={net} />}
      {snap?.phase === 'play' && role === 'runner' && <Hud s={snap} send={send} scan={scan} scenario={lobby?.scenario ?? DEFAULT_SCENARIO} />}
      {showHacker && <Hacker s={snap} send={send} scan={scan} />}
      {snap?.phase === 'play' && role === 'director' && !CINE && <Director s={snap} scan={scan} services={lobby?.services} />}
      {snap?.phase === 'play' && role === 'watch' && <Watch s={snap} services={lobby?.services} />}
      {snap?.phase === 'end' && !CINE && <EndScreen s={snap} vlog={vlog} learning={learning} again={() => send({ t: 'start' })} />}
      {role && !CINE && snap?.phase === 'play' && role !== 'hacker' && <button className={'dbgbtn' + (debug ? ' on' : '')} onClick={(e) => { setDebug(!debug); e.currentTarget.blur() }}>Debug: who did what</button>}
      {debug && role && !CINE && snap?.phase === 'play' && role !== 'hacker' && <DebugPanel log={vlog} local={conn.current?.local} />}
      {role && net === 'closed' && <div className="toast bad">Lost the server. Reconnecting…</div>}
    </div>
  )
}

function Menu({ status, enter, name, setName, scenario }) {
  return (
    <div className="menu">
      <p className="kicker">A heist for cats who can&apos;t trust cats</p>
      <h1>Nine<span>Lies</span></h1>
      <p className="brief"><b>{scenario.villain}:</b> “{scenario.villainLine}”</p>
      {scenario.why && <p className="why"><b>Why this mission:</b> {scenario.why}<br />{scenario.sources?.slice(0, 2).map((u) => <a key={u.url} href={u.url} target="_blank" rel="noreferrer">{u.title.length > 38 ? u.title.slice(0, 38) + '…' : u.title}</a>)}</p>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Code name (optional)" maxLength={14} aria-label="Code name" />
      <div className="row">
        <button className="big" onClick={() => enter(status ? 'server' : 'solo', 'watch')}>Watch a heist</button>
        <button className="big alt" onClick={() => enter('solo', 'runner')}>Play</button>
        {status && <button className="big alt" onClick={() => enter('server', 'runner')}>Play with live AI + friends</button>}
      </div>
      <div className="row small">
        
        {status && <button onClick={() => enter('server', 'hacker')}>Join as hacker</button>}
        {status && <button onClick={() => enter('server', 'director')}>Join as spectator</button>}
      </div>
      <p className="keys"><b>1. Power:</b> two cats stand on two rings at once. <b>2. Core:</b> grab it. <b>3. Escape:</b> reach the H. One cat is a traitor.<br /><b>WASD</b> move · <b>Shift</b> run · <b>C</b> sneak · <b>Space</b> claw · <b>F</b> shoot · <b>Q</b> talk</p>
    </div>
  )
}

function Lobby({ lobby, status, send, role, net }) {
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
      <button className="big" onClick={() => send({ t: 'start' })}>Start the heist</button>
      {lobby?.services && <p className="svc">{Object.entries(lobby.services).map(([k, v]) => <span key={k} className={v ? 'on' : ''}>{k}</span>)}</p>}
    </div>
  )
}
