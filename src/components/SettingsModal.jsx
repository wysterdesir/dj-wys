import { useState } from 'react'
import { useStore, toast } from '../store'
import { MODELS, validateAnthropicKey } from '../lib/dj'
import { validateYouTubeKey, quotaUsedToday, librarySize } from '../lib/search'
import { loadDemoSet } from '../lib/demo'
import {
  startNewSet,
  endSet,
  renameCurrentSet,
  deletePastSet,
  downloadSet,
  snapshotTracks,
} from '../lib/sets'
import { fmtRuntime } from '../lib/time'

function exportSetList() {
  const s = useStore.getState()
  const act = s.decks[s.active].track
  const all = [...s.history, ...(act ? [act] : [])]
  if (all.length === 0) {
    toast('Nothing played yet — the set list is empty')
    return
  }
  const header = `DJ WYS set list — ${new Date().toLocaleDateString()}\n\n`
  const lines = all.map((t, i) => `${i + 1}. ${t.artist} — ${t.title}`)
  const blob = new Blob([header + lines.join('\n') + '\n'], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `djwys-setlist-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-300">{label}</label>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function KeyInput({ value, onChange, onTest, placeholder }) {
  const [status, setStatus] = useState(null) // null | 'testing' | 'ok' | 'bad'
  const test = async () => {
    setStatus('testing')
    setStatus((await onTest()) ? 'ok' : 'bad')
  }
  return (
    <div className="flex gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => {
          onChange(e.target.value.trim())
          setStatus(null)
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="flex-1 bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-violet-400/50"
      />
      <button
        onClick={test}
        disabled={!value || status === 'testing'}
        className={`shrink-0 text-xs px-3 rounded-lg border transition disabled:opacity-40 ${
          status === 'ok'
            ? 'border-emerald-400/50 text-emerald-300'
            : status === 'bad'
              ? 'border-red-400/50 text-red-300'
              : 'border-white/15 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        {status === 'testing' ? '…' : status === 'ok' ? '✓ valid' : status === 'bad' ? '✗ failed' : 'Test'}
      </button>
    </div>
  )
}

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const banner = useStore((s) => s.banner)
  const currentSet = useStore((s) => s.currentSet)
  const pastSets = useStore((s) => s.pastSets)
  const playedCount = useStore(
    (s) => s.history.length + (s.decks[s.active].track ? 1 : 0)
  )
  const close = () => useStore.setState({ settingsOpen: false })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={close}>
      <div
        className="w-full max-w-md max-h-[88vh] overflow-y-auto thin-scroll glass rounded-3xl p-6 flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg">Settings</h2>
          <button onClick={close} className="text-zinc-500 hover:text-white text-xl leading-none">
            ✕
          </button>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-500">THIS SET</h3>
          <Row
            label="Set name"
            hint={
              currentSet
                ? `started ${new Date(currentSet.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${playedCount} played`
                : ''
            }
          >
            <input
              value={currentSet?.name || ''}
              onChange={(e) => renameCurrentSet(e.target.value)}
              placeholder="Maman's 60th"
              className="bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-400/50"
            />
          </Row>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                const played = snapshotTracks().length
                if (
                  played === 0 ||
                  confirm(`Start a new set? "${currentSet?.name}" (${played} played) will be archived to the library.`)
                ) {
                  startNewSet()
                  close()
                }
              }}
              className="text-xs px-4 py-2 rounded-lg border border-white/15 text-zinc-200 hover:border-cyan-400/50 transition"
            >
              ✨ Start new set
            </button>
            <button
              onClick={() => {
                const played = snapshotTracks().length
                if (
                  confirm(
                    played
                      ? `End "${currentSet?.name}"? The music fades out and ${played} played track${played > 1 ? 's' : ''} are archived.`
                      : 'End this set? Nothing played yet, so the booth just resets.'
                  )
                ) {
                  endSet()
                  close()
                }
              }}
              className="text-xs px-4 py-2 rounded-lg border border-white/15 text-zinc-200 hover:border-amber-400/50 transition"
            >
              🏁 End set & archive
            </button>
          </div>
          {pastSets.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <h4 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-600">
                SET LIBRARY · {pastSets.length}
              </h4>
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto thin-scroll pr-1">
                {pastSets.map((rec) => {
                  const runtime = rec.tracks.reduce((a, t) => a + (t.durationSec || 210), 0)
                  return (
                    <div
                      key={rec.id}
                      className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-200 truncate">{rec.name}</div>
                        <div className="text-[10px] text-zinc-600">
                          {new Date(rec.startedAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}{' '}
                          · {rec.tracks.length} tracks · ~{fmtRuntime(runtime)}
                        </div>
                      </div>
                      <button
                        onClick={() => downloadSet(rec)}
                        title="Download setlist"
                        className="shrink-0 w-7 h-7 grid place-items-center rounded-md bg-white/5 hover:bg-violet-500/40 text-xs text-zinc-300"
                      >
                        ⬇
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete the archived set "${rec.name}"? This can't be undone.`))
                            deletePastSet(rec.id)
                        }}
                        title="Delete from library"
                        className="shrink-0 w-7 h-7 grid place-items-center rounded-md bg-white/5 hover:bg-red-500/40 text-xs text-zinc-400"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-500">API KEYS — STORED ONLY IN THIS BROWSER</h3>
          <Row
            label="Anthropic API key (the DJ brain)"
            hint="console.anthropic.com → API keys"
          >
            <KeyInput
              value={settings.anthropicKey}
              onChange={(v) => setSetting('anthropicKey', v)}
              onTest={() => validateAnthropicKey(settings.anthropicKey)}
              placeholder="sk-ant-…"
            />
          </Row>
          <Row
            label="YouTube Data API key (track search)"
            hint="console.cloud.google.com — see README"
          >
            <KeyInput
              value={settings.youtubeKey}
              onChange={(v) => setSetting('youtubeKey', v)}
              onTest={() => validateYouTubeKey(settings.youtubeKey)}
              placeholder="AIza…"
            />
          </Row>
          {(() => {
            const used = quotaUsedToday()
            const pct = Math.min(100, Math.round((used / 99) * 100))
            return (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      pct >= 80 ? 'bg-amber-400' : 'bg-violet-400/70'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-[10px] ${pct >= 80 ? 'text-amber-300' : 'text-zinc-500'}`}>
                  {used} / ~99 searches today
                </span>
              </div>
            )
          })()}
          <p className="text-[10px] leading-relaxed text-zinc-600 -mt-2">
            Resets midnight Pacific. {librarySize()} tracks in your library play for free — the DJ
            also supplies known video IDs, verified at ~1% of a search's cost.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-500">DJ BEHAVIOR</h3>
          <Row label="DJ brain model" hint="cost ↕ quality">
            <select
              value={settings.model}
              onChange={(e) => setSetting('model', e.target.value)}
              className="bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-100 outline-none focus:border-violet-400/50 [&>option]:bg-zinc-900"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label={`FX pad volume — ${Math.round((settings.fxLevel ?? 0.5) * 100)}%`}>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((settings.fxLevel ?? 0.5) * 100)}
              onChange={(e) => setSetting('fxLevel', +e.target.value / 100)}
              className="fader w-full"
            />
          </Row>
          <Row label={`Default crossfade — ${settings.fadeSeconds}s`}>
            <input
              type="range"
              min="2"
              max="20"
              value={settings.fadeSeconds}
              onChange={(e) => setSetting('fadeSeconds', +e.target.value)}
              className="fader w-full"
            />
          </Row>
          <Row label="Auto-refill queue" hint="DJ tops up when < 3 tracks left">
            <button
              onClick={() => setSetting('autoRefill', !settings.autoRefill)}
              className={`self-start text-xs px-4 py-2 rounded-lg border transition ${
                settings.autoRefill
                  ? 'border-violet-400/40 bg-violet-400/10 text-violet-200'
                  : 'border-white/10 text-zinc-500'
              }`}
            >
              {settings.autoRefill ? 'On — set never runs dry' : 'Off'}
            </button>
          </Row>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-500">LOOK & DEVICE</h3>
          <Row label="Big-screen banner" hint="scrolls above the decks · or just ask the DJ">
            <input
              value={banner}
              onChange={(e) => useStore.setState({ banner: e.target.value.slice(0, 140) })}
              placeholder="Happy 60th, Maman! 🎉"
              className="bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-400/50"
            />
          </Row>
          <Row label="Deck visual">
            <div className="flex gap-2">
              {[
                ['platter', '◉ Spinning platter'],
                ['cinema', '▭ Cinema 16:9'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setSetting('videoMode', v)}
                  className={`text-xs px-4 py-2 rounded-lg border transition ${
                    settings.videoMode === v
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                      : 'border-white/10 text-zinc-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Keep screen awake while playing">
            <button
              onClick={() => setSetting('wakeLock', !settings.wakeLock)}
              className={`self-start text-xs px-4 py-2 rounded-lg border transition ${
                settings.wakeLock
                  ? 'border-violet-400/40 bg-violet-400/10 text-violet-200'
                  : 'border-white/10 text-zinc-500'
              }`}
            >
              {settings.wakeLock ? 'On' : 'Off'}
            </button>
          </Row>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[10px] font-semibold tracking-[0.25em] text-zinc-500">EXTRAS</h3>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                loadDemoSet()
                close()
                toast('Demo set loaded — press play!')
              }}
              className="text-xs px-4 py-2 rounded-lg border border-white/15 text-zinc-200 hover:border-cyan-400/50 transition"
            >
              ▶ Load demo set
            </button>
            <button
              onClick={exportSetList}
              className="text-xs px-4 py-2 rounded-lg border border-white/15 text-zinc-200 hover:border-violet-400/50 transition"
            >
              ⬇ Download set list
            </button>
            <button
              onClick={() => {
                if (confirm('Clear the chat, queue, and history?')) {
                  useStore.setState({ chat: [], apiHistory: [], queue: [], history: [], eventPlan: '' })
                  toast('Cleared')
                }
              }}
              className="text-xs px-4 py-2 rounded-lg border border-white/15 text-zinc-400 hover:border-red-400/50 hover:text-red-200 transition"
            >
              Clear chat & queue
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Shortcuts: Space play/pause · ← back · → skip · Shift+←→ seek ±10s · ↑↓ master volume ·
            T talkover · C chat. Click or drag the waveform to seek, YouTube-style.
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Playback uses the official YouTube player — sign into your YouTube Premium account in
            this browser for ad-free music. Keys live in this browser's local storage only and are
            sent solely to Anthropic / Google APIs.
          </p>
        </section>
      </div>
    </div>
  )
}
