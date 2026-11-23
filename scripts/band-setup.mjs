// Registers one Band agent per character. Run once: node scripts/band-setup.mjs
// Needs BAND_USER_KEY in .env. Saves ids and keys to data/band-agents.json (git-ignored).
import fs from 'node:fs'
import { loadEnv } from '../server/env.js'
import { bandApi } from '../server/band.js'

loadEnv()
const key = process.env.BAND_USER_KEY
if (!key) { console.error('Set BAND_USER_KEY in .env first'); process.exit(1) }
const file = 'data/band-agents.json'
fs.mkdirSync('data', { recursive: true })
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const cast = {
  ace: 'Ace, bold leader of the cat burglar crew', domino: 'Domino, careful and methodical cat burglar',
  velvet: 'Velvet, charming and slippery cat burglar', boots: 'Boots, blunt and loyal cat burglar',
  sable: 'Sable, paranoid and sharp-eyed cat burglar', captain: 'Captain of the guard dogs',
}
for (const [name, description] of Object.entries(cast)) {
  if (out[name]?.key) { console.log(name, 'already registered'); continue }
  const r = await bandApi(key, 'POST', '/me/agents/register', { agent: { name: `NineLies ${name[0].toUpperCase()}${name.slice(1)}`, description } })
  out[name] = { id: r.data.agent.id, key: r.data.credentials.api_key }
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(name, 'registered')
}
