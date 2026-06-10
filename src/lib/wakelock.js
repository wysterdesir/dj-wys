// Keep the screen awake while music plays (phones/tablets at a gig).
let sentinel = null
let wanted = false

export async function acquireWakeLock() {
  wanted = true
  if (sentinel || !('wakeLock' in navigator)) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
  } catch {
    sentinel = null
  }
}

export function releaseWakeLock() {
  wanted = false
  sentinel?.release().catch(() => {})
  sentinel = null
}

// Re-acquire when the tab becomes visible again (browsers drop it on blur).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) acquireWakeLock()
})
