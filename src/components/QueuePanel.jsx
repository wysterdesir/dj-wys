import { useState } from 'react'
import { useStore } from '../store'
import * as engine from '../lib/engine'
import { drag } from '../lib/dragdrop'
import { loadDemoSet } from '../lib/demo'
import { fmtTime, fmtRuntime } from '../lib/time'

function EnergyDots({ n }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1 h-1 rounded-full ${i <= n ? 'bg-violet-300' : 'bg-white/10'}`}
        />
      ))}
    </span>
  )
}

function TrackCard({ t, index, compact }) {
  const [over, setOver] = useState(false)
  const draggable = index >= 0 // history rows aren't draggable

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        drag.id = t.id
        e.dataTransfer.effectAllowed = 'move'
        try {
          e.dataTransfer.setData('text/plain', t.id)
        } catch {
          /* older browsers */
        }
      }}
      onDragEnd={() => {
        drag.id = null
      }}
      onDragOver={(e) => {
        if (draggable && drag.id && drag.id !== t.id) {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!draggable) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        if (drag.id && drag.id !== t.id) engine.moveBefore(drag.id, t.id)
        drag.id = null
      }}
      className={`group relative shrink-0 glass rounded-xl overflow-hidden transition-shadow ${
        compact ? 'w-44' : 'w-full flex items-center gap-3 pr-2'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
        over ? 'ring-2 ring-violet-400/80 shadow-[0_0_18px_rgba(167,139,250,0.35)]' : ''
      }`}
    >
      <div className={compact ? 'relative pointer-events-none' : 'relative shrink-0 w-24 pointer-events-none'}>
        <img
          src={`https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          draggable={false}
          className={compact ? 'w-full h-20 object-cover' : 'w-24 h-14 object-cover'}
        />
        <span className="absolute bottom-1 right-1 text-[10px] font-mono bg-black/70 px-1 rounded">
          {fmtTime(t.durationSec)}
        </span>
        {index === 0 && (
          <span className="absolute top-1 left-1 text-[9px] font-semibold tracking-wider bg-violet-500/80 px-1.5 py-0.5 rounded">
            NEXT
          </span>
        )}
      </div>
      <div className={compact ? 'p-2 pointer-events-none' : 'min-w-0 flex-1 py-1.5 pointer-events-none'}>
        <div className="text-xs font-medium text-zinc-100 truncate">{t.title}</div>
        <div className="text-[11px] text-zinc-500 truncate">{t.artist}</div>
        <div className="mt-1 flex items-center gap-2">
          <EnergyDots n={t.energy ?? 3} />
          {t.note && t.note !== 'demo' && (
            <span className="text-[10px] text-zinc-600 truncate" title={t.note}>
              {t.note}
            </span>
          )}
        </div>
      </div>
      {draggable && (
        <div
          className={`${
            compact
              ? 'absolute top-1 right-1 flex-col opacity-0 group-hover:opacity-100'
              : 'flex-row opacity-60'
          } flex gap-1 transition-opacity`}
        >
          <button
            onClick={() => engine.playNowFromQueue(t.id)}
            title="Play now (crossfade in)"
            className="w-6 h-6 grid place-items-center rounded-md bg-black/70 hover:bg-emerald-500/70 text-[10px]"
          >
            ▶
          </button>
          {index > 0 && (
            <button
              onClick={() => engine.moveToFront(t.id)}
              title="Play next"
              className="w-6 h-6 grid place-items-center rounded-md bg-black/70 hover:bg-violet-500/70 text-[11px]"
            >
              ↑
            </button>
          )}
          <button
            onClick={() => engine.removeFromQueue(t.id)}
            title="Remove"
            className="w-6 h-6 grid place-items-center rounded-md bg-black/70 hover:bg-red-500/70 text-[11px]"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default function QueuePanel({ variant = 'strip' }) {
  const queue = useStore((s) => s.queue)
  const history = useStore((s) => s.history)
  const [showHistory, setShowHistory] = useState(false)
  const [endOver, setEndOver] = useState(false)

  const runtime = queue.reduce((a, t) => a + (t.durationSec || 210), 0)
  const list = showHistory ? [...history].reverse() : queue
  const page = variant === 'page'

  // dropping on empty space sends the track to the end of the queue
  const containerDnD = showHistory
    ? {}
    : {
        onDragOver: (e) => {
          if (drag.id) {
            e.preventDefault()
            setEndOver(true)
          }
        },
        onDragLeave: () => setEndOver(false),
        onDrop: (e) => {
          e.preventDefault()
          setEndOver(false)
          if (drag.id) engine.moveToEnd(drag.id)
          drag.id = null
        },
      }

  const header = (
    <div className="flex items-center gap-3 px-4 pt-3 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.25em] text-zinc-400">
        {showHistory ? 'PLAYED' : 'UP NEXT'}
      </h2>
      {!showHistory && queue.length > 0 && (
        <span className="text-[11px] text-zinc-600">
          {queue.length} track{queue.length > 1 ? 's' : ''} · ~{fmtRuntime(runtime)}
        </span>
      )}
      {!showHistory && queue.length > 0 && queue.length < 5 && (
        <span className="text-[10px] text-amber-300/90 bg-amber-400/10 px-2 py-0.5 rounded-full">
          queue low
        </span>
      )}
      {!showHistory && queue.length > 0 && (
        <span className="hidden lg:inline text-[10px] text-zinc-700">
          drag to reorder · drop on a deck to play now
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="text-[11px] text-zinc-500 hover:text-zinc-300"
      >
        {showHistory ? '→ queue' : '⟲ history'}
      </button>
    </div>
  )

  const empty = (
    <div className={`flex ${page ? 'flex-col flex-1' : ''} items-center justify-center gap-3 px-6 py-4 w-full`}>
      <p className="text-sm text-zinc-500 text-center">
        {showHistory ? 'Nothing played yet.' : 'Queue is empty — tell the DJ about your event, or'}
      </p>
      {!showHistory && (
        <button
          onClick={() => loadDemoSet()}
          className="text-xs px-4 py-2 rounded-full border border-white/15 text-zinc-200 hover:border-violet-400/50 hover:text-white transition"
        >
          ▶ Load the demo set
        </button>
      )}
    </div>
  )

  return (
    <div className={page ? 'flex flex-col flex-1 min-h-0' : 'border-t border-white/10'}>
      {header}
      {list.length === 0 ? (
        empty
      ) : page ? (
        <div
          {...containerDnD}
          className={`flex-1 overflow-y-auto thin-scroll px-4 pb-4 flex flex-col gap-2 ${
            endOver ? 'bg-violet-400/[0.04]' : ''
          }`}
        >
          {list.map((t, i) => (
            <TrackCard key={t.id} t={t} index={showHistory ? -1 : i} compact={false} />
          ))}
        </div>
      ) : (
        <div
          {...containerDnD}
          className={`flex gap-3 overflow-x-auto thin-scroll px-4 pb-3 ${
            endOver ? 'bg-violet-400/[0.04]' : ''
          }`}
        >
          {list.map((t, i) => (
            <TrackCard key={t.id} t={t} index={showHistory ? -1 : i} compact />
          ))}
        </div>
      )}
    </div>
  )
}
