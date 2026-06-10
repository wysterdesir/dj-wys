import { useStore } from './store'
import * as engine from './lib/engine'
import Header from './components/Header'
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

function TapOverlay() {
  const needsTap = useStore((s) => s.needsTap)
  if (!needsTap) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center">
      <button
        onClick={() => engine.resumeFromTap()}
        className="px-8 py-5 rounded-2xl bg-white text-black font-display font-semibold text-lg shadow-[0_0_60px_rgba(34,211,238,0.4)]"
      >
        ▶ &nbsp;Tap to keep the music going
      </button>
    </div>
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

  return (
    <div className="h-dvh flex flex-col overflow-hidden no-select">
      <Header />

      <div className="flex flex-1 min-h-0">
        {/* main stage — decks stay mounted always (players live inside) */}
        <main
          className={`flex-1 min-w-0 flex-col ${
            mobileTab === 'decks' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          <div className="flex-1 min-h-0 overflow-y-auto thin-scroll lg:overflow-visible">
            <div className="flex flex-col lg:flex-row items-stretch gap-4 px-4 lg:px-6 py-3 lg:h-full">
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

      <MobileTabBar />
      <SettingsModal />
      <TapOverlay />
      <Toast />
    </div>
  )
}
