import * as THREE from 'three'
import { W, H, ROOMS, DOORS, PROPS, GENERATORS, HELIPAD, CORE, CAGES, solid, roomAt, doorAt } from '../shared/map.js'
import { makeCat, makeDog, makeProp, label, mat, geo, add, PROP_COLOR } from './models.js'
import { sfx } from './audio.js'

const WALL_H = 1.5

export class GameView {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#05060c')
    this.scene.fog = new THREE.Fog('#05060c', 40, 95)
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
    this.camera.position.set(21, 34, 46)
    this.look = new THREE.Vector3(21, 0, 16)
    this.ents = new Map()
    this.fx = []
    this.seenFx = new Set()
    this.snap = null
    this.mode = 'menu'
    this.focus = null
    this.clock = new THREE.Clock()
    this.lightLevel = 1
    this.build()
    this.resize = this.resize.bind(this)
    addEventListener('resize', this.resize)
    this.resize()
    this.running = true
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.frame() }
    loop()
  }

  dispose() { this.running = false; removeEventListener('resize', this.resize); this.renderer.dispose() }

  resize() {
    const el = this.renderer.domElement.parentElement
    const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  build() {
    const s = this.scene
    this.hemi = new THREE.HemisphereLight('#7f92d8', '#0a0a14', 0.55)
    s.add(this.hemi)
    this.moon = new THREE.DirectionalLight('#b9c8ff', 0.9)
    this.moon.position.set(8, 30, 6)
    this.moon.target.position.set(21, 0, 16)
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    Object.assign(this.moon.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 70 })
    this.moon.shadow.bias = -0.0008
    s.add(this.moon, this.moon.target)
    this.lamp = new THREE.PointLight('#ffe3b0', 0, 11, 1.4)
    s.add(this.lamp)

    this.roomLights = {}
    for (const r of ROOMS) {
      const base = new THREE.Color(r.color)
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mat(base.clone().lerp(new THREE.Color('#141726'), 0.68), { roughness: 0.85 }))
      floor.rotation.x = -Math.PI / 2
      floor.position.set(r.x + r.w / 2, r.id === 'vault' ? 0.015 : 0, r.z + r.h / 2)
      floor.receiveShadow = true
      s.add(floor)
      const grid = new THREE.GridHelper(1, 1)
      grid.visible = false
      const l = new THREE.PointLight(base, r.id === 'vault' ? 30 : 34, r.id === 'vault' ? 8 : 14, 1.5)
      l.position.set(r.x + r.w / 2, 3.4, r.z + r.h / 2)
      if (r.id === 'atrium') l.position.set(21, 4.5, 12)
      s.add(l)
      this.roomLights[r.id] = { l, base: l.intensity }
      const t = label(r.name.toUpperCase(), '#ffffff', 40)
      t.material.opacity = 0.34
      const p = new THREE.Mesh(new THREE.PlaneGeometry(t.scale.x * 1.5, 0.95), new THREE.MeshBasicMaterial({ map: t.material.map, transparent: true, opacity: 0.4, depthWrite: false }))
      p.rotation.x = -Math.PI / 2
      p.position.set(r.x + r.w / 2, 0.03, r.id === 'vault' ? r.z + 0.6 : r.z + r.h - 1.9)
      s.add(p)
      if (r.cam) {
        const cam = new THREE.Group()
        add(cam, geo.box, mat('#20242f'), [0, 0, 0], [0.5, 0.26, 0.26])
        const eye = add(cam, geo.sphere, new THREE.MeshBasicMaterial({ color: '#ff3048' }), [0.28, 0, 0], 0.09)
        cam.position.set(r.x + 0.5, 1.7, r.z + 0.4)
        cam.rotation.y = -0.6
        s.add(cam)
        this.cams ??= {}
        this.cams[r.id] = eye
      }
    }

    // Checker tiles give the floors some texture and a sense of speed.
    const tiles = []
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!solid[z * W + x] && (x + z) % 2) tiles.push([x, z])
    const tile = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.14, depthWrite: false }), tiles.length)
    const m4 = new THREE.Matrix4()
    tiles.forEach(([x, z], i) => tile.setMatrixAt(i, m4.makeTranslation(x + 0.5, 0.02, z + 0.5)))
    s.add(tile)

    const prop = new Set()
    for (const p of PROPS) for (let z = p.z; z < p.z + p.h; z++) for (let x = p.x; x < p.x + p.w; x++) prop.add(z * W + x)
    const walls = []
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (solid[z * W + x] && !prop.has(z * W + x)) walls.push([x, z])
    const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_H, 1), mat('#39415f', { roughness: 0.9 }), walls.length)
    walls.forEach(([x, z], i) => wall.setMatrixAt(i, m4.makeTranslation(x + 0.5, WALL_H / 2, z + 0.5)))
    wall.castShadow = wall.receiveShadow = true
    s.add(wall)
    const trim = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.08, 1.02), mat('#8b96c4', { roughness: 0.4 }), walls.length)
    walls.forEach(([x, z], i) => trim.setMatrixAt(i, m4.makeTranslation(x + 0.5, WALL_H, z + 0.5)))
    s.add(trim)
    // Doorways need a floor too.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!doorAt[z * W + x]) continue
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat('#1c2032'))
      f.position.set(x + 0.5, 0.001, z + 0.5)
      f.receiveShadow = true
      s.add(f)
    }

    this.doors = {}
    for (const d of DOORS) {
      const [[x1, z1], [x2, z2]] = d.cells
      const vertical = x1 === x2
      const g = new THREE.Group()
      const leaf = new THREE.Mesh(geo.box, new THREE.MeshStandardMaterial({ color: d.vault ? '#ff3048' : '#ff5a4a', emissive: d.vault ? '#ff1030' : '#ff3020', emissiveIntensity: 0.7, transparent: true, opacity: 0.85 }))
      leaf.scale.set(vertical ? 0.25 : 2, 1.3, vertical ? 2 : 0.25)
      leaf.position.y = 0.65
      const strip = new THREE.Mesh(geo.box, new THREE.MeshBasicMaterial({ color: '#35f0c0' }))
      strip.scale.set(vertical ? 0.2 : 1.9, 0.03, vertical ? 1.9 : 0.2)
      strip.position.y = 0.03
      g.add(leaf, strip)
      g.position.set((x1 + x2) / 2 + 0.5, 0, (z1 + z2) / 2 + 0.5)
      s.add(g)
      this.doors[d.id] = { leaf, strip, open: 0 }
    }

    this.rotors = []
    for (const p of PROPS) {
      const custom = makeProp(p.kind)
      const cx = p.x + p.w / 2, cz = p.z + p.h / 2
      if (custom) {
        custom.position.set(cx, 0, cz)
        s.add(custom)
        if (custom.userData.rotor) this.rotors.push(custom.userData.rotor)
        continue
      }
      const h = p.kind === 'counter' ? 0.8 : p.kind === 'rack' ? 1.7 : 1.25
      const b = add(s, geo.box, mat(PROP_COLOR[p.kind]), [cx, h / 2, cz], [p.w * 0.94, h, p.h * 0.94])
      b.receiveShadow = true
      if (p.kind === 'rack') {
        for (let i = 0; i < Math.max(p.w, p.h) * 2; i++) {
          const along = (i + 0.5) / 2
          add(s, geo.box, new THREE.MeshBasicMaterial({ color: i % 3 ? '#39ff88' : '#ffcf40' }), p.h > p.w ? [p.x + p.w + 0.01, 0.5 + (i % 3) * 0.4, p.z + along] : [p.x + along, 0.5 + (i % 3) * 0.4, p.z + p.h + 0.01], 0.08)
        }
      }
    }
    for (const c of CAGES) {
      const bars = new THREE.Group()
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        add(bars, geo.cyl, mat('#9aa3b8', { metalness: 0.8, roughness: 0.3 }), [Math.cos(a) * 0.75, 0.75, Math.sin(a) * 0.75], [0.04, 1.5, 0.04])
      }
      bars.position.set(c.x, 0, c.z)
      s.add(bars)
    }

    this.genRings = {}
    for (const g of GENERATORS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3cf2ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide }))
      ring.position.set(g.x, 0.04, g.z)
      s.add(ring)
      this.genRings[g.id] = ring
    }
    this.pad = new THREE.Mesh(new THREE.RingGeometry(HELIPAD.r - 0.25, HELIPAD.r, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#8dff9d', transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
    this.pad.position.set(HELIPAD.x, 0.04, HELIPAD.z)
    s.add(this.pad)
    const hLabel = label('H', '#8dff9d', 90)
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: hLabel.material.map, transparent: true, opacity: 0.8 }))
    hp.position.set(HELIPAD.x, 0.05, HELIPAD.z)
    s.add(hp)

    this.beams = Array.from({ length: 4 }, () => {
      const b = new THREE.Mesh(geo.box, new THREE.MeshBasicMaterial({ color: '#ff2a44', transparent: true, opacity: 0.85 }))
      b.visible = false
      s.add(b)
      return b
    })
    // The weapon: a glowing core, with a red dot that wanders like a toy.
    this.coreGroup = new THREE.Group()
    add(this.coreGroup, geo.cyl, mat('#2a2d3c', { metalness: 0.6 }), [0, 0.3, 0], [0.5, 0.6, 0.5])
    this.coreBall = add(this.coreGroup, geo.sphere, new THREE.MeshBasicMaterial({ color: '#ff1a33', toneMapped: false }), [0, 1.1, 0], 0.3)
    this.coreBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 14, 8), new THREE.MeshBasicMaterial({ color: '#ff3048', transparent: true, opacity: 0.45 }))
    this.coreBeam.position.y = 8
    this.coreGroup.add(this.coreBeam)
    this.coreGroup.position.set(CORE.x, 0, CORE.z)
    s.add(this.coreGroup)
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff2038' }))
    this.dot.position.set(21, 0.06, 12)
    s.add(this.dot)
    // Wire the cats drop in on.
    this.wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 12, 6), new THREE.MeshBasicMaterial({ color: '#dfe6ff' }))
    this.wire.visible = false
    s.add(this.wire)
  }

  update(snap, mode, focus) {
    this.prev = this.snap
    this.snap = snap
    this.mode = mode
    this.focus = focus
    const live = new Set()
    for (const c of snap.cats) {
      live.add(c.id)
      let e = this.ents.get(c.id)
      if (!e) {
        e = { obj: makeCat(c.color, c.name), kind: 'cat' }
        e.obj.position.set(c.x, 0, c.z)
        this.scene.add(e.obj)
        this.ents.set(c.id, e)
      }
      e.d = c
    }
    for (const d of snap.dogs) {
      live.add(d.id)
      let e = this.ents.get(d.id)
      if (!e) {
        e = { obj: makeDog(), kind: 'dog' }
        e.obj.position.set(d.x, 0, d.z)
        this.scene.add(e.obj)
        this.ents.set(d.id, e)
      }
      e.d = d
    }
    for (const [id, e] of this.ents) {
      if (live.has(id)) { e.obj.visible = true; continue }
      // Out of sight: forget where it was, so nothing lingers.
      e.obj.visible = false
      e.hidden = true
    }
    for (const f of snap.fx) {
      const key = `${f.kind}${f.t}${f.x}`
      if (this.seenFx.has(key)) continue
      this.seenFx.add(key)
      this.spawnFx(f)
    }
    if (this.seenFx.size > 400) this.seenFx.clear()
  }

  reset() {
    for (const e of this.ents.values()) this.scene.remove(e.obj)
    this.ents.clear()
    this.seenFx.clear()
  }

  spawnFx(f) {
    const g = new THREE.Group()
    g.position.set(f.x, 0, f.z)
    const item = { g, kind: f.kind, age: 0, life: 0.9, f }
    const basic = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide })
    if (f.kind === 'poof' || f.kind === 'net') {
      for (let i = 0; i < 12; i++) {
        const b = new THREE.Mesh(geo.sphere, basic(f.kind === 'net' ? '#ffd76a' : '#f3f0ff', 0.9))
        b.scale.setScalar(0.16)
        b.userData.v = [Math.cos((i / 12) * 6.28) * 2, 1.2 + Math.random() * 1.6, Math.sin((i / 12) * 6.28) * 2]
        b.position.y = 0.7
        g.add(b)
      }
      sfx(f.kind)
    } else if (f.kind === 'claw') {
      for (let i = -1; i <= 1; i++) {
        const b = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 14, 2), basic('#ffffff'))
        b.position.set(0, 0.8 + i * 0.16, 0)
        b.rotation.set(Math.PI / 2, 0, Math.random() * 6)
        g.add(b)
      }
      item.life = 0.28
      sfx('claw')
    } else if (f.kind === 'shot') {
      const len = Math.hypot(f.x2 - f.x, f.z2 - f.z)
      const b = new THREE.Mesh(geo.box, basic('#fff3a0'))
      b.scale.set(len, 0.06, 0.06)
      b.position.set((f.x2 - f.x) / 2, 0.8, (f.z2 - f.z) / 2)
      b.rotation.y = -Math.atan2(f.z2 - f.z, f.x2 - f.x)
      const flash = new THREE.PointLight('#fff0a0', 60, 9)
      flash.position.y = 1
      g.add(b, flash)
      item.life = 0.22
      sfx('shot')
    } else if (f.kind === 'yarn') {
      const b = new THREE.Mesh(geo.sphere, mat(f.color ?? '#ff8fd0'))
      b.scale.setScalar(0.2)
      g.add(b)
      item.life = 1.4
      sfx('yarn')
    } else if (f.kind === 'scuffle') {
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(geo.cone, basic('#ffd23e'))
        b.scale.setScalar(0.18)
        b.userData.v = [Math.cos(i) * 3, 2, Math.sin(i) * 3]
        b.position.y = 1
        g.add(b)
      }
      sfx('scuffle')
    } else if (f.kind === 'alarm' || f.kind === 'camera') {
      const b = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), basic('#ff3048', 0.8))
      b.position.y = 0.1
      g.add(b)
      item.life = 1.2
      sfx('alarm')
    }
    this.scene.add(g)
    this.fx.push(item)
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime
    const s = this.snap
    const k = Math.min(1, dt * 13)

    for (const e of this.ents.values()) {
      if (!e.d || !e.obj.visible) continue
      const o = e.obj, d = e.d, u = o.userData
      if (e.hidden || Math.hypot(o.position.x - d.x, o.position.z - d.z) > 4) { o.position.x = d.x; o.position.z = d.z; e.hidden = false }
      o.position.x += (d.x - o.position.x) * k
      o.position.z += (d.z - o.position.z) * k
      let dr = -d.dir - u.body.rotation.y
      dr = Math.atan2(Math.sin(dr), Math.cos(dr))
      u.body.rotation.y += dr * k
      const sp = d.speed ?? 0
      const step = t * (4 + sp * 3) + u.phase
      const c = Math.cos(u.body.rotation.y), sn = Math.sin(u.body.rotation.y)
      u.feet.forEach((f, i) => {
        const side = i ? -1 : 1
        const swing = sp > 0.1 ? Math.sin(step + i * Math.PI) * 0.22 : 0
        const lx = 0.06 + swing, lz = 0.18 * side
        f.position.set(lx * c + lz * sn, 0.1 + (sp > 0.1 ? Math.max(0, Math.cos(step + i * Math.PI)) * 0.12 : 0), -lx * sn + lz * c)
      })
      u.body.position.y = sp > 0.1 ? Math.abs(Math.sin(step)) * 0.09 : Math.sin(t * 2 + u.phase) * 0.02
      if (e.kind === 'cat') {
        const dead = d.state === 'dead'
        u.body.rotation.z = dead ? Math.PI / 2 : 0
        u.body.position.y = dead ? 0.25 : u.body.position.y - (d.mode === 'sneak' && sp > 0.1 ? 0.12 : 0)
        u.body.scale.y = d.mode === 'sneak' && sp > 0.1 ? 0.85 : 1
        u.eyes.forEach((x) => { x.visible = !dead })
        u.tail.rotation.y = Math.sin(t * 3 + u.phase) * 0.35
        u.core.visible = !!d.carry
        u.ring.visible = d.id === this.focus || !!d.human
        u.horns.visible = !!d.mole
        o.visible = d.state !== 'cut'
        if (d.stun) u.body.rotation.x = Math.sin(t * 40) * 0.12
        else u.body.rotation.x = 0
        if (d.wire > 0) {
          u.body.position.y = 0.9 + Math.sin(t * 5) * 0.08
          this.wire.visible = true
          this.wire.position.set(o.position.x, 7.8, o.position.z)
          this.wireAt = t
        }
      } else {
        const ko = d.state === 'ko'
        u.body.rotation.z = ko ? Math.PI / 2 : 0
        if (ko) u.body.position.y = 0.3
        u.cone.visible = !ko
        u.cone.rotation.z = u.body.rotation.y
        u.cone.material.color.set(d.state === 'chase' ? '#ff3048' : d.state === 'investigate' ? '#ff9a30' : '#ffe9a0')
        u.cone.material.opacity = d.state === 'chase' ? 0.3 : 0.17
        const r = s?.blackout > 0 ? 0.38 : 1
        u.cone.scale.set(r, r, 1)
        u.bang.visible = d.state === 'chase'
        u.zzz.visible = ko
      }
    }
    if (this.wireAt && t - this.wireAt > 0.15) this.wire.visible = false

    for (const f of this.fx) {
      f.age += dt
      const p = f.age / f.life
      f.g.children.forEach((b) => {
        if (b.userData.v) { b.position.x += b.userData.v[0] * dt; b.position.y += b.userData.v[1] * dt; b.position.z += b.userData.v[2] * dt; b.userData.v[1] -= 5 * dt }
        if (b.material && b.material.transparent) b.material.opacity = Math.max(0, 1 - p)
        if (b.isLight) b.intensity = 60 * (1 - p)
      })
      if (f.kind === 'alarm' || f.kind === 'camera') f.g.scale.setScalar(1 + p * 4)
      if (f.kind === 'yarn') {
        const q = Math.min(1, p * 2.2)
        f.g.children[0].position.set((f.f.x2 - f.f.x) * q, 0.25 + Math.sin(q * Math.PI) * 1.6, (f.f.z2 - f.f.z) * q)
      }
    }
    this.fx = this.fx.filter((f) => { if (f.age < f.life) return true; this.scene.remove(f.g); return false })

    if (s) {
      for (const [id, d] of Object.entries(this.doors)) {
        const want = s.locked.includes(id) ? 0 : 1
        d.open += (want - d.open) * Math.min(1, dt * 7)
        d.leaf.position.y = 0.65 - d.open * 1.35
        d.leaf.visible = d.open < 0.97
        d.strip.material.color.set(want ? '#35f0c0' : '#ff3048')
      }
      for (const g of s.gens) {
        const ring = this.genRings[g.id]
        ring.material.color.set(s.vaultOpen ? '#8dff9d' : g.held ? '#ffd23e' : '#3cf2ff')
        ring.scale.setScalar(1 + Math.sin(t * 4) * (g.held ? 0.08 : 0.03))
      }
      this.beams.forEach((b, i) => {
        const l = s.lasers?.[i]
        b.visible = !!l
        if (!l) return
        const [x1, z1, x2, z2] = l
        b.position.set((x1 + x2) / 2, 0.55, (z1 + z2) / 2)
        b.scale.set(Math.max(0.05, x2 - x1), 0.05, Math.max(0.05, z2 - z1))
      })
      const core = s.core
      const onPad = !core.taken
      this.coreBeam.visible = onPad
      this.coreBall.visible = !core.hidden && !core.by
      if (!core.hidden) {
        this.coreBall.position.set(core.taken ? core.x - CORE.x : 0, core.taken ? 0.35 : 1.1 + Math.sin(t * 2) * 0.08, core.taken ? core.z - CORE.z : 0)
      }
      const low = s.timeLeft < 60
      this.coreBeam.material.opacity = low ? 0.5 + Math.sin(t * 12) * 0.3 : 0.35
      this.pad.material.opacity = core.taken ? 0.6 + Math.sin(t * 5) * 0.35 : 0.35
      for (const [id, eye] of Object.entries(this.cams ?? {})) eye.material.color.set(s.camLoop.includes(id) ? '#35f0c0' : '#ff3048')
      const target = s.blackout > 0 ? 0.06 : 1
      this.lightLevel += (target - this.lightLevel) * Math.min(1, dt * 6)
    }
    const L = this.lightLevel
    const red = s && s.phase === 'play' && s.timeLeft < 45 ? 0.5 + Math.sin(t * 5) * 0.5 : 0
    const bright = this.mode === 'runner' ? 1 : 1.5
    for (const { l, base } of Object.values(this.roomLights)) l.intensity = base * L * (this.mode === 'runner' ? 0.75 : 1.25)
    this.hemi.intensity = (this.mode === 'runner' ? 0.38 : 0.75) * (0.25 + 0.75 * L)
    this.moon.intensity = 0.75 * bright * (0.2 + 0.8 * L)
    this.hemi.color.set(red > 0.5 ? '#ff8090' : '#7f92d8')
    this.rotors.forEach((r) => { r.rotation.y += dt * (s?.core?.taken ? 16 : 1.2) })
    // The wandering dot is a joke, and the cats really want it.
    this.dot.position.x = 21 + Math.cos(t * 0.9) * 5.6 + Math.sin(t * 2.3)
    this.dot.position.z = 12 + Math.sin(t * 1.3) * 0.7

    const me = this.focus ? this.ents.get(this.focus) : null
    const portrait = this.camera.aspect < 1
    if (this.mode === 'cine' && s) {
      // Cut to whoever is having the worst night: prey, carrier, chased, mole.
      if (!this.shotUntil || t > this.shotUntil) {
        const drama = (c) => (c.plan?.goal === 'hunt' ? 5 : 0) + (c.carry ? 4 : 0) + (c.wire > 0 ? 6 : 0) + (c.detected > 0.4 ? 3 : 0) + (c.plan?.goal === 'shoot' ? 5 : 0) + Math.random() * 2.5 - (c.state !== 'ok' ? 9 : 0)
        const star = [...s.cats].sort((a, b) => drama(b) - drama(a))[0]
        this.star = star?.id
        this.shotUntil = t + 4.5
        this.angle = Math.random() * 6.28
        this.low = Math.random() < 0.6
        this.cut = true
      }
      const st = this.ents.get(this.star)
      if (st) {
        const p = st.obj.position, a = this.angle + t * 0.12, d = this.low ? 6.2 : 10
        const want = new THREE.Vector3(p.x + Math.cos(a) * d, this.low ? 3.4 : 8.5, p.z + Math.sin(a) * d)
        if (this.cut) { this.camera.position.copy(want); this.look.set(p.x, 1, p.z); this.cut = false }
        this.camera.position.lerp(want, Math.min(1, dt * 3))
        this.look.lerp(new THREE.Vector3(p.x, 1, p.z), Math.min(1, dt * 6))
        this.lamp.position.set(p.x, 2.4, p.z)
        this.lamp.intensity = 10
        this.ents.forEach((e) => { if (e.kind === 'cat') { e.obj.userData.tag.visible = false; e.obj.userData.horns.visible = false; e.obj.userData.ring.visible = false } })
      }
      this.camera.lookAt(this.look)
      this.renderer.render(this.scene, this.camera)
      return
    }
    if (this.mode === 'runner' && me) {
      const p = me.obj.position
      this.look.lerp(new THREE.Vector3(p.x, 0, p.z - 0.5), Math.min(1, dt * 6))
      this.camera.position.lerp(new THREE.Vector3(p.x, portrait ? 20 : 14.5, p.z + (portrait ? 11 : 8.5)), Math.min(1, dt * 5))
      this.lamp.position.set(p.x, 2.2, p.z)
      this.lamp.intensity = s?.blackout > 0 ? 8 : 16
    } else {
      this.lamp.intensity = 0
      const menu = this.mode === 'menu'
      const a = menu ? t * 0.08 : 0
      const dist = portrait ? 62 : menu ? 30 : 33
      const target = menu ? new THREE.Vector3(21 + Math.sin(a) * 14, 20, 16 + Math.cos(a) * 24) : new THREE.Vector3(21, dist, 16 + dist * 0.42)
      this.camera.position.lerp(target, Math.min(1, dt * 2))
      this.look.lerp(new THREE.Vector3(21, 0, 16.5), Math.min(1, dt * 2))
    }
    this.camera.lookAt(this.look)
    this.renderer.render(this.scene, this.camera)
  }
}
