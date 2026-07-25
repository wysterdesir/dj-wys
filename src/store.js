import { create } from 'zustand'
import { persist } from 'zustand/middleware'

let n = 0
export const uid = () => `t${Date.now().toString(36)}-${(n++).toString(36)}`

export const emptyDeck = () => ({
  track: null, // { id, videoId, title, artist, channel, durationSec, energy, query, candidates }
  state: 'empty', // empty | loading | playing | paused | ended
  progress: 0,
  duration: 0,
})

// Duplicate ids in a persisted track list break React's keyed rendering
// (ghost rows that can't be removed), so heal them before the first render.
const dedupeTracks = (list) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  return list.filter((t) => {
    if (!t || !t.videoId || seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
}

export const useStore = create(
  persist(
    (set) => ({
      // ---------- settings ----------
      settings: {
        anthropicKey: '',
        youtubeKey: '',
        model: 'auto', // resolved to the newest Opus at send time (dj.js)
        fadeSeconds: 8,
        fxLevel: 0.5, // FX pad volume
        autoRefill: true,
        videoMode: 'platter', // platter | cinema
        wakeLock: true,
      },
      setSetting: (k, v) =>
        set((s) => ({ settings: { ...s.settings, [k]: v } })),

      // ---------- decks / mixer (runtime, not persisted) ----------
      decks: { A: emptyDeck(), B: emptyDeck() },
      active: 'A',
      xfade: 0, // 0 = full A, 1 = full B
      faders: { A: 1, B: 1 },
      master: 0.9,
      autoDJ: true,
      transition: null, // { to, until }
      needsTap: false, // mobile autoplay was blocked — show tap overlay
      started: false, // set has been started at least once
      ducked: false, // talkover: music dipped under speech
      fxCooldowns: {}, // effect id → timestamp it becomes ready again

      // ---------- queue ----------
      queue: [],
      history: [],
      trims: {}, // videoId → gain multiplier (0.5–1.5): per-track loudness fix, kept forever
      energy: 3,
      eventPlan: '', // run-of-show the host gave the DJ
      banner: '', // big-screen marquee message above the decks

      // ---------- set / gig lifecycle ----------
      currentSet: null, // { id, name, startedAt }
      pastSets: [], // archived gigs: { id, name, startedAt, endedAt, eventPlan, tracks }
      lastActiveAt: 0, // last time music was actually playing
      lastNowPlaying: null, // in-flight track snapshot — survives reload for archiving

      // ---------- chat ----------
      chat: [], // { id, role: 'user'|'dj'|'event'|'error', text, chips: [] }
      apiHistory: [], // raw Anthropic message objects (incl. tool blocks)
      chatEpoch: 0, // bumped whenever the conversation is reset — aborts in-flight loops
      aiBusy: false,

      // ---------- ui ----------
      settingsOpen: false,
      chatOpen: true,
      chatSeenLen: 0, // for the unread dot while the chat is collapsed
      mobileTab: 'decks', // decks | queue | chat
      toast: null,
    }),
    {
      name: 'djwys-v1',
      partialize: (s) => ({
        settings: s.settings,
        queue: s.queue,
        history: s.history.slice(-50),
        trims: s.trims,
        energy: s.energy,
        chat: s.chat.slice(-80),
        apiHistory: s.apiHistory.slice(-40),
        autoDJ: s.autoDJ,
        eventPlan: s.eventPlan,
        banner: s.banner,
        currentSet: s.currentSet,
        pastSets: s.pastSets.slice(0, 50),
        lastActiveAt: s.lastActiveAt,
        lastNowPlaying: s.lastNowPlaying,
        chatOpen: s.chatOpen,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted || {}) }
        merged.queue = dedupeTracks(merged.queue)
        merged.history = dedupeTracks(merged.history)
        if (!merged.trims || typeof merged.trims !== 'object') merged.trims = {}
        // model migration: devices still on an old DEFAULT follow the app
        // default forward ('auto' → newest Opus); deliberate picks like
        // haiku or fable are respected as-is
        const model = merged.settings?.model
        if (model === 'claude-opus-4-8') {
          merged.settings = { ...merged.settings, model: 'auto' }
        } else if (model === 'claude-sonnet-4-6') {
          merged.settings = { ...merged.settings, model: 'claude-sonnet-5' }
        }
        return merged
      },
    }
  )
)

let toastTimer = null
export function toast(text, ms = 3500) {
  clearTimeout(toastTimer)
  useStore.setState({ toast: text })
  toastTimer = setTimeout(() => useStore.setState({ toast: null }), ms)
}
