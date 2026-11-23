let ctx = null
export const audio = { on: true, voices: true }

export function unlock() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)()
  ctx.resume?.()
}

function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
  if (!ctx || !audio.on) return
  const t = ctx.currentTime + delay
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur)
}

function noise(dur, vol = 0.15, freq = 1200) {
  if (!ctx || !audio.on) return
  const n = ctx.sampleRate * dur
  const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
  f.type = 'lowpass'
  f.frequency.value = freq
  g.gain.value = vol
  s.buffer = b
  s.connect(f).connect(g).connect(ctx.destination)
  s.start()
}

export function sfx(kind) {
  if (kind === 'claw') { noise(0.12, 0.12, 5000); tone(900, 0.08, 'sawtooth', 0.03, -600) }
  else if (kind === 'shot') { noise(0.35, 0.4, 1800); tone(160, 0.2, 'square', 0.1, -110) }
  else if (kind === 'poof') { noise(0.4, 0.22, 600); tone(300, 0.3, 'triangle', 0.08, -220) }
  else if (kind === 'net') { tone(220, 0.1, 'square', 0.06); tone(150, 0.25, 'square', 0.06, -60, 0.1) }
  else if (kind === 'yarn') tone(500, 0.18, 'sine', 0.06, 400)
  else if (kind === 'scuffle') { noise(0.2, 0.2, 2500); tone(700, 0.15, 'sawtooth', 0.05, -400) }
  else if (kind === 'alarm') { tone(660, 0.14, 'square', 0.04); tone(520, 0.14, 'square', 0.04, 0, 0.16) }
  else if (kind === 'radio') { tone(1250, 0.04, 'square', 0.025); tone(1650, 0.05, 'square', 0.025, 0, 0.05) }
  else if (kind === 'vote') { tone(440, 0.15, 'triangle', 0.09); tone(330, 0.3, 'triangle', 0.09, 0, 0.15) }
  else if (kind === 'vault') [392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, 0, i * 0.1))
  else if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, 0, i * 0.12))
  else if (kind === 'lose') [392, 349, 311, 233].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.05, 0, i * 0.18))
  else if (kind === 'heart') { tone(70, 0.12, 'sine', 0.2); tone(60, 0.14, 'sine', 0.16, 0, 0.18) }
}

// A distinct voice for each cat. Server voices first, browser speech as backup.
const PITCH = { ace: 1.1, domino: 0.9, velvet: 1.45, boots: 0.65, sable: 1.2, hacker: 1 }
const RATE = { ace: 1.2, domino: 1.15, velvet: 1.25, boots: 1.1, sable: 1.4, hacker: 1.2 }
let queue = Promise.resolve()
let queued = 0
export function speak(who, text, useServer, base = '') {
  if (!audio.on || !audio.voices || queued > 2) return
  queued++
  queue = queue.then(() => (useServer ? serverVoice(who, text, base) : Promise.reject()).catch(() => browserVoice(who, text))).finally(() => { queued-- })
}

function serverVoice(who, text, base) {
  return new Promise((ok, fail) => {
    const a = new Audio(`${base}/api/tts?who=${who}&text=${encodeURIComponent(text)}`)
    a.onended = ok
    a.onerror = fail
    a.play().catch(fail)
    setTimeout(ok, 4000)
  })
}

function browserVoice(who, text) {
  return new Promise((ok) => {
    if (!window.speechSynthesis) return ok()
    const u = new SpeechSynthesisUtterance(text)
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
    const i = Object.keys(PITCH).indexOf(who)
    if (vs.length) u.voice = vs[Math.max(0, i) % vs.length]
    u.pitch = PITCH[who] ?? 1
    u.rate = RATE[who] ?? 1.2
    u.volume = 0.8
    u.onend = u.onerror = ok
    speechSynthesis.speak(u)
    setTimeout(ok, 3500)
  })
}
