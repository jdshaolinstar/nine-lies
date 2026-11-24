// Nine Lies: the whole match. No network, no rendering, so it runs on the
// server, in the browser and in tests.
import { clamp, dist, angleTo, angleDiff, makeRng, compass } from './util.js'
import {
  ROOMS, ROOM, DOORS, GENERATORS, CORE, HELIPAD, CAGES, CAT_SPAWNS, PATROLS, roomOf, roomCenter, roomName,
} from './map.js'
import { lineOfSight, findPath, moveBody, walkable } from './nav.js'
import { decide, voteFor, onHeard, TACTICS } from './brain.js'

export const MATCH_SECONDS = 240
export const CAT_DEFS = [
  { id: 'ace', name: 'Ace', color: '#ffb020' },
  { id: 'domino', name: 'Domino', color: '#3ea8ff' },
  { id: 'velvet', name: 'Velvet', color: '#b56bff' },
  { id: 'boots', name: 'Boots', color: '#4fd06a' },
  { id: 'sable', name: 'Sable', color: '#ff5c8a' },
]
export const CAT_NAME = Object.fromEntries(CAT_DEFS.map((c) => [c.id, c.name]))

// Radio calls. Every call is data, so agents and humans use the same language.
export const CALLS = {
  going: (c) => `Heading to ${roomName(c.room)}`,
  at: (c) => `I'm in ${roomName(c.room)}`,
  guard: (c) => `Dog in ${roomName(c.room)}!`,
  clear: (c) => `${roomName(c.room)} is clear`,
  help: (c) => `Help! ${roomName(c.room)}`,
  where: (c) => `${CAT_NAME[c.cat] ?? 'Everyone'}, where are you?`,
  saw: (c) => `Saw ${CAT_NAME[c.cat]} in ${roomName(c.room)}`,
  suspect: (c) => `I don't trust ${CAT_NAME[c.cat]}`,
  regroup: (c) => `Regroup at ${roomName(c.room)}`,
  body: (c) => `${CAT_NAME[c.cat]} is down in ${roomName(c.room)}`,
}

const R = 0.34
const SPEED = { sneak: 1.8, walk: 3.1, sprint: 4.5, carry: 2.5 }
const SEE = 9
const CLAW_RANGE = 1.35
const CLAW_CD = 10
const KILL_GRACE = 25 // nobody can be killed in the first seconds
const VOTE_SECONDS = 15

export class Match {
  constructor({ seed = Date.now() % 1e9, humans = [], moleId, tactic, onEvent, thinker, catNames = {}, setPiece = 'wire_drop' } = {}) {
    this.setPiece = setPiece
    this.lasers = []
    this.rng = makeRng(seed)
    this.seed = seed
    this.t = 0
    this.phase = 'play'
    this.timeLeft = MATCH_SECONDS
    this.humans = new Set(humans)
    this.onEvent = onEvent
    this.thinker = thinker
    this.events = []
    this.radio = []
    this.ledger = []
    this.fx = []
    this.locked = new Set(DOORS.filter((d) => d.vault).map((d) => d.id))
    this.doorTimers = {}
    this.gens = GENERATORS.map((g) => ({ ...g, held: false, by: [] }))
    this.genProgress = 0
    this.vaultOpen = false
    this.core = { x: CORE.x, z: CORE.z, by: null, taken: false }
    this.blackout = 0
    this.camLoop = {}
    this.hackCd = { door: 0, cam: 0, blackout: 0, alarm: 0, ping: 0 }
    this.pings = []
    this.vote = null
    this.scansLeft = 2
    this.result = null
    this.captain = { focus: null, until: 0, intel: [] }
    this.visionAt = 0

    this.cats = CAT_DEFS.map((d, i) => ({
      ...d, name: catNames[d.id] ?? d.name, kind: 'cat', ...CAT_SPAWNS[i], dir: 0, state: 'ok', bullets: 1, yarn: 2, clawCd: 0,
      stun: 0, input: { mx: 0, mz: 0 }, moving: 0, speed: 0, seen: new Set(), lastSeen: {}, notes: [],
      suspicion: {}, intent: null, path: null, pathAt: 0, nextThink: 0.4 + i * 0.5, thinking: false, calledVote: false,
      hold: 0, detected: 0, wire: 0, bodySeen: new Set(), orders: [], known: {}, kills: 0, lastKillAt: -99,
    }))
    const pool = this.cats.filter((c) => !this.humans.has(c.id))
    this.moleId = moleId ?? this.rng.pick(pool.length ? pool : this.cats).id
    this.tactic = tactic ?? this.rng.pick(TACTICS)
    this.mole = this.cat(this.moleId)
    this.mole.isMole = true
    this.humanMole = this.humans.has(this.moleId)
    if (this.humanMole) this.tactic = 'human'
    // A person playing the traitor needs time to work: sooner strikes, slower vault, every dog.
    this.killGrace = this.humanMole ? 10 : KILL_GRACE
    this.vaultSeconds = this.humanMole ? 14 : 5

    this.dogs = (this.humans.size && !this.humanMole ? PATROLS.slice(0, 3) : PATROLS).map((route, i) => ({
      id: 'dog' + i, kind: 'dog', ...roomCenter(route[0]), dir: this.rng() * 6.28, state: 'patrol', route, leg: 0,
      path: null, pathAt: 0, wait: 1 + this.rng() * 2, target: null, chase: null, lost: 0, ko: 0, meter: {}, speed: 0,
    }))
    this.log('start', null, null, { mole: this.moleId, tactic: this.tactic })
  }

  cat(id) { return this.cats.find((c) => c.id === id) }
  alive() { return this.cats.filter((c) => c.state === 'ok') }

  log(type, actor, target, data = {}) {
    const a = actor ? this.cat(actor) ?? this.dogs.find((d) => d.id === actor) : null
    const e = { type, t: +this.t.toFixed(2), actor, target, room: data.room ?? (a ? roomOf(a) : null), x: a ? +a.x.toFixed(1) : null, z: a ? +a.z.toFixed(1) : null, data }
    this.events.push(e)
    this.onEvent?.(e)
    return e
  }

  decideLog(who, source, goal, reason, secret) {
    const e = { t: +this.t.toFixed(1), who, source, goal, reason, secret: !!secret }
    this.ledger.push(e)
    this.log('decision', who === 'captain' ? null : who, null, { who, source, goal, reason })
  }

  note(cat, text, data) {
    cat.notes.push({ t: +this.t.toFixed(0), text, ...data })
    if (cat.notes.length > 40) cat.notes.shift()
  }

  // --- player and agent actions -------------------------------------------

  setInput(id, input) {
    const c = this.cat(id)
    if (c) c.input = { mx: clamp(+input.mx || 0, -1, 1), mz: clamp(+input.mz || 0, -1, 1), sprint: !!input.sprint, sneak: !!input.sneak }
  }

  act(id, a) {
    const c = this.cat(id)
    if (!c || c.state !== 'ok' || c.stun > 0 || this.phase !== 'play') return
    if (a === 'claw') return this.claw(c)
    if (a === 'shoot') return this.shoot(c)
    if (a === 'yarn') return this.throwYarn(c)
    if (a === 'drop' && this.core.by === c.id) this.dropCore(c)
  }

  // Attack from outside the victim's front arc.
  behind(attacker, victim) {
    return Math.abs(angleDiff(angleTo(victim, attacker), victim.dir)) > 1.75
  }

  claw(c) {
    if (c.clawCd > 0 || this.core.by === c.id) return
    const front = (o) => Math.abs(angleDiff(angleTo(c, o), c.dir)) < 1.2 && dist(c, o) < CLAW_RANGE && lineOfSight(c, o, this.locked)
    const targets = [...this.cats.filter((o) => o !== c && o.state === 'ok'), ...this.dogs.filter((d) => d.state !== 'ko')]
      .filter(front).sort((a, b) => dist(c, a) - dist(c, b))
    this.fx.push({ kind: 'claw', x: c.x + Math.cos(c.dir) * 0.8, z: c.z + Math.sin(c.dir) * 0.8, t: this.t })
    c.clawCd = targets.length ? CLAW_CD : 1
    const v = targets[0]
    if (!v) return
    if (v.kind === 'dog') {
      if (this.behind(c, v)) this.knockOut(v, 18, c)
      else this.capture(c, v)
      return
    }
    if (this.t < this.killGrace) { c.clawCd = 1; return }
    if (this.behind(c, v)) this.kill(c, v, 'claw')
    else {
      // Seen coming: both are knocked apart and both know.
      const a = angleTo(c, v)
      moveBody(v, Math.cos(a) * 1.2, Math.sin(a) * 1.2, R, this.locked)
      moveBody(c, -Math.cos(a) * 0.8, -Math.sin(a) * 0.8, R, this.locked)
      v.stun = 0.5; c.stun = 1.1
      this.fx.push({ kind: 'scuffle', x: (c.x + v.x) / 2, z: (c.z + v.z) / 2, t: this.t })
      v.suspicion[c.id] = 1
      this.note(v, `${c.name} attacked me in ${roomName(roomOf(c))}`, { about: c.id })
      this.log('scuffle', c.id, v.id)
      this.witness(c, `attacked ${v.name}`)
      v.nextThink = this.t
    }
  }

  shoot(c) {
    if (c.bullets <= 0 || this.core.by === c.id) return
    const inArc = (o) => dist(c, o) < 9 && Math.abs(angleDiff(angleTo(c, o), c.dir)) < 0.4 && lineOfSight(c, o, this.locked)
    const targets = [...this.cats.filter((o) => o !== c && o.state === 'ok'), ...this.dogs.filter((d) => d.state !== 'ko')]
      .filter(inArc).sort((a, b) => dist(c, a) - dist(c, b))
    if (this.t < this.killGrace && targets[0]?.kind === 'cat') return
    c.bullets--
    const v = targets[0]
    const end = v ? { x: v.x, z: v.z } : { x: c.x + Math.cos(c.dir) * 8, z: c.z + Math.sin(c.dir) * 8 }
    this.fx.push({ kind: 'shot', x: c.x, z: c.z, x2: end.x, z2: end.z, t: this.t })
    this.log('gunshot', c.id, v?.id ?? null)
    for (const o of this.alive()) {
      if (o === c) continue
      this.note(o, `Heard a gunshot to the ${compass(o, c)}`, { heard: true })
      o.heardShot = { dir: compass(o, c), t: this.t }
    }
    // Every dog that is awake and near enough comes to look.
    this.dogs.filter((d) => d.state !== 'ko').sort((a, b) => dist(a, c) - dist(b, c)).slice(0, 3)
      .forEach((d) => this.sendDog(d, c, 'gunshot'))
    if (!v) return
    if (v.kind === 'dog') this.knockOut(v, 30, c)
    else this.kill(c, v, 'pistol')
  }

  throwYarn(c) {
    if (c.yarn <= 0) return
    c.yarn--
    const p = { x: c.x, z: c.z }
    for (let i = 0; i < 24; i++) {
      const n = { x: p.x + Math.cos(c.dir) * 0.3, z: p.z + Math.sin(c.dir) * 0.3 }
      if (!walkable(Math.floor(n.x), Math.floor(n.z), this.locked)) break
      p.x = n.x; p.z = n.z
    }
    this.fx.push({ kind: 'yarn', x: c.x, z: c.z, x2: p.x, z2: p.z, t: this.t, color: c.color })
    this.noise(p, 9, 'yarn')
    this.log('yarn', c.id, null)
  }

  // What other cats in sight learn from a public act.
  witness(actor, what) {
    for (const o of this.alive()) {
      if (o === actor || !this.canSee(o, actor)) continue
      o.suspicion[actor.id] = 1
      this.note(o, `I SAW ${actor.name} ${what} in ${roomName(roomOf(actor))}`, { about: actor.id, crime: true })
      this.log('witnessed', o.id, actor.id, { what, room: roomOf(actor) })
      o.nextThink = this.t + 0.2; o.urgent = true
    }
  }

  kill(by, v, how) {
    this.witness(by, `kill ${v.name}`)
    v.state = 'dead'
    v.diedAt = this.t
    v.path = null
    if (this.core.by === v.id) this.dropCore(v)
    by.kills++
    by.lastKillAt = this.t
    by.known[v.id] = 'dead'
    this.fx.push({ kind: 'poof', x: v.x, z: v.z, t: this.t })
    this.log('kill', by.id, v.id, { how, room: roomOf(v), victimMole: !!v.isMole })
    this.checkEnd()
  }

  knockOut(dog, secs, by) {
    dog.state = 'ko'; dog.ko = secs; dog.chase = null; dog.path = null
    this.fx.push({ kind: 'poof', x: dog.x, z: dog.z, t: this.t })
    this.log('dog_ko', by.id, dog.id)
  }

  capture(c, dog) {
    if (c.state !== 'ok') return
    if (this.core.by === c.id) this.dropCore(c)
    const used = new Set(this.cats.filter((o) => o.state === 'captured').map((o) => o.cage))
    c.cage = CAGES.findIndex((_, i) => !used.has(i))
    this.fx.push({ kind: 'net', x: c.x, z: c.z, t: this.t })
    this.log('captured', dog.id, c.id, { room: roomOf(c) })
    c.state = 'captured'
    c.capturedAt = this.t
    c.path = null
    c.x = CAGES[c.cage].x; c.z = CAGES[c.cage].z
    dog.state = 'patrol'; dog.chase = null; dog.path = null; dog.wait = 1.5; dog.meter = {}; dog.spot = { x: roomCenter('kennel').x, z: roomCenter('kennel').z }; dog.fed = this.t + 9
    this.checkEnd()
  }

  dropCore(c) {
    this.core.by = null; this.core.x = c.x; this.core.z = c.z
    this.log('core_dropped', c.id, null)
    for (const o of this.alive()) { this.note(o, `The core was dropped in ${roomName(roomOf(c))}`); o.nextThink = Math.min(o.nextThink, this.t + 1 + this.rng()); o.urgent = true }
  }

  noise(p, radius, why) {
    for (const d of this.dogs) if (d.state !== 'ko' && d.state !== 'chase' && dist(d, p) < radius) this.sendDog(d, p, why)
  }

  sendDog(d, p, why) {
    if (d.state === 'ko' || d.state === 'chase') return
    d.state = 'investigate'; d.target = { x: p.x, z: p.z }; d.path = null; d.why = why
  }

  // --- radio ----------------------------------------------------------------

  say(from, { kind, to = 'all', room, cat }, source = 'rule') {
    if (!CALLS[kind]) return null
    const f = this.cat(from)
    if (!f || f.state !== 'ok' || this.phase !== 'play') return null
    if (f.mutedUntil > this.t) return null
    f.mutedUntil = this.t + 0.7
    if (!this.humans.has(from)) {
      const key = kind + room + (cat ?? '')
      f.saidAt ??= {}
      if (this.t - (f.saidAt[key] ?? -99) < 20 || (kind === 'guard' && this.t - (this.lastGuardCall ?? -99) < 8)) return null
      f.saidAt[key] = this.t
      if (kind === 'guard') this.lastGuardCall = this.t
    }
    if (!ROOM[room]) room = roomOf(f)
    // Loyal agents report truthfully; a model naming the wrong room is not a lie.
    if (['at', 'help', 'regroup'].includes(kind) && !f.isMole && !this.humans.has(from)) room = roomOf(f)
    if (cat && !this.cat(cat)) cat = null
    if (['saw', 'suspect', 'body'].includes(kind) && !cat) return null
    const msg = { id: this.radio.length, t: +this.t.toFixed(1), from, to, kind, room, cat: cat ?? null, source }
    msg.text = CALLS[kind](msg)
    const truth = roomOf(f)
    msg.lie = ['going', 'at'].includes(kind) ? (kind === 'at' && room !== truth) || !!f.isLying : false
    this.radio.push(msg)
    this.log('radio', from, to === 'all' ? null : to, { kind, room, cat: msg.cat, text: msg.text, trueRoom: truth, lie: msg.lie })
    this.onRadio?.(msg)
    const hear = (o, via) => {
      if (this.phase !== 'play' || o.state !== 'ok') return
      if (via) msg.via = via
      this.note(o, `${f.name} said${to !== 'all' ? ' (whisper)' : ''}: "${msg.text}"`, { told: from })
      onHeard(this, o, msg)
    }
    const ears = this.alive().filter((o) => o !== f && (to === 'all' || to === o.id))
    const remote = this.transport ? ears.filter((o) => !this.humans.has(o.id)) : []
    for (const o of ears) if (!remote.includes(o)) hear(o)
    if (remote.length) this.transport.send(this, msg, remote.map((o) => o.id), (id, via) => hear(this.cat(id), via))
    return msg
  }

  // A human traitor's button: tell the captain where the crew is.
  tip(id) {
    const c = this.cat(id)
    if (!c?.isMole || c.state !== 'ok' || this.phase !== 'play' || this.t - (c.leakAt ?? -99) < 15) return
    c.leakAt = this.t
    const seen = Object.entries(c.lastSeen).filter(([k]) => this.cat(k).state === 'ok').sort((a, b) => b[1].t - a[1].t)[0]
    const room = seen ? seen[1].room : roomOf(c)
    this.leak(room, seen ? `${CAT_NAME[seen[0]]} is in ${roomName(room)}` : `the crew is near ${roomName(room)}`)
  }

  // The mole's private line to the dog captain.
  leak(room, why) {
    if (this.mole.state !== 'ok') return
    this.log('leak', this.moleId, null, { room, why })
    if (this.transport) this.transport.leak(this, room, why, () => this.captainHears(room, why))
    else this.captainHears(room, why)
  }

  captainHears(room, why) {
    if (this.phase !== 'play') return
    this.captain.focus = room
    this.captain.until = this.t + 22
    this.captain.intel.push({ t: this.t, text: `Mole says: ${why} (${roomName(room)})` })
    this.decideLog('captain', 'rule', `Send two dogs to ${roomName(room)}`, `Tip from inside the crew: ${why}`, true)
    this.dogs.filter((d) => d.state === 'patrol').sort((a, b) => dist(a, roomCenter(room)) - dist(b, roomCenter(room)))
      .slice(0, 1).forEach((d) => this.sendDog(d, roomCenter(room), 'leak'))
  }

  // Cross-match habits from the warehouse. The nearest free dog acts on them.
  briefCaptain({ first, caught }) {
    if (this.phase !== 'play') return
    const bits = []
    if (first) bits.push(`${first.share}% of crews go to ${roomName(first.room)} first`)
    if (caught) bits.push(`${roomName(caught.room)} is where most cats get caught (${caught.share}%)`)
    if (!bits.length) return
    this.captain.habits = bits.join('; ')
    const room = first && ROOM[first.room] ? first.room : caught?.room
    this.decideLog('captain', 'bruin', `Guard ${roomName(room)} early`, bits.join('; '), true)
    const d = this.dogs.filter((k) => k.state === 'patrol').sort((a, b) => dist(a, roomCenter(room)) - dist(b, roomCenter(room)))[0]
    if (d) this.sendDog(d, roomCenter(room), 'briefing')
    return d?.id
  }

  captainOrders({ orders = [], reason = '', taunt = '' }) {
    if (this.phase !== 'play') return
    for (const o of orders.slice(0, 2)) {
      const d = this.dogs.find((k) => k.id === o?.dog)
      if (!d || !ROOM[o.room] || o.room === 'vault' || d.state !== 'patrol') continue
      this.sendDog(d, roomCenter(o.room), 'captain')
      this.decideLog('captain', 'llm', `Send ${d.id} to ${roomName(o.room)}`, String(reason).slice(0, 110), true)
    }
    if (taunt) {
      const msg = { id: this.radio.length, t: +this.t.toFixed(1), from: 'captain', to: 'all', kind: 'taunt', room: null, cat: null, source: 'llm', text: String(taunt).slice(0, 80) }
      this.radio.push(msg)
      this.log('radio', null, null, { from: 'captain', kind: 'taunt', text: msg.text })
    }
  }

  callVote(from) {
    const c = this.cat(from)
    if (!c || c.state !== 'ok' || c.calledVote || this.vote || this.phase !== 'play' || this.t < 15) return false
    c.calledVote = true
    this.vote = { by: from, until: this.t + VOTE_SECONDS, votes: {}, botAt: {} }
    for (const o of this.alive()) if (!this.humans.has(o.id)) this.vote.botAt[o.id] = this.t + 3 + this.rng() * 8
    this.log('vote_called', from, null)
    return true
  }

  castVote(id, target) {
    const c = this.cat(id)
    if (!this.vote || !c || c.state !== 'ok') return
    this.vote.votes[id] = target && this.cat(target)?.state !== 'cut' ? target : 'skip'
  }

  endVote() {
    const tally = {}
    for (const [voter, v] of Object.entries(this.vote.votes)) {
      if (this.cat(voter).state === 'ok') tally[v] = (tally[v] ?? 0) + 1
    }
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
    const [top, second] = ranked
    let out = null
    if (top && top[0] !== 'skip' && (!second || second[1] < top[1])) out = this.cat(top[0])
    this.lastVote = { tally, votes: this.vote.votes, out: out?.id ?? null, wasMole: out ? !!out.isMole : null, t: this.t }
    this.log('vote_result', null, out?.id ?? null, { tally, wasMole: this.lastVote.wasMole })
    this.vote = null
    if (out) {
      if (this.core.by === out.id) this.dropCore(out)
      out.state = 'cut'; out.path = null
      for (const c of this.cats) c.known[out.id] = 'cut'
      this.fx.push({ kind: 'poof', x: out.x, z: out.z, t: this.t })
    }
    this.checkEnd()
  }

  // --- hacker -----------------------------------------------------------------

  hack(a, id) {
    if (this.phase !== 'play' || this.hackCd[a] > 0) return false
    if (a === 'door') {
      const d = DOORS.find((o) => o.id === id)
      if (!d || (d.vault && !this.vaultOpen)) return false
      if (this.locked.has(id)) { this.locked.delete(id); delete this.doorTimers[id] }
      else { this.locked.add(id); this.doorTimers[id] = 10 }
      this.hackCd.door = 2
    } else if (a === 'cam') {
      if (!ROOM[id]?.cam) return false
      this.camLoop[id] = 15; this.hackCd.cam = 8
    } else if (a === 'blackout') {
      this.blackout = 8; this.hackCd.blackout = 40
    } else if (a === 'alarm') {
      if (!ROOM[id]) return false
      this.hackCd.alarm = 18
      this.fx.push({ kind: 'alarm', ...roomCenter(id), t: this.t })
      this.dogs.filter((d) => d.state === 'patrol' || d.state === 'investigate')
        .sort((x, y) => dist(x, roomCenter(id)) - dist(y, roomCenter(id))).slice(0, 2).forEach((d) => this.sendDog(d, roomCenter(id), 'alarm'))
    } else if (a === 'ping') {
      const d = this.dogs.find((o) => o.id === id)
      if (!d) return false
      this.hackCd.ping = 1
      this.pings.push({ dog: id, until: this.t + 6 })
    } else return false
    this.log('hack', null, null, { action: a, id, room: ROOM[id] ? id : null })
    return true
  }

  // --- seeing -------------------------------------------------------------------

  canSee(c, o, range) {
    const r = range ?? (this.blackout > 0 ? 3.5 : SEE)
    return dist(c, o) < r && lineOfSight(c, o, this.locked)
  }

  updateVision() {
    for (const c of this.alive()) {
      c.seen = new Set()
      for (const o of this.cats) {
        if (o === c || o.state === 'cut' || !this.canSee(c, o)) continue
        c.seen.add(o.id)
        const room = roomOf(o)
        if (o.state === 'ok') {
          const prev = c.lastSeen[o.id]
          if (!prev || prev.room !== room || this.t - prev.t > 4) {
            this.note(c, `Saw ${o.name} in ${roomName(room)}`, { about: o.id })
            this.log('saw', c.id, o.id, { room })
          }
          c.lastSeen[o.id] = { room, x: o.x, z: o.z, t: this.t }
          c.known[o.id] = 'ok'
          // Someone claimed to be elsewhere a moment ago: that is a lie.
          const claim = [...this.radio].reverse().find((m) => m.from === o.id && m.kind === 'at' && this.t - m.t < 5)
          if (claim && claim.room !== room && !claim['caught' + c.id]) {
            claim['caught' + c.id] = true
            c.suspicion[o.id] = Math.min(1, (c.suspicion[o.id] ?? 0) + 0.35)
            this.note(c, `${o.name} lied: said ${roomName(claim.room)}, was in ${roomName(room)}`, { about: o.id })
          }
        } else if (o.state === 'dead' && !c.bodySeen.has(o.id)) {
          c.bodySeen.add(o.id)
          c.known[o.id] = 'dead'
          this.note(c, `Found ${o.name} dead in ${roomName(room)}`, { about: o.id, body: true })
          this.log('body_found', c.id, o.id, { room })
          if (!c.isMole) {
            for (const k of this.cats) {
              const ls = c.lastSeen[k.id]
              if (k === c || k === o || !ls) continue
              if (this.t - ls.t < 18 && ls.room === room) c.suspicion[k.id] = Math.min(1, (c.suspicion[k.id] ?? 0) + 0.4)
            }
          }
          c.nextThink = this.t + 0.3; c.urgent = true
        } else if (o.state === 'captured') c.known[o.id] = 'captured'
      }
      for (const d of this.dogs) if (this.canSee(c, d)) c.seen.add(d.id)
    }
  }

  // --- main step ------------------------------------------------------------------

  step(dt) {
    if (this.phase !== 'play') return
    this.t += dt
    this.timeLeft = Math.max(0, MATCH_SECONDS - this.t)
    this.blackout = Math.max(0, this.blackout - dt)
    for (const k in this.hackCd) this.hackCd[k] = Math.max(0, this.hackCd[k] - dt)
    for (const k in this.camLoop) if ((this.camLoop[k] -= dt) <= 0) delete this.camLoop[k]
    for (const k in this.doorTimers) if ((this.doorTimers[k] -= dt) <= 0) { delete this.doorTimers[k]; this.locked.delete(k) }
    this.pings = this.pings.filter((p) => p.until > this.t)
    this.fx = this.fx.filter((f) => this.t - f.t < 1.5)

    if (this.t >= this.visionAt) { this.visionAt = this.t + 0.1; this.updateVision() }
    for (const c of this.cats) if (c.state === 'ok') this.stepCat(c, dt)
    for (const d of this.dogs) this.stepDog(d, dt)
    this.stepSetPiece(dt)
    this.stepObjectives(dt)
    this.stepCameras(dt)
    if (this.vote) {
      for (const [id, at] of Object.entries(this.vote.botAt)) {
        if (this.t >= at && !this.vote.votes[id]) {
          const v = voteFor(this, this.cat(id))
          this.castVote(id, v.cat)
          this.decideLog(id, 'rule', `Vote ${v.cat ? CAT_NAME[v.cat] : 'skip'}`, v.reason)
        }
      }
      const voters = this.alive().length
      if (this.t >= this.vote.until || Object.keys(this.vote.votes).length >= voters) this.endVote()
    }
    if (this.captainThinker && this.t > (this.captain.next ?? 8) && !this.captain.thinking) {
      this.captain.thinking = true
      this.captain.next = this.t + 15
      Promise.resolve(this.captainThinker(this)).then((p) => p && this.captainOrders(p)).catch(() => {}).finally(() => { this.captain.thinking = false })
    }
    if (this.timeLeft <= 0) this.finish('mole', 'The Red Dot fired.')
  }

  stepCat(c, dt) {
    c.clawCd = Math.max(0, c.clawCd - dt)
    if (c.stun > 0) { c.stun -= dt; c.speed = 0; return }
    let mx = 0, mz = 0, mode = 'walk'
    if (this.humans.has(c.id)) {
      ;({ mx, mz } = c.input)
      mode = c.input.sneak ? 'sneak' : c.input.sprint ? 'sprint' : 'walk'
    } else {
      const go = this.driveAgent(c, dt)
      if (go) { mx = go.mx; mz = go.mz; mode = go.mode }
    }
    const len = Math.hypot(mx, mz)
    const top = this.core.by === c.id ? SPEED.carry : SPEED[mode]
    c.speed = len > 0.05 ? top : 0
    c.mode = mode
    if (len > 0.05) {
      const k = (top * dt) / Math.max(1, len)
      moveBody(c, mx * k, mz * k, R, this.locked)
      const want = Math.atan2(mz, mx)
      c.dir += angleDiff(want, c.dir) * Math.min(1, dt * 12)
      if (mode === 'sprint' && this.core.by !== c.id && (c.noiseAt ?? 0) < this.t) {
        c.noiseAt = this.t + 0.6
        this.noise(c, 4.5, 'footsteps')
      }
    }
  }

  // --- agent control: the plan comes from a brain, the moving happens here -----------

  think(c) {
    const i = c.intent
    // Don't flip-flop: let a wander or a tail play out unless something changed.
    const settled = i && this.t - i.since < 7 && ['goto', 'follow'].includes(i.goal) && !c.urgent
    c.urgent = false
    if (this.thinker && !c.thinking && !(c.llmOff > this.t)) {
      const hint = decide(this, c)
      if (!i) this.setIntent(c, hint, 'rule')
      c.thinking = true
      c.nextThink = this.t + 9 + this.rng() * 4
      const started = this.t
      Promise.resolve(this.thinker(this, c, hint)).then((plan) => {
        c.thinking = false
        c.thinkTook = this.t - started
        if (this.phase !== 'play' || c.state !== 'ok') return
        if (plan && c.isMole && ['hunt', 'shoot'].includes(hint.goal) && !['hunt', 'shoot'].includes(plan.goal)) {
          this.setIntent(c, { ...hint, say: plan.say, lie: plan.lie, leak: plan.leak }, 'rule')
        } else if (plan) this.setIntent(c, plan, 'llm')
        else { c.llmOff = this.t + 12; this.setIntent(c, hint, 'rule') }
      }).catch(() => { c.thinking = false; c.llmOff = this.t + 12 })
      return
    }
    if (!c.thinking && !settled) this.setIntent(c, decide(this, c), 'rule')
    c.nextThink = this.t + 3 + this.rng() * 2
  }

  setIntent(c, i, source) {
    if (!i?.goal) return
    if (['hunt', 'shoot', 'follow', 'rescue'].includes(i.goal) && (!this.cat(i.cat) || i.cat === c.id)) return
    if (['hunt'].includes(i.goal) && !c.isMole && !c.turned && (c.suspicion[i.cat] ?? 0) < 0.5) return
    if (i.goal === 'goto' && !ROOM[i.room]) return
    if (!c.isMole && this.vaultOpen) {
      // Everyone can see the core glow: if nobody has it, go and get it.
      if (!this.core.by && ['escape', 'gennorth', 'gensouth'].includes(i.goal)) i.goal = 'core'
      else if (this.core.by && ['gennorth', 'gensouth'].includes(i.goal)) i.goal = 'escape'
      if (this.core.by === c.id) i.goal = 'escape'
    }
    if (c.isMole && i.goal === 'core') { i.goal = 'goto'; i.room = 'atrium' }
    const same = c.intent && c.intent.goal === i.goal && c.intent.room === i.room && c.intent.cat === i.cat
    c.intent = { ...i, source, since: same ? c.intent.since : this.t }
    if (!same) {
      c.path = null
      const label = { gennorth: 'Hold North Generator', gensouth: 'Hold South Generator', core: 'Grab the core', escape: 'Get to the helipad' }[i.goal]
        ?? (i.goal === 'goto' ? `Go to ${roomName(i.room)}` : `${i.goal} ${CAT_NAME[i.cat] ?? ''}`.trim())
      this.decideLog(c.id, source, label, i.reason ?? '', c.isMole)
    }
    if (i.leak && c.isMole && ROOM[i.leak] && this.t - (c.leakAt ?? -99) > 18 && !(this.lastLeak?.room === i.leak && this.t - this.lastLeak.t < 50)) { c.leakAt = this.t; this.lastLeak = { room: i.leak, t: this.t }; this.leak(i.leak, i.leakWhy ?? `crew heading to ${roomName(i.leak)}`) }
    if (i.say?.kind) {
      c.isLying = !!i.lie && (c.isMole || c.turned)
      this.say(c.id, i.say, source)
      c.isLying = false
    }
    if (i.callVote) this.callVote(c.id)
  }

  driveAgent(c, dt) {
    if (c.pendingReply && this.t >= c.pendingReply.at) { const r = c.pendingReply; c.pendingReply = null; r.fire() }
    if (this.t >= c.nextThink) this.think(c)
    // Reflex: a chasing dog beats any plan.
    const threat = this.dogs.find((d) => d.state !== 'ko' && ((d.state === 'chase' && d.chase === c.id && dist(d, c) < 8) || ((d.meter[c.id] ?? 0) > 0.45 && c.seen.has(d.id))))
    if (threat) {
      if (!c.fleeTo || dist(c, c.fleeTo) < 1.5 || c.fleeUntil < this.t) {
        const opts = ROOMS.filter((r) => r.id !== 'vault').map((r) => roomCenter(r.id))
          .filter((p) => dist(p, c) > 5).sort((a, b) => (dist(b, threat) - dist(b, c)) - (dist(a, threat) - dist(a, c)))
        c.fleeTo = opts[Math.floor(this.rng() * Math.min(2, opts.length))]
        c.fleeUntil = this.t + 5
        c.path = null
      }
      if (c.yarn > 0 && threat.state === 'chase' && dist(threat, c) < 3.5 && this.rng() < dt * 0.8) { this.throwYarn(c); if (this.rng() < 0.6) { threat.state = 'patrol'; threat.chase = null; threat.wait = 2.2; threat.path = null } }
      return this.follow(c, c.fleeTo, 'sprint', 1)
    }
    c.fleeTo = null

    // Loyal cats defend themselves with the one bullet when they are sure.
    const sure = this.alive().find((o) => (c.suspicion[o.id] ?? 0) >= 0.95 && c.seen.has(o.id) && o !== c)
    if (sure && !c.isMole && c.bullets > 0 && dist(c, sure) < 7 && this.t > this.killGrace) {
      c.dir = angleTo(c, sure)
      c.aim = (c.aim ?? 0) + dt
      if (c.aim > 0.7) { c.aim = 0; this.decideLog(c.id, 'rule', `Shoot ${sure.name}`, 'Certain they are the mole'); this.shoot(c) }
      return null
    }
    c.aim = 0

    const i = c.intent
    if (!i) return null
    const gen = this.gens.find((g) => g.id === i.goal)
    if (gen) return this.vaultOpen ? this.idle(c) : this.follow(c, gen, this.urgency(c), 0.5)
    if (i.goal === 'core') {
      if (this.core.by === c.id) return this.follow(c, HELIPAD, 'sprint', 0.8)
      if (this.core.by) return this.follow(c, HELIPAD, this.urgency(c), 2)
      return this.follow(c, this.core, this.urgency(c), 0.4)
    }
    if (i.goal === 'escape') return this.follow(c, HELIPAD, this.urgency(c), 0.9)
    if (i.goal === 'goto') {
      if (!i.spot) { const p = roomCenter(i.room); i.spot = { x: p.x + this.rng.range(-2.5, 2.5), z: p.z + this.rng.range(-2, 2) } }
      return this.follow(c, i.spot, this.urgency(c), 0.7)
    }
    if (i.goal === 'rescue') {
      const v = this.cat(i.cat)
      return v.state === 'captured' ? this.follow(c, v, this.urgency(c), 0.7) : this.idle(c)
    }
    const prey = this.cat(i.cat)
    if (!prey || prey.state !== 'ok') { c.nextThink = Math.min(c.nextThink, this.t + 0.5); return this.idle(c) }
    const ls = c.seen.has(prey.id) ? prey : c.lastSeen[prey.id]
    if (!ls) return this.idle(c)
    if (i.goal === 'follow') return this.follow(c, ls, 'walk', 2.2)
    if (i.goal === 'shoot') {
      if (c.seen.has(prey.id) && dist(c, prey) < 7) {
        c.dir = angleTo(c, prey)
        c.aim2 = (c.aim2 ?? 0) + dt
        if (c.aim2 > 0.6) { c.aim2 = 0; this.shoot(c); c.intent = null; c.nextThink = this.t + 1 }
        return null
      }
      return this.follow(c, ls, 'walk', 1)
    }
    if (i.goal === 'hunt') {
      if (!c.seen.has(prey.id)) return this.follow(c, ls, 'walk', 0.5)
      const eyes = this.alive().some((o) => o !== c && o !== prey && this.canSee(o, c))
      if (this.t < this.killGrace || c.clawCd > 0 || (eyes && !i.bold)) return dist(c, prey) > 3 ? this.follow(c, prey, 'walk', 2.6) : null
      if (dist(c, prey) < CLAW_RANGE * 0.9 && this.behind(c, prey)) { c.dir = angleTo(c, prey); this.claw(c); c.nextThink = this.t + 0.4; return null }
      // Circle to the victim's back.
      const back = { x: prey.x - Math.cos(prey.dir) * 0.9, z: prey.z - Math.sin(prey.dir) * 0.9 }
      return this.follow(c, back, dist(c, prey) > 4 ? 'walk' : prey.speed > 2 ? 'sprint' : 'walk', 0.1)
    }
    return this.idle(c)
  }

  urgency(c) {
    const near = this.dogs.some((d) => d.state !== 'ko' && c.seen.has(d.id) && dist(c, d) < 7)
    return near ? 'sneak' : this.timeLeft < 80 || this.core.taken ? 'sprint' : 'walk'
  }

  idle(c) {
    c.nextThink = Math.min(c.nextThink, this.t + 1.2)
    return null
  }

  follow(c, target, mode, stop) {
    if (dist(c, target) <= stop) return null
    const moved = !c.pathTo || dist(c.pathTo, target) > 1
    if (!c.path || moved || this.t - c.pathAt > 1.5) {
      const danger = this.dogs.filter((d) => d.state !== 'ko' && c.seen.has(d.id))
      const avoid = danger.length && !c.isMole
        ? (x, z) => { let k = 0; for (const d of danger) { const q = Math.hypot(d.x - x - 0.5, d.z - z - 0.5); if (q < 6.5) k += (6.5 - q) * 2 } return k }
        : null
      c.path = findPath(c, target, this.locked, avoid)
      c.pathAt = this.t
      c.pathTo = { x: target.x, z: target.z }
    }
    if (!c.path?.length) {
      if (dist(c, target) < 1.5) return { mx: target.x - c.x, mz: target.z - c.z, mode }
      c.path = null
      return null
    }
    while (c.path.length && dist(c, c.path[0]) < 0.35) c.path.shift()
    if (!c.path.length) return null
    const p = c.path[0], d = dist(c, p) || 1
    return { mx: (p.x - c.x) / d, mz: (p.z - c.z) / d, mode }
  }

  // --- dogs -------------------------------------------------------------------------

  stepDog(d, dt) {
    if (d.state === 'ko') {
      d.speed = 0
      if ((d.ko -= dt) <= 0) { d.state = 'patrol'; d.path = null; d.wait = 1 }
      return
    }
    const range = this.blackout > 0 ? 2 : 5.4
    let best = null
    for (const c of this.alive()) {
      const dd = dist(d, c)
      // The mole is on the payroll: dogs let it pass.
      const sees = !c.isMole && !(d.fed > this.t) && dd < (c.mode === 'sneak' ? range * 0.72 : range) &&
        (Math.abs(angleDiff(angleTo(d, c), d.dir)) < 0.62 || dd < 0.9) && lineOfSight(d, c, this.locked)
      d.meter[c.id] = clamp((d.meter[c.id] ?? 0) + (sees ? dt * (0.7 + 1.5 * (1 - dd / range)) * (this.humans.has(c.id) ? 0.65 : 1) : -dt * 0.7), 0, 1.2)
      c.detected = Math.max(sees ? d.meter[c.id] : 0, (c.detected ?? 0) - dt * 0.5)
      if (sees && d.meter[c.id] >= 1 && (!best || dd < dist(d, best))) best = c
    }
    if (best && d.chase !== best.id && d.state !== 'chase') {
      this.log('spotted', d.id, best.id, { room: roomOf(best) })
      this.captain.intel.push({ t: this.t, text: `${d.id} spotted a cat in ${roomName(roomOf(best))}` })
      d.state = 'chase'; d.chase = best.id; d.lost = 0; d.path = null; d.bark = 0.7
    }
    let target = null, speed = 2
    if (d.state === 'chase') {
      const c = this.cat(d.chase)
      if (c.state !== 'ok') { d.state = 'patrol'; d.chase = null; d.path = null; return }
      if (dist(d, c) < 0.95) return this.capture(c, d)
      const visible = dist(d, c) < 8 && lineOfSight(d, c, this.locked) && this.blackout <= 0
      d.lost = visible ? 0 : d.lost + dt
      if (visible) d.lastKnown = { x: c.x, z: c.z }
      if (d.lost > 2.2) { d.state = 'investigate'; d.target = d.lastKnown ?? { x: c.x, z: c.z }; d.chase = null; d.path = null }
      target = d.lost > 0.6 ? d.lastKnown : c
      speed = 3.85
      if (d.bark > 0) { d.bark -= dt; d.dir += angleDiff(angleTo(d, c), d.dir) * Math.min(1, dt * 8); d.speed = 0; return }
    } else if (d.state === 'investigate') {
      target = d.target; speed = 3
      if (dist(d, target) < 1) {
        d.wait = (d.wait ?? 0) - dt
        d.dir += dt * 1.8
        if (d.wait <= 0) { d.state = 'patrol'; d.path = null; d.wait = 1 }
        d.speed = 0
        return
      }
    } else {
      if (d.wait > 0) { d.wait -= dt; d.dir += Math.sin(this.t * 1.3 + d.leg) * dt * 0.9; d.speed = 0; return }
      const focus = this.captain.focus && this.t < this.captain.until && d.id === 'dog0'
      if (!d.spot) {
        const p = roomCenter(focus ? this.captain.focus : d.route[d.leg % d.route.length])
        d.spot = { x: p.x + this.rng.range(-3, 3), z: p.z + this.rng.range(-2.5, 2.5) }
      }
      target = d.spot
      if (dist(d, target) < 1) { d.spot = null; d.leg++; d.wait = 1.2 + this.rng() * 1.8; d.path = null; return }
    }
    if (!target) return
    if (!d.path || this.t - d.pathAt > (d.state === 'chase' ? 0.4 : 2)) { d.path = findPath(d, target, this.locked); d.pathAt = this.t }
    if (!d.path) { d.spot = null; if (d.state !== 'patrol') { d.state = 'patrol'; d.wait = 0.5 } d.leg++; return }
    while (d.path.length && dist(d, d.path[0]) < 0.4) d.path.shift()
    if (!d.path.length) { if (d.state === 'patrol') { d.spot = null; d.leg++ } return }
    const p = d.path[0], a = angleTo(d, p)
    d.dir += angleDiff(a, d.dir) * Math.min(1, dt * 7)
    d.speed = speed
    moveBody(d, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, 0.36, this.locked)
  }

  // Cameras tip off the dogs unless the hacker loops them.
  stepCameras(dt) {
    for (const r of ROOMS) {
      if (!r.cam || this.camLoop[r.id] || this.blackout > 0) continue
      const c = this.alive().find((o) => !o.isMole && roomOf(o) === r.id)
      if (c && this.rng() < dt * 0.014) {
        this.log('camera', null, c.id, { room: r.id })
        this.captain.intel.push({ t: this.t, text: `Camera saw a cat in ${r.name}` })
        this.dogs.filter((d) => d.state === 'patrol').sort((a, b) => dist(a, c) - dist(b, c)).slice(0, 1).forEach((d) => this.sendDog(d, c, 'camera'))
        this.fx.push({ kind: 'camera', ...roomCenter(r.id), t: this.t })
      }
    }
  }

  // One spy-film moment per match, chosen by the scenario.
  stepSetPiece(dt) {
    if (this.setPiece === 'laser_hall') {
      // Beams sweep the ring around the vault.
      const s = (k, p) => Math.sin(this.t * k + p)
      this.lasers = [
        { x1: 15.5 + 1.2 * s(0.9, 0), z1: 11, x2: 15.5 + 1.2 * s(0.9, 0), z2: 21 },
        { x1: 26.2 + 1.2 * s(1.1, 2), z1: 11, x2: 26.2 + 1.2 * s(1.1, 2), z2: 21 },
        { x1: 17, z1: 12 + 0.8 * s(1.3, 1), x2: 25, z2: 12 + 0.8 * s(1.3, 1) },
        { x1: 17, z1: 19.9 + 0.8 * s(1, 4), x2: 25, z2: 19.9 + 0.8 * s(1, 4) },
      ]
      for (const c of this.alive()) {
        if (c.isMole || (c.zapAt ?? -9) > this.t - 3) continue
        const hit = this.lasers.some((l) => (l.x1 === l.x2 ? Math.abs(c.x - l.x1) < 0.28 && c.z > l.z1 && c.z < l.z2 : Math.abs(c.z - l.z1) < 0.28 && c.x > l.x1 && c.x < l.x2))
        if (!hit) continue
        c.zapAt = this.t
        c.stun = Math.max(c.stun, 0.5)
        this.fx.push({ kind: 'alarm', x: c.x, z: c.z, t: this.t })
        this.log('laser', c.id, null)
        this.noise(c, 10, 'laser')
      }
    } else if (this.setPiece === 'blackout') {
      this.autoDark ??= [70, 150]
      if (this.autoDark.length && this.t > this.autoDark[0]) { this.autoDark.shift(); this.blackout = 10; this.log('power_cut', null, null) }
    } else if (this.setPiece === 'rooftop' && this.core.taken && !this.hurried) {
      this.hurried = true
      this.t = Math.max(this.t, MATCH_SECONDS - 45)
      for (const c of this.cats) { c.nextThink = Math.min(c.nextThink, this.t); c.llmOff = 0 }
      this.log('pilot_leaving', null, null)
    } else if (this.setPiece === 'double_cross' && this.core.taken && !this.turned) {
      // Greed: with the core out, one loyal agent decides to keep it all.
      const pool = this.alive().filter((c) => !c.isMole && !this.humans.has(c.id) && this.core.by !== c.id)
      if (pool.length) {
        this.turned = this.rng.pick(pool)
        this.turned.turned = true
        this.turned.nextThink = this.t + 2
        this.decideLog(this.turned.id, 'rule', 'Turn on the crew', 'Why split nine million fish?', true)
        this.log('turned', this.turned.id, null)
      } else this.turned = true
    }
  }

  stepObjectives(dt) {
    if (!this.vaultOpen) {
      for (const g of this.gens) {
        g.by = this.alive().filter((c) => dist(c, g) < 1.6).map((c) => c.id)
        g.held = g.by.length > 0
      }
      const both = this.gens.every((g) => g.held)
      this.genProgress = clamp(this.genProgress + (both ? dt / this.vaultSeconds : -dt / 25), 0, 1)
      if (this.genProgress >= 1) {
        this.vaultOpen = true
        this.locked.delete('v1'); this.locked.delete('v2')
        this.log('vault_open', null, null, { room: 'vault' })
        for (const c of this.alive()) { c.nextThink = this.t + this.rng() * 1.5; this.note(c, 'The vault is open') }
      }
    } else if (!this.core.by) {
      const c = this.alive().find((o) => dist(o, this.core) < 0.9 && o.stun <= 0 && !o.isMole)
      if (c) {
        // The wire drop: hang still over the pedestal for a moment, then you have it.
        c.wire += dt
        if (c.wire > (this.core.taken ? 0.4 : 1.8)) {
          c.wire = 0
          this.core.by = c.id
          const first = !this.core.taken
          this.core.taken = true
          this.log('core_taken', c.id, null)
          for (const o of this.alive()) { this.note(o, 'Someone took the core'); o.nextThink = this.t + this.rng() }
          if (first) this.sendDog(this.dogs.filter((d) => d.state !== 'ko')[0] ?? this.dogs[0], this.core, 'vault alarm')
        }
      }
      for (const o of this.cats) if (o !== c) o.wire = 0
    }
    const carrier = this.core.by ? this.cat(this.core.by) : null
    if (carrier) {
      this.core.x = carrier.x; this.core.z = carrier.z
      if (dist(carrier, HELIPAD) < HELIPAD.r && !carrier.isMole) return this.finish('crew', `${carrier.name} got the core out.`)
    }
    // Free caged friends.
    for (const v of this.cats) {
      if (v.state !== 'captured') continue
      const helper = this.alive().find((o) => !o.isMole && dist(o, v) < 1.3)
      v.free = helper ? (v.free ?? 0) + dt : 0
      const picked = this.t - v.capturedAt > 28 // picks its own lock, slowly
      if (v.free > 1.8 || picked) {
        v.free = 0; v.state = 'ok'; v.nextThink = this.t + 0.2
        const p = helper ?? { x: v.x - 1.6, z: v.z }
        if (walkable(Math.floor(p.x), Math.floor(p.z), this.locked)) { v.x = p.x; v.z = p.z }
        this.log('rescued', helper?.id ?? null, v.id)
      }
    }
  }

  checkEnd() {
    if (this.phase !== 'play') return
    const loyal = this.cats.filter((c) => !c.isMole)
    if (!loyal.some((c) => c.state === 'ok')) this.finish('mole', loyal.some((c) => c.state === 'captured') ? 'The crew was wiped out or caged.' : 'The crew was wiped out.')
  }

  finish(winner, why) {
    if (this.phase !== 'play') return
    this.phase = 'end'
    const out = this.cats.filter((c) => c.state === 'ok' && !c.isMole && dist(c, HELIPAD) < 9 && roomOf(c) === 'helipad')
    const share = winner === 'crew' && out.length ? Math.round(9_000_000 / out.length) : 0
    const moleCaught = this.mole.state === 'cut' || this.mole.state === 'dead'
    const spyPaid = winner === 'mole' && !moleCaught ? 9_000_000 : 0
    this.result = { winner, spyPaid, why, mole: this.moleId, tactic: this.tactic, moleCaught, escaped: out.map((c) => c.id), share, t: +this.t.toFixed(1) }
    this.log('end', null, null, this.result)
  }

  // Newest story events, numbered, for the commentary.
  recentEvents() {
    const out = []
    for (let i = this.events.length - 1; i >= 0 && out.length < 24; i--) {
      const e = this.events[i]
      if (this.t - e.t > 7) break
      if (['saw', 'hack', 'camera', 'laser', 'yarn', 'dog_ko'].includes(e.type)) continue
      out.push({ n: i + 1, type: e.type, t: e.t, actor: e.actor, target: e.target, data: e.data })
    }
    return out.reverse()
  }

  // --- what each screen is allowed to know --------------------------------------------

  viewFor(role, catId) {
    const me = role === 'runner' ? this.cat(catId) : null
    const god = role === 'director' || this.phase === 'end'
    const ghost = me && me.state !== 'ok'
    const showCat = (c) => god || c === me || (me && (me.seen.has(c.id) || ghost)) ||
      (role === 'hacker' && c.state === 'ok' && ROOM[roomOf(c)]?.cam)
    const showDog = (d) => god || role === 'hacker' || (me && (me.seen.has(d.id) || ghost || this.pings.some((p) => p.dog === d.id)))
    const f = (n) => +n.toFixed(2)
    const heard = this.radio.filter((m) => god || m.to === 'all' || m.from === catId || m.to === catId || (role === 'hacker' && m.to === 'all')).slice(-14)
    return {
      ...(me?.isMole ? { traitor: true, grace: this.killGrace, tipIn: f(Math.max(0, 15 - (this.t - (me.leakAt ?? -99)))) } : {}),
      t: f(this.t), phase: this.phase, timeLeft: f(this.timeLeft), role, you: catId ?? null,
      gens: this.gens.map((g) => ({ id: g.id, held: g.held })), genProgress: f(this.genProgress), vaultOpen: this.vaultOpen,
      core: god || role === 'hacker' || !this.core.taken || !this.core.by || (me && (this.core.by === me.id || me.seen.has(this.core.by) || (!this.core.by && this.canSee(me, this.core))))
        ? { x: f(this.core.x), z: f(this.core.z), by: this.core.by, taken: this.core.taken } : { taken: true, hidden: true },
      setPiece: this.setPiece, lasers: this.lasers.map((l) => [f(l.x1), f(l.z1), f(l.x2), f(l.z2)]),
      locked: [...this.locked], blackout: f(this.blackout), camLoop: Object.keys(this.camLoop),
      hackCd: Object.fromEntries(Object.entries(this.hackCd).map(([k, v]) => [k, f(v)])),
      cats: this.cats.filter(showCat).map((c) => ({
        id: c.id, name: c.name, color: c.color, x: f(c.x), z: f(c.z), dir: f(c.dir), state: c.state, speed: f(c.speed), mode: c.mode,
        stun: c.stun > 0, human: this.humans.has(c.id), carry: this.core.by === c.id, wire: f(c.wire),
        ...(c === me || god ? { bullets: c.bullets, yarn: c.yarn, clawCd: f(c.clawCd), detected: f(c.detected ?? 0), calledVote: c.calledVote } : {}),
        ...(god ? { mole: !!c.isMole, plan: c.intent ? { goal: c.intent.goal, reason: c.intent.reason, source: c.intent.source, cat: c.intent.cat, room: c.intent.room } : null, thinking: c.thinking } : {}),
      })),
      // Crew strip: what *you* know, which may be wrong.
      crew: this.cats.map((c) => ({
        id: c.id, name: c.name, color: c.color, human: this.humans.has(c.id),
        status: god ? c.state : c === me ? c.state : c.state === 'cut' ? 'cut' : me ? (me.seen.has(c.id) ? c.state : me.known[c.id] === 'dead' ? 'dead' : me.known[c.id] === 'captured' ? 'captured' : 'unseen') : 'unseen',
        lastSeen: me?.lastSeen[c.id] ? { room: me.lastSeen[c.id].room, ago: Math.round(this.t - me.lastSeen[c.id].t) } : null,
      })),
      dogs: this.dogs.filter(showDog).map((d) => ({ id: d.id, x: f(d.x), z: f(d.z), dir: f(d.dir), state: d.state, speed: f(d.speed) })),
      fx: this.fx.filter((e) => god || !me || ghost || e.kind === 'shot' || e.kind === 'alarm' || this.canSee(me, e)).map((e) => ({ ...e })),
      radio: god ? heard : heard.map(({ id, t, from, to, kind, room, cat, text, via }) => ({ id, t, from, to, kind, room, cat, text, via })), scansLeft: this.scansLeft, pings: this.pings.map((p) => p.dog),
      heardShot: me?.heardShot && this.t - me.heardShot.t < 4 ? me.heardShot.dir : null,
      vote: this.vote ? { by: this.vote.by, left: f(this.vote.until - this.t), votes: god ? this.vote.votes : Object.fromEntries(Object.keys(this.vote.votes).map((k) => [k, true])), options: this.cats.filter((c) => c.state !== 'cut').map((c) => c.id) } : null,
      lastVote: this.lastVote && this.t - this.lastVote.t < 6 ? { out: this.lastVote.out, wasMole: this.lastVote.wasMole, votes: this.lastVote.votes } : null,
      ledger: god ? this.ledger.slice(this.phase === 'end' ? -120 : -14) : [],
      sealed: god ? 0 : this.ledger.length,
      result: this.result,
      ...(god ? { mole: this.moleId, tactic: this.tactic } : {}),
      ...(god && this.phase === 'play' ? { recent: this.recentEvents() } : {}),
      ...(this.phase === 'end' ? { story: this.events.filter((e) => ['kill', 'captured', 'rescued', 'leak', 'gunshot', 'vote_result', 'vault_open', 'core_taken', 'scuffle', 'end', 'body_found', 'turned', 'pilot_leaving', 'power_cut'].includes(e.type)) } : {}),
    }
  }
}
