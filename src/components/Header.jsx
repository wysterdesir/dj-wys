import { useStore } from '../store'

export function Logo({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="djwys-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="27" fill="none" stroke="url(#djwys-g)" strokeWidth="5" />
      <polyline
        points="21,25 26.5,40 32,29 37.5,40 43,25"
        fill="none"
        stroke="#fafafa"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatusDot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-400" title={label}>
      <span
        className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-zinc-600'}`}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}

export default function Header() {
  const settings = useStore((s) => s.settings)
  const chatOpen = useStore((s) => s.chatOpen)

  return (
    <header className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-3 border-b border-white/10">
      <div className="flex items-center gap-2.5">
        <Logo />
        <h1 className="font-display font-bold text-xl tracking-tight bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 bg-clip-text text-transparent">
          DJ WYS
        </h1>
        <span className="hidden md:inline text-[11px] uppercase tracking-[0.2em] text-zinc-500 ml-1">
          virtual DJ booth
        </span>
      </div>

      <div className="flex items-center gap-4">
        <StatusDot ok={!!settings.anthropicKey} label="DJ brain" />
        <StatusDot ok={!!settings.youtubeKey} label="Track search" />
        <button
          onClick={() => useStore.setState({ chatOpen: !chatOpen })}
          className={`hidden lg:block text-xs px-3 py-1.5 rounded-full border ${
            chatOpen
              ? 'border-violet-400/40 text-violet-200 bg-violet-400/10'
              : 'border-white/15 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          ✦ Chat
        </button>
        <button
          onClick={() => useStore.setState({ settingsOpen: true })}
          aria-label="Settings"
          className="text-zinc-400 hover:text-white transition-colors text-lg leading-none"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
