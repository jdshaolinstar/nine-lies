import { useEffect, useRef, useState } from 'react'
import { W, H, ROOMS, DOORS, GENERATORS, HELIPAD, solid, PROPS } from '../shared/map.js'
import { clock, Radio, ScanBox, VoteResult } from './Hud.jsx'

// The hacker sees every dog and every door, but cats only on working cameras.
export default function Hacker({ s, send, scan }) {
  const ref = useRef(null)
  const snap = useRef(s)
  snap.current = s
  const [tool, setTool] = useState('door')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const geom = useRef({ k: 1, ox: 0, oy: 0 })

  useEffect(() => {
    const c = ref.current
    const g = c.getContext('2d')
    let raf
    const props = new Set()
    PROPS.forEach((p) => { for (let z = p.z; z < p.z + p.h; z++) for (let x = p.x; x < p.x + p.w; x++) props.add(z * W + x) })
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const st = snap.current
      const dpr = Math.min(2, devicePixelRatio)
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr }
      const k = Math.min(w / W, h / H)
      const ox = (w - k * W) / 2, oy = (h - k * H) / 2
      geom.current = { k, ox, oy }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = '#03110c'
      g.fillRect(0, 0, w, h)
      g.translate(ox, oy)
      const px = (n) => n * k
      for (const r of ROOMS) {
        g.fillStyle = r.cam ? (st.camLoop.includes(r.id) ? '#0f4a3a' : '#0a2e24') : '#071d17'
        if (r.id === 'vault') g.fillStyle = st.vaultOpen ? '#0f4a3a' : '#3a0f18'
        g.fillRect(px(r.x), px(r.z), px(r.w), px(r.h))
      }
      g.fillStyle = '#1b6a50'
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (solid[z * W + x]) { g.globalAlpha = props.has(z * W + x) ? 0.35 : 0.9; g.fillRect(px(x), px(z), k + 0.5, k + 0.5) }
      g.globalAlpha = 1
      g.font = `700 ${Math.max(8, k * 0.85)}px ui-monospace, monospace`
      g.textAlign = 'center'
      for (const r of ROOMS) {
        g.fillStyle = '#5fe0b0'
        g.globalAlpha = 0.75
        g.fillText(r.name.toUpperCase(), px(r.x + r.w / 2), px(r.z + r.h / 2))
        if (r.cam) g.fillText(st.camLoop.includes(r.id) ? '◉ LOOPED' : '◉ CAM', px(r.x + r.w / 2), px(r.z + r.h / 2 + 1.3))
        g.globalAlpha = 1
      }
      for (const gen of GENERATORS) {
        const on = st.gens.find((q) => q.id === gen.id)?.held
        g.strokeStyle = on ? '#ffd23e' : '#3cf2ff'
        g.lineWidth = 2
        g.beginPath(); g.arc(px(gen.x), px(gen.z), px(1.2), 0, 7); g.stroke()
      }
      g.strokeStyle = '#8dff9d'
      g.beginPath(); g.arc(px(HELIPAD.x), px(HELIPAD.z), px(HELIPAD.r), 0, 7); g.stroke()
      for (const d of DOORS) {
        const locked = st.locked.includes(d.id)
        const [[x1, z1], [x2, z2]] = d.cells
        g.fillStyle = locked ? '#ff4050' : '#4dffb8'
        g.fillRect(px(x1), px(z1), px(x2 - x1 + 1), px(z2 - z1 + 1))
        if (toolRef.current === 'door' && !d.vault) { g.strokeStyle = '#ffffff88'; g.strokeRect(px(x1) - 3, px(z1) - 3, px(x2 - x1 + 1) + 6, px(z2 - z1 + 1) + 6) }
      }
      g.strokeStyle = '#ff3048'; g.lineWidth = 2
      for (const [x1, z1, x2, z2] of st.lasers ?? []) { g.beginPath(); g.moveTo(px(x1), px(z1)); g.lineTo(px(x2), px(z2)); g.stroke() }
      for (const d of st.dogs) {
        g.save()
        g.translate(px(d.x), px(d.z))
        g.rotate(d.dir)
        g.fillStyle = d.state === 'chase' ? '#ff304088' : d.state === 'investigate' ? '#ff9a3066' : '#ffe9a044'
        if (d.state !== 'ko') { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, px(5.4), -0.62, 0.62); g.fill() }
        g.fillStyle = d.state === 'ko' ? '#777' : '#ffb04a'
        g.beginPath(); g.arc(0, 0, Math.max(5, px(0.65)), 0, 7); g.fill()
        g.restore()
        if (st.pings.includes(d.id)) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(px(d.x), px(d.z), px(1.6), 0, 7); g.stroke() }
      }
      for (const cat of st.cats) {
        g.fillStyle = cat.color
        g.beginPath(); g.arc(px(cat.x), px(cat.z), Math.max(5, px(0.6)), 0, 7); g.fill()
        g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke()
        g.fillText(cat.name, px(cat.x), px(cat.z) - px(0.9))
      }
      if (!st.core.hidden) { g.fillStyle = '#ff3048'; g.beginPath(); g.arc(px(st.core.x), px(st.core.z), px(0.4), 0, 7); g.fill() }
      if (st.blackout > 0) { g.fillStyle = '#000000aa'; g.fillRect(0, 0, px(W), px(H)) }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  const tap = (e) => {
    const r = ref.current.getBoundingClientRect()
    const { k, ox, oy } = geom.current
    const x = (e.clientX - r.left - ox) / k, z = (e.clientY - r.top - oy) / k
    const t = toolRef.current
    const dog = s.dogs.map((d) => ({ d, q: Math.hypot(d.x - x, d.z - z) })).sort((a, b) => a.q - b.q)[0]
    const room = ROOMS.find((o) => o.id === 'vault' && x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.h) ?? ROOMS.find((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.h)
    if (t === 'door') {
      const d = DOORS.map((o) => ({ o, q: Math.hypot((o.cells[0][0] + o.cells[1][0]) / 2 + 0.5 - x, (o.cells[0][1] + o.cells[1][1]) / 2 + 0.5 - z) })).sort((a, b) => a.q - b.q)[0]
      if (d.q < 2.6) send({ t: 'hack', a: 'door', id: d.o.id })
    } else if (t === 'ping') { if (dog && dog.q < 3) send({ t: 'hack', a: 'ping', id: dog.d.id }) }
    else if (room && t === 'cam') send({ t: 'hack', a: 'cam', id: room.id })
    else if (room && t === 'alarm') send({ t: 'hack', a: 'alarm', id: room.id })
    else if (room && ['guard', 'clear', 'going'].includes(t)) send({ t: 'radio', kind: t, room: room.id })
  }

  const tools = [['door', 'Doors'], ['ping', 'Ping dog'], ['cam', 'Loop cam'], ['alarm', 'Bait alarm'], ['guard', 'Call: dog'], ['clear', 'Call: clear'], ['going', 'Call: go']]
  const hint = { door: 'Tap a door to lock or open it', ping: 'Tap a dog to show it to the runner', cam: 'Tap a camera room', alarm: 'Tap a room to lure dogs there', guard: 'Tap the room with the dog', clear: 'Tap a safe room', going: 'Tap where they should go' }
  return (
    <div className="hacker">
      <div className="hk-top"><b>{clock(s.timeLeft)}</b><span>{s.core.taken ? 'Core is out!' : s.vaultOpen ? 'Vault open' : `Generators: ${s.gens.filter((g) => g.held).length}/2`}</span></div>
      <canvas ref={ref} onPointerDown={tap} />
      <p className="hint">{hint[tool]}</p>
      <div className="tools">
        {tools.map(([id, l]) => <button key={id} className={(tool === id ? 'sel ' : '') + (s.hackCd[id] > 0.1 ? 'off' : '')} onClick={() => setTool(id)}>{l}{s.hackCd[id] > 0.5 ? ` ${s.hackCd[id].toFixed(0)}` : ''}</button>)}
        <button className={'danger' + (s.hackCd.blackout > 0.1 ? ' off' : '')} onClick={() => send({ t: 'hack', a: 'blackout', id: 'all' })}>BLACKOUT{s.hackCd.blackout > 0.5 ? ` ${s.hackCd.blackout.toFixed(0)}` : ''}</button>
        <button className={s.scansLeft ? '' : 'off'} onClick={() => send({ t: 'scan' })}>Scan ×{s.scansLeft}</button>
      </div>
      <Radio s={s} />
      <ScanBox scan={scan} />
      <VoteResult s={s} />
    </div>
  )
}
