import { useEffect } from 'react'
import { useStore } from '../store'
import * as engine from '../lib/engine'
import { fmtTime } from '../lib/time'
import Waveform from './Waveform'

const COLORS = {
  A: { hex: '#22d3ee', text: 'text-cyan-300', glow: 'rgba(34,211,238,0.55)', ring: 'border-cyan-400/35' },
  B: { hex: '#f472b6', text: 'text-pink-300', glow: 'rgba(244,114,182,0.55)', ring: 'border-pink-400/35' },
}

export default function Deck({ deck }) {
  const d = useStore((s) => s.decks[deck])
  const active = useStore((s) => s.active)
  const transition = useStore((s) => s.transition)
  const videoMode = useStore((s) => s.settings.videoMode)
  const fader = useStore((s) => s.faders[deck])
  const c = COLORS[deck]
  const elId = `yt-deck-${deck}`
  const isLive = active === deck || transition?.to === deck
  const playing = d.state === 'playing'

  useEffect(() => {
    engine.attachDeck(deck, elId)
    // players persist for the app's lifetime — never torn down
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const platter = videoMode === 'platter'

  return (
    <section
      className={`flex-1 min-w-0 flex flex-col justify-center gap-3 py-2 ${
        isLive ? 'order-first' : 'order-last'
      } lg:order-none`}
    >
      {/* deck label */}
      <div className="flex items-center justify-between px-1">
        <span className={`font-display font-semibold text-sm tracking-[0.25em] ${c.text}`}>
          DECK {deck}
        </span>
        <span
          className={`text-[10px] font-semibold tracking-[0.2em] px-2 py-0.5 rounded-full ${
            isLive && playing
              ? 'bg-red-500/15 text-red-300 pulse-soft'
              : 'bg-white/5 text-zinc-600'
          }`}
        >
          {isLive && playing ? '● ON AIR' : isLive ? 'LIVE DECK' : 'STANDBY'}
        </span>
      </div>

      {/* video stage */}
      <div
        className={
          platter
            ? 'relative w-full max-w-[280px] lg:max-w-[330px] aspect-square mx-auto'
            : 'relative w-full max-w-[560px] mx-auto aspect-video'
        }
      >
        {platter && (
          <>
            <div
              className={`absolute -inset-2.5 rounded-full border-2 border-dashed ${c.ring} platter-ring ${
                playing ? '' : 'paused'
              }`}
            />
            <div
              className={`absolute -inset-2.5 rounded-full platter-ring ${playing ? '' : 'paused'}`}
            >
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full"
                style={{ background: c.hex, boxShadow: `0 0 10px ${c.glow}` }}
              />
            </div>
          </>
        )}
        <div
          className={`absolute inset-0 overflow-hidden bg-black ring-1 ring-white/10 ${
            platter ? 'rounded-full' : 'rounded-2xl'
          }`}
          style={isLive && playing ? { boxShadow: `0 0 50px -12px ${c.glow}` } : undefined}
        >
          <div
            className={`yt-stage ${platter ? 'platter' : 'cinema'} ${d.track ? '' : 'opacity-0'}`}
          >
            <div id={elId} />
          </div>
          {!d.track && (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-white/[0.04] to-transparent">
              <div className="text-center px-6">
                <div className={`font-display text-5xl font-bold opacity-15 ${c.text}`}>{deck}</div>
                <div className="text-[11px] text-zinc-600 mt-1">deck empty</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* track info */}
      <div className="text-center px-2 min-h-[2.6rem]">
        {d.track ? (
          <>
            <div className="font-medium text-sm text-zinc-100 truncate">{d.track.title}</div>
            <div className="text-xs text-zinc-500 truncate">{d.track.artist}</div>
          </>
        ) : (
          <div className="text-xs text-zinc-600 italic">waiting for a track…</div>
        )}
      </div>

      {/* waveform + time */}
      <div className="px-1">
        <Waveform
          videoId={d.track?.videoId}
          progress={d.progress}
          duration={d.duration}
          playing={playing}
          energy={d.track?.energy ?? 3}
          color={c.hex}
        />
        <div className="flex justify-between text-[11px] font-mono text-zinc-500 mt-1 px-0.5">
          <span>{d.track ? fmtTime(d.progress) : '–:––'}</span>
          <span className={d.track && d.duration - d.progress < 20 ? 'text-amber-300' : ''}>
            {d.track && d.duration > 0 ? `-${fmtTime(Math.max(0, d.duration - d.progress))}` : '–:––'}
          </span>
        </div>
      </div>

      {/* channel fader */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-[10px] tracking-widest text-zinc-600 w-8">VOL</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(fader * 100)}
          onChange={(e) => engine.setFader(deck, e.target.value / 100)}
          className="fader w-full"
          style={{ '--fader-glow': c.glow }}
          aria-label={`Deck ${deck} volume`}
        />
        <span className="text-[10px] font-mono text-zinc-500 w-8 text-right">
          {Math.round(fader * 100)}
        </span>
      </div>
    </section>
  )
}
