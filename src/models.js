import * as THREE from 'three'

// Everything is built from primitives, so there are no asset downloads.
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...o })
const geo = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  capsule: new THREE.CapsuleGeometry(0.3, 0.34, 6, 14),
  cone: new THREE.ConeGeometry(1, 1, 12),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
}
const add = (parent, g, m, pos, scale, rot) => {
  const o = new THREE.Mesh(g, m)
  o.position.set(...pos)
  if (scale) o.scale.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]))
  if (rot) o.rotation.set(...rot)
  o.castShadow = true
  parent.add(o)
  return o
}

export function label(text, color = '#fff', size = 46) {
  const c = document.createElement('canvas')
  const x = c.getContext('2d')
  const font = `800 ${size}px Trebuchet MS, system-ui, sans-serif`
  x.font = font
  c.width = Math.ceil(x.measureText(text).width) + 28
  c.height = size + 26
  x.font = font
  x.textBaseline = 'middle'
  x.lineWidth = 9
  x.lineJoin = 'round'
  x.strokeStyle = '#0a0c16'
  x.strokeText(text, 14, c.height / 2)
  x.fillStyle = color
  x.fillText(text, 14, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  s.scale.set((c.width / c.height) * 0.62, 0.62, 1)
  s.renderOrder = 10
  return s
}

// A cat in a tuxedo and a ninja mask. Faces +x.
export function makeCat(color, name) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const fur = mat(color)
  const suit = mat('#171a26', { roughness: 0.55 })
  const white = mat('#f4f1e8')
  const dark = mat('#07080d')
  add(body, geo.capsule, suit, [0, 0.55, 0], [1, 1, 1.05])
  add(body, geo.sphere, white, [0.2, 0.62, 0], [0.13, 0.22, 0.16])
  const tie = mat(color, { emissive: color, emissiveIntensity: 0.35 })
  add(body, geo.cone, tie, [0.33, 0.82, 0.075], [0.07, 0.13, 0.05], [Math.PI / 2, 0, 0])
  add(body, geo.cone, tie, [0.33, 0.82, -0.075], [0.07, 0.13, 0.05], [-Math.PI / 2, 0, 0])
  const head = new THREE.Group()
  head.position.set(0.04, 1.18, 0)
  body.add(head)
  add(head, geo.sphere, fur, [0, 0, 0], [0.37, 0.33, 0.39])
  for (const s of [1, -1]) {
    add(head, geo.cone, fur, [-0.02, 0.33, 0.21 * s], [0.13, 0.26, 0.13], [0.28 * s, 0, 0])
    add(head, geo.cone, mat('#ffb7c5'), [0.03, 0.31, 0.21 * s], [0.07, 0.16, 0.07], [0.28 * s, 0, 0])
  }
  add(head, geo.sphere, dark, [0.06, 0.06, 0], [0.335, 0.125, 0.385])
  const eye = new THREE.MeshStandardMaterial({ color: '#eaffd0', emissive: '#c8ff7a', emissiveIntensity: 1.6 })
  const eyes = [1, -1].map((s) => add(head, geo.sphere, eye, [0.35, 0.07, 0.14 * s], [0.06, 0.075, 0.075]))
  add(head, geo.sphere, mat('#ff8fa8'), [0.37, -0.06, 0], [0.04, 0.03, 0.05])
  add(head, geo.sphere, white, [0.3, -0.11, 0], [0.1, 0.07, 0.13])
  for (const s of [1, -1]) add(head, geo.box, dark, [-0.36, 0.05, 0.1 * s], [0.22, 0.05, 0.07], [0, 0.3 * s, -0.5])
  const feet = [1, -1].map((s) => add(root, geo.sphere, fur, [0.06, 0.1, 0.17 * s], [0.17, 0.11, 0.12]))
  const hands = [1, -1].map((s) => add(body, geo.sphere, fur, [0.16, 0.55, 0.37 * s], [0.12, 0.12, 0.12]))
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.25, 0.35, 0), new THREE.Vector3(-0.6, 0.35, 0), new THREE.Vector3(-0.75, 0.75, 0), new THREE.Vector3(-0.62, 1.05, 0)])
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.075, 8), fur)
  tail.castShadow = true
  body.add(tail)
  const core = new THREE.Mesh(geo.sphere, new THREE.MeshStandardMaterial({ color: '#ff3048', emissive: '#ff1030', emissiveIntensity: 3 }))
  core.scale.setScalar(0.2)
  core.position.set(0.1, 1.85, 0)
  core.visible = false
  body.add(core)
  const tag = label(name, color)
  tag.position.y = 2.15
  root.add(tag)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.visible = false
  root.add(ring)
  const horns = new THREE.Group()
  for (const s of [1, -1]) add(horns, geo.cone, new THREE.MeshBasicMaterial({ color: '#ff3048' }), [0, 1.62, 0.16 * s], [0.07, 0.24, 0.07])
  horns.visible = false
  body.add(horns)
  root.userData = { body, head, feet, hands, tail, eyes, core, tag, ring, horns, phase: Math.random() * 9 }
  return root
}

// A guard dog in a vest and shades, with a torch beam. Faces +x.
export function makeDog() {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const fur = mat('#8a5a38')
  const vest = mat('#7d1d2b')
  const dark = mat('#0c0d14')
  add(body, new THREE.CapsuleGeometry(0.4, 0.4, 6, 14), vest, [0, 0.72, 0])
  add(body, geo.box, mat('#d8b24a', { metalness: 0.6, roughness: 0.3 }), [0.37, 0.85, 0.16], [0.06, 0.14, 0.14])
  const head = new THREE.Group()
  head.position.set(0.1, 1.45, 0)
  body.add(head)
  add(head, geo.sphere, fur, [0, 0, 0], [0.4, 0.36, 0.38])
  add(head, geo.box, fur, [0.42, -0.1, 0], [0.4, 0.22, 0.28])
  add(head, geo.sphere, dark, [0.63, -0.04, 0], [0.08, 0.07, 0.1])
  for (const s of [1, -1]) {
    add(head, geo.sphere, mat('#5d3a22'), [-0.05, 0.02, 0.4 * s], [0.14, 0.3, 0.08], [0.2 * s, 0, 0.1])
    add(head, geo.box, dark, [0.36, 0.11, 0.15 * s], [0.08, 0.13, 0.2])
  }
  add(head, geo.cyl, dark, [0, 0.34, 0], [0.34, 0.12, 0.34])
  add(head, geo.cyl, dark, [0.18, 0.29, 0], [0.34, 0.03, 0.34])
  const feet = [1, -1].map((s) => add(root, geo.sphere, fur, [0.06, 0.12, 0.2 * s], [0.2, 0.13, 0.15]))
  add(body, geo.capsule, fur, [-0.45, 0.6, 0], [0.22, 0.5, 0.22], [0, 0, 0.9])
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  const R = 5.4
  for (let i = -12; i <= 12; i++) shape.lineTo(Math.cos((i / 12) * 0.62) * R, Math.sin((i / 12) * 0.62) * R)
  shape.closePath()
  const cone = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }))
  cone.rotation.x = -Math.PI / 2
  cone.position.y = 0.05
  root.add(cone)
  const bang = label('!', '#ff3048', 80)
  bang.position.y = 2.4
  bang.visible = false
  root.add(bang)
  const zzz = label('zzz', '#9fd0ff', 46)
  zzz.position.y = 1.4
  zzz.visible = false
  root.add(zzz)
  root.userData = { body, head, feet, cone, bang, zzz, phase: Math.random() * 9 }
  return root
}

export function makeProp(kind) {
  const g = new THREE.Group()
  const M = { crate: '#6a543a', counter: '#b9b2a6', fridge: '#93a4b8', rack: '#1c2430', pedestal: '#c9c3b4' }
  if (kind === 'generator') {
    add(g, geo.box, mat('#2c4650', { metalness: 0.5, roughness: 0.4 }), [0, 0.8, 0], [2.8, 1.6, 1.8])
    for (const x of [-0.8, 0, 0.8]) add(g, geo.cyl, new THREE.MeshStandardMaterial({ color: '#3cf2ff', emissive: '#18c8e0', emissiveIntensity: 1.4 }), [x, 1.75, 0], [0.22, 0.5, 0.22])
  } else if (kind === 'helicopter') {
    const m = mat('#2d5a3d')
    add(g, geo.sphere, m, [0, 0.9, 0], [1.1, 0.75, 0.75])
    add(g, geo.sphere, mat('#9fe0ff', { roughness: 0.1 }), [0.6, 1, 0], [0.6, 0.5, 0.55])
    add(g, geo.box, m, [-1.4, 1, 0], [1.6, 0.2, 0.2])
    add(g, geo.box, m, [-2.1, 1.3, 0], [0.2, 0.7, 0.1])
    const rotor = new THREE.Group()
    rotor.position.y = 1.8
    add(rotor, geo.box, mat('#111'), [0, 0, 0], [4, 0.05, 0.18])
    add(rotor, geo.box, mat('#111'), [0, 0, 0], [0.18, 0.05, 4])
    g.add(rotor)
    g.userData.rotor = rotor
  } else if (kind === 'rack') {
    return null
  } else if (kind === 'pedestal') {
    add(g, geo.cyl, mat(M.pedestal), [0, 0.45, 0], [0.36, 0.9, 0.36])
    add(g, geo.sphere, mat('#ffd76a', { metalness: 0.9, roughness: 0.2, emissive: '#a06a00', emissiveIntensity: 0.25 }), [0, 1.15, 0], [0.22, 0.28, 0.22])
  } else return null
  return g
}

export const PROP_COLOR = { crate: '#6a543a', counter: '#b9b2a6', fridge: '#93a4b8', rack: '#1c2430' }
export { mat, geo, add }
