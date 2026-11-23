import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { createGame } from './game.js'

const readHud = (game) => ({
  time: Math.ceil(game.timeLeft),
  scores: game.players.map((p) => p.score),
})
const sameHud = (a, b) => a.time === b.time && a.scores.every((s, i) => s === b.scores[i])

export default function App() {
  const [game, setGame] = useState(createGame)
  const [running, setRunning] = useState(false)
  const [hud, setHud] = useState(() => readHud(game))

  const start = () => {
    const next = createGame()
    setGame(next)
    setHud(readHud(next))
    setRunning(true)
  }

  const onTick = () => {
    const next = readHud(game)
    // Returning the old value skips the re-render when nothing changed.
    setHud((prev) => (sameHud(prev, next) ? prev : next))
    if (game.timeLeft <= 0) setRunning(false)
  }

  const finished = !running && hud.time === 0
  const top = Math.max(...hud.scores)
  const winners = game.players.filter((_, i) => hud.scores[i] === top).map((p) => p.name)
  const result =
    winners.length > 1 ? `Tie: ${winners.join(', ')}` : winners[0] === 'You' ? 'You win!' : `${winners[0]} wins`

  return (
    <>
      <Canvas shadows camera={{ position: [0, 19, 17], fov: 48 }}>
        <Scene game={game} running={running} onTick={onTick} />
      </Canvas>

      <div className="hud">
        <strong className="time">{hud.time}s</strong>
        {game.players.map((p, i) => (
          <span key={p.id}>
            <i style={{ background: p.color }} />
            {p.name} {hud.scores[i]}
          </span>
        ))}
      </div>

      {!running && (
        <div className="panel">
          <h1>{finished ? result : 'Multi-AI Game'}</h1>
          <p>
            Collect more crystals than three AI rivals. Big orange ones are worth 3.
            <br />
            Move with WASD or the arrow keys, or hold and drag.
          </p>
          <button type="button" onClick={start}>{finished ? 'Play again' : 'Start'}</button>
        </div>
      )}
    </>
  )
}
