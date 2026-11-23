// Watches full live matches on the running server: node test/llm-match.mjs [count]
import WebSocket from 'ws'
for (let i = 0; i < (+process.argv[2] || 1); i++) {
  const ws = new WebSocket(`ws://127.0.0.1:8787/ws?room=watch${Date.now() % 1e6}`)
  const s = await new Promise((ok) => {
    ws.on('open', () => { ws.send('{"t":"join","role":"director"}'); ws.send('{"t":"start"}') })
    ws.on('message', (r) => { const m = JSON.parse(r); if (m.t === 'snap' && m.s.phase === 'end') ok(m.s) })
  })
  ws.close()
  console.log('\n==', s.result.winner, '|', s.result.why, '| mole', s.result.mole, s.tactic, '| caught', s.result.moleCaught, '|', s.result.t + 's')
  const src = {}
  s.ledger.forEach((l) => { src[l.source] = (src[l.source] ?? 0) + 1 })
  console.log('decisions', src)
  s.ledger.filter((l) => l.source === 'llm').slice(0, 14).forEach((l) => console.log(`  ${l.t} ${l.who}: ${l.goal} — ${l.reason}`))
  s.story.forEach((e) => console.log('   *', e.t, e.type, e.actor ?? '', e.target ?? '', e.data.why ?? ''))
  console.log(s.radio.slice(-8).map((m) => `   ${m.from}: ${m.text}`).join('\n'))
}
