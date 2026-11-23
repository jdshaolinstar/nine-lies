import { Session } from '../shared/session.js'

// Two ways to play: on the server with other people, or alone in this tab.
export function connectLocal(onMsg) {
  const session = new Session({ services: { local: true } })
  let client
  const queue = []
  const send = (m) => (client ? onMsg(m) : queue.push(m))
  client = session.join(send)
  queue.forEach(onMsg)
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    session.tick(Math.min(0.25, (now - last) / 1000))
    last = now
  }, 50)
  return { local: true, session, send: (m) => session.handle(client, m), close: () => clearInterval(timer) }
}

export function serverUrl() {
  const p = new URLSearchParams(location.search)
  const explicit = p.get('server') || import.meta.env.VITE_SERVER_URL
  const base = explicit ? new URL(explicit) : location
  const proto = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${base.host}/ws?room=${encodeURIComponent(p.get('room') || 'main')}`
}

export function connectServer(onMsg, onState) {
  let ws
  let closed = false
  let tries = 0
  const open = () => {
    ws = new WebSocket(serverUrl())
    ws.onopen = () => { tries = 0; onState('open') }
    ws.onmessage = (e) => onMsg(JSON.parse(e.data))
    ws.onclose = () => {
      if (closed) return
      onState('closed')
      if (tries++ < 8) setTimeout(open, 800 * tries)
    }
  }
  open()
  return { send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)) }, close: () => { closed = true; ws.close() } }
}

export const apiBase = () => (new URLSearchParams(location.search).get('server') || import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '')

// Is there a game server behind this page?
export async function probeServer() {
  try {
    const p = new URLSearchParams(location.search)
    const explicit = p.get('server') || import.meta.env.VITE_SERVER_URL
    const r = await fetch((explicit ? explicit.replace(/\/$/, '') : '') + '/api/status', { signal: AbortSignal.timeout(2500) })
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
    return await r.json()
  } catch { return null }
}
