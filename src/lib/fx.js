// The FX pad: synthesized one-shot DJ effects layered over the music via
// Web Audio (the YouTube stream itself can't be processed — but a sample
// pad doesn't touch the music anyway). Designed to be impossible to ruin
// the night with: per-effect cooldowns, short self-resolving sounds, and
// a hard lockout while talkover is ducking the music.

import { useStore, toast } from '../store'
import * as engine from './engine'

let ctx = null
let bus = null

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    ctx = new AC()
    bus = ctx.createGain()
    bus.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  bus.gain.value = Math.max(0, Math.min(1, useStore.getState().settings.fxLevel ?? 0.5))
  return ctx
}

// Create/resume the AudioContext inside a user gesture so later
// DJ-triggered effects are allowed to sound.
export function warmup() {
  try {
    ac()
  } catch {
    /* no audio available — effects just won't sound */
  }
}

const noiseBuffer = (c, seconds) => {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

const env = (c, node, t, { a = 0.01, peak = 0.8, hold = 0, release = 0.2 }) => {
  node.gain.setValueAtTime(0.0001, t)
  node.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + a)
  if (hold > 0) node.gain.setValueAtTime(peak, t + a + hold)
  node.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + release)
}

// ---------------------------------------------------------------- synths

function airHorn() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  const blast = (t, dur) => {
    const g = c.createGain()
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1500
    lp.Q.value = 4
    g.connect(lp).connect(bus)
    for (const det of [0, 9]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(462, t)
      o.frequency.exponentialRampToValueAtTime(396, t + dur)
      o.detune.value = det
      o.connect(g)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
    env(c, g, t, { a: 0.012, peak: 0.7, hold: dur * 0.6, release: dur * 0.4 })
  }
  blast(t0, 0.18)
  blast(t0 + 0.26, 0.18)
  blast(t0 + 0.52, 0.55)
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
  bp.Q.value = 1.1
  bp.frequency.setValueAtTime(150, t0)
  bp.frequency.exponentialRampToValueAtTime(7000, t0 + D)
  const g = c.createGain()
  src.connect(bp).connect(g).connect(bus)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.75, t0 + D)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + D + 0.12)
  src.start(t0)
  src.stop(t0 + D + 0.2)
  // rising tone underneath
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(170, t0)
  o.frequency.exponentialRampToValueAtTime(760, t0 + D)
  const og = c.createGain()
  o.connect(og).connect(bus)
  og.gain.setValueAtTime(0.0001, t0)
  og.gain.exponentialRampToValueAtTime(0.22, t0 + D)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + D + 0.1)
  o.start(t0)
  o.stop(t0 + D + 0.15)
}

function drop() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  // sub thump
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(130, t0)
  o.frequency.exponentialRampToValueAtTime(38, t0 + 0.5)
  const g = c.createGain()
  o.connect(g).connect(bus)
  env(c, g, t0, { a: 0.008, peak: 1.0, hold: 0.12, release: 0.8 })
  o.start(t0)
  o.stop(t0 + 1.1)
  // crack of noise on top
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c, 0.15)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1800
  const ng = c.createGain()
  n.connect(hp).connect(ng).connect(bus)
  env(c, ng, t0, { a: 0.004, peak: 0.5, hold: 0, release: 0.12 })
  n.start(t0)
}

function laser() {
  const c = ac()
  const t0 = c.currentTime + 0.02
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.16
    const o = c.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(2200, t)
    o.frequency.exponentialRampToValueAtTime(180, t + 0.13)
    const g = c.createGain()
    o.connect(g).connect(bus)
    env(c, g, t, { a: 0.005, peak: 0.3, hold: 0, release: 0.12 })
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
  o.frequency.exponentialRampToValueAtTime(28, t0 + 0.85)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2200, t0)
  lp.frequency.exponentialRampToValueAtTime(160, t0 + 0.85)
  const g = c.createGain()
  o.connect(lp).connect(g).connect(bus)
  env(c, g, t0, { a: 0.01, peak: 0.4, hold: 0.4, release: 0.45 })
  o.start(t0)
  o.stop(t0 + 1)
}

// ---------------------------------------------------------------- firing

export const FX_LIST = [
  { id: 'air_horn', icon: '📯', label: 'HORN', hint: 'Triple air horn — celebration peaks' },
  { id: 'riser', icon: '🚀', label: 'RISER', hint: 'Sweep up ~3.5s — press just before a drop or blend' },
  { id: 'drop', icon: '💥', label: 'DROP', hint: 'Sub boom — land it on the transition' },
  { id: 'laser', icon: '⚡', label: 'LASER', hint: 'Three zaps — dancefloor peaks' },
  { id: 'brake', icon: '🌀', label: 'BRAKE', hint: 'Slow the track down and blend into the next' },
]

const COOLDOWN = { air_horn: 8000, riser: 12000, drop: 6000, laser: 8000, brake: 20000 }
const SYNTHS = { air_horn: airHorn, riser, drop, laser }

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
    if (id === 'brake') {
      brakeZip()
      engine.brakeAndBlend()
    } else {
      SYNTHS[id]()
    }
  } catch (e) {
    console.warn('fx failed', e)
    return { ok: false, reason: 'audio unavailable' }
  }
  return { ok: true }
}
