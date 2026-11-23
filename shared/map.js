// The lair: 3x3 rooms on one floor, plus a locked vault in the middle.
// One cell is one world unit. x grows east, z grows south.
export const W = 42
export const H = 32

export const ROOMS = [
  { id: 'trophy', name: 'Trophy Hall', x: 1, z: 1, w: 12, h: 9, color: '#7a4fd0' },
  { id: 'kitchen', name: 'Kitchen', x: 14, z: 1, w: 14, h: 9, color: '#d08a3c', cam: true },
  { id: 'gennorth', name: 'North Generator', x: 29, z: 1, w: 12, h: 9, color: '#3cc6d0' },
  { id: 'docks', name: 'Docks', x: 1, z: 11, w: 12, h: 10, color: '#3c6ed0' },
  { id: 'atrium', name: 'Atrium', x: 14, z: 11, w: 14, h: 10, color: '#b03a5b', cam: true },
  { id: 'helipad', name: 'Helipad', x: 29, z: 11, w: 12, h: 10, color: '#4fae6a', cam: true },
  { id: 'gensouth', name: 'South Generator', x: 1, z: 22, w: 12, h: 9, color: '#3cc6d0' },
  { id: 'servers', name: 'Server Room', x: 14, z: 22, w: 14, h: 9, color: '#4a7f5a', cam: true },
  { id: 'kennel', name: 'Kennel', x: 29, z: 22, w: 12, h: 9, color: '#c05a3a' },
  { id: 'vault', name: 'Vault', x: 18, z: 14, w: 6, h: 4, color: '#ff3048' },
]
export const ROOM = Object.fromEntries(ROOMS.map((r) => [r.id, r]))
export const roomName = (id) => ROOM[id]?.name ?? 'somewhere'

// Two-cell doorways. Vault doors start locked.
export const DOORS = [
  { id: 'd1', cells: [[13, 4], [13, 5]] },
  { id: 'd2', cells: [[28, 4], [28, 5]] },
  { id: 'd3', cells: [[13, 15], [13, 16]] },
  { id: 'd4', cells: [[28, 15], [28, 16]] },
  { id: 'd5', cells: [[13, 25], [13, 26]] },
  { id: 'd6', cells: [[28, 25], [28, 26]] },
  { id: 'd7', cells: [[6, 10], [7, 10]] },
  { id: 'd8', cells: [[6, 21], [7, 21]] },
  { id: 'd9', cells: [[20, 10], [21, 10]] },
  { id: 'd10', cells: [[20, 21], [21, 21]] },
  { id: 'd11', cells: [[34, 10], [35, 10]] },
  { id: 'd12', cells: [[34, 21], [35, 21]] },
  { id: 'v1', cells: [[17, 15], [17, 16]], vault: true },
  { id: 'v2', cells: [[24, 15], [24, 16]], vault: true },
]

// tall blocks sight; low only blocks movement.
export const PROPS = [
  { x: 3, z: 3, w: 1, h: 1, kind: 'pedestal' },
  { x: 9, z: 3, w: 1, h: 1, kind: 'pedestal' },
  { x: 3, z: 7, w: 2, h: 1, kind: 'crate', tall: true },
  { x: 9, z: 7, w: 2, h: 1, kind: 'crate', tall: true },
  { x: 17, z: 3, w: 8, h: 1, kind: 'counter' },
  { x: 16, z: 7, w: 2, h: 1, kind: 'fridge', tall: true },
  { x: 24, z: 7, w: 2, h: 1, kind: 'fridge', tall: true },
  { x: 36, z: 3, w: 3, h: 2, kind: 'generator', tall: true },
  { x: 31, z: 3, w: 2, h: 2, kind: 'crate', tall: true },
  { x: 3, z: 12, w: 2, h: 2, kind: 'crate', tall: true },
  { x: 9, z: 18, w: 2, h: 2, kind: 'crate', tall: true },
  { x: 36, z: 12, w: 3, h: 2, kind: 'helicopter' },
  { x: 31, z: 18, w: 2, h: 2, kind: 'crate', tall: true },
  { x: 3, z: 27, w: 3, h: 2, kind: 'generator', tall: true },
  { x: 9, z: 24, w: 2, h: 2, kind: 'crate', tall: true },
  { x: 16, z: 24, w: 1, h: 5, kind: 'rack', tall: true },
  { x: 25, z: 24, w: 1, h: 5, kind: 'rack', tall: true },
  { x: 20, z: 27, w: 2, h: 1, kind: 'rack', tall: true },
  { x: 33, z: 24, w: 1, h: 3, kind: 'crate', tall: true },
]

export const GENERATORS = [
  { id: 'gennorth', x: 37.5, z: 6.2 },
  { id: 'gensouth', x: 4.5, z: 25.8 },
]
export const CORE = { x: 21, z: 16 }
export const HELIPAD = { x: 36, z: 16.8, r: 2.6 }
export const CAGES = [
  { x: 39.2, z: 24.2 }, { x: 39.2, z: 26.2 }, { x: 39.2, z: 28.2 }, { x: 36.5, z: 29.2 }, { x: 33.5, z: 29.2 },
]
export const CAT_SPAWNS = [
  { x: 3, z: 16 }, { x: 4.6, z: 17.2 }, { x: 4.6, z: 15 }, { x: 6.2, z: 16.2 }, { x: 3, z: 18.2 },
]
// Each dog loops through these rooms.
export const PATROLS = [
  ['kitchen', 'trophy', 'kitchen', 'gennorth'],
  ['atrium', 'kitchen', 'atrium', 'servers'],
  ['gensouth', 'servers', 'gensouth', 'docks'],
  ['helipad', 'kennel', 'gennorth', 'helipad'],
]

const idx = (cx, cz) => cz * W + cx
export const solid = new Uint8Array(W * H).fill(1) // 1 = cannot walk
export const opaque = new Uint8Array(W * H).fill(1) // 1 = cannot see through
export const roomAt = new Array(W * H).fill(null)
export const doorAt = new Array(W * H).fill(null)

for (const r of ROOMS) {
  for (let z = r.z; z < r.z + r.h; z++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      solid[idx(x, z)] = 0
      opaque[idx(x, z)] = 0
      roomAt[idx(x, z)] = r.id
    }
  }
}
// Vault walls cut out of the atrium.
for (let z = 13; z <= 18; z++) {
  for (let x = 17; x <= 24; x++) {
    if (x > 17 && x < 24 && z > 13 && z < 18) continue
    solid[idx(x, z)] = 1
    opaque[idx(x, z)] = 1
    roomAt[idx(x, z)] = null
  }
}
for (const d of DOORS) {
  for (const [x, z] of d.cells) {
    solid[idx(x, z)] = 0
    opaque[idx(x, z)] = 0
    doorAt[idx(x, z)] = d.id
  }
}
for (const p of PROPS) {
  for (let z = p.z; z < p.z + p.h; z++) {
    for (let x = p.x; x < p.x + p.w; x++) {
      solid[idx(x, z)] = 1
      if (p.tall) opaque[idx(x, z)] = 1
    }
  }
}
// Give doorway cells the room next to them, so every walkable spot has a name.
for (const d of DOORS) {
  for (const [x, z] of d.cells) {
    const near = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]].map(([a, b]) => roomAt[idx(a, b)]).find(Boolean)
    roomAt[idx(x, z)] = near
  }
}

export const inBounds = (cx, cz) => cx >= 0 && cz >= 0 && cx < W && cz < H
export const roomOf = (p) => roomAt[idx(Math.floor(p.x), Math.floor(p.z))] ?? 'atrium'
export const roomCenter = (id) => {
  const r = ROOM[id]
  if (id === 'atrium') return { x: 15.5, z: 16 }
  return { x: r.x + r.w / 2, z: r.z + r.h / 2 }
}
