import { useEffect, useRef } from 'react'

// Simulated waveform: the YouTube stream's raw audio is not accessible to
// the page (browser security), so bars are seeded per-track and animated by
// playback position + the track's energy rating. Looks alive, stays honest.

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

export default function Waveform({ videoId, progress, duration, playing, energy = 3, color }) {
  const ref = useRef(null)
  const live = useRef({})
  live.current = { videoId, progress, duration, playing, energy, color }

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

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="w-full h-12 block" />
}
