// Gig lifecycle: every session belongs to a named set. Ending a set fades
// the music out, archives the night's played list into the set library
// (persisted, capped at 50), and resets the booth. Opening the app on
// stale state (> 8h since music last played) auto-archives the previous
// gig so a refresh never resurrects last week's queue.

import { useStore, uid, toast } from '../store'
import * as engine from './engine'
import { fmtRuntime } from './time'

const defaultName = () =>
  `Set — ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`

const newSetObj = (name) => ({
  id: uid(),
  name: (name || '').trim() || defaultName(),
  startedAt: Date.now(),
})

// Everything that has actually PLAYED this set: history + what's on air now.
// After a reload the decks are empty, so the persisted lastNowPlaying
// snapshot stands in for the song that was airing when the page closed.
export function snapshotTracks() {
  const s = useStore.getState()
  const decksEmpty = !s.decks.A.track && !s.decks.B.track
  const act = s.decks[s.active].track || (decksEmpty ? s.lastNowPlaying : null)
  return [...s.history, ...(act ? [act] : [])].map((t) => ({
    artist: t.artist,
    title: t.title,
    durationSec: t.durationSec,
    energy: t.energy,
    videoId: t.videoId, // keeps archived sets usable as free library seeds
  }))
}

function archiveCurrent(endedAt = Date.now()) {
  const s = useStore.getState()
  const tracks = snapshotTracks()
  if (!s.currentSet || tracks.length === 0) return null
  const rec = {
    id: s.currentSet.id,
    name: s.currentSet.name,
    startedAt: s.currentSet.startedAt,
    endedAt,
    eventPlan: s.eventPlan,
    tracks,
  }
  useStore.setState({ pastSets: [rec, ...s.pastSets].slice(0, 50) })
  return rec
}

function resetLive(name) {
  useStore.setState({
    queue: [],
    history: [],
    chat: [],
    apiHistory: [],
    eventPlan: '',
    banner: '',
    energy: 3,
    currentSet: newSetObj(name),
    lastActiveAt: Date.now(),
    lastNowPlaying: null,
  })
}

// End the night (or start a fresh one — same move from the other side):
// graceful fade, archive what played, clean slate under a new set.
export function endSet({ fade = true, nextName } = {}) {
  const finish = () => {
    const rec = archiveCurrent()
    engine.stopAll()
    resetLive(nextName)
    toast(
      rec
        ? `🏁 "${rec.name}" archived — ${rec.tracks.length} track${rec.tracks.length > 1 ? 's' : ''}. Fresh decks.`
        : '✨ Fresh set started'
    )
    return rec
  }
  const s = useStore.getState()
  if (fade && s.decks[s.active].state === 'playing') {
    engine.fadeOutAndStop(2.5, finish)
    return null
  }
  return finish()
}

export const startNewSet = (name) => endSet({ nextName: name })

export function renameCurrentSet(name) {
  const s = useStore.getState()
  if (!s.currentSet) return
  useStore.setState({ currentSet: { ...s.currentSet, name: name.slice(0, 80) } })
}

export function deletePastSet(id) {
  useStore.setState((s) => ({ pastSets: s.pastSets.filter((r) => r.id !== id) }))
}

// On app load: make sure a set exists; archive a stale one from a past gig.
export function initSetLifecycle(maxIdleHours = 8) {
  const s = useStore.getState()
  if (!s.currentSet) {
    useStore.setState({ currentSet: newSetObj(), lastActiveAt: Date.now() })
    return
  }
  const idleMs = Date.now() - (s.lastActiveAt || 0)
  const hasContent = s.history.length > 0 || s.queue.length > 0
  if (s.lastActiveAt && hasContent && idleMs > maxIdleHours * 3600 * 1000) {
    const rec = archiveCurrent(s.lastActiveAt) // it ended when music last played
    resetLive()
    if (rec) {
      toast(`🏁 Previous set "${rec.name}" archived (${rec.tracks.length} tracks) — fresh decks for tonight`, 6500)
    }
  }
}

// ---------------------------------------------------------------- export

export function setlistText(rec) {
  const d = (ts) =>
    new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  const runtime = rec.tracks.reduce((a, t) => a + (t.durationSec || 210), 0)
  const head = `DJ WYS — ${rec.name}\n${d(rec.startedAt)} → ${d(rec.endedAt)} · ${rec.tracks.length} tracks · ~${fmtRuntime(runtime)}${rec.eventPlan ? `\nPlan: ${rec.eventPlan}` : ''}\n\n`
  return head + rec.tracks.map((t, i) => `${i + 1}. ${t.artist} — ${t.title}`).join('\n') + '\n'
}

export function downloadSet(rec) {
  const blob = new Blob([setlistText(rec)], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const stamp = new Date(rec.startedAt).toISOString().slice(0, 10)
  a.download = `djwys-${stamp}-${rec.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}
