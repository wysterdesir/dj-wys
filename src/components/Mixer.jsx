import { useEffect, useRef, useState } from 'react'
import { useStore, toast } from '../store'
import * as engine from '../lib/engine'
import * as fx from '../lib/fx'
import { amplitudeAt } from './Waveform'

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

// Channel VU meters. The signal is the simulated waveform level at the
// playhead, but the GAIN is real — crossfader, channel faders, master and
// talkover ducking all move these bars exactly like the audible volume.
function VUMeter() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    const level = { A: 0, B: 0 }
    let raf
    const SEG = 14
    const draw = (t) => {
      const s = useStore.getState()
      const W = cv.clientWidth
      const H = cv.clientHeight
      if (W === 0) {
        raf = requestAnimationFrame(draw)
        return
      }
      if (cv.width !== W * 2 || cv.height !== H * 2) {
        cv.width = W * 2
        cv.height = H * 2
      }
      ctx.clearRect(0, 0, cv.width, cv.height)
      const duck = engine.getDuckLevel()
      const gain = {
        A: Math.cos((s.xfade * Math.PI) / 2) * s.faders.A * s.master * duck,
        B: Math.sin((s.xfade * Math.PI) / 2) * s.faders.B * s.master * duck,
      }
      ;['A', 'B'].forEach((k, col) => {
        const d = s.decks[k]
        const playing = d.state === 'playing'
        const frac = d.duration > 0 ? d.progress / d.duration : 0
        const target = playing
          ? amplitudeAt(d.track?.videoId, frac, d.track?.energy ?? 3, t + (k === 'B' ? 90 : 0)) *
            gain[k]
          : 0
        level[k] = Math.max(target, level[k] * 0.88) // fast attack, slow release
        const segH = cv.height / SEG
        const x = col === 0 ? 0 : cv.width * 0.56
        const w = cv.width * 0.44
        for (let i = 0; i < SEG; i++) {
          const lit = level[k] >= ((i + 1) / SEG) * 0.95
          const y = cv.height - (i + 1) * segH
          const color = i >= SEG - 2 ? '#f87171' : i >= SEG - 5 ? '#fbbf24' : '#34d399'
          ctx.fillStyle = lit ? color : 'rgba(255,255,255,0.06)'
          ctx.beginPath()
          ctx.roundRect(x, y + segH * 0.2, w, segH * 0.6, 3)
          ctx.fill()
        }
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas ref={ref} className="w-14 h-24" />
      <div className="flex w-14 justify-between px-0.5 text-[9px] font-semibold">
        <span className="text-cyan-300/70">A</span>
        <span className="text-pink-300/70">B</span>
      </div>
    </div>
  )
}

// The FX pad: one-shot crowd effects with per-button cooldowns.
function FXPad() {
  const cooldowns = useStore((s) => s.fxCooldowns)
  const ducked = useStore((s) => s.ducked)
  const [, forceTick] = useState(0)

  // re-render once a second while anything is cooling down
  useEffect(() => {
    const anyActive = Object.values(cooldowns).some((t) => t > Date.now())
    if (!anyActive) return
    const iv = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [cooldowns])

  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] text-zinc-600 text-center mb-1.5">FX</div>
      <div className="grid grid-cols-5 gap-1.5">
        {fx.FX_LIST.map((f) => {
          const waitMs = Math.max(0, (cooldowns[f.id] || 0) - Date.now())
          const cooling = waitMs > 0
          const disabled = cooling || ducked
          return (
            <div key={f.id} className="fx-socket">
              <button
                title={ducked ? 'Effects are off during talkover' : f.hint}
                disabled={disabled}
                onClick={() => {
                  fx.warmup()
                  const r = fx.fire(f.id)
                  if (!r.ok && r.reason !== 'cooling down') toast(r.reason)
                }}
                style={{ '--pad': f.color }}
                className="fx-pad w-full h-11 lg:h-12 flex flex-col items-center justify-center gap-px"
              >
                <span className="fx-label font-display text-[9px] font-bold tracking-[0.14em]">
                  {f.label}
                </span>
                {cooling && (
                  <span className="text-[8px] font-mono text-zinc-600 leading-none">
                    {Math.ceil(waitMs / 1000)}s
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
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
  const ducked = useStore((s) => s.ducked)
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
    <section className="w-full lg:w-72 shrink-0 lg:self-center flex flex-col gap-5 glass rounded-3xl px-5 py-6 my-2">
      <EnergyMeter />

      {/* transport */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => engine.back()}
          className="hw-round w-11 h-11 rounded-full grid place-items-center text-zinc-300"
          aria-label="Back"
        >
          <Icon.Prev />
        </button>
        <button
          onClick={() => {
            fx.warmup() // bless the FX audio context inside a real gesture
            engine.togglePlay()
          }}
          className={`hw-round w-16 h-16 rounded-full grid place-items-center ${
            playing ? 'glow-onair text-emerald-200' : 'glow-play text-zinc-100'
          }`}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
        <button
          onClick={() => engine.skip()}
          className="hw-round w-11 h-11 rounded-full grid place-items-center text-zinc-300"
          aria-label="Next"
        >
          <Icon.Next />
        </button>
      </div>

      {/* display strip */}
      <div className="hw-screen px-3 py-1.5 text-center text-[10px] font-mono text-cyan-100/70 truncate" title={status}>
        {status}
      </div>

      {/* channel meters behind glass */}
      <div className="flex justify-center">
        <div className="hw-screen px-4 py-2.5">
          <VUMeter />
        </div>
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

      {/* fx pad */}
      <FXPad />

      {/* auto dj (latching switch) + fade length */}
      <div className="flex items-center justify-between gap-3">
        <div className="fx-socket flex-1">
          <button
            onClick={() => engine.setAutoDJ(!autoDJ)}
            style={{ '--pad': '#a78bfa' }}
            className={`fx-pad w-full h-9 flex items-center justify-center gap-2 ${autoDJ ? '' : 'pad-off'}`}
            title="Automatic crossfades at each track's mix-out point"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${autoDJ ? 'bg-violet-300 pulse-soft' : 'bg-zinc-700'}`}
            />
            <span className="fx-label font-display text-[9px] font-bold tracking-[0.2em]">
              AUTO DJ
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => engine.setCrossfadeSeconds(fadeSeconds - 1)}
            className="hw-round w-7 h-7 rounded-lg text-sm text-zinc-300"
            aria-label="Shorter fade"
          >
            –
          </button>
          <span className="hw-screen px-2 py-1 w-10 text-center text-[11px] font-mono text-cyan-100/80">
            {fadeSeconds}s
          </span>
          <button
            onClick={() => engine.setCrossfadeSeconds(fadeSeconds + 1)}
            className="hw-round w-7 h-7 rounded-lg text-sm text-zinc-300"
            aria-label="Longer fade"
          >
            +
          </button>
        </div>
      </div>

      {/* talkover (latching switch) */}
      <div className="fx-socket">
        <button
          onClick={() => engine.toggleDuck(!ducked)}
          style={{ '--pad': '#fbbf24' }}
          className={`fx-pad w-full h-10 flex items-center justify-center gap-2.5 ${ducked ? '' : 'pad-off'}`}
          title="Duck the music to talk over it (T)"
        >
          <span className={`w-2 h-2 rounded-full ${ducked ? 'bg-amber-300 pulse-soft' : 'bg-zinc-700'}`} />
          <span className="fx-label font-display text-[10px] font-bold tracking-[0.25em]">
            TALKOVER
          </span>
        </button>
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
