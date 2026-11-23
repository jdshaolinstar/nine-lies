import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Session } from '../shared/session.js'
import { loadEnv } from './env.js'
import { createServices } from './services.js'

loadEnv()
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PORT = +process.env.PORT || 8787
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' }

const services = await createServices()

const sessions = new Map()
function sessionFor(room) {
  const key = /^[a-z0-9-]{1,20}$/.test(room ?? '') ? room : 'main'
  if (!sessions.has(key)) {
    if (sessions.size > 20) return sessions.get('main') ?? [...sessions.values()][0]
    sessions.set(key, new Session({ ...services.hooks, services: services.status(), learning: services.learning, scenario: services.scenario }))
  }
  return sessions.get(key)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/health') return res.end('ok')
  // The browser build can be hosted elsewhere and still use this server.
  if (url.pathname.startsWith('/api/')) res.setHeader('access-control-allow-origin', '*')
  if (url.pathname === '/api/status') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify({ services: services.status(), scenario: services.scenario, detail: url.searchParams.has('debug') && !req.headers['x-forwarded-for'] ? services.detail() : undefined, lan: lanAddress(), port: PORT, publicUrl: process.env.PUBLIC_URL ?? null }))
  }
  if (url.pathname === '/api/tts') return services.tts(url, res)
  // Only files inside dist are ever served.
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)))
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) { res.statusCode = 503; return res.end('Run: npm run build') }
  res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
})

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 })
wss.on('connection', (ws, req) => {
  const session = sessionFor(new URL(req.url, 'http://x').searchParams.get('room'))
  const client = session.join((msg) => { if (ws.readyState === 1 && ws.bufferedAmount < 200_000) ws.send(JSON.stringify(msg)) })
  ws.on('message', (raw) => { try { session.handle(client, JSON.parse(raw)) } catch (e) { console.error('bad message:', e.message) } })
  ws.on('close', () => session.leave(client))
  ws.on('error', () => {})
})

let last = performance.now()
setInterval(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  for (const s of sessions.values()) {
    try { s.tick(dt) } catch (e) { console.error('tick failed', e) }
  }
}, 50)

function lanAddress() {
  const found = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vmware|virtual|vethernet|wsl|docker|loopback/i.test(name)) continue
    for (const i of list) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.')) found.push({ name, address: i.address })
  }
  // The real network first; hotspot adapters also have private addresses.
  found.sort((a, b) => /^(wi-?fi|wlan|en0)/i.test(b.name) - /^(wi-?fi|wlan|en0)/i.test(a.name))
  return found[0]?.address ?? 'localhost'
}

server.listen(PORT, () => console.log(`Nine Lies on http://localhost:${PORT}  (LAN: http://${lanAddress()}:${PORT})`, services.status()))
