// The DJ brain: Claude with tools that drive the decks.
// Runs entirely in the browser via the official Anthropic SDK
// (dangerouslyAllowBrowser) — the key never leaves localStorage.

import Anthropic from '@anthropic-ai/sdk'
import { useStore, uid, toast } from '../store'
import * as engine from './engine'
import { searchTrack, SearchError } from './search'
import { fmtTime } from './time'

export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — default DJ brain' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — faster & cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — cheapest' },
  { id: 'claude-fable-5', label: 'Claude Fable 5 — maximum brain' },
]

const S = () => useStore.getState()
const set = useStore.setState

// ------------------------------------------------------------------ prompt

// Stable system prompt — kept byte-identical across calls so prompt caching
// can kick in; all volatile state goes in a second system block.
const SYSTEM = `You are DJ WYS, a world-class event DJ running a LIVE set. The host talks to you between songs; your text replies are patter on their headset — warm, confident, and brief (1–3 short sentences, no markdown lists or headers unless asked). You control the decks ONLY through your tools.

CRAFT
- Open by learning the room: event type, audience, vibe, any must-plays or do-not-plays. If the host hasn't briefed you yet, ask one sharp question while still queueing something safe and broadly likable.
- Build arcs: warm-up → groove → peak → cooldown. Sequence adjacent tracks by energy, genre and era so every transition feels intentional.
- The energy scale: 1 = dinner/ambient … 5 = peak dancefloor. Move gradually unless the host demands a jump. Call set_energy when the direction changes.
- Variety: don't repeat an artist within ~5 tracks; never replay anything in recent_history unless asked.
- Honor requests instantly: "play X now" → play_now; "play X next" → queue_tracks with mode play_next.
- Keep the upcoming queue 5–10 tracks deep. Whenever live_state shows fewer than 4 upcoming, top it up with queue_tracks in the SAME response.
- A message starting with [AUTO] is from the app, not the host: the queue is running low. Extend the set seamlessly in the current vibe and reply with at most one short sentence, no greeting.

TRACK PICKING
- search_query format: "{artist} {title} official audio". For big visual moments use "official video" instead — the video shows on the decks.
- Prefer original studio recordings unless the host asks for live/remix versions.
- Mind explicit lyrics around family crowds — when kids are present search "{artist} {title} clean version".
- If a tool result says a track wasn't found or was blocked, pick a replacement immediately — never leave a hole in the set.

TOOLS
- Tool results report what was ACTUALLY queued from YouTube. If the wrong upload came back (a live take, a cover), fix it by re-queueing with a more specific search_query.
- set_crossfade: longer fades (8–12s) blend smoothly; shorter (2–4s) hit harder.
- Only pause_music when the host clearly wants silence (speeches, toasts); resume_music brings the room back.`

const TRACK_PROPS = {
  artist: { type: 'string' },
  title: { type: 'string' },
  search_query: {
    type: 'string',
    description: 'YouTube search query, usually "{artist} {title} official audio"',
  },
  energy: { type: 'integer', description: 'Track energy: 1 chill … 5 peak dancefloor' },
  note: { type: 'string', description: 'Optional: why this track — shown to the host' },
}

const TOOLS = [
  {
    name: 'queue_tracks',
    description:
      "Add tracks to the upcoming queue. mode 'append' adds to the end, 'play_next' slots them right after the current song, 'replace_upcoming' rebuilds the upcoming queue from scratch (the current song keeps playing). The result reports exactly what was found and queued.",
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['append', 'play_next', 'replace_upcoming'] },
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            properties: TRACK_PROPS,
            required: ['artist', 'title', 'search_query', 'energy'],
          },
        },
      },
      required: ['mode', 'tracks'],
    },
  },
  {
    name: 'play_now',
    description: 'Crossfade into this track immediately — the host wants to hear it right now.',
    input_schema: {
      type: 'object',
      properties: TRACK_PROPS,
      required: ['artist', 'title', 'search_query', 'energy'],
    },
  },
  {
    name: 'skip_track',
    description: 'Skip to the next queued track with a quick fade.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pause_music',
    description: 'Pause playback (speeches, toasts, announcements).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'resume_music',
    description: 'Resume playback after a pause.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_crossfade',
    description: 'Set the automatic crossfade length in seconds (2–20).',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'integer', description: '2–20 seconds' } },
      required: ['seconds'],
    },
  },
  {
    name: 'set_energy',
    description: "Set the room-energy dial (1–5) shown on the mixer; it should reflect where you're steering the set.",
    input_schema: {
      type: 'object',
      properties: { level: { type: 'integer', description: '1 dinner … 5 peak dancefloor' } },
      required: ['level'],
    },
  },
]

function stateBlock() {
  const s = S()
  const deck = s.decks[s.active]
  const state = {
    now_playing: deck.track
      ? {
          artist: deck.track.artist,
          title: deck.track.title,
          position: `${fmtTime(deck.progress)} / ${fmtTime(deck.duration)}`,
          state: deck.state,
        }
      : null,
    upcoming: s.queue.slice(0, 10).map((t) => ({
      artist: t.artist,
      title: t.title,
      energy: t.energy,
      duration: fmtTime(t.durationSec),
    })),
    upcoming_count: s.queue.length,
    recent_history: s.history.slice(-10).map((t) => `${t.artist} — ${t.title}`),
    energy_level: s.energy,
    crossfade_seconds: s.settings.fadeSeconds,
    auto_dj: s.autoDJ,
    local_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
  return `<live_state>\n${JSON.stringify(state, null, 1)}\n</live_state>`
}

// ------------------------------------------------------------------ chat plumbing

function pushChat(role, text, extra = {}) {
  set((s) => ({ chat: [...s.chat, { id: uid(), role, text, ...extra }] }))
}

// Keep API history bounded; it must start with a plain user text message
// (never an orphaned tool_result) or the API rejects the request.
function trimmedHistory() {
  let h = S().apiHistory
  if (h.length <= 36) return h
  h = h.slice(-36)
  const startIdx = h.findIndex(
    (m) => m.role === 'user' && typeof m.content === 'string'
  )
  return startIdx === -1 ? h.slice(-2) : h.slice(startIdx)
}

function pushApi(msg) {
  set((s) => ({ apiHistory: [...s.apiHistory, msg] }))
}

// ------------------------------------------------------------------ tool execution

async function resolveTrack(t) {
  const key = S().settings.youtubeKey
  const found = await searchTrack(t.search_query, key)
  if (!found) return null
  return {
    videoId: found.videoId,
    title: t.title,
    artist: t.artist,
    ytTitle: found.title,
    channel: found.channel,
    durationSec: found.durationSec,
    energy: t.energy,
    note: t.note,
    query: t.search_query,
    candidates: found.candidates,
  }
}

async function execQueueTracks({ mode = 'append', tracks = [] }) {
  const lines = []
  const found = []
  for (const t of tracks.slice(0, 12)) {
    try {
      const r = await resolveTrack(t)
      if (r) {
        found.push(r)
        lines.push(`OK: ${t.artist} — ${t.title} → "${r.ytTitle}" [${r.channel}] (${fmtTime(r.durationSec)})`)
      } else {
        lines.push(`NOT FOUND: ${t.artist} — ${t.title} (query: ${t.search_query})`)
      }
    } catch (e) {
      if (e instanceof SearchError && e.code === 'quota') {
        lines.push(`SEARCH QUOTA EXHAUSTED — cannot search more tracks today. ${found.length} resolved so far.`)
        break
      }
      lines.push(`ERROR searching "${t.search_query}": ${e.message}`)
    }
  }
  if (found.length) {
    engine.queueTracks(found, mode)
    const mins = Math.round(found.reduce((a, t) => a + (t.durationSec || 210), 0) / 60)
    pushChat('event', `🎵 ${mode === 'replace_upcoming' ? 'Rebuilt queue with' : 'Queued'} ${found.length} track${found.length > 1 ? 's' : ''} · ~${mins} min`)
  }
  return `Queued ${found.length}/${tracks.length} (mode: ${mode}).\n${lines.join('\n')}`
}

async function execPlayNow(input) {
  try {
    const r = await resolveTrack(input)
    if (!r) return `NOT FOUND: ${input.artist} — ${input.title}`
    engine.playNow(r)
    pushChat('event', `▶️ Now playing: ${r.artist} — ${r.title}`)
    return `Now crossfading into "${r.ytTitle}" [${r.channel}].`
  } catch (e) {
    return `ERROR: ${e.message}`
  }
}

async function executeTool(name, input) {
  switch (name) {
    case 'queue_tracks':
      return execQueueTracks(input)
    case 'play_now':
      return execPlayNow(input)
    case 'skip_track': {
      const had = S().queue.length
      engine.skip()
      pushChat('event', '⏭ Skipped')
      return had ? 'Skipped to the next track.' : 'Nothing queued to skip to — queue more first.'
    }
    case 'pause_music':
      engine.pauseMusic()
      pushChat('event', '⏸ Paused')
      return 'Playback paused.'
    case 'resume_music':
      engine.resumeMusic()
      pushChat('event', '▶️ Resumed')
      return 'Playback resumed.'
    case 'set_crossfade': {
      const v = engine.setCrossfadeSeconds(input.seconds)
      pushChat('event', `🎚 Crossfade → ${v}s`)
      return `Crossfade set to ${v} seconds.`
    }
    case 'set_energy': {
      const level = Math.max(1, Math.min(5, Math.round(input.level)))
      set({ energy: level })
      pushChat('event', `⚡ Energy → ${level}/5`)
      return `Energy dial set to ${level}.`
    }
    default:
      return `Unknown tool: ${name}`
  }
}

// ------------------------------------------------------------------ main loop

let inFlight = false

export async function sendToDJ(text, { auto = false } = {}) {
  const s = S()
  if (!s.settings.anthropicKey) {
    pushChat('error', 'No Anthropic API key yet — open Settings (gear icon) to add one. That key is the DJ brain.')
    return
  }
  if (inFlight) {
    if (!auto) toast('The DJ is still working on the last request…')
    return
  }
  inFlight = true
  set({ aiBusy: true })

  if (auto) {
    pushChat('event', '🤖 Queue running low — DJ is topping up the set')
  } else {
    pushChat('user', text)
  }
  pushApi({ role: 'user', content: text })

  const client = new Anthropic({
    apiKey: s.settings.anthropicKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  })

  try {
    for (let i = 0; i < 8; i++) {
      const response = await client.messages.create({
        model: S().settings.model,
        max_tokens: 4096,
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: stateBlock() },
        ],
        messages: trimmedHistory(),
        tools: TOOLS,
      })

      pushApi({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'tool_use') {
        const results = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          let out
          try {
            out = await executeTool(block.name, block.input)
          } catch (e) {
            out = `Tool failed: ${e.message}`
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
        }
        pushApi({ role: 'user', content: results })
        continue
      }

      const finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (finalText) pushChat('dj', finalText)
      break
    }
  } catch (e) {
    let msg = `DJ brain error: ${e.message}`
    if (e instanceof Anthropic.AuthenticationError) {
      msg = 'Anthropic key rejected — double-check it in Settings.'
    } else if (e instanceof Anthropic.RateLimitError) {
      msg = 'DJ brain is rate-limited — give it a few seconds and try again.'
    } else if (e instanceof Anthropic.APIConnectionError) {
      msg = "Can't reach the Anthropic API — check the internet connection."
    }
    pushChat('error', msg)
    if (auto) throw e
  } finally {
    inFlight = false
    set({ aiBusy: false })
  }
}

export function autoRefill() {
  const n = S().queue.length
  return sendToDJ(
    `[AUTO] The upcoming queue is down to ${n} track${n === 1 ? '' : 's'}. Extend the set in the current vibe with 5–6 more tracks.`,
    { auto: true }
  )
}

// Cheap key check: 1-token call against the cheapest model.
export async function validateAnthropicKey(key) {
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 })
    await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return true
  } catch (e) {
    return !(e instanceof Anthropic.AuthenticationError)
  }
}
