// Song identity for the booth's "every song once per set" rule. Two picks
// are the same song when they share a YouTube upload, or when their titles
// match once the upload noise is stripped and their artists share a name.

import { norm } from './search'

export function titleKey(title) {
  return norm(
    String(title || '')
      .replace(/\(.*?\)|\[.*?\]/g, ' ') // (Remastered 2009), [Official Video]
      .replace(/\s[-–—|]\s.*$/, ' ') // " - Radio Edit", " | Official Audio"
      .replace(/\b(feat|ft|featuring)\b.*$/i, ' ') // featured artists
  )
}

// Name words too common to identify an artist on their own.
const STOP = new Set([
  'the', 'and', 'feat', 'featuring', 'with', 'band', 'orchestra', 'crew', 'family',
  'brothers', 'sisters', 'boys', 'girls', 'los', 'las', 'del', 'des', 'les', 'lil', 'big', 'young',
])

function artistWords(artist) {
  return new Set(norm(artist).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)))
}

export function sameArtist(a, b) {
  const wa = artistWords(a)
  const wb = artistWords(b)
  if (!wa.size || !wb.size) return norm(a) !== '' && norm(a) === norm(b)
  for (const w of wa) if (wb.has(w)) return true
  return false
}

export function sameSong(a, b) {
  if (!a || !b) return false
  if (a.videoId && a.videoId === b.videoId) return true
  const t = titleKey(a.title)
  return t !== '' && t === titleKey(b.title) && sameArtist(a.artist, b.artist)
}
