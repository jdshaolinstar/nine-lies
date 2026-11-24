// Are the hacker and the runner in the same match? node test/hacker-sync.mjs
import WebSocket from 'ws'
const room = 'sync' + (Date.now() % 1e6)
const open = (role, r = room) => new Promise((ok) => {
  const ws = new WebSocket(`ws://127.0.0.1:8787/ws?room=${r}`)
  const c = { ws, s: [], send: (m) => ws.send(JSON.stringify(m)) }
  ws.on('message', (x) => { const m = JSON.parse(x); if (m.t === 'snap') c.s.push(m.s) })
  ws.on('open', () => { c.send({ t: 'join', role, name: role }); setTimeout(() => ok(c), 250) })
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const run = await open('runner'), hack = await open('hacker'), spec = await open('director')
run.send({ t: 'start' })
await wait(6000)
const at = (c, t) => c.s.find((x) => x.t === t)
let compared = 0, maxOff = 0
for (const h of hack.s) {
  const d = at(spec, h.t)
  if (!d) continue
  compared++
  for (const dog of h.dogs) { const k = d.dogs.find((q) => q.id === dog.id); maxOff = Math.max(maxOff, Math.hypot(k.x - dog.x, k.z - dog.z)) }
}
console.log(`same clock: ${compared} matching frames, biggest dog position difference ${maxOff.toFixed(3)}`)
const h = hack.s.at(-1)
console.log('cats the hacker can see right now:', h.cats.map((c) => c.name).join(', ') || 'NONE', '| cats alive:', spec.s.at(-1).cats.length)
const none = hack.s.filter((x) => !x.cats.length).length
console.log(`frames where the hacker saw no cats at all: ${Math.round((none / hack.s.length) * 100)}%`)
console.log('hacker sees their own runner:', Math.round((hack.s.filter((x) => x.cats.some((c) => c.human)).length / hack.s.length) * 100) + '% of frames')
const t0 = Date.now()
hack.send({ t: 'hack', a: 'door', id: 'd3' })
while (!run.s.at(-1).locked.includes('d3') && Date.now() - t0 < 3000) await wait(5)
console.log('door lock reached the runner in', Date.now() - t0, 'ms:', run.s.at(-1).locked.includes('d3'))
const dog = h.dogs[0].id
hack.send({ t: 'hack', a: 'ping', id: dog }); await wait(400)
console.log('pinged dog now visible to runner:', run.s.at(-1).dogs.some((d) => d.id === dog))
for (const c of [run, hack, spec]) c.ws.close()
process.exit(0)
