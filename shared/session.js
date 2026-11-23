// A room of players around one match. Used by the server, and by the browser
// alone for solo play.
import { Match, CAT_DEFS } from './sim.js'
import { localAlibiScan } from './alibi.js'
import { TACTICS } from './brain.js'
import { DEFAULT_SCENARIO } from './scenario.js'

const SEATS = ['ace', 'domino']

export class Session {
  constructor({ thinkerFor, scanner, onEvent, onMatch, onEnd, services = {}, learning, scenario } = {}) {
    Object.assign(this, { thinkerFor, scanner, onEvent, onMatch, onEnd, services })
    this.scenario = scenario ?? DEFAULT_SCENARIO
    // Mole tactics compete across matches: a small Thompson-sampling bandit.
    this.learning = learning ?? Object.fromEntries(TACTICS.map((t) => [t, { wins: 0, plays: 0 }]))
    this.clients = new Map()
    this.match = null
    this.nextId = 1
    this.matchNo = 0
    this.acc = 0
  }

  join(send) {
    const c = { id: this.nextId++, send, role: 'director', catId: null, name: 'Guest' }
    this.clients.set(c.id, c)
    this.pushLobby()
    return c
  }

  leave(c) {
    this.clients.delete(c.id)
    // The cat stays in the match; an agent takes over.
    if (c.catId && this.match?.phase === 'play') this.match.humans.delete(c.catId)
    this.pushLobby()
  }

  pickTactic() {
    let best = null
    for (const [t, s] of Object.entries(this.learning)) {
      // Beta sample approximated with two gamma-like draws.
      const a = 1 + s.wins, b = 1 + s.plays - s.wins
      const g = (k) => { let x = 0; for (let i = 0; i < Math.ceil(k); i++) x -= Math.log(Math.random() || 1e-9); return x }
      const x = g(a), y = g(b)
      const v = x / (x + y)
      if (!best || v > best.v) best = { t, v }
    }
    return best.t
  }

  handle(c, msg) {
    const m = this.match
    switch (msg?.t) {
      case 'join': {
        const role = ['runner', 'hacker', 'director'].includes(msg.role) ? msg.role : 'director'
        c.name = String(msg.name ?? '').slice(0, 16) || 'Guest'
        c.catId = null
        c.role = role
        if (role === 'runner') {
          const taken = new Set([...this.clients.values()].filter((o) => o !== c).map((o) => o.catId))
          c.catId = SEATS.find((s) => !taken.has(s)) ?? null
          if (!c.catId) c.role = 'director'
          else if (m?.phase === 'play' && m.cat(c.catId).state === 'ok' && m.moleId !== c.catId) m.humans.add(c.catId)
        }
        this.pushLobby()
        break
      }
      case 'start': if (!m || m.phase !== 'play') this.start(); break
      case 'lobby': if (!m || m.phase === 'end') { this.match = null; this.pushLobby() } break
      case 'input': if (c.catId && m) m.setInput(c.catId, msg); break
      case 'act': if (c.catId && m) m.act(c.catId, msg.a); break
      case 'radio':
        if (!m) break
        if (c.catId) m.say(c.catId, msg, 'human')
        else if (c.role === 'hacker') this.hackerRadio(msg)
        break
      case 'hack': if (c.role === 'hacker' && m) m.hack(msg.a, msg.id); break
      case 'callVote': if (c.catId && m) m.callVote(c.catId); break
      case 'vote': if (c.catId && m) m.castVote(c.catId, msg.cat); break
      case 'scan': if ((c.catId || c.role === 'hacker') && m) this.scan(c); break
      default:
    }
  }

  // The hacker has no body, so calls go out on the crew channel through Ace's earpiece.
  hackerRadio(msg) {
    const m = this.match
    if (m.phase !== 'play' || (this.hackerMute ?? 0) > m.t || !['guard', 'clear', 'going'].includes(msg.kind)) return
    this.hackerMute = m.t + 1.5
    const names = { guard: 'Dog in', clear: 'Clear:', going: 'Go to' }
    m.radio.push({ id: m.radio.length, t: +m.t.toFixed(1), from: 'hacker', to: 'all', kind: msg.kind, room: msg.room, cat: null, source: 'human', text: `${names[msg.kind]} ${roomLabel(msg.room)}` })
    m.log('radio', null, null, { from: 'hacker', kind: msg.kind, room: msg.room, text: m.radio.at(-1).text })
    for (const o of m.alive()) {
      m.note(o, `Hacker said: ${names[msg.kind]} ${roomLabel(msg.room)}`, { told: 'hacker' })
      if (msg.kind === 'going' && !m.humans.has(o.id)) { o.orders.push({ t: m.t, kind: 'regroup', room: msg.room, from: 'hacker' }); o.nextThink = Math.min(o.nextThink, m.t + 0.6) }
    }
  }

  async scan(c) {
    const m = this.match
    if (m.phase !== 'play' || m.scansLeft <= 0 || this.scanning) return
    m.scansLeft--
    this.scanning = true
    this.broadcast({ t: 'scan', state: 'running' })
    const local = () => localAlibiScan(m)
    let out
    try { out = this.scanner ? await this.scanner(m, local) : local() } catch (e) { out = { ...local(), error: String(e.message ?? e) } }
    this.scanning = false
    m.log('scan', c.catId, null, { source: out.source, rows: out.rows.length })
    this.broadcast({ t: 'scan', state: 'done', ...out })
  }

  start() {
    const humans = [...this.clients.values()].filter((c) => c.role === 'runner' && c.catId)
    this.matchNo++
    const id = `${Date.now().toString(36)}-${this.matchNo}`
    this.match = new Match({
      seed: Math.floor(Math.random() * 1e9),
      humans: humans.map((c) => c.catId),
      tactic: this.pickTactic(),
      setPiece: this.scenario.setPiece,
      catNames: Object.fromEntries(humans.filter((c) => c.name !== 'Guest').map((c) => [c.catId, c.name])),
      onEvent: (e) => this.onEvent?.(id, e),
    })
    this.match.id = id
    this.match.thinker = this.thinkerFor?.(this.match) ?? null
    this.ended = false
    this.onMatch?.(this.match)
    for (const c of this.clients.values()) c.send({ t: 'started', you: c.catId, role: c.role })
  }

  tick(dt) {
    const m = this.match
    if (!m) return
    this.acc += dt
    let n = 0
    while (this.acc >= 0.05 && n++ < 5) { m.step(0.05); this.acc -= 0.05 }
    if (n >= 5) this.acc = 0
    if (m.phase === 'end' && !this.ended) {
      this.ended = true
      const s = this.learning[m.tactic]
      s.plays++
      if (m.result.winner === 'mole' && !m.result.moleCaught) s.wins++
      this.onEnd?.(m, this.learning)
    }
    for (const c of this.clients.values()) c.send({ t: 'snap', s: m.viewFor(c.role, c.catId), learning: m.phase === 'end' ? this.learning : undefined })
  }

  broadcast(msg) { for (const c of this.clients.values()) c.send(msg) }

  pushLobby() {
    const players = [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, role: c.role, catId: c.catId, color: CAT_DEFS.find((d) => d.id === c.catId)?.color }))
    for (const c of this.clients.values()) {
      c.send({ t: 'lobby', players, you: { id: c.id, role: c.role, catId: c.catId }, inMatch: this.match?.phase === 'play', services: this.services, scenario: this.scenario, learning: this.learning })
    }
  }
}

import { roomName as roomLabel } from './map.js'
