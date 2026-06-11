import { useEffect, useRef } from 'react'
import { fmtTime } from '../lib/time'

// Simulated waveform: the YouTube stream's raw audio is not accessible to
// the page (browser security), so bars are seeded per-track and animated by
// playback position + the track's energy rating. Looks alive, stays honest.
// It doubles as the seek bar: click or drag anywhere to jump, YouTube-style.

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const N = 72

// Simulated signal level at the playhead — used by the mixer's VU meters.
// Same seeded math as the bars, so meters and waveform agree.
export function amplitudeAt(videoId, frac, energy = 3, t = 0) {
  if (!videoId) return 0
  const rnd = mulberry32(hashStr(videoId))
  const idx = Math.max(0, Math.min(N - 1, Math.floor(frac * N)))
  let v = 0
  for (let i = 0; i <= idx; i++) {
    const b = 0.3 + 0.7 * rnd()
    if (i === idx) {
      const x = i / N
      const intro = Math.min(1, x / 0.07)
      const outro = Math.min(1, (1 - x) / 0.1)
      v = b * intro * outro * (0.35 + energy * 0.13)
    }
  }
  return Math.min(1, v * (0.8 + 0.35 * Math.abs(Math.sin(t / 170))))
}

export default function Waveform({
  videoId,
  progress,
  duration,
  playing,
  energy = 3,
  color,
  interactive = false,
  onSeek,
}) {
  const ref = useRef(null)
  const live = useRef({})
  live.current = { videoId, progress, duration, playing, energy, color, interactive, onSeek }
  const ux = useRef({ hover: null, scrub: null })

  const fracFrom = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  const onPointerDown = (e) => {
    if (!live.current.interactive) return
    e.preventDefault()
    ref.current.setPointerCapture(e.pointerId)
    ux.current.scrub = fracFrom(e)
  }
  const onPointerMove = (e) => {
    if (!live.current.interactive) return
    const f = fracFrom(e)
    if (ux.current.scrub != null) ux.current.scrub = f
    else ux.current.hover = f
  }
  const onPointerUp = (e) => {
    if (ux.current.scrub != null) {
      live.current.onSeek?.(ux.current.scrub)
      ux.current.scrub = null
      ux.current.hover = null
      try {
        ref.current.releasePointerCapture(e.pointerId)
      } catch {
        /* fine */
      }
    }
  }
  const onPointerLeave = () => {
    ux.current.hover = null
  }
  const onPointerCancel = () => {
    ux.current.scrub = null
    ux.current.hover = null
  }

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let raf

    const draw = (t) => {
      const { videoId, progress, duration, playing, energy, color } = live.current
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      if (W === 0) {
        raf = requestAnimationFrame(draw)
        return
      }
      if (canvas.width !== W * 2 || canvas.height !== H * 2) {
        canvas.width = W * 2
        canvas.height = H * 2
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const frac = duration > 0 ? Math.min(1, progress / duration) : 0
      const rnd = mulberry32(hashStr(videoId || 'empty'))
      const barW = canvas.width / N
      const mid = canvas.height / 2

      for (let i = 0; i < N; i++) {
        const x = i / N
        let h
        if (!videoId) {
          h = canvas.height * 0.04
        } else {
          const base = 0.3 + 0.7 * rnd()
          const intro = Math.min(1, x / 0.07)
          const outro = Math.min(1, (1 - x) / 0.1)
          const amp = 0.35 + energy * 0.13
          h = base * intro * outro * amp * canvas.height
          if (playing && Math.abs(x - frac) < 0.04) {
            h *= 1 + 0.3 * Math.abs(Math.sin(t / 110 + i * 1.7))
          }
        }
        const played = x <= frac && videoId
        ctx.fillStyle = played ? color : 'rgba(255,255,255,0.13)'
        const bh = Math.max(canvas.height * 0.03, h)
        ctx.beginPath()
        ctx.roundRect(i * barW + barW * 0.18, mid - bh / 2, barW * 0.64, bh, barW * 0.3)
        ctx.fill()
      }

      // playhead
      if (videoId && frac > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fillRect(frac * canvas.width - 1, mid - canvas.height * 0.46, 2, canvas.height * 0.92)
      }

      // hover / scrub ghost playhead + time pill (YouTube-style seek preview)
      const { interactive, duration: dur2 } = live.current
      const ix = ux.current.scrub ?? ux.current.hover
      if (interactive && ix != null && videoId) {
        const x = ix * canvas.width
        ctx.fillStyle = ux.current.scrub != null ? color : 'rgba(255,255,255,0.5)'
        ctx.fillRect(x - 1, 0, 2, canvas.height)
        const label = fmtTime(ix * (dur2 || 0))
        ctx.font = '600 21px ui-monospace, SFMono-Regular, monospace'
        const tw = ctx.measureText(label).width + 18
        const px = Math.min(Math.max(x - tw / 2, 2), canvas.width - tw - 2)
        ctx.fillStyle = 'rgba(0,0,0,0.85)'
        ctx.beginPath()
        ctx.roundRect(px, 2, tw, 30, 8)
        ctx.fill()
        ctx.fillStyle = ux.current.scrub != null ? color : 'rgba(255,255,255,0.9)'
        ctx.fillText(label, px + 9, 25)
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      className={`w-full h-12 lg:h-16 block ${interactive ? 'cursor-pointer' : ''}`}
      style={interactive ? { touchAction: 'none' } : undefined}
    />
  )
}
