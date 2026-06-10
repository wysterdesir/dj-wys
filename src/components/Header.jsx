import { useStore } from '../store'

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
      <div className="flex items-baseline gap-3">
        <h1 className="font-display font-bold text-xl tracking-tight bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 bg-clip-text text-transparent">
          AI·DJ
        </h1>
        <span className="hidden md:inline text-[11px] uppercase tracking-[0.2em] text-zinc-500">
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
