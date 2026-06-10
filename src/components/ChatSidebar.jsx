import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { sendToDJ, MODELS } from '../lib/dj'

const QUICK_PROMPTS = [
  "🎉 Family birthday party — multigenerational crowd, start warm and fun",
  '🍸 Cocktail hour — smooth grooves, keep it low-key',
  '💍 Wedding reception — build to a big dance floor',
  '⚡ Bring the energy up!',
]

// Deliberately muted palette: the booth is the show — the chat is just the
// quiet headset conversation between host and DJ.
function Bubble({ m }) {
  if (m.role === 'event') {
    return (
      <div className="self-center text-[11px] text-zinc-600 bg-white/[0.03] border border-white/[0.04] px-3 py-1 rounded-full max-w-[90%] text-center">
        {m.text}
      </div>
    )
  }
  if (m.role === 'error') {
    return (
      <div className="self-start max-w-[88%] text-xs text-red-200/90 bg-red-500/10 border border-red-400/20 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
        {m.text}
      </div>
    )
  }
  const user = m.role === 'user'
  return (
    <div
      className={`max-w-[88%] text-[13px] leading-relaxed px-3.5 py-2.5 rounded-2xl whitespace-pre-wrap ${
        user
          ? 'self-end bg-white/[0.07] text-zinc-400 rounded-br-sm'
          : 'self-start bg-white/[0.04] border border-white/[0.06] text-zinc-400 rounded-bl-sm'
      }`}
    >
      {!user && <span className="block text-[10px] tracking-[0.2em] text-zinc-600 mb-1">DJ WYS</span>}
      {m.text}
    </div>
  )
}

export default function ChatSidebar() {
  const chat = useStore((s) => s.chat)
  const aiBusy = useStore((s) => s.aiBusy)
  const hasKey = useStore((s) => !!s.settings.anthropicKey)
  const model = useStore((s) => s.settings.model)
  const [input, setInput] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.length, aiBusy])

  const send = () => {
    const text = input.trim()
    if (!text || aiBusy) return
    setInput('')
    sendToDJ(text)
  }

  const modelShort = MODELS.find((m) => m.id === model)?.label.split(' — ')[0] || model

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black/20">
      {/* header */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
        <span
          className={`w-2 h-2 rounded-full ${
            !hasKey ? 'bg-red-400' : aiBusy ? 'bg-amber-300 pulse-soft' : 'bg-emerald-400'
          }`}
        />
        <h2 className="text-[11px] font-semibold tracking-[0.25em] text-zinc-300">DJ BOOTH</h2>
        <span className="text-[10px] text-zinc-600 truncate">{modelShort}</span>
      </div>

      {/* messages */}
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-4 py-4 flex flex-col gap-2.5">
        {chat.length === 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <p className="text-[13px] text-zinc-500 leading-relaxed">
              Tell me about tonight — the occasion, the crowd, the vibe — and I'll run the music
              while you run the party. 🎧
            </p>
            <div className="flex flex-col gap-2">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  onClick={() => hasKey && sendToDJ(q)}
                  className="text-left text-xs text-zinc-500 border border-white/[0.08] hover:border-white/25 hover:text-zinc-300 hover:bg-white/[0.03] rounded-xl px-3 py-2.5 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {aiBusy && (
          <div className="self-start text-xs text-zinc-600 italic px-1 flex items-center gap-2">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:120ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:240ms]" />
            </span>
            digging the crates…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* no-key banner */}
      {!hasKey && (
        <div className="shrink-0 mx-4 mb-2 text-xs text-amber-200/90 bg-amber-400/10 border border-amber-300/20 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <span>The DJ brain needs an Anthropic API key.</span>
          <button
            onClick={() => useStore.setState({ settingsOpen: true })}
            className="shrink-0 underline underline-offset-2 hover:text-white"
          >
            Add key
          </button>
        </div>
      )}

      {/* input */}
      <div className="shrink-0 p-3 border-t border-white/10 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={hasKey ? 'Talk to your DJ…' : 'Add your API key first…'}
          disabled={!hasKey}
          className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-[13px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-white/25 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!hasKey || !input.trim() || aiBusy}
          className="shrink-0 w-11 rounded-xl bg-white/[0.08] text-zinc-400 hover:bg-white/15 hover:text-zinc-200 font-bold disabled:opacity-30 active:scale-95 transition"
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
