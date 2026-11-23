import { W, H, solid, opaque, doorAt, inBounds } from './map.js'

const idx = (x, z) => z * W + x

export function walkable(cx, cz, locked) {
  if (!inBounds(cx, cz) || solid[idx(cx, cz)]) return false
  const d = doorAt[idx(cx, cz)]
  return !(d && locked.has(d))
}

export function lineOfSight(a, b, locked) {
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const n = Math.ceil(d / 0.25)
  for (let i = 1; i < n; i++) {
    const x = Math.floor(a.x + ((b.x - a.x) * i) / n)
    const z = Math.floor(a.z + ((b.z - a.z) * i) / n)
    const k = idx(x, z)
    if (opaque[k] || (doorAt[k] && locked.has(doorAt[k]))) return false
  }
  return true
}

function nearestWalkable(p, locked) {
  const cx = Math.floor(p.x)
  const cz = Math.floor(p.z)
  for (let r = 0; r < 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (walkable(cx + dx, cz + dz, locked)) return [cx + dx, cz + dz]
      }
    }
  }
  return null
}

const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]]

function heapPush(heap, n) {
  heap.push(n)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p][0] <= heap[i][0]) break
    const tmp = heap[p]
    heap[p] = heap[i]
    heap[i] = tmp
    i = p
  }
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (!heap.length) return top
  heap[0] = last
  let i = 0
  for (;;) {
    const l = i * 2 + 1
    const r = l + 1
    let m = i
    if (l < heap.length && heap[l][0] < heap[m][0]) m = l
    if (r < heap.length && heap[r][0] < heap[m][0]) m = r
    if (m === i) return top
    const tmp = heap[m]
    heap[m] = heap[i]
    heap[i] = tmp
    i = m
  }
}

// A* over the grid. `avoid(cx, cz)` adds cost, e.g. near dogs. Returns world points.
export function findPath(from, to, locked, avoid) {
  const s = nearestWalkable(from, locked)
  const g = nearestWalkable(to, locked)
  if (!s || !g) return null
  const start = idx(...s)
  const goal = idx(...g)
  const cost = new Float32Array(W * H).fill(Infinity)
  const came = new Int32Array(W * H).fill(-1)
  const done = new Uint8Array(W * H)
  const heap = [[0, start]]
  cost[start] = 0
  while (heap.length) {
    const cur = heapPop(heap)[1]
    if (done[cur]) continue
    done[cur] = 1
    if (cur === goal) break
    const cx = cur % W
    const cz = (cur / W) | 0
    for (const [dx, dz, c] of STEPS) {
      const nx = cx + dx
      const nz = cz + dz
      if (!walkable(nx, nz, locked)) continue
      if (dx && dz && (!walkable(cx + dx, cz, locked) || !walkable(cx, cz + dz, locked))) continue
      const k = idx(nx, nz)
      const nc = cost[cur] + c + (avoid ? avoid(nx, nz) : 0)
      if (nc < cost[k]) {
        cost[k] = nc
        came[k] = cur
        heapPush(heap, [nc + Math.hypot(nx - g[0], nz - g[1]), k])
      }
    }
  }
  if (!done[goal]) return null
  const out = []
  for (let k = goal; k !== -1 && k !== start; k = came[k]) out.push({ x: (k % W) + 0.5, z: ((k / W) | 0) + 0.5 })
  out.reverse()
  // Finish on the exact spot when its cell is open.
  if (out.length && Math.floor(to.x) === g[0] && Math.floor(to.z) === g[1]) out[out.length - 1] = { x: to.x, z: to.z }
  return out
}

// Circle vs grid, one axis at a time so bodies slide along walls.
export function moveBody(b, dx, dz, r, locked) {
  const hit = (x, z) =>
    !walkable(Math.floor(x - r), Math.floor(z - r), locked) || !walkable(Math.floor(x + r), Math.floor(z - r), locked) ||
    !walkable(Math.floor(x - r), Math.floor(z + r), locked) || !walkable(Math.floor(x + r), Math.floor(z + r), locked)
  const stuck = hit(b.x, b.z) // a door closed on us: let us walk out
  const open = (x, z) => walkable(Math.floor(x), Math.floor(z), locked)
  if (stuck ? open(b.x + dx, b.z) : !hit(b.x + dx, b.z)) b.x += dx
  if (stuck ? open(b.x, b.z + dz) : !hit(b.x, b.z + dz)) b.z += dz
}
