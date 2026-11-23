import { GENERATORS, HELIPAD, CORE, roomName, roomOf } from '../shared/map.js'
import { dist } from '../shared/util.js'

// The one thing this player should do next, in plain words.
export function guide(s) {
  const me = s.cats.find((c) => c.id === s.you)
  if (!me || me.state !== 'ok') return { step: stepOf(s), text: '', target: null }
  const step = stepOf(s)
  const dog = s.dogs.find((d) => d.state === 'chase' && dist(d, me) < 8)
  const warn = dog ? 'A dog sees you. RUN!' : me.detected > 0.35 ? 'Get out of the light!' : null

  if (me.carry) return { step, warn, text: 'You have the core! Run to the green H', target: HELIPAD }
  if (!s.vaultOpen) {
    const held = (id) => s.gens.find((g) => g.id === id).held
    const on = GENERATORS.find((g) => dist(g, me) < 1.6)
    if (on) {
      const other = GENERATORS.find((g) => g !== on)
      return { step, warn, text: held(other.id) ? 'Stay here! The vault is opening…' : 'Stay on the ring. Wait for a crewmate on the other one', target: on, there: true }
    }
    const free = GENERATORS.filter((g) => !held(g.id))
    const pick = (free.length ? free : GENERATORS).slice().sort((a, b) => dist(a, me) - dist(b, me))[0]
    return { step, warn, text: free.length === 1 ? `One generator is held. Stand on the other: ${roomName(pick.id)}` : 'Follow the dots and stand on the generator ring', target: pick }
  }
  if (!s.core.by && !s.core.hidden) {
    if (dist(s.core, me) < 1) return { step, warn, text: 'Hold still. Grabbing the core…', target: s.core, there: true }
    return { step, warn, text: s.core.taken ? `The core was dropped in ${roomName(roomOf(s.core))}. Grab it!` : 'The vault is open. Grab the red core', target: s.core.taken ? s.core : CORE }
  }
  return { step, warn, text: 'A crewmate has the core. Get to the green H', target: HELIPAD }
}

export function stepOf(s) {
  return !s.vaultOpen ? 0 : !s.core.taken ? 1 : 2
}

export const STEPS = [
  { title: 'Power', text: 'Two cats, two rings, same time' },
  { title: 'Core', text: 'Grab it from the vault' },
  { title: 'Escape', text: 'Carry it to the green H' },
]
