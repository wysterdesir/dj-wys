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

export const useStore = create(
  persist(
    (set) => ({
      // ---------- settings ----------
      settings: {
        anthropicKey: '',
        youtubeKey: '',
        model: 'claude-opus-4-8',
        fadeSeconds: 8,
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

      // ---------- queue ----------
      queue: [],
      history: [],
      energy: 3,

      // ---------- chat ----------
      chat: [], // { id, role: 'user'|'dj'|'event'|'error', text, chips: [] }
      apiHistory: [], // raw Anthropic message objects (incl. tool blocks)
      aiBusy: false,

      // ---------- ui ----------
      settingsOpen: false,
      chatOpen: true,
      mobileTab: 'decks', // decks | queue | chat
      toast: null,
    }),
    {
      name: 'djwys-v1',
      partialize: (s) => ({
        settings: s.settings,
        queue: s.queue,
        history: s.history.slice(-50),
        energy: s.energy,
        chat: s.chat.slice(-80),
        apiHistory: s.apiHistory.slice(-40),
        autoDJ: s.autoDJ,
      }),
    }
  )
)

let toastTimer = null
export function toast(text, ms = 3500) {
  clearTimeout(toastTimer)
  useStore.setState({ toast: text })
  toastTimer = setTimeout(() => useStore.setState({ toast: null }), ms)
}
