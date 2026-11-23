// Compares models on one real decision: node test/llm-probe.mjs model [model...]
import { loadEnv } from '../server/env.js'
loadEnv()
const { Match } = await import('../shared/sim.js')
const { thinkerFor, llmStats, chat } = await import('../server/llm.js')
for (const model of process.argv.slice(2).length ? process.argv.slice(2) : ['minimax:m3@0']) {
  process.env.LLM_MODEL = model
  const m = new Match({ seed: 5, moleId: 'velvet' })
  for (let i = 0; i < 700; i++) m.step(0.05)
  for (const id of ['boots', 'velvet']) {
    const t0 = Date.now()
    const before = llmStats.failed
    const plan = await thinkerFor()(m, m.cat(id), m.cat(id).intent ?? { goal: 'gennorth' })
    console.log(model, id, Date.now() - t0 + 'ms', llmStats.failed > before ? 'FAILED ' + llmStats.lastError : JSON.stringify(plan))
  }
}
