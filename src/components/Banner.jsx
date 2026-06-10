import { useState } from 'react'
import { useStore } from '../store'

// Big-screen marquee above the decks: event title, birthday wishes,
// dedications. Text rides in the live deck's color. Set it by clicking
// here, in Settings, or by just asking the DJ (set_banner tool).

const COLORS = {
  A: { hex: '#22d3ee', glow: 'rgba(34,211,238,0.5)' },
  B: { hex: '#f472b6', glow: 'rgba(244,114,182,0.5)' },
}

export default function Banner() {
  const banner = useStore((s) => s.banner)
  const active = useStore((s) => s.active)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const c = COLORS[active]

  const save = () => {
    useStore.setState({ banner: draft.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="shrink-0 px-6 py-2 flex justify-center">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={save}
          maxLength={140}
          placeholder="Type the big-screen message… (Enter to save, Esc to cancel)"
          className="w-full max-w-2xl text-center bg-white/[0.06] border border-white/20 rounded-full px-5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-white/35"
        />
      </div>
    )
  }

  if (!banner) {
    return (
      <div className="shrink-0 hidden lg:flex justify-center py-1.5">
        <button
          onClick={() => {
            setDraft('')
            setEditing(true)
          }}
          className="text-[10px] text-zinc-700 hover:text-zinc-400 tracking-[0.3em] transition-colors"
        >
          ✦ ADD BIG-SCREEN BANNER
        </button>
      </div>
    )
  }

  const text = banner.toUpperCase()
  const repeats = Math.max(3, Math.ceil(60 / Math.max(4, text.length)))
  const totalChars = (text.length + 4) * repeats
  // doubled glyphs = doubled pixels per char; doubled duration keeps the pace
  const dur = Math.min(180, Math.max(28, Math.round(totalChars * 0.64)))

  const Half = ({ hidden }) => (
    <div className="flex items-center shrink-0" aria-hidden={hidden}>
      {Array.from({ length: repeats }, (_, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          <span>{text}</span>
          <span className="mx-8 lg:mx-12 text-[0.55em] opacity-50">✦</span>
        </span>
      ))}
    </div>
  )

  return (
    <div className="shrink-0 relative group py-1 lg:py-2" role="marquee" aria-label={banner}>
      <div className="overflow-hidden marquee-mask">
        <div
          className="marquee-track flex w-max font-display font-bold uppercase tracking-[0.2em] text-[2.5rem] lg:text-[4.8rem] leading-tight"
          style={{
            '--marquee-dur': `${dur}s`,
            color: c.hex,
            textShadow: `0 0 30px ${c.glow}, 0 0 7px ${c.glow}`,
            transition: 'color 1.2s ease, text-shadow 1.2s ease',
          }}
        >
          <Half />
          <Half hidden />
        </div>
      </div>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => {
            setDraft(banner)
            setEditing(true)
          }}
          title="Edit banner"
          className="w-7 h-7 grid place-items-center rounded-full bg-black/70 border border-white/15 text-zinc-300 hover:text-white text-xs"
        >
          ✎
        </button>
        <button
          onClick={() => useStore.setState({ banner: '' })}
          title="Clear banner"
          className="w-7 h-7 grid place-items-center rounded-full bg-black/70 border border-white/15 text-zinc-300 hover:text-red-300 text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
