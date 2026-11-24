// Agent brains on Runware's OpenAI-compatible endpoint. The LLM picks goals,
// lies and words. Plain code does the walking.
import { ROOMS, ROOM, roomOf, roomName } from '../shared/map.js'
import { CAT_NAME, CALLS } from '../shared/sim.js'

const URL = 'https://api.runware.ai/v1/chat/completions'
export const llmStats = { calls: 0, failed: 0, ms: 0, lastError: null }

export async function chat(messages, { maxTokens = 220, timeout = 8000, temperature = 0.9 } = {}) {
  const cap = +process.env.LLM_CALL_CAP || 1500
  if (llmStats.calls >= cap) throw new Error('LLM call cap reached')
  llmStats.calls++
  const t0 = Date.now()
  const r = await fetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RUNWARE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.LLM_MODEL || 'google:gemini@3.5-flash-lite', messages, max_tokens: maxTokens, ...(/claude/.test(process.env.LLM_MODEL ?? '') ? {} : { temperature }) }),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`LLM ${r.status}: ${text.slice(0, 200)}`)
  llmStats.ms = llmStats.ms ? llmStats.ms * 0.8 + (Date.now() - t0) * 0.2 : Date.now() - t0
  return JSON.parse(text).choices?.[0]?.message?.content ?? ''
}

export function parseJson(text) {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}')
  return a < 0 || b < a ? null : JSON.parse(clean.slice(a, b + 1))
}

const PERSONA = {
  ace: 'bold and impatient', domino: 'careful and methodical', velvet: 'charming and slippery',
  boots: 'blunt, loyal to whoever pulls their weight', sable: 'paranoid and sharp-eyed',
}
const TACTIC = {
  early_strike: 'Kill early, as soon as someone is alone.',
  late_strike: 'Earn trust first. Kill in the last two minutes.',
  leak_only: 'Never kill. Feed routes to the captain and let the dogs do it.',
  frame: 'Kill once, then make the crew blame somebody innocent.',
}
const ROOM_IDS = ROOMS.map((r) => r.id).join(', ')

function systemFor(m, c) {
  return `You are ${c.name}, a spy cat in a live heist game. Personality: ${PERSONA[c.id]}.
Heist: cats must stand on BOTH generators (gennorth and gensouth) at the same moment for 5s, then take the core from the vault, then reach the helipad. Dogs cage any cat they catch.
${c.isMole
    ? `SECRET: you are the mole. You win if time runs out or the crew is wiped out. Dogs ignore you. Never admit it. Tactic: ${TACTIC[m.tactic] ?? 'Stop the heist.'} You claw silently from behind with goal "hunt" when nobody is watching. "leak" a room id to send dogs there. Lie on the radio when useful.`
    : 'You are loyal. Exactly one other cat is the mole. The loot is split between loyal survivors, so a smaller crew means a bigger share, but you lose if the heist fails.'}
Reply with ONE JSON object and nothing else:
{"goal": one of [gennorth, gensouth, core, escape, goto, follow, rescue, ${c.isMole ? 'hunt, ' : ''}shoot], "room": room id (for goto), "cat": cat id (for follow, rescue, shoot${c.isMole ? ', hunt' : ''}), "say": null or {"kind": one of [${Object.keys(CALLS).join(', ')}], "room": room id, "cat": cat id, "to": "all" or cat id for a whisper}, ${c.isMole ? '"leak": null or room id, "lie": true/false, ' : ''}"callVote": true/false, "reason": "max 12 words, first person"}
Room ids: ${ROOM_IDS}. Cat ids: ${Object.keys(CAT_NAME).join(', ')}.
Speak only when it helps. Only shoot someone you are nearly sure about: you have one bullet and it calls the dogs.`
}

function situation(m, c, hint) {
  const ago = (t) => `${Math.round(m.t - t)}s ago`
  const crew = m.cats.filter((o) => o !== c).map((o) => {
    const ls = c.lastSeen[o.id]
    const st = c.known[o.id] && c.known[o.id] !== 'ok' ? c.known[o.id] : c.seen.has(o.id) ? 'in sight' : ls ? `last seen ${roomName(ls.room)} ${ago(ls.t)}` : 'not seen'
    const sus = c.suspicion[o.id] ? `, suspicion ${Math.round(c.suspicion[o.id] * 100)}%` : ''
    return `${o.id}: ${st}${m.humans.has(o.id) ? ' (human)' : ''}${sus}`
  }).join('; ')
  const dogs = m.dogs.filter((d) => c.seen.has(d.id)).map((d) => `${d.state} dog in ${roomName(roomOf(d))}`).join(', ')
  return `Time left ${Math.round(m.timeLeft)}s. You are in ${roomOf(c)}. Bullets ${c.bullets}. Claw ${c.clawCd > 0 ? `ready in ${Math.ceil(c.clawCd)}s` : 'ready'}.
Generators: ${m.vaultOpen ? 'done, vault OPEN' : m.gens.map((g) => `${g.id} ${g.held ? 'held' : 'empty'}`).join(', ')}. Core: ${m.core.by === c.id ? 'YOU carry it, go to helipad' : m.core.by ? 'a crewmate carries it, escort to helipad' : m.core.taken ? `lying on the floor in ${roomName(roomOf(m.core))}, someone must grab it` : m.vaultOpen ? 'in the OPEN vault, someone must grab it' : 'locked in vault'}.
Crew: ${crew}.
Dogs you see: ${dogs || 'none'}.
Recent: ${c.notes.slice(-9).map((n) => `[${ago(n.t)}] ${n.text}`).join(' | ') || 'nothing'}
Your current plan: ${c.intent ? `${c.intent.goal} ${c.intent.room ?? c.intent.cat ?? ''}` : 'none'}. Field instinct suggests: ${hint.goal} ${hint.room ?? hint.cat ?? ''} (${hint.reason ?? ''}). You may ignore it.`
}

const GOALS = new Set(['gennorth', 'gensouth', 'core', 'escape', 'goto', 'follow', 'rescue', 'hunt', 'shoot'])

// Models get names wrong; accept "Kitchen" for "kitchen" and drop the rest.
const asRoom = (v) => {
  if (!v) return undefined
  const k = String(v).toLowerCase().replace(/[^a-z]/g, '')
  return ROOM[k] ? k : ROOMS.find((r) => r.name.toLowerCase().replace(/[^a-z]/g, '') === k)?.id
}
const asCat = (v) => (v && CAT_NAME[String(v).toLowerCase()] ? String(v).toLowerCase() : undefined)

export function cleanPlan(p) {
  if (!p || !GOALS.has(p.goal)) return null
  const out = { goal: p.goal, room: asRoom(p.room), cat: asCat(p.cat), reason: String(p.reason ?? '').slice(0, 110), callVote: p.callVote === true, lie: p.lie === true, leak: asRoom(p.leak) }
  if (p.say && CALLS[p.say.kind]) out.say = { kind: p.say.kind, room: asRoom(p.say.room), cat: asCat(p.say.cat), to: asCat(p.say.to) ?? 'all' }
  if (out.goal === 'goto' && !out.room) return null
  return out
}

export function thinkerFor() {
  return async (m, c, hint) => {
    const t0 = Date.now()
    const label = (what, ok) => m.vendor?.({ vendor: 'runware', who: c.id, sticker: 'thinking', ms: Date.now() - t0, ok, secret: true, what, hidden: `${c.name} is deciding what to do` })
    try {
      const text = await chat([{ role: 'system', content: systemFor(m, c) }, { role: 'user', content: situation(m, c, hint) }])
      const plan = cleanPlan(parseJson(text))
      if (!plan) throw new Error('unusable plan: ' + text.slice(0, 120))
      // Keep one-off duties the rules already decided on.
      if (!plan.say && hint.say && ['body', 'suspect'].includes(hint.say.kind)) plan.say = hint.say
      label(`${c.name} planned: ${ROOM[plan.goal] ? `hold ${roomName(plan.goal)}` : plan.goal === 'core' ? 'grab the core' : plan.goal === 'escape' ? 'run for the helipad' : `${plan.goal} ${plan.cat ? CAT_NAME[plan.cat] : plan.room ? roomName(plan.room) : ''}`.trim()}. "${plan.reason}"`)
      return plan
    } catch (e) {
      llmStats.failed++
      llmStats.lastError = e.message
      label(`${c.name}'s plan failed, so the built-in rules took over`, false)
      return null
    }
  }
}

export function captainFor(scenario) {
  return async (m) => {
    const recent = m.captain.intel.filter((i) => m.t - i.t < 40).slice(-8)
    const t0 = Date.now()
    try {
      const text = await chat([
        { role: 'system', content: `You are ${scenario.villain}, the dog captain guarding ${scenario.target}. Smug and theatrical. Reply with ONE JSON object: {"orders":[{"dog":"dog0","room":"kitchen"}], "reason":"max 12 words", "taunt":"max 10 words over the loudspeaker, or empty"}. At most 2 orders. Room ids: ${ROOM_IDS}.` },
        { role: 'user', content: `Time until it fires: ${Math.round(m.timeLeft)}s. Vault ${m.vaultOpen ? 'BREACHED' : 'sealed'}. Core ${m.core.taken ? 'STOLEN, they need the helipad' : 'safe'}. ${m.captain.habits ? `Past heists: ${m.captain.habits}. ` : ''}Dogs: ${m.dogs.map((d) => `${d.id} ${d.state} in ${roomOf(d)}`).join('; ')}. Intel: ${recent.map((i) => `[${Math.round(m.t - i.t)}s ago] ${i.text}`).join(' | ') || 'none'}` },
      ], { maxTokens: 160 })
      const p = parseJson(text)
      const sent = (p?.orders ?? []).filter((o) => ROOM[o?.room]).map((o) => `${o.dog} to ${roomName(o.room)}`).join(', ')
      m.vendor?.({ vendor: 'runware', who: p?.orders?.[0]?.dog, sticker: 'orders', ms: Date.now() - t0, secret: true, what: `Dog captain ordered ${sent || 'no change'}`, hidden: 'The dog captain is deciding' })
      return p
    } catch (e) {
      llmStats.failed++
      llmStats.lastError = e.message
      return null
    }
  }
}
