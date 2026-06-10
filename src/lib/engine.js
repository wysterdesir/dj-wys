// The conductor: owns the two YouTube players, runs the auto-DJ ticker,
// executes crossfades, and mutates the zustand store. UI components call
// these functions; they never touch the players directly.

import { useStore, emptyDeck, toast, uid } from '../store'
import { createPlayer, safe, YTState } from './youtube'
import { acquireWakeLock, releaseWakeLock } from './wakelock'

const players = { A: null, B: null }
let ticker = null
let fadeAnim = null
let unlockedB = false
let lastRefillAt = 0
let refillErrorUntil = 0
const cuedFor = { A: null, B: null } // videoId pre-buffered on a deck
const watch = { A: { p: -1, at: 0 }, B: { p: -1, at: 0 } } // stall watchdog
let duckLevel = 1 // 1 = full, ~0.18 = talkover
let duckRaf = null
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
  if (duckRaf) cancelAnimationFrame(duckRaf)
  const target = on ? 0.18 : 1
  const from = duckLevel
  const t0 = performance.now()
  const dur = 700
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur)
    const e = k * k * (3 - 2 * k)
    duckLevel = from + (target - from) * e
    applyVolumes()
    if (k < 1) duckRaf = requestAnimationFrame(step)
    else duckRaf = null
  }
  duckRaf = requestAnimationFrame(step)
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

function cancelFadeAnim() {
  if (fadeAnim) {
    cancelAnimationFrame(fadeAnim)
    fadeAnim = null
  }
}

function animateXfade(target, seconds, onDone) {
  cancelFadeAnim()
  const from = S().xfade
  const t0 = performance.now()
  const dur = Math.max(0.2, seconds) * 1000
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur)
    // smoothstep easing for a hand-on-the-fader feel
    const e = k * k * (3 - 2 * k)
    set({ xfade: from + (target - from) * e })
    applyVolumes()
    if (k < 1) {
      fadeAnim = requestAnimationFrame(step)
    } else {
      fadeAnim = null
      onDone?.()
    }
  }
  fadeAnim = requestAnimationFrame(step)
}

// ---------------------------------------------------------------- loading

function loadOnDeck(deck, track, { andPlay = true } = {}) {
  watch[deck] = { p: -1, at: Date.now() }
  set((s) => ({
    decks: {
      ...s.decks,
      [deck]: { track, state: 'loading', progress: 0, duration: track.durationSec || 0 },
    },
  }))
  const startSeconds = startAtOf(track)
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
  detectBlockedAutoplay(to)

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

// If a mobile browser blocked programmatic playback, surface a tap target.
function detectBlockedAutoplay(deck) {
  setTimeout(() => {
    const d = S().decks[deck]
    if (!d.track) return
    const yts = safe(players[deck], 'getPlayerState')
    if (yts !== YTState.PLAYING && yts !== YTState.BUFFERING) {
      set({ needsTap: true })
    }
  }, 1800)
}

export function resumeFromTap() {
  const s = S()
  const deck = s.transition?.to || s.active
  safe(players[deck], 'playVideo')
  set({ needsTap: false })
}

// Mobile audio unlock: a user gesture "blesses" both players once.
function unlockDeckB() {
  if (unlockedB || !players.B) return
  const s = S()
  if (s.decks.B.track) {
    unlockedB = true
    return // it already has content; first gesture-play covers it
  }
  unlockedB = true
  try {
    players.B.mute()
    // play/pause on an empty player is a no-op but still registers the gesture
    players.B.playVideo?.()
    setTimeout(() => {
      safe(players.B, 'pauseVideo')
      safe(players.B, 'unMute')
      applyVolumes()
    }, 250)
  } catch {
    /* fine */
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
    unlockDeckB()
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
  unlockDeckB()
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
