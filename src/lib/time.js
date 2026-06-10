// "PT1H2M30S" -> seconds
export function parseISODuration(iso) {
  if (!iso) return 0
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–:––'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = (s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${r}` : `${m}:${r}`
}

export function fmtRuntime(totalSec) {
  const m = Math.round(totalSec / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, '0')}m`
}
