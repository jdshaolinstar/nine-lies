// Game rules only: no React or three.js in here.

export const ARENA = 11
export const ROUND_SECONDS = 60
const CRYSTALS = 8
const PICKUP_DISTANCE = 0.95

export const PLAYERS = [
  { id: 'you', name: 'You', color: '#ffc857', speed: 6.2 },
  // Each AI picks its target differently.
  { id: 'nearest', name: 'Scout', color: '#4cc9f0', speed: 4.6 },
  { id: 'value', name: 'Banker', color: '#f72585', speed: 4.4 },
  { id: 'rival', name: 'Thief', color: '#80ed99', speed: 5.0 },
]

const STARTS = [[0, 8], [-8, -6], [8, -6], [0, -8]]

const clamp = (n) => Math.max(-ARENA, Math.min(ARENA, n))
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const randomSpot = () => (Math.random() * 2 - 1) * (ARENA - 1)

function newCrystal(id) {
  return { id, x: randomSpot(), z: randomSpot(), value: Math.random() < 0.25 ? 3 : 1 }
}

export function createGame() {
  return {
    timeLeft: ROUND_SECONDS,
    players: PLAYERS.map((p, i) => ({ ...p, x: STARTS[i][0], z: STARTS[i][1], score: 0 })),
    crystals: Array.from({ length: CRYSTALS }, (_, i) => newCrystal(i)),
  }
}

function pickTarget(player, game) {
  const best = (score) =>
    game.crystals.reduce((top, c) => (score(c) > score(top) ? c : top))

  if (player.id === 'value') {
    return best((c) => c.value * 4 - dist(player, c))
  }
  if (player.id === 'rival') {
    // Goes for whatever the current leader is closest to.
    const leader = game.players
      .filter((p) => p !== player)
      .reduce((top, p) => (p.score > top.score ? p : top))
    return best((c) => -dist(leader, c) - dist(player, c) * 0.5)
  }
  return best((c) => -dist(player, c))
}

// Moves the game forward by dt seconds. `input` is the human's direction {x, z}.
export function step(game, input, dt) {
  if (game.timeLeft <= 0) return
  game.timeLeft = Math.max(0, game.timeLeft - dt)

  for (const p of game.players) {
    const target = p.id === 'you' ? null : pickTarget(p, game)
    const dx = target ? target.x - p.x : input.x
    const dz = target ? target.z - p.z : input.z
    const length = Math.hypot(dx, dz)
    if (length > 0.001) {
      const travel = target ? Math.min(p.speed * dt, length) : p.speed * dt
      p.x = clamp(p.x + (dx / length) * travel)
      p.z = clamp(p.z + (dz / length) * travel)
    }
  }

  // The closest player in range wins each crystal, so turn order gives no edge.
  for (const c of game.crystals) {
    const closest = game.players.reduce((a, b) => (dist(b, c) < dist(a, c) ? b : a))
    if (dist(closest, c) < PICKUP_DISTANCE) {
      closest.score += c.value
      Object.assign(c, newCrystal(c.id))
    }
  }
}
