// Cat voices from Runware, cached on disk because radio calls repeat. Only lines
// that were really said in a match can be spoken, and there is a spending cap.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MODEL = 'inworld:tts@1.5-mini'
const VOICES = { ace: 'Vinny', domino: 'Grant', velvet: 'Miranda', boots: 'Hank', sable: 'Pixie', hacker: 'Snik', captain: 'Hades' }
export const ttsStats = { made: 0, cached: 0, failed: 0, ms: 0, lastError: null }
const said = new Set()
const inFlight = new Map()

export const ttsReady = () => !!process.env.RUNWARE_API_KEY && process.env.TTS !== 'off'

export function allowLine(who, text) {
  said.add(`${who}|${text}`)
  if (said.size > 4000) said.delete(said.values().next().value)
}

async function make(who, text, file) {
  if (ttsStats.made >= (+process.env.TTS_CAP || 500)) throw new Error('voice cap reached')
  ttsStats.made++
  const t0 = Date.now()
  const r = await fetch('https://api.runware.ai/v1', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RUNWARE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify([{ taskType: 'audioInference', taskUUID: crypto.randomUUID(), model: MODEL, outputFormat: 'MP3', speech: { text, voice: VOICES[who], speed: who === 'captain' ? 1 : 1.2 } }]),
    signal: AbortSignal.timeout(8000),
  })
  const body = await r.text()
  if (!r.ok) throw new Error(`voice ${r.status}: ${body.slice(0, 200)}`)
  const url = JSON.parse(body).data?.[0]?.audioURL
  if (!url) throw new Error('no audio: ' + body.slice(0, 200))
  const audio = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(8000) })).arrayBuffer())
  fs.writeFileSync(file, audio)
  ttsStats.ms = Date.now() - t0
  return audio
}

export function createTts(dataDir) {
  const dir = path.join(dataDir, 'voices')
  fs.mkdirSync(dir, { recursive: true })
  const get = async (who, text) => {
    const key = crypto.createHash('sha1').update(`${MODEL}|${VOICES[who]}|${text}`).digest('hex')
    const file = path.join(dir, key + '.mp3')
    if (fs.existsSync(file)) { ttsStats.cached++; return fs.readFileSync(file) }
    if (!inFlight.has(key)) inFlight.set(key, make(who, text, file).finally(() => inFlight.delete(key)))
    return inFlight.get(key)
  }
  return {
    get,
    async handle(url, res) {
      const who = url.searchParams.get('who'), text = url.searchParams.get('text') ?? ''
      if (!VOICES[who] || !said.has(`${who}|${text}`) || text.length > 120) { res.statusCode = 404; return res.end() }
      try {
        const audio = await get(who, text)
        res.setHeader('content-type', 'audio/mpeg')
        res.setHeader('cache-control', 'public, max-age=86400')
        res.end(audio)
      } catch (e) {
        ttsStats.failed++
        ttsStats.lastError = e.message
        res.statusCode = 503
        res.end()
      }
    },
  }
}
