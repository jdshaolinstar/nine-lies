// A scenario skins the heist: villain, target, mood and featured set piece.
// scripts/research.mjs can write a new one from live web research.
export const SET_PIECES = {
  wire_drop: 'Wire drop: hang silently over the vault pedestal',
  laser_hall: 'Laser hall: sweeping beams guard the vault ring',
  blackout: 'Blackout: the whole lair goes dark',
  rooftop: 'Rooftop getaway: a helicopter that will not wait',
  double_cross: 'Double cross: the partner with the knife',
}

export const DEFAULT_SCENARIO = {
  id: 'red-dot',
  title: 'The Red Dot',
  villain: 'Baron von Woof',
  villainLine: 'Come in, kittens. One little red dot, and every cat on Earth will chase it off a cliff.',
  target: 'the Red Dot, a giant laser-pointer superweapon',
  briefing: 'Break in. Hold both generators at once. Take the core. Reach the helipad. One of you works for the dogs.',
  setPiece: 'wire_drop',
  accent: '#ff3048',
  sources: [],
}
