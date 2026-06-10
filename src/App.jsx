import { useEffect } from 'react'
import { useStore } from './store'
import * as engine from './lib/engine'
import Header from './components/Header'
import Banner from './components/Banner'
import Deck from './components/Deck'
import Mixer from './components/Mixer'
import QueuePanel from './components/QueuePanel'
import ChatSidebar from './components/ChatSidebar'
import SettingsModal from './components/SettingsModal'

function MobileTabBar() {
  const tab = useStore((s) => s.mobileTab)
  const queueLen = useStore((s) => s.queue.length)
  const setTab = (t) => useStore.setState({ mobileTab: t })
  const tabs = [
    ['decks', 'Decks', '◉'],
    ['queue', `Queue${queueLen ? ` · ${queueLen}` : ''}`, '☰'],
    ['chat', 'DJ Chat', '✦'],
  ]
  return (
    <nav className="lg:hidden shrink-0 grid grid-cols-3 border-t border-white/10 bg-black/60 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      {tabs.map(([id, label, icon]) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`py-3 text-xs font-medium tracking-wide flex flex-col items-center gap-0.5 ${
            tab === id ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <span className="text-base leading-none">{icon}</span>
          {label}
        </button>
      ))}
    </nav>
  )
}

// ambient room lighting: the page itself leans toward the live deck's color
function StageGlow() {
  const active = useStore((s) => s.active)
  const playing = useStore((s) => s.decks[s.active].state === 'playing')
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <div
        className={`absolute inset-0 transition-opacity duration-[2000ms] ${
          playing && active === 'A' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background:
            'radial-gradient(1100px 800px at 20% 40%, rgba(34,211,238,0.09), transparent 65%)',
        }}
      />
      <div
        className={`absolute inset-0 transition-opacity duration-[2000ms] ${
          playing && active === 'B' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background:
            'radial-gradient(1100px 800px at 80% 40%, rgba(244,114,182,0.09), transparent 65%)',
        }}
      />
    </div>
  )
}

// slim now-playing bar for the mobile Queue/Chat tabs — never fly blind
function NowPlayingBar() {
  const decks = useStore((s) => s.decks)
  const active = useStore((s) => s.active)
  const tab = useStore((s) => s.mobileTab)
  const d = decks[active]
  if (tab === 'decks' || !d.track) return null
  const frac = d.duration > 0 ? Math.min(100, (d.progress / d.duration) * 100) : 0
  const playing = d.state === 'playing' || d.state === 'loading'
  return (
    <div className="lg:hidden shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-xl">
      <div className="h-0.5 bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400"
          style={{ width: `${frac}%` }}
        />
      </div>
      <div
        className="flex items-center gap-3 px-3 py-2"
        onClick={() => useStore.setState({ mobileTab: 'decks' })}
      >
        <img
          src={`https://i.ytimg.com/vi/${d.track.videoId}/default.jpg`}
          alt=""
          className="w-9 h-9 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-zinc-100 truncate">{d.track.title}</div>
          <div className="text-[10px] text-zinc-500 truncate">{d.track.artist}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            engine.togglePlay()
          }}
          className="w-9 h-9 grid place-items-center rounded-full bg-white/10 text-xs"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            engine.skip()
          }}
          className="w-9 h-9 grid place-items-center rounded-full bg-white/10 text-xs"
          aria-label="Skip"
        >
          ⏭
        </button>
      </div>
    </div>
  )
}

// Last-resort autoplay nudge: a small pill, never a blocking overlay — the
// engine recovers silently (retry → muted start + unmute) before this shows.
function AutoplayNudge() {
  const needsTap = useStore((s) => s.needsTap)
  if (!needsTap) return null
  return (
    <button
      onClick={() => engine.resumeFromTap()}
      className="fixed left-1/2 -translate-x-1/2 bottom-24 lg:bottom-44 z-40 flex items-center gap-2 pl-3.5 pr-4.5 py-2.5 rounded-full bg-black/85 backdrop-blur border border-amber-300/40 text-amber-200 text-sm shadow-2xl hover:bg-black active:scale-95 transition"
    >
      🔇 Tap to resume the music
    </button>
  )
}

function Toast() {
  const msg = useStore((s) => s.toast)
  if (!msg) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-20 lg:bottom-6 z-40 glass rounded-full px-5 py-2.5 text-sm text-zinc-100 shadow-xl max-w-[90vw]">
      {msg}
    </div>
  )
}

export default function App() {
  const mobileTab = useStore((s) => s.mobileTab)
  const chatOpen = useStore((s) => s.chatOpen)

  // transport keyboard shortcuts (ignored while typing)
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      const s = useStore.getState()
      switch (e.key) {
        case ' ':
          e.preventDefault()
          engine.togglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          engine.skip()
          break
        case 'ArrowLeft':
          e.preventDefault()
          engine.back()
          break
        case 'ArrowUp':
          e.preventDefault()
          engine.setMaster(Math.min(1, s.master + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          engine.setMaster(Math.max(0, s.master - 0.05))
          break
        case 't':
        case 'T':
          engine.toggleDuck(!s.ducked)
          break
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-dvh flex flex-col overflow-hidden no-select">
      <StageGlow />
      <Header />

      <div className="flex flex-1 min-h-0">
        {/* main stage — decks stay mounted always (players live inside) */}
        <main
          className={`flex-1 min-w-0 flex-col ${
            mobileTab === 'decks' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          <Banner />
          <div className="flex-1 min-h-0 overflow-y-auto thin-scroll lg:overflow-visible">
            <div className="flex flex-col lg:flex-row items-stretch gap-4 xl:gap-10 px-4 lg:px-8 py-3 lg:h-full w-full max-w-[1880px] mx-auto">
              <Deck deck="A" />
              <Mixer />
              <Deck deck="B" />
            </div>
          </div>
          <div className="hidden lg:block shrink-0">
            <QueuePanel variant="strip" />
          </div>
        </main>

        {/* mobile queue page */}
        <section className={`flex-1 min-w-0 ${mobileTab === 'queue' ? 'flex' : 'hidden'} lg:hidden`}>
          <QueuePanel variant="page" />
        </section>

        {/* chat: sidebar on desktop, tab page on mobile */}
        <aside
          className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} flex-1 min-w-0 lg:min-w-0 ${
            chatOpen ? 'lg:flex' : 'lg:hidden'
          } lg:flex-none lg:w-[380px] lg:border-l lg:border-white/10`}
        >
          <ChatSidebar />
        </aside>
      </div>

      <NowPlayingBar />
      <MobileTabBar />
      <SettingsModal />
      <AutoplayNudge />
      <Toast />
    </div>
  )
}
