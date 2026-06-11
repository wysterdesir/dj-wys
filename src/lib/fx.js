// The FX pad: one-shot DJ effects layered over the music via Web Audio.
// Everything runs through a shared "space" chain — saturation, a generated
// impulse-response reverb, and a feedback echo — because dry oscillators
// sound like a doorbell and wet ones sound like a club.
//
// Want the real thing? Drop royalty-free recordings into public/fx/ named
// air_horn.mp3, riser.mp3, drop.mp3, laser.mp3, brake.mp3 — they're
// prefetched at warmup and automatically replace the synthesized versions.

import { useStore, toast } from '../store'
import * as engine from './engine'

let ctx = null
let master = null // final gain (fx volume)
let sat = null // gentle saturation before output
let dryIn = null // direct path
let revIn = null // reverb send
let dlyIn = null // echo send

function satCurve(k = 2.5) {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

function impulseResponse(c, seconds = 1.9, decay = 2.4) {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    ctx = new AC()

    master = ctx.createGain()
    master.connect(ctx.destination)

    sat = ctx.createWaveShaper()
    sat.curve = satCurve(2.5)
    sat.oversample = '2x'
    sat.connect(master)

    dryIn = ctx.createGain()
    dryIn.gain.value = 0.9
    dryIn.connect(sat)

    // reverb send → convolver with a generated hall
    const conv = ctx.createConvolver()
    conv.buffer = impulseResponse(ctx)
    revIn = ctx.createGain()
    revIn.gain.value = 1
    revIn.connect(conv)
    conv.connect(sat)

    // echo send → feedback delay with damping
    const delay = ctx.createDelay(1.5)
    delay.delayTime.value = 0.27
    const fb = ctx.createGain()
    fb.gain.value = 0.38
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2600
    dlyIn = ctx.createGain()
    dlyIn.gain.value = 1
    dlyIn.connect(delay)
    delay.connect(damp)
    damp.connect(fb)
    fb.connect(delay)
    damp.connect(sat)
  }
  if (ctx.state === 'suspended') ctx.resume()
  master.gain.value = Math.max(0, Math.min(1, useStore.getState().settings.fxLevel ?? 0.5))
  return ctx
}

// route a node into the space: full dry + optional reverb/echo send levels
function route(c, node, { rev = 0, dly = 0 } = {}) {
  node.connect(dryIn)
  if (rev > 0) {
    const g = c.createGain()
    g.gain.value = rev
    node.connect(g)
    g.connect(revIn)
  }
  if (dly > 0) {
    const g = c.createGain()
    g.gain.value = dly
    node.connect(g)
    g.connect(dlyIn)
  }
}

const noiseBuffer = (c, seconds) => {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

const env = (node, t, { a = 0.01, peak = 0.8, hold = 0, release = 0.2 }) => {
  node.gain.setValueAtTime(0.0001, t)
  node.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + a)
  if (hold > 0) node.gain.setValueAtTime(peak, t + a + hold)
  node.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + release)
}

// ---------------------------------------------------------------- synths

function airHorn() {
  const c = ac()
  const t0 = c.currentTime + 0.02

  const blast = (t, dur, final) => {
    const g = c.createGain()
    // formant pair gives it the "horn throat" instead of a flat buzz
    const f1 = c.createBiquadFilter()
    f1.type = 'bandpass'
    f1.frequency.value = 520
    f1.Q.value = 2.2
    const f2 = c.createBiquadFilter()
    f2.type = 'bandpass'
    f2.frequency.value = 1350
    f2.Q.value = 3
    const sum = c.createGain()
    g.connect(f1)
    g.connect(f2)
    f1.connect(sum)
    f2.connect(sum)
    sum.gain.value = 1.4
    route(c, sum, { rev: 0.45, dly: final ? 0.5 : 0.12 })

    // vibrato shared by the stack
    const lfo = c.createOscillator()
    lfo.frequency.value = 6.2
    const lfoG = c.createGain()
    lfoG.gain.value = 5
    lfo.connect(lfoG)
    lfo.start(t)
    lfo.stop(t + dur + 0.1)

    // detuned saw ensemble + a growling sub square
    for (const det of [-14, -6, 0, 7, 15]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(458, t)
      o.frequency.exponentialRampToValueAtTime(final ? 372 : 405, t + dur)
      o.detune.value = det
      lfoG.connect(o.frequency)
      o.connect(g)
      o.start(t)
      o.stop(t + dur + 0.08)
    }
    const subO = c.createOscillator()
    subO.type = 'square'
    subO.frequency.setValueAtTime(229, t)
    subO.frequency.exponentialRampToValueAtTime(final ? 186 : 202, t + dur)
    const subG = c.createGain()
    subG.gain.value = 0.3
    subO.connect(subG)
    subG.connect(g)
    subO.start(t)
    subO.stop(t + dur + 0.08)

    env(g, t, { a: 0.012, peak: 0.62, hold: dur * 0.65, release: final ? 0.5 : dur * 0.35 })
  }

  blast(t0, 0.17, false)
  blast(t0 + 0.25, 0.17, false)
  blast(t0 + 0.5, 0.62, true)
}

function riser() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  const D = 3.4

  // noise sweep
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, D + 0.3)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.0
  bp.frequency.setValueAtTime(160, t0)
  bp.frequency.exponentialRampToValueAtTime(7800, t0 + D)
  const ng = c.createGain()
  src.connect(bp)
  bp.connect(ng)
  route(c, ng, { rev: 0.4 })
  ng.gain.setValueAtTime(0.0001, t0)
  ng.gain.exponentialRampToValueAtTime(0.7, t0 + D)
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + D + 0.1)
  src.start(t0)
  src.stop(t0 + D + 0.2)

  // detuned saw pair climbing an octave through an opening filter,
  // with a tremolo that accelerates into the top — the "hold on" feel
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(350, t0)
  lp.frequency.exponentialRampToValueAtTime(6500, t0 + D)
  const trem = c.createGain()
  lp.connect(trem)
  route(c, trem, { rev: 0.45, dly: 0.15 })
  const tremLfo = c.createOscillator()
  tremLfo.frequency.setValueAtTime(4, t0)
  tremLfo.frequency.exponentialRampToValueAtTime(15, t0 + D)
  const tremDepth = c.createGain()
  tremDepth.gain.value = 0.4
  tremLfo.connect(tremDepth)
  tremDepth.connect(trem.gain)
  trem.gain.value = 0.0001
  trem.gain.setValueAtTime(0.0001, t0)
  trem.gain.exponentialRampToValueAtTime(0.5, t0 + D)
  trem.gain.exponentialRampToValueAtTime(0.0001, t0 + D + 0.1)
  tremLfo.start(t0)
  tremLfo.stop(t0 + D + 0.1)
  for (const det of [-8, 7]) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(116, t0)
    o.frequency.exponentialRampToValueAtTime(232, t0 + D)
    o.detune.value = det
    o.connect(lp)
    o.start(t0)
    o.stop(t0 + D + 0.15)
  }
}

function drop() {
  const c = ac()
  const t0 = c.currentTime + 0.02

  // saturated sub thump
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, t0)
  o.frequency.exponentialRampToValueAtTime(36, t0 + 0.5)
  const g = c.createGain()
  o.connect(g)
  route(c, g, { rev: 0.5 })
  env(g, t0, { a: 0.006, peak: 1.15, hold: 0.14, release: 0.85 })
  o.start(t0)
  o.stop(t0 + 1.2)

  // downward whoosh
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c, 0.6)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(6000, t0)
  lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.5)
  const ng = c.createGain()
  n.connect(lp)
  lp.connect(ng)
  route(c, ng, { rev: 0.4 })
  env(ng, t0, { a: 0.005, peak: 0.45, hold: 0.05, release: 0.45 })
  n.start(t0)

  // crack on top
  const k = c.createBufferSource()
  k.buffer = noiseBuffer(c, 0.12)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2000
  const kg = c.createGain()
  k.connect(hp)
  hp.connect(kg)
  route(c, kg, { rev: 0.6 })
  env(kg, t0, { a: 0.003, peak: 0.5, hold: 0, release: 0.1 })
  k.start(t0)
}

function laser() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.16
    const o = c.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(2400, t)
    o.frequency.exponentialRampToValueAtTime(160, t + 0.13)
    const g = c.createGain()
    o.connect(g)
    // heavy echo send → trailing pew-pew-pew
    route(c, g, { rev: 0.15, dly: 0.55 })
    env(g, t, { a: 0.004, peak: 0.28, hold: 0, release: 0.11 })
    o.start(t)
    o.stop(t + 0.2)
  }
}

function brakeZip() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(320, t0)
  o.frequency.exponentialRampToValueAtTime(26, t0 + 0.85)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2400, t0)
  lp.frequency.exponentialRampToValueAtTime(140, t0 + 0.85)
  const g = c.createGain()
  o.connect(lp)
  lp.connect(g)
  route(c, g, { rev: 0.35, dly: 0.2 })
  env(g, t0, { a: 0.01, peak: 0.42, hold: 0.4, release: 0.45 })
  o.start(t0)
  o.stop(t0 + 1)
}

// ------------------------------------------------- sample overrides

// public/fx/<id>.mp3 beats the synth. Prefetched at warmup so firing is
// instant; misses are remembered and silently fall back to synthesis.
const samples = {} // id → AudioBuffer | 'miss' | Promise

function loadSample(id) {
  if (samples[id]) return
  samples[id] = fetch(`${import.meta.env.BASE_URL}fx/${id}.mp3`)
    .then((r) => {
      if (!r.ok) throw new Error('no sample')
      return r.arrayBuffer()
    })
    .then((ab) => ac().decodeAudioData(ab))
    .then((buf) => {
      samples[id] = buf
    })
    .catch(() => {
      samples[id] = 'miss'
    })
}

function playSample(buf) {
  const c = ac()
  const src = c.createBufferSource()
  src.buffer = buf
  const g = c.createGain()
  g.gain.value = 0.9
  src.connect(g)
  route(c, g, { rev: 0.12 })
  src.start(c.currentTime + 0.02)
}

// Create/resume the AudioContext inside a user gesture (so later
// DJ-triggered effects may sound) and prefetch any custom samples.
export function warmup() {
  try {
    ac()
    FX_LIST.forEach((f) => loadSample(f.id))
  } catch {
    /* no audio available */
  }
}

// ---------------------------------------------------------------- firing

export const FX_LIST = [
  { id: 'air_horn', icon: '📯', label: 'HORN', color: '#fbbf24', hint: 'Triple air horn — celebration peaks' },
  { id: 'riser', icon: '🚀', label: 'RISER', color: '#22d3ee', hint: 'Sweep up ~3.5s — press just before a drop or blend' },
  { id: 'drop', icon: '💥', label: 'DROP', color: '#ef4444', hint: 'Sub boom — land it on the transition' },
  { id: 'laser', icon: '⚡', label: 'LASER', color: '#34d399', hint: 'Three zaps with echo — dancefloor peaks' },
  { id: 'brake', icon: '🌀', label: 'BRAKE', color: '#a78bfa', hint: 'Slow the track down and blend into the next' },
]

const COOLDOWN = { air_horn: 8000, riser: 12000, drop: 6000, laser: 8000, brake: 20000 }
const SYNTHS = { air_horn: airHorn, riser, drop, laser, brake: brakeZip }

export function fire(id) {
  const s = useStore.getState()
  if (!COOLDOWN[id]) return { ok: false, reason: `unknown effect "${id}"` }
  if (s.ducked) return { ok: false, reason: 'talkover is on — no effects over speech' }
  const until = s.fxCooldowns[id] || 0
  if (Date.now() < until) {
    return { ok: false, reason: 'cooling down', waitMs: until - Date.now() }
  }
  if (id === 'brake' && s.decks[s.active].state !== 'playing') {
    return { ok: false, reason: 'nothing is playing to brake' }
  }
  useStore.setState({ fxCooldowns: { ...s.fxCooldowns, [id]: Date.now() + COOLDOWN[id] } })
  try {
    const buf = samples[id]
    if (buf && buf !== 'miss' && typeof buf.then !== 'function') {
      playSample(buf) // custom recording wins
    } else {
      SYNTHS[id]()
    }
    if (id === 'brake') engine.brakeAndBlend()
  } catch (e) {
    console.warn('fx failed', e)
    return { ok: false, reason: 'audio unavailable' }
  }
  return { ok: true }
}
