import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { connectLocal, connectServer, probeServer } from './net.js'
import { GameView } from './view.js'
import { sfx, speak, unlock, audio } from './audio.js'
import Hud from './Hud.jsx'
import Hacker from './Hacker.jsx'
import Director from './Director.jsx'
import EndScreen from './EndScreen.jsx'
import { DEFAULT_SCENARIO } from '../shared/scenario.js'

const params = new URLSearchParams(location.search)

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
  const heard = useRef(-1)

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
    else if (m.t === 'started') { view.current?.reset(); heard.current = -1; setScan(null); setSnap(null) }
    else if (m.t === 'scan') setScan(m)
    else if (m.t === 'snap') {
      const s = m.s
      const r = roleRef.current
      view.current?.update(s, r === 'runner' && s.phase === 'play' ? 'runner' : 'director', s.you)
      const last = s.radio[s.radio.length - 1]
      if (last && last.id > heard.current) {
        if (heard.current >= 0 || last.id < 3) {
          sfx('radio')
          if (last.from !== s.you) speak(last.from, last.text, statusRef.current?.services?.voices)
        }
        heard.current = last.id
      }
      setSnap(s)
      if (m.learning) setLearning(m.learning)
    }
  }
  const statusRef = useRef(null)
  statusRef.current = status

  const enter = (mode, r) => {
    unlock()
    demo.current?.close()
    demo.current = null
    roleRef.current = r
    setRole(r)
    view.current?.reset()
    conn.current = mode === 'solo' ? connectLocal(onMsg) : connectServer(onMsg, (st) => { setNet(st); if (st === 'open') conn.current?.send({ t: 'join', role: r, name }) })
    if (mode === 'solo') {
      conn.current.send({ t: 'join', role: r, name })
      conn.current.send({ t: 'start' })
    }
  }
  const send = (m) => conn.current?.send(m)

  // Deep link for phones: /?join=hacker
  useEffect(() => {
    const j = params.get('join')
    if (j && status) enter('server', j)
    const solo = params.get('solo')
    if (solo && status !== undefined && !roleRef.current) enter('solo', solo)
  }, [status])

  const inMatch = snap && (snap.phase === 'play' || snap.phase === 'end')
  const showHacker = role === 'hacker' && snap?.phase === 'play'
  return (
    <div className="app">
      <div className={'stage' + (showHacker ? ' hidden' : '')}><canvas ref={canvas} /></div>
      {!role && <Menu status={status} enter={enter} name={name} setName={setName} scenario={status?.scenario ?? DEFAULT_SCENARIO} />}
      {role && !inMatch && <Lobby lobby={lobby} status={status} send={send} role={role} net={net} />}
      {snap?.phase === 'play' && role === 'runner' && <Hud s={snap} send={send} scan={scan} scenario={lobby?.scenario ?? DEFAULT_SCENARIO} />}
      {showHacker && <Hacker s={snap} send={send} scan={scan} />}
      {snap?.phase === 'play' && role === 'director' && <Director s={snap} scan={scan} services={lobby?.services} />}
      {snap?.phase === 'end' && <EndScreen s={snap} learning={learning} again={() => send({ t: 'start' })} />}
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
      <p className="brief dim">{scenario.briefing}</p>
      {scenario.why && <p className="why"><b>Why this mission:</b> {scenario.why}<br />{scenario.sources?.slice(0, 3).map((u) => <a key={u.url} href={u.url} target="_blank" rel="noreferrer">{u.title.slice(0, 40)}</a>)}</p>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Code name (optional)" maxLength={14} aria-label="Code name" />
      <div className="row">
        <button className="big" onClick={() => enter('solo', 'runner')}>Play now</button>
        {status && <button className="big alt" onClick={() => enter('server', 'runner')}>Play with friends</button>}
      </div>
      <div className="row small">
        <button onClick={() => enter('solo', 'director')}>Watch the agents</button>
        {status && <button onClick={() => enter('server', 'hacker')}>Join as hacker</button>}
        {status && <button onClick={() => enter('server', 'director')}>Join as spectator</button>}
      </div>
      <p className="keys"><b>WASD</b> move · <b>Shift</b> sprint · <b>Ctrl</b> sneak · <b>Space</b> claw · <b>F</b> shoot · <b>E</b> yarn · <b>Q</b> radio · <b>V</b> vote · <b>X</b> alibi scan</p>
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
