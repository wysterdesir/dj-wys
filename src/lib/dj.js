// The DJ brain: Claude with tools that drive the decks.
// Runs entirely in the browser via the official Anthropic SDK
// (dangerouslyAllowBrowser) — the key never leaves localStorage.

import Anthropic from '@anthropic-ai/sdk'
import { useStore, uid, toast } from '../store'
import * as engine from './engine'
import * as sets from './sets'
import { fire as fireEffect } from './fx'
import {
  searchTrack,
  SearchError,
  libraryLookup,
  libraryAdd,
  lookupVideos,
  plausibleMatch,
  quotaUsedToday,
  libraryFresh,
} from './search'
import { fmtTime, fmtRuntime } from './time'
import { stripThinking, hasThinking, isTurnStart } from './history'
import { sameSong, sameArtist } from './freshness'

// Newest flagship known at build time — the safety net when the live
// model listing can't be reached (offline, key without models scope).
export const FALLBACK_FLAGSHIP = 'claude-opus-5-5'

export const MODELS = [
  { id: 'auto', label: 'Auto — always the newest Opus (recommended)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — current flagship DJ brain' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — faster & cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — cheapest' },
  { id: 'claude-fable-5', label: 'Claude Fable 5 — maximum brain, premium price' },
]

// 'claude-opus-5-5' → 'Opus 5.5' (header chip, settings check)
export function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id || '')
  if (!m) return id || ''
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

// Pick the newest Opus from a Models API listing by version number — a
// patch to an older line published later must not win — with created_at
// as the tiebreak. Bare version IDs only; suffixed variants are skipped.
// Opus is the flagship tier the app tracks; Fable/Mythos cost 2x and stay
// a deliberate manual choice in the dropdown.
export function newestOpusFrom(models) {
  let best = null
  let bestKey = null
  for (const m of models) {
    const v = /^claude-opus-(\d+)(?:-(\d+))?$/.exec(m?.id || '')
    if (!v) continue
    const key = [Number(v[1]), Number(v[2] || 0), new Date(m.created_at || 0).getTime()]
    const newer =
      !bestKey ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))
    if (newer) {
      best = m
      bestKey = key
    }
  }
  return best ? best.id : FALLBACK_FLAGSHIP
}

// 'auto' resolves against the live Models API (one tokenless request),
// memoized for the session, so a future Opus 6 gets picked up the day the
// key can see it — no app update needed. Falls back to the newest Opus
// known at build time; failures aren't memoized, so the next send retries.
let autoPromise = null
export function resolveModel(selected, client) {
  if (selected !== 'auto') return Promise.resolve(selected)
  if (!autoPromise) {
    autoPromise = (async () => {
      const seen = []
      for await (const m of client.models.list()) seen.push(m)
      return newestOpusFrom(seen)
    })().catch(() => {
      autoPromise = null
      return FALLBACK_FLAGSHIP
    })
  }
  return autoPromise
}

function generation(model) {
  const m = /^claude-(opus|sonnet|fable|mythos)-(\d+)/.exec(model || '')
  return m ? { tier: m[1], major: Number(m[2]) } : null
}

// From the 5 generation on, models think on every turn (Opus 5.5 can't
// turn it off) and thinking shares max_tokens with the reply — 16K gives
// room while keeping a non-streaming call inside the SDK's timeout guard.
// Effort is always explicit because defaults differ (Opus 5.5: medium):
// LOW for the booth — a live party needs quick reactions, and low effort
// on this generation still out-reasons the old flagships at full tilt.
// Fable (a deliberate premium pick) runs medium for extra depth.
function requestParams(model) {
  const g = generation(model)
  if (!g || g.major < 5) return { max_tokens: 4096 }
  const premium = g.tier === 'fable' || g.tier === 'mythos'
  return { max_tokens: 16000, output_config: { effort: premium ? 'medium' : 'low' } }
}

// Refusal safety net: should Opus's safety classifiers ever misfire on a
// request (a stuck false positive would otherwise starve auto-refill for
// the rest of the night), the API re-runs it on the model Anthropic
// recommends for that category. Opus line only, where the 'default' form
// is documented; switched off for the session if an endpoint rejects it.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
let fallbackOff = false
const usesFallback = (model) => {
  const g = generation(model)
  return !fallbackOff && g?.tier === 'opus' && g.major >= 5
}

async function createMessage(client, body) {
  if (!usesFallback(body.model)) return client.messages.create(body)
  try {
    return await client.beta.messages.create({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' })
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError) || !/fallback/i.test(e.message)) throw e
    fallbackOff = true
    console.warn('[dj] refusal fallback unavailable — continuing without it:', e.message)
    return client.messages.create(body)
  }
}

// A server-side fallback marks each model switch with a `fallback` block;
// what the declined model produced before the last switch is dropped
// except plain text (the API's echo rule), and the marker itself goes too.
function echoable(content) {
  const last = content.map((b) => b.type).lastIndexOf('fallback')
  return content.filter((b, i) => b.type !== 'fallback' && (i > last || b.type === 'text'))
}

const S = () => useStore.getState()
const set = useStore.setState

// ------------------------------------------------------------------ prompt

// Frozen for the whole conversation: Opus 5.5 binds its thinking to the
// exact system prompt, so the volatile booth state rides in each user turn
// instead (see sendToDJ). Byte-identical also keeps it in the prompt cache.
const SYSTEM = `You are DJ WYS, a world-class event DJ running a LIVE set — you work a room the way the best club and wedding DJs do. The host talks to you between songs; your text replies are patter on their headset — warm, confident, and brief (1–3 short sentences, no markdown lists or headers unless asked). You control the decks ONLY through your tools.

Every incoming message opens with a <live_state> snapshot of the booth taken the moment it was sent. Trust the most recent snapshot; older ones are history.

READING THE ROOM
- Open by learning the room: event type, audience, vibe, any must-plays or do-not-plays. If the host hasn't briefed you yet, ask one sharp question while still queueing something safe and broadly likable.
- host_signals are the floor talking: a song skipped early or a pick thrown out of the queue means that lane isn't landing — steer away from it; a pick pulled forward means give them more like it. Crowd reads from the host ("packed", "emptying") outrank everything else.
- React within a song or two. When the host or the signals call for a change, rework the next few slots (play_next or replace_upcoming) — appending to the end would take forty minutes to arrive.

KEEPING IT FRESH
- Every song plays ONCE per set. played_this_set lists everything that has aired tonight; never queue a song from it, from the decks, or already upcoming — unless the host explicitly asks for that exact song again, in which case set requested_by_host. The booth refuses repeats and reports them, so check the list before you pick.
- Space artists: 8+ songs between tracks by the same artist, unless the host asks for a run of them or the theme is one artist.
- Pivot the flavor every 20–30 minutes — a new sub-style, era, language or tempo pocket — while holding the energy. That is what keeps a room interested for hours.
- Inside a narrow theme, dig wider instead of circling its most famous songs: its different decades, sub-genres and scenes, the neighboring genres that share its groove, well-known remixes and edits, and deeper cuts from the artists everyone knows.
- Balance the familiar and the fresh: about 6 in 10 songs the crowd will recognize instantly, 3 deeper or newer cuts that fit, 1 surprise that still makes sense.

KEEPING IT HOT
- Ride waves, not a flat line: build → peak → release → rebuild. When peak_run_min passes about 30–40, give the floor one or two breather songs — a big singalong or a deep groove at energy 3–4 — then climb again. During dance time never let three low songs run back to back. energy_trail shows the energy of the last dozen songs (the last one is on air).
- Pace your ammunition: hold several of the night's biggest anthems in reserve for the peak and for rescues; don't burn them all in the first hour.
- Flow: keep neighbors within about 8 BPM, or change tempo on purpose through a bridge song with a foot in both worlds. Sequence by energy, genre and era so every transition feels intentional.
- The energy scale: 1 = dinner/ambient … 5 = peak dancefloor. Move gradually unless the host demands a jump. Call set_energy when the direction changes.

RUNNING THE BOOTH
- Honor requests fast: "play X now" → play_now; "play X next" → queue_tracks with mode play_next (a song that is already queued moves up instead of doubling). If a request fits badly this minute, land it within the next few songs at a moment it can work.
- Keep the upcoming queue AT LEAST 10 songs deep (10–15 is ideal), planned as a sequence rather than a pile. Whenever live_state shows fewer than 10 upcoming, top it up in the SAME response.
- A message whose text (after its snapshot) starts with [AUTO] is from the app, not the host: the queue is running low, or the app noticed something about the floor. Act on it, carrying the set's arc forward, and reply with at most one short sentence, no greeting.
- When the host lays out the evening (phases, key moments, end time), call set_event_plan with a concise plan — then pace the set against local_time: build toward the moments, land the final song on time.
- The big screen is yours too: set_banner puts a scrolling message above the decks. Use it when asked ("put Happy Birthday up") and at natural moments — a dedication banner when the host dedicates a song, the event title at the start. Keep it short and celebratory; update or clear it when the moment passes.
- When the host clearly says the night is over ("that's a wrap", "shut it down"), end_set fades the music out and archives the gig's setlist. If the signal is ambiguous, ask once before ending.

TRACK PICKING
- Search budget: each fresh lookup costs 1 of ~99 daily searches (live_state shows usage). Two ways to queue songs for FREE: songs already in this device's library resolve automatically, and a confident video_id verifies at ~1% of a search's cost. For well-known tracks whose official upload ID you know, ALWAYS include video_id. When usage runs high, lean on library_fresh (library songs that haven't aired tonight) and confident video_ids — never on songs already played — and tell the host if you're getting constrained.
- search_query format: "{artist} {title} official audio". For big visual moments use "official video" instead — the video shows on the decks.
- Prefer original studio recordings unless the host asks for live/remix versions.
- Mind explicit lyrics around family crowds — when kids are present search "{artist} {title} clean version".
- If a tool result says a song wasn't found, was blocked or was refused, replace it in your next call — never leave a hole in the set.
- Mix points: for tracks you know well, set start_at to skip a video's cinematic intro and fade_out_at to start the blend before the outro/credits. This is what makes transitions feel hand-mixed. Omit both when unsure — the engine falls back to full length.
- Give every pick a note of a few words naming its job in the set (anthem, breather, bridge to the 90s, deep cut) — the host sees it on the queue.

TOOLS
- Tool results report what was ACTUALLY queued from YouTube, and anything the booth refused (repeats, doubles) or flagged (the same artist placed too close). If the wrong upload came back (a live take, a cover), send that song again with fix_upload and a more specific search_query or a video_id — the booth swaps the upload where it sits in the queue.
- set_crossfade: longer fades (8–12s) blend smoothly; shorter (2–4s) hit harder.
- Only pause_music when the host clearly wants silence (speeches, toasts); resume_music brings the room back.`

const SYSTEM_BLOCKS = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }]

const TRACK_PROPS = {
  artist: { type: 'string' },
  title: { type: 'string' },
  search_query: {
    type: 'string',
    description: 'YouTube search query, usually "{artist} {title} official audio"',
  },
  energy: { type: 'integer', description: 'Track energy: 1 chill … 5 peak dancefloor' },
  note: {
    type: 'string',
    description: "A few words on this pick's job in the set (anthem, breather, bridge to the 90s, deep cut) — shown to the host",
  },
  requested_by_host: {
    type: 'boolean',
    description:
      'true ONLY when the host explicitly asked for this exact song, including asking to hear it again. Without it the booth refuses songs that already aired tonight.',
  },
  fix_upload: {
    type: 'boolean',
    description:
      'true to replace the YouTube upload of this song where it already sits in the queue (a live take or cover came back) — pair it with a more specific search_query or a video_id.',
  },
  video_id: {
    type: 'string',
    description:
      "Optional: the official YouTube video ID (11 chars) for this exact track, ONLY if you are confident you know it. Verifying an ID costs ~1% of a search, so supplying correct IDs hugely stretches the daily search budget. A wrong ID is harmless — it falls back to a normal search.",
  },
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
      "Add tracks to the upcoming queue. mode 'append' adds to the end, 'play_next' slots them right after the current song (a song already queued moves up instead of doubling), 'replace_upcoming' rebuilds the upcoming queue from scratch (the current song keeps playing). The result reports exactly what was found and queued, and anything the booth refused.",
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
    name: 'seek_track',
    description:
      "Jump to a position WITHIN the currently playing track — e.g. past a long intro the host complains about, or back to replay a moment. Position is absolute seconds from the track's start.",
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'number' } },
      required: ['seconds'],
    },
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
    name: 'play_effect',
    description:
      "Fire a one-shot crowd effect over the music: 'air_horn' (celebration peaks), 'riser' (3.5s build — fire it just BEFORE a drop or transition), 'drop' (sub boom — land it ON the moment), 'laser' (dancefloor zaps), 'brake' (slow the track down and blend into the next — a theatrical transition). Use SPARINGLY: at genuine peaks and big transitions only, at most one every few minutes unless the host asks. Never during dinner, speeches, or low-energy stretches. Effects have cooldowns and are blocked during talkover.",
    input_schema: {
      type: 'object',
      properties: {
        effect: { type: 'string', enum: ['air_horn', 'riser', 'drop', 'laser', 'brake'] },
      },
      required: ['effect'],
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

const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function minsAgo(ts) {
  if (!ts) return 'earlier tonight'
  const m = Math.round((Date.now() - ts) / 60000)
  return m < 1 ? 'just now' : `${m} min ago`
}

function describeSignal(x) {
  const song = `${x.artist} — ${x.title} (${minsAgo(x.at)})`
  if (x.type === 'skipped') return `skipped after ${fmtTime(x.after || 0)}: ${song}`
  if (x.type === 'removed') return `thrown out of the queue: ${song}`
  return `pulled forward: ${song}`
}

function stateBlock() {
  const s = S()
  const deck = s.decks[s.active]
  const log = s.playLog
  // minutes the floor has run at energy 4+ without a dip, counting back from now
  let peakRun = 0
  for (let i = log.length - 1; i >= 0 && (log[i].energy ?? 3) >= 4; i--) {
    peakRun += (log[i].durationSec || 210) / 60
  }
  const quota = quotaUsedToday()
  const state = {
    now_playing: deck.track
      ? {
          artist: deck.track.artist,
          title: deck.track.title,
          energy: deck.track.energy,
          position: `${fmtTime(deck.progress)} / ${fmtTime(deck.duration)}`,
          state: deck.state,
        }
      : null,
    upcoming: s.queue.slice(0, 25).map((t) => ({
      artist: t.artist,
      title: t.title,
      energy: t.energy,
      duration: fmtTime(t.durationSec),
      ...(t.note && t.note !== 'demo' ? { note: t.note.slice(0, 40) } : {}),
    })),
    upcoming_count: s.queue.length,
    set: s.currentSet
      ? {
          name: s.currentSet.name,
          started: clock(s.currentSet.startedAt),
          running: fmtRuntime((Date.now() - s.currentSet.startedAt) / 1000),
          songs_played: log.length,
        }
      : null,
    played_this_set: log.slice(-200).map((t) => `${t.artist} — ${t.title}`),
    energy_trail: log.slice(-12).map((t) => t.energy ?? 3),
    peak_run_min: Math.round(peakRun),
    host_signals: s.signals
      .filter((x) => Date.now() - x.at < 45 * 60000)
      .slice(-8)
      .map(describeSignal),
    energy_level: s.energy,
    crossfade_seconds: s.settings.fadeSeconds,
    auto_dj: s.autoDJ,
    talkover_ducked: s.ducked,
    event_plan: s.eventPlan || null,
    banner: s.banner || null,
    search_quota_used_today: `${quota} of ~99 (resets midnight PT)`,
    ...(quota >= 70 ? { library_fresh: libraryFresh(log, 40) } : {}),
    local_time: clock(Date.now()),
  }
  return `<live_state>\n${JSON.stringify(state, null, 1)}\n</live_state>`
}

// ------------------------------------------------------------------ chat plumbing

function pushChat(role, text, extra = {}) {
  set((s) => ({ chat: [...s.chat, { id: uid(), role, text, ...extra }] }))
}

// The API history is APPEND-ONLY while a conversation runs. Opus 5.5 binds
// each thinking block to everything before it, so rewriting earlier turns
// is a 400 for accounts created after 2026-08-31 (older accounts are let
// through, but lose the prompt cache). To stay bounded it is cut only
// between turns, and rarely; the kept turns lose their thinking blocks,
// which were produced with the older history present and can't replay.
const HISTORY_MAX = 64
const HISTORY_KEEP = 32

function compacted(h) {
  if (h.length <= HISTORY_MAX) return h
  let i = h.length - HISTORY_KEEP
  while (i < h.length && !isTurnStart(h[i])) i++
  return h.slice(i).map(stripThinking).filter(Boolean)
}

// The request's view of the history: well-formed (it must open with a turn,
// never an orphaned tool_result left by a mid-loop reset — this also heals
// bad history persisted by older versions), with a cache marker on the
// newest block so the next request re-reads everything before it cheaply.
function conversation() {
  const h = S().apiHistory
  const start = h.findIndex(isTurnStart)
  if (start === -1) return []
  const msgs = h.slice(start)
  const last = msgs[msgs.length - 1]
  if (Array.isArray(last.content) && last.content.length) {
    const blocks = last.content.slice()
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
    msgs[msgs.length - 1] = { ...last, content: blocks }
  }
  return msgs
}

// Documented recovery if a replayed thinking block is ever rejected as
// belonging to a different conversation: drop all earlier reasoning once
// (text and tool calls stay) rather than failing every request after it.
function healThinking() {
  if (!S().apiHistory.some(hasThinking)) return false
  set((s) => ({ apiHistory: s.apiHistory.map(stripThinking).filter(Boolean) }))
  return true
}

function pushApi(msg) {
  set((s) => ({ apiHistory: [...s.apiHistory, msg] }))
}

// ------------------------------------------------------------------ tool execution

function buildTrack(t, found, how) {
  return {
    videoId: found.videoId,
    title: t.title,
    artist: t.artist,
    ytTitle: found.title,
    artistTitleHow: how, // 'library' | 'id' | 'search' — for the tool report
    channel: found.channel,
    durationSec: found.durationSec,
    energy: t.energy,
    note: t.note,
    startAt: t.start_at,
    fadeOutAt: t.fade_out_at,
    query: t.search_query,
    candidates: found.candidates || [found.videoId],
    ...(t.requested_by_host === true ? { requested: true } : {}),
  }
}

// Resolution ladder: library (free) → DJ-supplied id, pre-verified in a
// batched 1-unit lookup (idMap) → full search (~1 search of the daily ~99).
// Fixing a wrong upload skips the library, which would return it again.
async function resolveTrack(t, idMap, { skipLibrary = false } = {}) {
  const hit = skipLibrary ? null : libraryLookup(t.artist, t.title)
  if (hit) return buildTrack(t, hit, 'library')

  if (t.video_id && idMap) {
    const meta = idMap.get(t.video_id)
    if (meta && plausibleMatch(t, meta)) {
      libraryAdd(t.artist, t.title, meta)
      return buildTrack(t, meta, 'id')
    }
  }

  const key = S().settings.youtubeKey
  const found = await searchTrack(t.search_query, key)
  if (!found) return null
  libraryAdd(t.artist, t.title, found)
  return buildTrack(t, found, 'search')
}

// One cheap batched lookup for the DJ-supplied ids that need checking
// (whole batch ≈ 1 quota unit).
async function verifyIds(tracks) {
  const ids = tracks.map((t) => t.video_id).filter(Boolean)
  if (ids.length === 0) return new Map()
  try {
    return await lookupVideos(ids, S().settings.youtubeKey)
  } catch {
    return new Map()
  }
}

// Which picks need their video_id verified: library songs resolve free,
// except when the DJ is replacing a wrong upload.
const needsIdCheck = (t, v) => t.video_id && !v.move && (v.swap || !libraryLookup(t.artist, t.title))

// The booth's rules for the DJ's own picks (host requests pass): a song
// airs once per set and never doubles up with the decks or the queue.
// A queued song asked for again moves up under play_next, or gets a new
// upload swapped in with fix_upload. Runs before any search is spent.
function vet(t, { mode, aired, onDecks, queued, taken }) {
  const pick = t.video_id ? { ...t, videoId: t.video_id } : t
  if (taken.some((x) => sameSong(x, pick))) return { skip: 'listed twice in this call' }
  const byHost = t.requested_by_host === true
  if (!byHost && onDecks.some((d) => sameSong(d, pick))) return { skip: 'it is on the decks right now' }
  const i = queued.findIndex((e) => sameSong(e, pick))
  if (i !== -1) {
    if (t.fix_upload === true) return { swap: queued[i] }
    if (mode === 'play_next') return { move: queued[i] }
    return { skip: `already queued at #${i + 1}` }
  }
  if (!byHost) {
    for (let j = aired.length - 1; j >= 0; j--) {
      if (sameSong(aired[j], pick)) return { skip: `already played tonight, ${minsAgo(aired[j].at)}` }
    }
  }
  return {}
}

// Two differently named picks can land on the same upload, so the rule is
// checked again once the upload is known.
function uploadClash(r, t, { aired, onDecks, queued }, placed, swapOf) {
  if (t.requested_by_host !== true && [...aired, ...onDecks].some((x) => x.videoId === r.videoId)) {
    return 'that upload already played tonight'
  }
  const q = queued.findIndex((e) => e.videoId === r.videoId && e.id !== swapOf?.id)
  if (q !== -1) return `that upload is already queued at #${q + 1}`
  if (placed.some((x) => x.videoId === r.videoId)) return 'that upload is already in this call'
  if (swapOf && swapOf.videoId === r.videoId) return 'the same upload came back — try a video_id or a more specific search_query'
  return null
}

// Pro spacing: flag any newly placed song that sits within 8 songs of
// another track by the same artist (recent plays included).
function spacingNotes(ids) {
  const s = S()
  const aired = s.playLog.slice(-10)
  const timeline = [...aired, ...s.queue]
  const out = []
  s.queue.forEach((t, i) => {
    if (!ids.has(t.id) || t.requested) return
    const p = aired.length + i
    let near = Infinity
    timeline.forEach((x, j) => {
      if (j !== p && sameArtist(x.artist, t.artist)) near = Math.min(near, Math.abs(j - p))
    })
    if (near < 8) {
      out.push(`SPACING: ${t.artist} — ${t.title} sits ${near} song${near === 1 ? '' : 's'} from another ${t.artist} track; keep the same artist 8+ apart.`)
    }
  })
  return out
}

async function execQueueTracks({ mode = 'append', tracks = [] }) {
  const s = S()
  const ctx = {
    mode,
    aired: s.playLog,
    onDecks: [s.decks.A.track, s.decks.B.track].filter(Boolean),
    queued: mode === 'replace_upcoming' ? [] : s.queue,
    taken: [],
  }
  const lines = []
  const plan = []
  let refused = 0
  for (const t of tracks.slice(0, 12)) {
    const v = vet(t, ctx)
    if (v.skip) {
      refused++
      lines.push(`NOT ADDED: ${t.artist} — ${t.title} (${v.skip})`)
      continue
    }
    ctx.taken.push(t.video_id ? { ...t, videoId: t.video_id } : t)
    plan.push({ t, ...v })
  }

  const idMap = await verifyIds(plan.filter((p) => needsIdCheck(p.t, p)).map((p) => p.t))
  const tag = { library: 'from library, free', id: 'via your video_id, ~free', search: 'searched' }
  const placed = [] // pick order: new songs, moved entries, swapped entries (keep their id)
  const swaps = []
  for (const p of plan) {
    if (p.move) {
      placed.push(p.move)
      lines.push(`MOVED UP: ${p.t.artist} — ${p.t.title} (it was already queued)`)
      continue
    }
    try {
      const r = await resolveTrack(p.t, idMap, { skipLibrary: !!p.swap })
      if (!r) {
        lines.push(`NOT FOUND: ${p.t.artist} — ${p.t.title} (query: ${p.t.search_query})`)
        continue
      }
      const clash = uploadClash(r, p.t, ctx, placed, p.swap)
      if (clash) {
        refused++
        lines.push(`NOT ADDED: ${p.t.artist} — ${p.t.title} (${clash})`)
        continue
      }
      const how = `(${tag[r.artistTitleHow]}): ${p.t.artist} — ${p.t.title} → "${r.ytTitle}" [${r.channel}] (${fmtTime(r.durationSec)})`
      if (p.swap) {
        const fixed = { ...r, id: p.swap.id }
        swaps.push(fixed)
        if (mode === 'play_next') placed.push(fixed)
        lines.push(`UPLOAD SWAPPED ${how}`)
      } else {
        placed.push(r)
        lines.push(`OK ${how}`)
      }
    } catch (e) {
      if (e instanceof SearchError && e.code === 'quota') {
        lines.push(
          `SEARCH QUOTA EXHAUSTED — no more searches today. ${placed.length} resolved so far. You can still queue songs from library_fresh or with confident video_ids.`
        )
        break
      }
      lines.push(`ERROR searching "${p.t.search_query}": ${e.message}`)
    }
  }

  if (swaps.length) engine.setQueue((q) => q.map((e) => swaps.find((x) => x.id === e.id) || e))
  let added = []
  if (placed.length) {
    added = mode === 'play_next' ? engine.placeNext(placed) : engine.queueTracks(placed, mode)
    lines.push(...spacingNotes(new Set(added.map((t) => t.id))))
  }
  if (added.length || swaps.length) {
    const mins = Math.round(added.reduce((a, t) => a + (t.durationSec || 210), 0) / 60)
    const verb = mode === 'replace_upcoming' ? 'Rebuilt queue with' : mode === 'play_next' ? 'Slotted next:' : 'Queued'
    const blocked = refused ? ` · ${refused} repeat${refused > 1 ? 's' : ''} blocked` : ''
    pushChat(
      'event',
      added.length
        ? `🎵 ${verb} ${added.length} track${added.length > 1 ? 's' : ''} · ~${mins} min${blocked}`
        : `🎵 Swapped ${swaps.length} upload${swaps.length > 1 ? 's' : ''}${blocked}`
    )
  }
  const refill = refused ? ` ${refused} not added — replace them with fresh picks so the queue stays full.` : ''
  return `Queued ${added.length}/${tracks.length} (mode: ${mode}).${refill}\n${lines.join('\n')}`
}

async function execPlayNow(input) {
  const s = S()
  const ctx = {
    mode: 'play_next',
    aired: s.playLog,
    onDecks: [s.decks.A.track, s.decks.B.track].filter(Boolean),
    queued: s.queue,
    taken: [],
  }
  const v = vet(input, ctx)
  if (v.skip) {
    return `NOT PLAYED: ${input.artist} — ${input.title} (${v.skip}). Pick something fresh — or, if the host asked for this exact song, send it again with requested_by_host.`
  }
  try {
    let track = v.move
    if (!track) {
      const idMap = await verifyIds(needsIdCheck(input, v) ? [input] : [])
      const r = await resolveTrack(input, idMap, { skipLibrary: !!v.swap })
      if (!r) return `NOT FOUND: ${input.artist} — ${input.title}`
      const clash = uploadClash(r, input, ctx, [], v.swap)
      if (clash) return `NOT PLAYED: ${input.artist} — ${input.title} (${clash}).`
      track = v.swap ? { ...r, id: v.swap.id } : r
    }
    engine.playNow(track)
    pushChat('event', `▶️ Now playing: ${track.artist} — ${track.title}`)
    return `Now crossfading into "${track.ytTitle || track.title}"${track.channel ? ` [${track.channel}]` : ''}.`
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
    case 'seek_track': {
      const s = S()
      const d = s.decks[s.active]
      if (!d.track) return 'Nothing is playing right now.'
      const sec = Math.max(0, Math.min(input.seconds, d.duration > 0 ? d.duration - 5 : input.seconds))
      engine.seekTo(s.active, sec)
      pushChat('event', `⏩ Jumped to ${fmtTime(sec)}`)
      return `Seeked "${d.track.title}" to ${fmtTime(sec)}.`
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
    case 'play_effect': {
      const r = fireEffect(input.effect)
      if (!r.ok) {
        return `Effect not fired: ${r.reason}${r.waitMs ? ` (~${Math.ceil(r.waitMs / 1000)}s left)` : ''}.`
      }
      const icons = { air_horn: '📯', riser: '🚀', drop: '💥', laser: '⚡', brake: '🌀' }
      pushChat('event', `${icons[input.effect]} ${input.effect.replace('_', ' ')}!`)
      return `Fired ${input.effect}.`
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

export async function sendToDJ(text, { auto = false, note } = {}) {
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
    pushChat('event', note || '🤖 Queue running low — DJ is topping up the set')
  } else {
    pushChat('user', text)
  }
  // a new turn: the only moment the history may be cut; the booth snapshot
  // is frozen into the turn itself so nothing earlier ever changes
  set((st) => ({
    apiHistory: [
      ...compacted(st.apiHistory),
      {
        role: 'user',
        content: [
          { type: 'text', text: stateBlock() },
          { type: 'text', text },
        ],
      },
    ],
  }))

  const client = new Anthropic({
    apiKey: s.settings.anthropicKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  })

  // if the conversation gets reset while we're mid-loop (end_set, clear,
  // auto-archive), stop touching it — appending anything would orphan
  // tool_result blocks and poison every later request
  const epoch0 = S().chatEpoch
  const aborted = () => S().chatEpoch !== epoch0

  try {
    const model = await resolveModel(s.settings.model, client)
    const request = () => ({
      model,
      ...requestParams(model),
      system: SYSTEM_BLOCKS,
      messages: conversation(),
      tools: TOOLS,
    })
    for (let i = 0; i < 8; i++) {
      if (aborted()) break
      let response
      try {
        response = await createMessage(client, request())
      } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError) || !/thinking/i.test(e.message) || !healThinking()) throw e
        console.warn('[dj] replayed reasoning rejected — dropped it and retried:', e.message)
        response = await createMessage(client, request())
      }

      if (aborted()) break // reset happened while waiting on the API
      set({ brainModel: response.model })

      // Claude 5-family safety classifiers can decline a request (HTTP 200,
      // stop_reason 'refusal', content possibly empty) — never expected for
      // party music, but read stop_reason before touching content.
      if (response.stop_reason === 'refusal') {
        if (!aborted()) pushChat('error', 'The DJ brain declined that one — try rephrasing the request.')
        break
      }
      // a reply cut off mid-thought (possibly mid tool call) must never
      // enter the history — an unanswered tool_use fails every later request
      if (response.stop_reason === 'max_tokens') {
        if (!aborted()) pushChat('error', 'The DJ brain ran out of room on that one — try again, or ask for less at once.')
        break
      }

      const content = echoable(response.content)
      pushApi({ role: 'assistant', content })

      if (response.stop_reason === 'tool_use') {
        const results = []
        let setEnded = false
        for (const block of content) {
          if (block.type !== 'tool_use') continue
          let out
          try {
            out = await executeTool(block.name, block.input)
          } catch (e) {
            out = `Tool failed: ${e.message}`
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
          if (block.name === 'end_set') setEnded = true
        }
        // end_set archives and resets the conversation — it is terminal:
        // no receipt to append, nothing more to say
        if (setEnded || aborted()) break
        pushApi({ role: 'user', content: results })
        continue
      }

      const finalText = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (finalText && !aborted()) pushChat('dj', finalText)
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
    `[AUTO] The upcoming queue is down to ${n} song${n === 1 ? '' : 's'}. Add ${need} fresh ones that carry the set's arc forward — check played_this_set, host_signals and peak_run_min first.`,
    { auto: true }
  )
}

// Two early skips within a few minutes: a working DJ would already be
// changing course, so the DJ gets a turn to rework the next songs.
let lastCourseCorrection = 0
export function maybeCourseCorrect() {
  const s = S()
  const early = s.signals.filter((x) => x.type === 'skipped' && Date.now() - x.at < 10 * 60000)
  if (early.length < 2 || !s.settings.anthropicKey || s.aiBusy || inFlight) return
  if (Date.now() - lastCourseCorrection < 10 * 60000) return
  lastCourseCorrection = Date.now()
  sendToDJ(
    '[AUTO] The host skipped two songs early in the last few minutes, so that lane is not landing. Rework the next few slots now (play_next or replace_upcoming) toward what has been working tonight.',
    { auto: true, note: '🤖 Two early skips — DJ is reworking the next songs' }
  ).catch(() => {})
}

const brainClient = () =>
  new Anthropic({ apiKey: S().settings.anthropicKey, dangerouslyAllowBrowser: true, maxRetries: 1 })

// Header chip: which model the current setting resolves to, before any
// request has run (after that, each response records who really answered).
export async function showBrainModel() {
  const s = S()
  if (!s.settings.anthropicKey) return set({ brainModel: null })
  set({ brainModel: await resolveModel(s.settings.model, brainClient()) })
}

// Settings "Check": one tiny real request down the exact production path,
// so the host can see which model answers with their key before a gig.
export async function checkBrain() {
  const client = brainClient()
  const model = await resolveModel(S().settings.model, client)
  const response = await createMessage(client, {
    model,
    ...requestParams(model),
    system: SYSTEM_BLOCKS,
    messages: [
      {
        role: 'user',
        content: 'Soundcheck from the app, not the host: reply with one short line and use no tools.',
      },
    ],
    tools: TOOLS,
  })
  set({ brainModel: response.model })
  return response.model
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
