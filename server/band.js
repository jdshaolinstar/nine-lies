// Band carries what the agents say to each other. Each cat (and the captain) is
// its own Band agent. A whisper mentions one agent, so nobody else receives it.
// If Band is slow, a message is delivered locally and marked as such.
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const API = 'https://app.band.ai/api/v1'
const SOCKET = 'wss://app.band.ai/api/v1/socket/websocket?vsn=2.0.0'
export const bandStats = { sent: 0, delivered: 0, local: 0, ms: 0, lastError: null, room: null }

export async function bandApi(key, method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Band ${method} ${url.split('?')[0]} ${r.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

export async function connectBand(dataDir) {
  const file = path.join(dataDir, 'band-agents.json')
  const agents = JSON.parse(fs.readFileSync(file, 'utf8')) // { ace: {id, key}, ..., captain: {id, key} }
  const need = ['ace', 'domino', 'velvet', 'boots', 'sable', 'captain']
  for (const n of need) if (!agents[n]?.id || !agents[n]?.key) throw new Error(`no Band agent for ${n}`)

  const makeRoom = async (title, owner, members) => {
    const r = await bandApi(agents[owner].key, 'POST', '/agent/chats', { chat: { title } })
    const id = (r.data ?? r).id
    for (const n of members) await bandApi(agents[owner].key, 'POST', `/agent/chats/${id}/participants`, { participant: { participant_id: agents[n].id, role: 'member' } })
    return id
  }
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
  const crewRoom = await makeRoom(`Nine Lies crew ${stamp}`, 'ace', need.filter((n) => n !== 'ace' && n !== 'captain'))
  // The kennel line has every cat in it, but a leak only mentions the captain.
  const lineRoom = await makeRoom(`Nine Lies kennel line ${stamp}`, 'captain', need.filter((n) => n !== 'captain'))
  bandStats.room = crewRoom

  const waiting = new Map() // token + agent -> callback
  const listen = (name) => {
    const a = agents[name]
    const ws = new WebSocket(SOCKET, { headers: { 'x-api-key': a.key } })
    let ref = 1
    let beat
    ws.on('open', () => {
      for (const room of [crewRoom, lineRoom]) ws.send(JSON.stringify([String(ref), String(ref++), `chat_room:${room}`, 'phx_join', {}]))
      beat = setInterval(() => ws.send(JSON.stringify([null, String(ref++), 'phoenix', 'heartbeat', {}])), 30000)
    })
    ws.on('message', (raw) => {
      let frame
      try { frame = JSON.parse(raw) } catch { return }
      const [, , topic, event, payload] = frame
      if (event !== 'message_created') return
      const msg = payload?.message ?? payload
      const token = String(msg?.content ?? '').match(/#(\w+)\s*$/)?.[1]
      const cb = waiting.get(`${token}:${name}`)
      if (cb) { waiting.delete(`${token}:${name}`); cb() }
      const room = topic.split(':')[1]
      if (msg?.id) bandApi(a.key, 'POST', `/agent/chats/${room}/messages/${msg.id}/processing`).then(() => bandApi(a.key, 'POST', `/agent/chats/${room}/messages/${msg.id}/processed`)).catch(() => {})
    })
    ws.on('close', () => { clearInterval(beat); setTimeout(() => listen(name), 4000) })
    ws.on('error', (e) => { bandStats.lastError = e.message })
  }
  need.forEach(listen)

  let n = 0
  const post = (from, room, text, toNames, onArrive, report) => {
    const token = `${Date.now().toString(36)}${(n++).toString(36)}`
    const t0 = Date.now()
    const pending = new Set(toNames)
    let viaBand = 0
    let lastMs = 0
    const arrive = (name, via) => {
      if (!pending.delete(name)) return
      if (via === 'band') { bandStats.delivered++; bandStats.ms = bandStats.ms ? bandStats.ms * 0.8 + (Date.now() - t0) * 0.2 : Date.now() - t0 } else bandStats.local++
      if (via === 'band') { viaBand++; lastMs = Date.now() - t0 }
      onArrive(name, via)
      if (!pending.size) report?.({ ok: viaBand === toNames.length, ms: viaBand ? lastMs : null, viaBand, total: toNames.length })
    }
    for (const name of toNames) waiting.set(`${token}:${name}`, () => arrive(name, 'band'))
    bandStats.sent++
    bandApi(agents[from].key, 'POST', `/agent/chats/${room}/messages`, {
      message: { content: `${text} #${token}`, mentions: toNames.map((t) => ({ id: agents[t].id })) },
    }).catch((e) => { bandStats.lastError = e.message; for (const name of [...pending]) arrive(name, 'local') })
    setTimeout(() => { for (const name of [...pending]) { waiting.delete(`${token}:${name}`); arrive(name, 'local') } }, 2500)
  }

  return {
    send(match, msg, toIds, deliver) {
      if (!agents[msg.from]) return toIds.forEach((id) => deliver(id))
      const cap = (id) => id[0].toUpperCase() + id.slice(1)
      const whisper = msg.to !== 'all'
      post(msg.from, crewRoom, msg.text, toIds, deliver, (r) => match.vendor?.({
        vendor: 'band', who: msg.from, sticker: whisper ? 'whisper' : 'radio', ms: r.ms, ok: r.ok, secret: whisper,
        what: `${cap(msg.from)} → ${whisper ? `only ${toIds.map(cap).join(', ')}` : `${r.total} crew agents`}: "${msg.text}"`,
        hidden: 'A private whisper was delivered',
      }))
    },
    leak(match, room, why, done) {
      const id = match.moleId
      post(id, lineRoom, `Tip: ${why}`, ['captain'], done, (r) => match.vendor?.({
        vendor: 'band', who: id, sticker: 'secret tip', ms: r.ms, ok: r.ok, secret: true,
        what: `${id[0].toUpperCase() + id.slice(1)} (the traitor) → only the dog captain: "${why}"`,
        hidden: 'Someone sent a private message',
      }))
    },
  }
}
