// The DJ brain: Claude with tools that drive the decks.
// Runs entirely in the browser via the official Anthropic SDK
// (dangerouslyAllowBrowser) — the key never leaves localStorage.

import Anthropic from '@anthropic-ai/sdk'
import { useStore, uid, toast } from '../store'
import * as engine from './engine'
import * as sets from './sets'
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
- Keep the upcoming queue AT LEAST 10 tracks deep (10–15 is ideal). Whenever live_state shows fewer than 10 upcoming, top it up with queue_tracks in the SAME response — the host should always see what the next 10 songs are.
- A message starting with [AUTO] is from the app, not the host: the queue is running low. Extend the set seamlessly in the current vibe and reply with at most one short sentence, no greeting.
- When the host lays out the evening (phases, key moments, end time), call set_event_plan with a concise plan — then pace the set against live_state.local_time: build toward the moments, land the final song on time.
- The big screen is yours too: set_banner puts a scrolling message above the decks. Use it when asked ("put Happy Birthday up") and at natural moments — a dedication banner when the host dedicates a song, the event title at the start. Keep it short and celebratory; update or clear it when the moment passes.
- When the host clearly says the night is over ("that's a wrap", "shut it down"), end_set fades the music out and archives the gig's setlist. If the signal is ambiguous, ask once before ending.

TRACK PICKING
- search_query format: "{artist} {title} official audio". For big visual moments use "official video" instead — the video shows on the decks.
- Prefer original studio recordings unless the host asks for live/remix versions.
- Mind explicit lyrics around family crowds — when kids are present search "{artist} {title} clean version".
- If a tool result says a track wasn't found or was blocked, pick a replacement immediately — never leave a hole in the set.
- Mix points: for tracks you know well, set start_at to skip a video's cinematic intro and fade_out_at to start the blend before the outro/credits. This is what makes transitions feel hand-mixed. Omit both when unsure — the engine falls back to full length.

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
  start_at: {
    type: 'integer',
    description:
      'Optional, seconds: where the actual song begins — use to skip a music video\'s cinematic intro/dialogue. Only when reasonably sure.',
  },
  fade_out_at: {
    type: 'integer',
    description:
      'Optional, seconds: where the outro/credits begin — the crossfade to the next track starts there instead of at the very end. Only when reasonably sure.',
  },
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
    name: 'duck_music',
    description:
      'Talkover: duck the music to ~20% volume (on=true) for speeches/toasts/announcements, or bring it back up (on=false). Prefer this over pause_music when the host just needs to talk over the room.',
    input_schema: {
      type: 'object',
      properties: { on: { type: 'boolean' } },
      required: ['on'],
    },
  },
  {
    name: 'end_set',
    description:
      "End the night: fade the music to silence, archive this set's full played list into the set library, and reset the booth for the next gig. Call ONLY on a clear, unambiguous signal from the host that the gig is over ('that's a wrap', 'we're done, shut it down') — never on your own initiative.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_banner',
    description:
      "Set the big-screen scrolling banner above the decks — event title, birthday wishes, a thank-you, a song dedication. Short and punchy reads best (under ~80 chars, emojis welcome). Empty string clears it. Use it for moments: when the host dedicates a song, put the dedication up.",
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'set_event_plan',
    description:
      "Store or update the evening's run-of-show (phases, key moments, end time) as a short plan (max ~300 chars). Replaces the previous plan; it stays visible to you in live_state and to the host in the header.",
    input_schema: {
      type: 'object',
      properties: { plan: { type: 'string' } },
      required: ['plan'],
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
    talkover_ducked: s.ducked,
    event_plan: s.eventPlan || null,
    banner: s.banner || null,
    set_name: s.currentSet?.name || null,
    set_started: s.currentSet
      ? new Date(s.currentSet.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null,
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
    startAt: t.start_at,
    fadeOutAt: t.fade_out_at,
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
    case 'duck_music': {
      engine.toggleDuck(input.on)
      pushChat('event', input.on ? '🎙 Talkover — music ducked' : '🎙 Music back up')
      return input.on ? 'Music ducked to talkover level.' : 'Music restored to full volume.'
    }
    case 'end_set': {
      const n = sets.snapshotTracks().length
      sets.endSet()
      pushChat('event', '🏁 Set ended — fading out and archiving')
      return `Set ended: music fading out, ${n} played track${n === 1 ? '' : 's'} archived to the library, booth reset.`
    }
    case 'set_banner': {
      const text = String(input.text || '').slice(0, 140)
      set({ banner: text })
      pushChat('event', text ? `📢 Banner: "${text}"` : '📢 Banner cleared')
      return text ? `Big-screen banner now scrolling: "${text}"` : 'Banner cleared.'
    }
    case 'set_event_plan': {
      const plan = String(input.plan || '').slice(0, 400)
      set({ eventPlan: plan })
      pushChat('event', '📋 Run-of-show updated')
      return `Event plan stored: ${plan}`
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
  const need = Math.max(4, 12 - n)
  return sendToDJ(
    `[AUTO] The upcoming queue is down to ${n} track${n === 1 ? '' : 's'}. Top it up with ${need} more in the current vibe so at least 10 stay queued.`,
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
