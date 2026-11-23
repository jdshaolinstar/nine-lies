// Needs a running server: node test/multiplayer.mjs
// Two human runners and a hacker in one match; checks that each only sees what they should.
import assert from 'node:assert'
import WebSocket from 'ws'

const URL = process.argv[2] || 'ws://127.0.0.1:8787/ws?room=test' + (Date.now() % 1e6)
const open = (role, name) => new Promise((ok) => {
  const ws = new WebSocket(URL)
  const c = { ws, snaps: [], scan: null, send: (m) => ws.send(JSON.stringify(m)) }
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.t === 'snap') c.snaps.push(m.s)
    if (m.t === 'lobby') c.lobby = m
    if (m.t === 'scan' && m.state === 'done') c.scan = m
  })
  ws.on('open', () => { c.send({ t: 'join', role, name }); setTimeout(() => ok(c), 200) })
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const a = await open('runner', 'Ann'), b = await open('runner', 'Bob'), h = await open('hacker', 'Hax')
assert.equal(a.lobby.you.catId, 'ace')
assert.equal(b.lobby.you.catId, 'domino')
a.send({ t: 'start' })
await wait(800)
a.send({ t: 'input', mx: 1, mz: 0, sprint: true })
await wait(1500)
a.send({ t: 'input', mx: 0, mz: 0 })
const x0 = a.snaps[0].cats.find((c) => c.id === 'ace').x
const last = a.snaps.at(-1)
assert.ok(last.cats.find((c) => c.id === 'ace').x > x0 + 2, 'runner moved')
assert.ok(last.cats.find((c) => c.id === 'ace').human && b.snaps.at(-1).you === 'domino')
assert.ok(!JSON.stringify(last).includes('"mole":'), 'runner must not learn the mole')
assert.ok(!('mole' in h.snaps.at(-1)), 'hacker must not learn the mole')
assert.equal(h.snaps.at(-1).dogs.length, 3, 'hacker sees every dog')
assert.ok(!JSON.stringify(b.snaps.at(-1).radio).includes('"lie"'), 'lies stay secret')
h.send({ t: 'hack', a: 'door', id: 'd3' })
await wait(300)
assert.ok(a.snaps.at(-1).locked.includes('d3'), 'hacker locked a door for everyone')
a.send({ t: 'radio', kind: 'going', room: 'gennorth', to: 'domino' })
await wait(1200)
assert.ok(b.snaps.at(-1).radio.some((m) => m.from === 'ace' && m.to === 'domino'), 'whisper reached Bob')
assert.ok(!h.snaps.at(-1).radio.some((m) => m.to === 'domino'), 'whisper hidden from the hacker')
a.send({ t: 'scan' })
await wait(6000)
assert.ok(a.scan, 'scan answered')
console.log('scan source:', a.scan.source, a.scan.error ?? '', a.scan.rows.length, 'rows', a.scan.ms ? a.scan.ms + ' ms' : '')
console.log('radio via:', [...new Set(b.snaps.at(-1).radio.map((m) => m.via ?? 'direct'))].join(', '), '| snapshot bytes:', JSON.stringify(last).length)
for (const c of [a, b, h]) c.ws.close()
console.log('multiplayer ok')
