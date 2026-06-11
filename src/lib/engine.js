// The conductor: owns the two YouTube players, runs the auto-DJ ticker,
// executes crossfades, and mutates the zustand store. UI components call
// these functions; they never touch the players directly.

import { useStore, emptyDeck, toast, uid } from '../store'
import { createPlayer, safe, YTState } from './youtube'
import { acquireWakeLock, releaseWakeLock } from './wakelock'

const players = { A: null, B: null }
let ticker = null
const primed = { A: false, B: false } // deck iframes blessed for autoplay

// ---- background-safe animation pump ------------------------------------
// rAF freezes in hidden tabs, so every fade is a time-based stepper pumped
// from BOTH a rAF loop (smooth when visible) and the 400ms engine tick
// (keeps crossfades completing when the tab is backgrounded mid-party —
// audible tabs are exempt from deep timer throttling).
const anims = new Set()
let animRaf = null
function pumpAnims() {
  if (anims.size === 0) return
  const now = performance.now()
  for (const fn of [...anims]) {
    if (fn(now)) anims.delete(fn)
  }
}
function addAnim(fn) {
  anims.add(fn)
  if (!animRaf) {
    const loop = () => {
      pumpAnims()
      animRaf = anims.size ? requestAnimationFrame(loop) : null
    }
    animRaf = requestAnimationFrame(loop)
  }
  return fn
}
let lastRefillAt = 0
let refillErrorUntil = 0
const cuedFor = { A: null, B: null } // videoId pre-buffered on a deck
const watch = { A: { p: -1, at: 0 }, B: { p: -1, at: 0 } } // stall watchdog
let duckLevel = 1 // 1 = full, ~0.18 = talkover
let duckStepper = null
export const getDuckLevel = () => duckLevel

const S = () => useStore.getState()
const set = useStore.setState
export const other = (d) => (d === 'A' ? 'B' : 'A')

// ------------------------------------------------------------- mix points

// Where the actual song starts (skip cinematic video intros). DJ-supplied.
export function startAtOf(track) {
  const sa = Math.round(track?.startAt || 0)
  if (sa <= 0 || sa > 60) return 0
  if (track?.durationSec && sa > track.durationSec * 0.25) return 0
  return sa
}

// Where the blend to the next track should begin (before outros/credits).
export function mixOutPoint(track, duration) {
  const fo = Math.round(track?.fadeOutAt || 0)
  if (
    duration > 0 &&
    fo > startAtOf(track) + 45 &&
    fo <= duration &&
    fo >= duration * 0.5
  ) {
    return fo
  }
  return duration
}

// ---------------------------------------------------------------- players

export async function attachDeck(deck, elementId) {
  if (players[deck]) return players[deck]
  players[deck] = await createPlayer(elementId, {
    onStateChange: (e) => onStateChange(deck, e.data),
    onError: (e) => onPlayerError(deck, e.data),
  })
  applyVolumes()
  startTicker()
  return players[deck]
}

function onStateChange(deck, ytState) {
  const map = {
    [YTState.PLAYING]: 'playing',
    [YTState.PAUSED]: 'paused',
    [YTState.ENDED]: 'ended',
    [YTState.BUFFERING]: 'loading',
  }
  const next = map[ytState]
  if (!next) return
  set((s) => ({ decks: { ...s.decks, [deck]: { ...s.decks[deck], state: s.decks[deck].track ? next : 'empty' } } }))
  if (ytState === YTState.PLAYING) {
    primed[deck] = true // it played — the iframe is trusted from here on
    set({ needsTap: false })
    if (S().settings.wakeLock) acquireWakeLock()
    // pick up the real duration once known
    const dur = safe(players[deck], 'getDuration')
    if (dur > 0) {
      set((s) => ({ decks: { ...s.decks, [deck]: { ...s.decks[deck], duration: dur } } }))
    }
  }
  if (ytState === YTState.ENDED && deck === S().active) {
    // song ran out (e.g. queue was empty during the outro)
    if (S().queue.length > 0) beginTransition({ fade: 1.2 })
    else releaseWakeLock()
  }
}

function onPlayerError(deck, code) {
  const s = S()
  const d = s.decks[deck]
  if (!d.track) return
  console.warn(`[deck ${deck}] player error ${code} on`, d.track.title)
  const candidates = d.track.candidates || []
  const idx = candidates.indexOf(d.track.videoId)
  const nextId = candidates[idx + 1]
  if (nextId) {
    // try the next search candidate for the same track
    toast(`"${d.track.title}" blocked — trying another upload`)
    const track = { ...d.track, videoId: nextId }
    set((st) => ({ decks: { ...st.decks, [deck]: { ...st.decks[deck], track } } }))
    safe(players[deck], 'loadVideoById', nextId)
  } else {
    toast(`"${d.track.title}" can't be played — skipping`)
    if (deck === s.active && s.queue.length > 0) beginTransition({ fade: 1 })
    else if (deck === s.active) {
      set((st) => ({ decks: { ...st.decks, [deck]: emptyDeck() } }))
    }
  }
}

// ---------------------------------------------------------------- volumes

// Equal-power crossfade: A fades on a cosine curve, B on a sine curve.
// duckLevel rides on top for talkover (speeches/toasts).
export function applyVolumes() {
  const s = S()
  const gA = Math.cos((s.xfade * Math.PI) / 2) * s.faders.A * s.master * duckLevel
  const gB = Math.sin((s.xfade * Math.PI) / 2) * s.faders.B * s.master * duckLevel
  safe(players.A, 'setVolume', Math.round(Math.max(0, Math.min(1, gA)) * 100))
  safe(players.B, 'setVolume', Math.round(Math.max(0, Math.min(1, gB)) * 100))
}

// Talkover: smoothly dip the music under speech and bring it back.
export function toggleDuck(on) {
  set({ ducked: !!on })
  if (duckStepper) {
    anims.delete(duckStepper)
    duckStepper = null
  }
  const target = on ? 0.18 : 1
  const from = duckLevel
  const t0 = performance.now()
  const dur = 700
  duckStepper = addAnim((t) => {
    const k = Math.min(1, (t - t0) / dur)
    const e = k * k * (3 - 2 * k)
    duckLevel = from + (target - from) * e
    applyVolumes()
    if (k >= 1) {
      duckStepper = null
      return true
    }
    return false
  })
}

export function setXfade(x) {
  cancelFadeAnim()
  set({ xfade: Math.max(0, Math.min(1, x)) })
  applyVolumes()
}
export function setFader(deck, v) {
  set((s) => ({ faders: { ...s.faders, [deck]: v } }))
  applyVolumes()
}
export function setMaster(v) {
  set({ master: v })
  applyVolumes()
}

let xfadeStepper = null
function cancelFadeAnim() {
  if (xfadeStepper) {
    anims.delete(xfadeStepper)
    xfadeStepper = null
  }
}

function animateXfade(target, seconds, onDone) {
  cancelFadeAnim()
  const from = S().xfade
  const t0 = performance.now()
  const dur = Math.max(0.2, seconds) * 1000
  xfadeStepper = addAnim((t) => {
    const k = Math.min(1, (t - t0) / dur)
    // smoothstep easing for a hand-on-the-fader feel
    const e = k * k * (3 - 2 * k)
    set({ xfade: from + (target - from) * e })
    applyVolumes()
    if (k >= 1) {
      xfadeStepper = null
      onDone?.()
      return true
    }
    return false
  })
}

// ---------------------------------------------------------------- loading

function loadOnDeck(deck, track, { andPlay = true } = {}) {
  watch[deck] = { p: -1, at: Date.now() }
  set((s) => ({
    decks: {
      ...s.decks,
      [deck]: { track, state: 'loading', progress: 0, duration: track.durationSec || 0 },
    },
    // persisted snapshot so the airing song still reaches the set archive
    // even if the page is closed mid-track
    lastNowPlaying: andPlay
      ? {
          artist: track.artist,
          title: track.title,
          durationSec: track.durationSec,
          energy: track.energy,
          videoId: track.videoId,
        }
      : s.lastNowPlaying,
  }))
  const startSeconds = startAtOf(track)
  safe(players[deck], 'setPlaybackRate', 1) // undo any BRAKE leftovers
  if (andPlay) {
    if (cuedFor[deck] === track.videoId) {
      // pre-buffered earlier — instant start
      safe(players[deck], 'playVideo')
    } else {
      safe(players[deck], 'loadVideoById', { videoId: track.videoId, startSeconds })
    }
  } else {
    safe(players[deck], 'cueVideoById', { videoId: track.videoId, startSeconds })
  }
  cuedFor[deck] = null
}

// ---------------------------------------------------------------- ticker

export function startTicker() {
  if (ticker) return
  ticker = setInterval(tick, 400)
}

function tick() {
  pumpAnims() // backstop: fades keep moving even when rAF is frozen (hidden tab)
  const s = S()
  // progress updates + watchdog bookkeeping
  for (const deck of ['A', 'B']) {
    if (!s.decks[deck].track) continue
    const cur = safe(players[deck], 'getCurrentTime') || 0
    const dur = safe(players[deck], 'getDuration') || s.decks[deck].duration || 0
    const d = s.decks[deck]
    if (cur > watch[deck].p + 0.25) {
      watch[deck] = { p: cur, at: Date.now() }
    }
    if (Math.abs(cur - d.progress) > 0.2 || Math.abs(dur - d.duration) > 0.5) {
      set((st) => ({
        decks: { ...st.decks, [deck]: { ...st.decks[deck], progress: cur, duration: dur } },
      }))
    }
  }

  const st = S()
  const act = st.decks[st.active]
  const mixOut = act.track ? mixOutPoint(act.track, act.duration) : 0
  const remaining = act.track && act.duration > 0 ? mixOut - act.progress : Infinity

  // heartbeat for the set lifecycle: "when was music last actually playing"
  if (act.state === 'playing' && Date.now() - (st.lastActiveAt || 0) > 30_000) {
    set({ lastActiveAt: Date.now() })
  }

  // stall watchdog: playback frozen for 12s on the live deck → move on
  if (
    !st.transition &&
    act.track &&
    (act.state === 'playing' || act.state === 'loading') &&
    Date.now() - watch[st.active].at > 12_000
  ) {
    watch[st.active] = { p: -1, at: Date.now() }
    if (st.queue.length > 0) {
      toast(`"${act.track.title}" stalled — skipping ahead`)
      beginTransition({ fade: 1 })
    }
  }

  // auto-DJ: start the crossfade as the mix-out point approaches
  if (
    st.autoDJ &&
    !st.transition &&
    act.track &&
    act.state === 'playing' &&
    act.duration > 0 &&
    st.queue.length > 0
  ) {
    if (remaining <= st.settings.fadeSeconds + 0.8) {
      beginTransition({})
    }
  }

  // pre-buffer: cue the next track on the idle deck just before the blend
  if (
    act.track &&
    act.state === 'playing' &&
    act.duration > 0 &&
    !st.transition &&
    st.queue[0]
  ) {
    const idle = other(st.active)
    if (
      !st.decks[idle].track &&
      remaining <= st.settings.fadeSeconds + 18 &&
      cuedFor[idle] !== st.queue[0].videoId
    ) {
      cuedFor[idle] = st.queue[0].videoId
      safe(players[idle], 'cueVideoById', {
        videoId: st.queue[0].videoId,
        startSeconds: startAtOf(st.queue[0]),
      })
    }
  }

  // auto-refill: keep at least 10 tracks queued at all times
  if (
    st.settings.autoRefill &&
    st.settings.anthropicKey &&
    !st.aiBusy &&
    st.queue.length < 10 &&
    act.track &&
    (act.state === 'playing' || st.transition) &&
    Date.now() - lastRefillAt > 90_000 &&
    Date.now() > refillErrorUntil
  ) {
    lastRefillAt = Date.now()
    import('./dj').then((dj) =>
      dj.autoRefill().catch(() => {
        refillErrorUntil = Date.now() + 5 * 60_000
      })
    )
  }
}

// ---------------------------------------------------------------- transport

export function beginTransition({ fade } = {}) {
  const s = S()
  if (s.transition) return false
  const next = s.queue[0]
  if (!next) return false
  const from = s.active
  const to = other(from)
  const seconds = fade ?? s.settings.fadeSeconds

  set({
    transition: { to, until: Date.now() + seconds * 1000 },
    queue: s.queue.slice(1),
  })
  loadOnDeck(to, next)
  ensurePlaybackStarts(to)

  animateXfade(to === 'B' ? 1 : 0, seconds, () => finishTransition(from, to))
  return true
}

function finishTransition(from, to) {
  const s = S()
  const old = s.decks[from]
  safe(players[from], 'stopVideo')
  set({
    active: to,
    transition: null,
    decks: { ...s.decks, [from]: emptyDeck() },
    history: old.track ? [...s.history, old.track].slice(-80) : s.history,
  })
  applyVolumes()
}

// Autoplay recovery ladder — keeps the music flowing without ever blocking
// the screen: gentle retry → muted start + unmute (browsers always allow a
// muted play) → only as a true last resort, a small non-blocking nudge pill.
// PAUSED counts as fine: a manual pause must never be fought.
function ensurePlaybackStarts(deck) {
  const vid = S().decks[deck].track?.videoId
  if (!vid) return
  const same = () => S().decks[deck].track?.videoId === vid
  const fine = () => {
    const st = safe(players[deck], 'getPlayerState')
    return (
      st === YTState.PLAYING ||
      st === YTState.BUFFERING ||
      st === YTState.PAUSED ||
      st === YTState.ENDED
    )
  }
  setTimeout(() => {
    if (!same() || fine()) return
    safe(players[deck], 'playVideo')
    setTimeout(() => {
      if (!same() || fine()) return
      safe(players[deck], 'mute')
      safe(players[deck], 'playVideo')
      setTimeout(() => {
        if (!same()) return
        safe(players[deck], 'unMute')
        applyVolumes()
        const stillMuted = safe(players[deck], 'isMuted')
        if (!fine() || stillMuted === true) set({ needsTap: true })
        else primed[deck] = true
      }, 800)
    }, 1600)
  }, 2000)
}

export function resumeFromTap() {
  const s = S()
  const deck = s.transition?.to || s.active
  safe(players[deck], 'playVideo')
  set({ needsTap: false })
}

// One-time per deck: a brief MUTED blink of real playback issued inside a
// user gesture earns the iframe lasting autoplay permission, so every later
// programmatic transition starts without asking anything of the user.
// Invisible (the stage is hidden while the deck has no store track) and
// inaudible (muted, and the idle deck's crossfade gain is 0 anyway).
function primeDeck(deck, videoId) {
  if (primed[deck] || !players[deck] || !videoId) return
  if (S().decks[deck].track) return // deck is in use — it blesses itself
  primed[deck] = true
  try {
    players[deck].mute()
    players[deck].loadVideoById({ videoId, startSeconds: 0 })
    setTimeout(() => {
      safe(players[deck], 'stopVideo')
      safe(players[deck], 'unMute')
      cuedFor[deck] = null
      applyVolumes()
    }, 650)
  } catch {
    primed[deck] = false
  }
}

export function togglePlay() {
  const s = S()
  const act = s.decks[s.active]
  if (!act.track) {
    startSet()
    return
  }
  if (act.state === 'playing' || act.state === 'loading') {
    safe(players[s.active], 'pauseVideo')
    if (s.transition) safe(players[other(s.active)], 'pauseVideo')
    releaseWakeLock()
  } else {
    primeDeck(other(s.active), s.queue[0]?.videoId)
    safe(players[s.active], 'playVideo')
    if (s.transition) safe(players[other(s.active)], 'playVideo')
  }
}

// Start (or restart) playback from the front of the queue.
export function startSet() {
  const s = S()
  const next = s.queue[0]
  if (!next) {
    toast('Queue is empty — ask the DJ for music, or load the demo set in Settings')
    return
  }
  // this call sits inside the user's gesture — bless the idle deck too
  primeDeck(other(s.active), s.queue[1]?.videoId || next.videoId)
  set({ queue: s.queue.slice(1), started: true, xfade: s.active === 'B' ? 1 : 0 })
  loadOnDeck(s.active, next)
  applyVolumes()
}

export function skip() {
  const s = S()
  if (s.queue.length === 0) {
    toast('Nothing queued to skip to')
    return
  }
  if (!s.decks[s.active].track) {
    startSet()
    return
  }
  beginTransition({ fade: Math.min(2, s.settings.fadeSeconds) })
}

// Jump within a deck's playing track (waveform scrub / Shift+arrows / DJ).
export function seekTo(deck, seconds) {
  const d = S().decks[deck]
  if (!d.track) return
  const dur = d.duration || 0
  const sec = Math.max(0, dur > 0 ? Math.min(seconds, dur - 0.4) : seconds)
  watch[deck] = { p: -1, at: Date.now() } // a seek is not a stall
  safe(players[deck], 'seekTo', sec, true)
  set((s) => ({
    decks: { ...s.decks, [deck]: { ...s.decks[deck], progress: sec } },
  }))
}

export function nudge(delta) {
  const s = S()
  const d = s.decks[s.active]
  if (d.track) seekTo(s.active, d.progress + delta)
}

// FX "BRAKE": slow the live deck down over ~0.9s (YT quantizes the rate —
// the synth zip in fx.js sells the illusion), then blend into the next
// track. With an empty queue it snaps back to speed instead.
export function brakeAndBlend() {
  const s = S()
  const deck = s.active
  if (s.decks[deck].state !== 'playing' || s.transition) return
  const p = players[deck]
  const t0 = performance.now()
  addAnim((t) => {
    const k = Math.min(1, (t - t0) / 900)
    safe(p, 'setPlaybackRate', Math.max(0.25, 1 - 0.75 * k))
    if (k >= 1) {
      if (S().queue.length > 0 && !S().transition) {
        beginTransition({ fade: 1.5 })
      } else {
        safe(p, 'setPlaybackRate', 1)
      }
      return true
    }
    return false
  })
}

export function back() {
  const s = S()
  const act = s.decks[s.active]
  if (act.track && act.progress > 8) {
    safe(players[s.active], 'seekTo', 0, true)
    return
  }
  const prev = s.history[s.history.length - 1]
  if (!prev) {
    if (act.track) safe(players[s.active], 'seekTo', 0, true)
    return
  }
  // requeue current, pull previous back on
  const requeue = act.track ? [{ ...act.track }, ...s.queue] : s.queue
  set({
    history: s.history.slice(0, -1),
    queue: [{ ...prev }, ...requeue],
  })
  if (act.track) beginTransition({ fade: 1.2 })
  else startSet()
}

// ---------------------------------------------------------------- queue ops

export function queueTracks(tracks, mode = 'append') {
  // fresh id even when re-queueing a history item, so list keys never collide
  const items = tracks.map((t) => ({ ...t, id: uid() }))
  set((s) => {
    if (mode === 'replace_upcoming') return { queue: items }
    if (mode === 'play_next') return { queue: [...items, ...s.queue] }
    return { queue: [...s.queue, ...items] }
  })
  // revive playback if the set was running but the queue had run dry
  const s = S()
  const act = s.decks[s.active]
  if (s.started && !s.transition && s.queue.length) {
    if (!act.track) startSet()
    else if (act.state === 'ended') beginTransition({ fade: 1.2 })
  }
  return items
}

export function removeFromQueue(id) {
  set((s) => ({ queue: s.queue.filter((t) => t.id !== id) }))
}

export function moveToFront(id) {
  set((s) => {
    const t = s.queue.find((x) => x.id === id)
    if (!t) return {}
    return { queue: [t, ...s.queue.filter((x) => x.id !== id)] }
  })
}

// Drag-reorder: insert the dragged track before the target track.
export function moveBefore(dragId, targetId) {
  if (dragId === targetId) return
  set((s) => {
    const t = s.queue.find((x) => x.id === dragId)
    if (!t) return {}
    const rest = s.queue.filter((x) => x.id !== dragId)
    const idx = rest.findIndex((x) => x.id === targetId)
    if (idx === -1) return {}
    return { queue: [...rest.slice(0, idx), t, ...rest.slice(idx)] }
  })
}

export function moveToEnd(id) {
  set((s) => {
    const t = s.queue.find((x) => x.id === id)
    if (!t) return {}
    return { queue: [...s.queue.filter((x) => x.id !== id), t] }
  })
}

// Drop a queued track onto a deck: pull it from the queue and crossfade
// into it right now. deckPref only matters when nothing is playing yet.
export function playNowFromQueue(id, deckPref) {
  const s = S()
  if (s.transition) {
    toast('Already blending — drop it again in a moment')
    return
  }
  const t = s.queue.find((x) => x.id === id)
  if (!t) return
  set({ queue: s.queue.filter((x) => x.id !== id) })
  const st = S()
  if (!st.decks[st.active].track && deckPref && !st.decks[deckPref].track) {
    set({ active: deckPref, xfade: deckPref === 'B' ? 1 : 0, started: true })
  }
  playNow(t)
}

export function playNow(track) {
  queueTracks([track], 'play_next')
  const s = S()
  if (s.decks[s.active].track) beginTransition({ fade: Math.min(2.5, s.settings.fadeSeconds) })
  else startSet()
}

export function setCrossfadeSeconds(sec) {
  const v = Math.max(2, Math.min(20, Math.round(sec)))
  S().setSetting('fadeSeconds', v)
  return v
}

export function setAutoDJ(on) {
  set({ autoDJ: !!on })
}

export function pauseMusic() {
  const s = S()
  if (s.decks[s.active].state === 'playing') togglePlay()
}
export function resumeMusic() {
  const s = S()
  if (s.decks[s.active].state !== 'playing') togglePlay()
}

// ---------------------------------------------------------------- set end

// Hard stop: silence both players and reset the mixer surface.
export function stopAll() {
  cancelFadeAnim()
  safe(players.A, 'stopVideo')
  safe(players.B, 'stopVideo')
  cuedFor.A = null
  cuedFor.B = null
  duckLevel = 1
  set({
    decks: { A: emptyDeck(), B: emptyDeck() },
    transition: null,
    xfade: 0,
    active: 'A',
    needsTap: false,
    started: false,
    ducked: false,
    lastNowPlaying: null,
  })
  applyVolumes()
  releaseWakeLock()
}

// End-of-night fade: ease the whole mix to silence, then stop everything.
export function fadeOutAndStop(seconds = 2.5, onDone) {
  if (duckStepper) {
    anims.delete(duckStepper)
    duckStepper = null
  }
  const from = duckLevel
  const t0 = performance.now()
  const dur = Math.max(0.3, seconds) * 1000
  duckStepper = addAnim((t) => {
    const k = Math.min(1, (t - t0) / dur)
    duckLevel = from * (1 - k)
    applyVolumes()
    if (k >= 1) {
      duckStepper = null
      stopAll() // restores duckLevel and ducked
      onDone?.()
      return true
    }
    return false
  })
}
