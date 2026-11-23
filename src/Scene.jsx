import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ARENA, step } from './game.js'

const KEYS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
}

export default function Scene({ game, running, onTick }) {
  const players = useRef([])
  const crystals = useRef([])
  const held = useRef(new Set())
  const pointer = useRef(null)

  useEffect(() => {
    const down = (e) => {
      if (!KEYS[e.code]) return
      e.preventDefault()
      pointer.current = null
      held.current.add(e.code)
    }
    const up = (e) => held.current.delete(e.code)
    const release = () => { pointer.current = null }
    const clear = () => {
      held.current.clear()
      release()
    }
    const listeners = [
      ['keydown', down], ['keyup', up], ['blur', clear],
      ['pointerup', release], ['pointercancel', release],
    ]
    listeners.forEach(([type, fn]) => window.addEventListener(type, fn))
    return () => listeners.forEach(([type, fn]) => window.removeEventListener(type, fn))
  }, [])

  useFrame(({ clock }, delta) => {
    if (running) {
      const input = { x: 0, z: 0 }
      for (const code of held.current) {
        input.x += KEYS[code][0]
        input.z += KEYS[code][1]
      }
      if (pointer.current) {
        const dx = pointer.current.x - game.players[0].x
        const dz = pointer.current.z - game.players[0].z
        if (Math.hypot(dx, dz) > 0.2) Object.assign(input, { x: dx, z: dz })
      }
      // Cap the step so a background tab doesn't jump ahead.
      step(game, input, Math.min(delta, 0.05))
      onTick()
    }

    const t = clock.elapsedTime
    game.players.forEach((p, i) => {
      players.current[i]?.position.set(p.x, 0.6 + Math.sin(t * 4 + i) * 0.06, p.z)
    })
    game.crystals.forEach((c, i) => {
      const mesh = crystals.current[i]
      if (!mesh) return
      mesh.position.set(c.x, 0.7 + Math.sin(t * 2 + i) * 0.12, c.z)
      mesh.rotation.y = t + i
      mesh.scale.setScalar(c.value === 3 ? 0.6 : 0.35)
      mesh.material.color.set(c.value === 3 ? '#ff9f1c' : '#e0e7ff')
    })
  })

  const aim = (e) => { pointer.current = { x: e.point.x, z: e.point.z } }

  return (
    <>
      <color attach="background" args={['#14171f']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 14, 8]} intensity={2} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-16, 16, 16, -16, 1, 40]} />
      </directionalLight>

      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onPointerDown={aim}
        onPointerMove={(e) => { if (pointer.current) aim(e) }}
      >
        <planeGeometry args={[ARENA * 2 + 2, ARENA * 2 + 2]} />
        <meshStandardMaterial color="#262c3a" />
      </mesh>
      <gridHelper args={[ARENA * 2 + 2, 12, '#46506a', '#343c50']} position-y={0.01} />

      {game.players.map((p, i) => (
        <mesh key={p.id} ref={(m) => { players.current[i] = m }} castShadow raycast={() => null}>
          {i === 0 ? <sphereGeometry args={[0.6, 32, 16]} /> : <boxGeometry args={[0.95, 0.95, 0.95]} />}
          <meshStandardMaterial color={p.color} roughness={0.4} />
        </mesh>
      ))}

      {game.crystals.map((c, i) => (
        <mesh key={c.id} ref={(m) => { crystals.current[i] = m }} castShadow raycast={() => null}>
          <octahedronGeometry />
          <meshStandardMaterial roughness={0.2} flatShading />
        </mesh>
      ))}
    </>
  )
}
