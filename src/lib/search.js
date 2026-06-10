// YouTube Data API v3 track search with localStorage caching and
// result scoring that prefers the official YT Music catalog uploads
// ("Artist - Topic" channels / "official audio") over live/cover/remix noise.
//
// Quota notes: search.list costs 100 units, videos.list costs 1. The free
// daily quota is 10,000 units, so ~99 fresh searches/day — caching makes
// that comfortably enough for an event.

import { parseISODuration } from './time'

const CACHE_KEY = 'djwys-search-cache-v1'
const CACHE_TTL = 30 * 24 * 3600 * 1000 // 30 days

let cache = null
function loadCache() {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}
  } catch {
    cache = {}
  }
  return cache
}
function saveCache() {
  try {
    // keep the cache bounded
    const entries = Object.entries(cache)
    if (entries.length > 600) {
      entries.sort((a, b) => a[1].ts - b[1].ts)
      cache = Object.fromEntries(entries.slice(-400))
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage full — fine */
  }
}

export class SearchError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code // 'quota' | 'badkey' | 'network' | 'notfound'
  }
}

// ---- daily search counter (each fresh search ≈ 1% of the free quota) ----
const QUOTA_KEY = 'djwys-quota-v1'
const today = () => new Date().toISOString().slice(0, 10)

function bumpQuota() {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY)) || {}
    const n = q.date === today() ? (q.count || 0) + 1 : 1
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ date: today(), count: n }))
  } catch {
    /* fine */
  }
}

export function quotaUsedToday() {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY))
    return q && q.date === today() ? q.count || 0 : 0
  } catch {
    return 0
  }
}

function score(item, query) {
  const q = query.toLowerCase()
  const title = item.title.toLowerCase()
  const channel = item.channel.toLowerCase()
  let s = 0
  if (channel.endsWith(' - topic')) s += 3 // auto-generated YT Music catalog upload
  if (channel.includes('vevo')) s += 2
  if (title.includes('official audio')) s += 2.5
  if (title.includes('official video') || title.includes('official music video')) s += 2
  if (title.includes('audio')) s += 0.5
  if (title.includes('lyric')) s += 0.5
  for (const bad of ['live', 'cover', 'remix', 'sped up', 'slowed', 'reverb', 'karaoke', 'instrumental', 'reaction', '8d', 'nightcore', 'loop', '1 hour', 'extended']) {
    if (title.includes(bad) && !q.includes(bad)) s -= 2.5
  }
  if (item.durationSec < 75 || item.durationSec > 600) s -= 2
  if (item.durationSec >= 120 && item.durationSec <= 360) s += 0.5
  return s
}

// Returns { videoId, title, channel, durationSec, candidates: [videoId...] }
export async function searchTrack(query, apiKey) {
  if (!apiKey) throw new SearchError('badkey', 'No YouTube API key configured')
  const key = query.trim().toLowerCase()
  const c = loadCache()
  const hit = c[key]
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.result

  let searchRes
  bumpQuota()
  try {
    const url =
      'https://www.googleapis.com/youtube/v3/search' +
      `?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(query)}&key=${apiKey}`
    searchRes = await fetch(url)
  } catch {
    throw new SearchError('network', 'Network error reaching YouTube')
  }
  if (!searchRes.ok) {
    const body = await searchRes.json().catch(() => ({}))
    const reason = body?.error?.errors?.[0]?.reason || ''
    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded')
      throw new SearchError('quota', 'YouTube search quota exhausted for today')
    throw new SearchError('badkey', `YouTube API error: ${reason || searchRes.status}`)
  }
  const searchData = await searchRes.json()
  const ids = (searchData.items || []).map((i) => i.id?.videoId).filter(Boolean)
  if (ids.length === 0) {
    c[key] = { ts: Date.now(), result: null }
    saveCache()
    return null
  }

  // hydrate with duration + embeddability (1 quota unit)
  const vUrl =
    'https://www.googleapis.com/youtube/v3/videos' +
    `?part=snippet,contentDetails,status&id=${ids.join(',')}&key=${apiKey}`
  const vRes = await fetch(vUrl)
  if (!vRes.ok) throw new SearchError('badkey', `YouTube videos lookup failed (${vRes.status})`)
  const vData = await vRes.json()

  const items = (vData.items || [])
    .filter((v) => v.status?.embeddable !== false)
    .map((v) => ({
      videoId: v.id,
      title: v.snippet?.title || query,
      channel: v.snippet?.channelTitle || '',
      durationSec: parseISODuration(v.contentDetails?.duration),
    }))

  if (items.length === 0) {
    c[key] = { ts: Date.now(), result: null }
    saveCache()
    return null
  }

  items.sort((a, b) => score(b, query) - score(a, query))
  const best = items[0]
  const result = {
    videoId: best.videoId,
    title: best.title,
    channel: best.channel,
    durationSec: best.durationSec,
    candidates: items.slice(0, 4).map((i) => i.videoId),
  }
  c[key] = { ts: Date.now(), result }
  saveCache()
  return result
}

// Cheap key sanity check (1 quota unit).
export async function validateYouTubeKey(apiKey) {
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${apiKey}`
    )
    return r.ok
  } catch {
    return false
  }
}
