export const clamp = (n, a, b) => Math.max(a, Math.min(b, n))
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
export const angleTo = (a, b) => Math.atan2(b.z - a.z, b.x - a.x)
export const angleDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// Small seeded generator, so a match can be replayed and tested.
export function makeRng(seed = 1) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.pick = (arr) => arr[Math.floor(next() * arr.length)]
  next.range = (lo, hi) => lo + next() * (hi - lo)
  return next
}

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
export const compass = (from, to) => DIRS[(Math.round(angleTo(from, to) / (Math.PI / 4)) + 8) % 8]
