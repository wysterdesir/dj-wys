import { useEffect, useState } from 'react'
import { useStore } from '../store'
import * as engine from '../lib/engine'
import { drag } from '../lib/dragdrop'
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
  const nextTrack = useStore((s) => s.queue[0])
  const activeDeckHasTrack = useStore((s) => !!s.decks[s.active].track)
  const fadeSeconds = useStore((s) => s.settings.fadeSeconds)
  const [dropOver, setDropOver] = useState(false)
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

  const dropHandlers = {
    onDragOver: (e) => {
      if (drag.id) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropOver(true)
      }
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false)
    },
    onDrop: (e) => {
      e.preventDefault()
      setDropOver(false)
      if (drag.id) {
        engine.playNowFromQueue(drag.id, deck)
        drag.id = null
      }
    },
  }

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

      {/* video stage (also a drop target: drop a queued track to play it now) */}
      <div
        {...dropHandlers}
        className={
          platter
            ? 'relative w-full max-w-[280px] lg:max-w-[min(42vh,500px)] aspect-square mx-auto'
            : 'relative w-full max-w-[560px] lg:max-w-[680px] mx-auto aspect-video'
        }
      >
        {/* stage light: the live deck radiates its color */}
        <div
          className="absolute -inset-12 rounded-full blur-3xl transition-opacity duration-1000 pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)`,
            opacity: isLive && playing ? 0.4 : 0,
          }}
        />
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
            {/* elapsed-time arc; warms to amber as the mix-out point nears */}
            {d.track &&
              (() => {
                const C = 2 * Math.PI * 48
                const frac = d.duration > 0 ? Math.min(1, d.progress / d.duration) : 0
                const mixOut = engine.mixOutPoint(d.track, d.duration)
                const nearOut =
                  playing && d.duration > 0 && mixOut - d.progress <= fadeSeconds + 10
                return (
                  <svg viewBox="0 0 100 100" className="absolute -inset-4 pointer-events-none">
                    <circle
                      cx="50"
                      cy="50"
                      r="48"
                      fill="none"
                      stroke="rgba(255,255,255,0.07)"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="48"
                      fill="none"
                      stroke={nearOut ? '#fbbf24' : c.hex}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray={C}
                      strokeDashoffset={C * (1 - frac)}
                      transform="rotate(-90 50 50)"
                      style={{
                        transition: 'stroke 0.5s',
                        opacity: 0.9,
                        filter: nearOut
                          ? 'drop-shadow(0 0 5px rgba(251,191,36,0.8))'
                          : `drop-shadow(0 0 3px ${c.glow})`,
                      }}
                    />
                  </svg>
                )
              })()}
          </>
        )}
        <div
          className={`absolute inset-0 overflow-hidden bg-black ring-1 ${
            dropOver ? 'ring-2 ring-violet-300/80' : 'ring-white/10'
          } ${platter ? 'rounded-full' : 'rounded-2xl'}`}
          style={isLive && playing ? { boxShadow: `0 0 50px -12px ${c.glow}` } : undefined}
        >
          <div
            className={`yt-stage ${platter ? 'platter' : 'cinema'} ${d.track ? '' : 'opacity-0'}`}
          >
            <div id={elId} />
          </div>

          {/* transparent shield: catches drag events that the iframe would
              otherwise swallow (we drive playback via the API, controls=0) */}
          <div className="absolute inset-0" />

          {/* vinyl read: edge vignette + faint grooves over the spinning video */}
          {platter && d.track && (
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle, transparent 54%, rgba(0,0,0,0.25) 78%, rgba(0,0,0,0.55) 100%), repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 0 1px, transparent 1px 6px)',
              }}
            />
          )}

          {/* empty deck: preview what's up next (on the deck that will receive it) */}
          {!d.track &&
            (nextTrack && (deck === active || activeDeckHasTrack) ? (
              <div className="absolute inset-0 pointer-events-none">
                <img
                  src={`https://i.ytimg.com/vi/${nextTrack.videoId}/hqdefault.jpg`}
                  alt=""
                  draggable={false}
                  className="w-full h-full object-cover opacity-60"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/45" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-[14%] text-center">
                  <span className="text-[9px] font-semibold tracking-[0.3em] px-2.5 py-1 rounded-full bg-black/60 border border-white/15 text-zinc-200">
                    UP NEXT
                  </span>
                  <div className="text-sm font-semibold text-white drop-shadow max-w-full truncate">
                    {nextTrack.title}
                  </div>
                  <div className="text-xs text-zinc-300/90 max-w-full truncate">{nextTrack.artist}</div>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none">
                <div className="text-center px-6">
                  <div className={`font-display text-5xl font-bold opacity-15 ${c.text}`}>{deck}</div>
                  <div className="text-[11px] text-zinc-600 mt-1">deck empty</div>
                </div>
              </div>
            ))}

          {/* drop highlight */}
          {dropOver && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-violet-500/20 pointer-events-none">
              <span className="text-[11px] font-bold tracking-[0.25em] px-3.5 py-1.5 rounded-full bg-black/75 border border-violet-300/50 text-violet-100">
                DROP TO PLAY
              </span>
            </div>
          )}
        </div>
      </div>

      {/* track info */}
      <div className="text-center px-2 min-h-[2.6rem] lg:min-h-[3.6rem]">
        {d.track ? (
          <>
            <div className="font-display font-semibold text-sm lg:text-xl text-zinc-100 truncate">
              {d.track.title}
            </div>
            <div className="text-xs lg:text-sm text-zinc-500 truncate">{d.track.artist}</div>
          </>
        ) : (
          <div className="text-xs text-zinc-600 italic">
            {nextTrack ? 'standing by…' : 'waiting for a track…'}
          </div>
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
