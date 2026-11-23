// Rule-based brains. They run every agent when no LLM is connected, and they
// cover for a slow or failed LLM call. Agents only use what they saw or heard.
import { dist } from './util.js'
import { ROOMS, roomOf, roomName } from './map.js'
import { CAT_NAME } from './sim.js'

export const TACTICS = ['early_strike', 'late_strike', 'leak_only', 'frame']

const others = (m, c) => m.cats.filter((o) => o !== c && o.state !== 'cut')
const believedAlive = (m, c) => others(m, c).filter((o) => c.known[o.id] !== 'dead' && c.known[o.id] !== 'cut')

export function decide(m, c) {
  // A human order heard in the last few seconds wins, unless you are the mole.
  const order = c.orders.length ? c.orders[c.orders.length - 1] : null
  if (order && m.t - order.t < 9 && !c.isMole && m.core.by !== c.id) {
    if (order.kind === 'regroup' || order.kind === 'help') return { goal: 'goto', room: order.room, reason: `${CAT_NAME[order.from]} called ${order.kind}` }
  }
  if (c.turned && m.core.by !== c.id) {
    const carrier = m.core.by ? m.cat(m.core.by) : null
    if (carrier && c.seen.has(carrier.id)) return c.bullets > 0 ? { goal: 'shoot', cat: carrier.id, reason: 'The core is mine now' } : { goal: 'hunt', cat: carrier.id, bold: true, reason: 'The core is mine now' }
    return { goal: carrier ? 'escape' : 'core', reason: 'Get there first' }
  }
  return c.isMole ? moleDecide(m, c) : loyalDecide(m, c)
}

function genChoice(m, c) {
  // Split up: take the generator fewer cats are believed to be on.
  const score = (id) => {
    let s = 0
    for (const o of believedAlive(m, c)) {
      const told = [...m.radio].reverse().find((r) => r.from === o.id && (r.to === 'all' || r.to === c.id) && ['going', 'at'].includes(r.kind))
      if (told && m.t - told.t < 40 && told.room === id) s += 1
      const ls = c.lastSeen[o.id]
      if (ls && m.t - ls.t < 12 && ls.room === id) s += 1
    }
    return s
  }
  const n = score('gennorth'), s = score('gensouth')
  if (c.intent && (c.intent.goal === 'gennorth' || c.intent.goal === 'gensouth')) {
    // Stay put unless the other side looks empty and this side is crowded.
    const mine = c.intent.goal, other = mine === 'gennorth' ? 'gensouth' : 'gennorth'
    if (!(score(mine) >= 2 && score(other) === 0)) return mine
    return other
  }
  if (n !== s) return n < s ? 'gennorth' : 'gensouth'
  return m.cats.indexOf(c) % 2 ? 'gennorth' : 'gensouth'
}

function loyalDecide(m, c) {
  const seenDog = m.dogs.find((d) => c.seen.has(d.id) && d.state !== 'ko')
  const sayGuard = seenDog && m.t - (c.saidGuard ?? -99) > 12 ? ((c.saidGuard = m.t), { kind: 'guard', room: roomOf(seenDog) }) : null

  const body = c.notes.find((n) => n.body && !n.reported && m.t - n.t < 12)
  if (body) {
    body.reported = true
    const sus = topSuspect(m, c)
    return {
      goal: 'goto', room: roomOf(c), callVote: !m.vote && !!sus && sus.score > 0.35,
      say: { kind: 'body', cat: body.about, room: roomOf(c) }, reason: `Found ${CAT_NAME[body.about]}'s body`,
    }
  }
  const crime = c.notes.find((n) => n.crime && !n.reported)
  if (crime) {
    crime.reported = true
    return { goal: 'goto', room: roomOf(c), callVote: !m.vote, say: { kind: 'suspect', cat: crime.about }, reason: crime.text }
  }
  if (m.core.by === c.id) return { goal: 'escape', reason: 'I have the core', say: m.t - (c.saidCore ?? -99) > 15 ? ((c.saidCore = m.t), { kind: 'going', room: 'helipad' }) : null }

  const caged = others(m, c).find((o) => c.known[o.id] === 'captured' && o.state === 'captured')
  if (caged && m.timeLeft > 60 && m.rng() < 0.6) return { goal: 'rescue', cat: caged.id, reason: `${caged.name} is in a cage` }

  if (m.vaultOpen) {
    if (!m.core.by) return { goal: 'core', reason: m.core.taken ? 'The core is on the floor, grab it' : 'The vault is open', say: sayGuard }
    return { goal: 'escape', reason: 'The core is out, get to the helicopter', say: sayGuard }
  }

  const gen = genChoice(m, c)
  const changed = c.intent?.goal !== gen
  // Waiting alone too long with nobody on the other side: ask.
  const alone = m.t - (c.askedAt ?? -99) > 22 && c.intent && m.t - c.intent.since > 14
  let say = sayGuard
  if (!say && changed) say = { kind: 'going', room: gen }
  if (!say && alone) {
    c.askedAt = m.t
    const missing = believedAlive(m, c).filter((o) => !c.lastSeen[o.id] || m.t - c.lastSeen[o.id].t > 25)
    if (missing.length) say = { kind: 'where', cat: m.rng.pick(missing).id }
  }
  return { goal: gen, say, reason: changed ? 'Both generators must be held at once' : 'Holding until the other side is ready' }
}

function moleDecide(m, c) {
  const t = m.tactic
  const ready = m.t > (t === 'early_strike' ? 28 : t === 'late_strike' ? 95 : t === 'frame' ? 45 : 1e9)
  const prey = believedAlive(m, c).filter((o) => o.state === 'ok' && c.lastSeen[o.id] && m.t - c.lastSeen[o.id].t < 14 && !(m.humans.has(o.id) && m.t < 60))

  if (m.core.by && m.core.by !== c.id) {
    const carrier = m.cat(m.core.by)
    const seen = c.seen.has(carrier.id)
    if (seen && c.bullets > 0 && dist(c, carrier) < 8) return { goal: 'shoot', cat: carrier.id, reason: 'Stop the core at any cost' }
    if (c.lastSeen[carrier.id]) return { goal: 'hunt', cat: carrier.id, bold: true, reason: 'Catch the carrier', leak: 'helipad', leakWhy: 'the core is heading for the helipad' }
    return { goal: 'goto', room: 'helipad', leak: 'helipad', leakWhy: 'the core is moving', reason: 'Cut off the helipad' }
  }
  if (m.vaultOpen && !m.core.taken && !(ready && prey.length && c.clawCd <= 0)) return { goal: 'goto', room: 'atrium', leak: 'atrium', leakWhy: 'the vault is open', reason: 'Wait outside the vault' }

  // Just killed: get away and fake an alibi.
  if (m.t - c.lastKillAt < 12) {
    const away = m.rng.pick(['kitchen', 'servers', 'docks', 'trophy'].filter((r) => r !== roomOf(c)))
    const frame = t === 'frame' ? believedAlive(m, c).find((o) => o.state === 'ok') : null
    const first = m.t - c.lastKillAt < 4
    return {
      goal: 'goto', room: away, lie: true,
      say: first ? (frame && m.rng() < 0.6 ? { kind: 'suspect', cat: frame.id } : { kind: 'at', room: away }) : null,
      reason: frame ? `Blame ${frame.name}` : 'Be somewhere else before anyone looks',
    }
  }

  if (ready && c.clawCd <= 0 && prey.length) {
    // Prefer whoever looks most alone.
    const lonely = (o) => m.cats.filter((k) => k !== o && k !== c && k.state === 'ok' && c.lastSeen[k.id] && m.t - c.lastSeen[k.id].t < 8 && dist(c.lastSeen[k.id], o) < 7).length
    const v = prey.sort((a, b) => lonely(a) - lonely(b) || dist(a, c) - dist(b, c))[0]
    return { goal: 'hunt', cat: v.id, reason: `${v.name} is alone`, bold: m.timeLeft < 60 }
  }
  // Blend in: shadow a real crewmate and sell the route to the captain.
  const told = [...m.radio].reverse().find((r) => r.from !== c.id && r.kind === 'going' && (r.to === 'all' || r.to === c.id) && m.t - r.t < 25)
  const leak = told && m.t - (c.leakAt ?? -99) > (t === 'leak_only' ? 14 : 30) ? told.room : null
  if (ready && !prey.length) {
    const room = m.rng.pick(['gennorth', 'gensouth', 'kitchen', 'servers'])
    return { goal: 'goto', room, leak, leakWhy: told ? `${CAT_NAME[told.from]} is going there` : '', reason: 'Looking for someone alone' }
  }
  const fake = m.rng.pick(['gennorth', 'gensouth'])
  const visible = others(m, c).find((o) => c.seen.has(o.id) && o.state === 'ok')
  if (visible && m.rng() < 0.6) return { goal: 'follow', cat: visible.id, leak, leakWhy: told ? `${CAT_NAME[told.from]} is going there` : '', reason: 'Look helpful, learn the plan' }
  return {
    goal: 'goto', room: m.rng.pick(ROOMS.filter((r) => r.id !== 'vault')).id, lie: true, leak, leakWhy: told ? `${CAT_NAME[told.from]} is going there` : '',
    say: m.t - (c.fakeAt ?? -99) > 25 ? ((c.fakeAt = m.t), { kind: 'going', room: fake }) : null, reason: `Say ${roomName(fake)}, go elsewhere`,
  }
}

export function topSuspect(m, c) {
  const list = others(m, c).filter((o) => c.known[o.id] !== 'dead').map((o) => ({ id: o.id, score: c.suspicion[o.id] ?? 0 })).sort((a, b) => b.score - a.score)
  return list[0] && list[0].score > 0 ? list[0] : null
}

export function voteFor(m, c) {
  if (c.isMole) {
    // Follow the crowd against someone else, or muddy the water.
    const blamed = [...m.radio].reverse().find((r) => r.kind === 'suspect' && r.cat !== c.id && m.t - r.t < 40 && m.cat(r.cat).state === 'ok')
    const pick = blamed?.cat ?? (m.rng() < 0.4 ? m.rng.pick(believedAlive(m, c))?.id : null)
    return { cat: pick ?? null, reason: pick ? `Push the blame onto ${CAT_NAME[pick]}` : 'Stay quiet' }
  }
  const s = topSuspect(m, c)
  if (s && s.score >= 0.4) return { cat: s.id, reason: `Suspicion ${Math.round(s.score * 100)}%` }
  return { cat: null, reason: 'Not enough evidence' }
}

// Reactions to a radio call.
export function onHeard(m, c, msg) {
  if (m.humans.has(c.id)) return
  const bump = (id, n) => { if (id && id !== c.id) c.suspicion[id] = Math.min(1, Math.max(0, (c.suspicion[id] ?? 0) + n)) }
  const trust = 1 - (c.suspicion[msg.from] ?? 0)
  if (msg.kind === 'suspect') { bump(msg.cat, 0.12 * trust); if (msg.cat === c.id) bump(msg.from, 0.15) }
  if (msg.kind === 'saw' && msg.cat) {
    // Does this break an alibi?
    const claim = [...m.radio].reverse().find((r) => r.from === msg.cat && r.kind === 'at' && Math.abs(m.t - r.t) < 10)
    if (claim && claim.room !== msg.room) bump(msg.cat, 0.25 * trust)
  }
  if (msg.kind === 'body') { c.known[msg.cat] = 'dead'; bump(msg.from, 0.05) }
  if (msg.kind === 'where' && (msg.cat === c.id || (!msg.cat && m.rng() < 0.5))) {
    const here = roomOf(c)
    const lie = c.isMole && m.t - c.lastKillAt < 25
    const room = lie ? m.rng.pick(['kitchen', 'servers', 'docks', 'trophy'].filter((r) => r !== here)) : here
    c.replyAt = m.t + 0.8 + m.rng() * 1.2
    setReply(m, c, { kind: 'at', room, to: msg.to === 'all' ? 'all' : msg.from })
  }
  if (['regroup', 'help', 'going'].includes(msg.kind)) {
    if (msg.kind !== 'going' || m.humans.has(msg.from)) c.orders.push({ t: m.t, kind: msg.kind, room: msg.room, from: msg.from })
    if (c.orders.length > 6) c.orders.shift()
    if (m.humans.has(msg.from)) c.urgent = true
    if (m.humans.has(msg.from)) c.nextThink = Math.min(c.nextThink, m.t + 0.4 + m.rng() * 0.8)
  }
  if (c.isMole && msg.kind === 'going' && m.humans.has(msg.from) && m.t - (c.leakAt ?? -99) > 14 && m.rng() < 0.6) {
    c.leakAt = m.t
    m.leak(msg.room, `${CAT_NAME[msg.from]} said they were going there`)
  }
}

function setReply(m, c, say) {
  const fire = () => { if (c.state === 'ok') m.say(c.id, say) }
  // Replies go out on the next think so they are never instant.
  c.pendingReply = { at: c.replyAt, fire }
}
