import { useStore } from '../store'
import * as engine from '../lib/engine'

const Icon = {
  Prev: () => (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
      <path d="M6 5h2v14H6zM20 5v14L9.5 12z" />
    </svg>
  ),
  Play: () => (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  ),
  Next: () => (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
      <path d="M16 5h2v14h-2zM4 5v14l10.5-7z" />
    </svg>
  ),
}

function EnergyMeter() {
  const energy = useStore((s) => s.energy)
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="w-4 h-1.5 rounded-full transition-all"
            style={{
              background:
                i <= energy
                  ? `linear-gradient(90deg, #22d3ee, #a78bfa, #f472b6)`
                  : 'rgba(255,255,255,0.08)',
              boxShadow: i <= energy ? '0 0 8px rgba(167,139,250,0.5)' : 'none',
            }}
          />
        ))}
      </div>
      <span className="text-[10px] tracking-[0.25em] text-zinc-600">ENERGY {energy}/5</span>
    </div>
  )
}

export default function Mixer() {
  const xfade = useStore((s) => s.xfade)
  const master = useStore((s) => s.master)
  const autoDJ = useStore((s) => s.autoDJ)
  const fadeSeconds = useStore((s) => s.settings.fadeSeconds)
  const transition = useStore((s) => s.transition)
  const decks = useStore((s) => s.decks)
  const active = useStore((s) => s.active)
  const queue = useStore((s) => s.queue)
  const setSetting = useStore((s) => s.setSetting)

  const act = decks[active]
  const playing = act.state === 'playing' || act.state === 'loading'

  const status = transition
    ? `blending → deck ${transition.to}…`
    : queue[0]
      ? `next: ${queue[0].artist} — ${queue[0].title}`
      : act.track
        ? 'queue empty — ask the DJ for more'
        : 'press play to start the set'

  return (
    <section className="w-full lg:w-64 shrink-0 flex flex-col justify-center gap-5 glass rounded-3xl px-5 py-6 my-2">
      <EnergyMeter />

      {/* transport */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => engine.back()}
          className="w-11 h-11 rounded-full grid place-items-center text-zinc-300 bg-white/5 hover:bg-white/10 active:scale-95 transition"
          aria-label="Back"
        >
          <Icon.Prev />
        </button>
        <button
          onClick={() => engine.togglePlay()}
          className={`w-16 h-16 rounded-full grid place-items-center text-black active:scale-95 transition shadow-lg ${
            playing
              ? 'bg-gradient-to-br from-zinc-100 to-zinc-300'
              : 'bg-gradient-to-br from-cyan-300 via-violet-300 to-pink-300 shadow-[0_0_35px_rgba(167,139,250,0.45)]'
          }`}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
        <button
          onClick={() => engine.skip()}
          className="w-11 h-11 rounded-full grid place-items-center text-zinc-300 bg-white/5 hover:bg-white/10 active:scale-95 transition"
          aria-label="Next"
        >
          <Icon.Next />
        </button>
      </div>

      <div className="text-center text-[11px] text-zinc-500 min-h-[1rem] truncate px-1" title={status}>
        {status}
      </div>

      {/* crossfader */}
      <div>
        <div className="flex justify-between text-[10px] font-semibold tracking-widest mb-1.5">
          <span className="text-cyan-300">A</span>
          <span className="text-zinc-600 tracking-[0.25em]">CROSSFADE</span>
          <span className="text-pink-300">B</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          value={Math.round(xfade * 1000)}
          onChange={(e) => engine.setXfade(e.target.value / 1000)}
          className="fader xfader w-full"
          style={{ '--fader-glow': 'rgba(167,139,250,0.8)' }}
          aria-label="Crossfader"
        />
      </div>

      {/* auto dj + fade length */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => engine.setAutoDJ(!autoDJ)}
          className={`flex items-center gap-2 text-[11px] font-semibold tracking-wider px-3 py-2 rounded-xl border transition ${
            autoDJ
              ? 'border-violet-400/40 bg-violet-400/10 text-violet-200'
              : 'border-white/10 text-zinc-500'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${autoDJ ? 'bg-violet-300 pulse-soft' : 'bg-zinc-600'}`}
          />
          AUTO DJ
        </button>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <button
            onClick={() => engine.setCrossfadeSeconds(fadeSeconds - 1)}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-sm"
            aria-label="Shorter fade"
          >
            –
          </button>
          <span className="text-xs font-mono w-8 text-center">{fadeSeconds}s</span>
          <button
            onClick={() => engine.setCrossfadeSeconds(fadeSeconds + 1)}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-sm"
            aria-label="Longer fade"
          >
            +
          </button>
        </div>
      </div>

      {/* master volume */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] tracking-widest text-zinc-600 w-12">MASTER</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(master * 100)}
          onChange={(e) => engine.setMaster(e.target.value / 100)}
          className="fader w-full"
          style={{ '--fader-glow': 'rgba(255,255,255,0.6)' }}
          aria-label="Master volume"
        />
      </div>
    </section>
  )
}
