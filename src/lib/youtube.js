// Loader + thin wrapper around the official YouTube IFrame Player API.
// This is the only ToS-compliant way to stream YouTube / YouTube Music
// content in a web app; Premium accounts signed into the browser get
// ad-free playback inside these embeds.

let apiPromise = null

export function loadYouTubeAPI() {
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    document.head.appendChild(tag)
  })
  return apiPromise
}

// Player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
export const YTState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
}

export async function createPlayer(elementId, { onStateChange, onError } = {}) {
  const YT = await loadYouTubeAPI()
  return new Promise((resolve) => {
    let settled = false
    const player = new YT.Player(elementId, {
      width: '100%',
      height: '100%',
      playerVars: {
        enablejsapi: 1,
        controls: 0,
        rel: 0,
        fs: 0,
        disablekb: 1,
        iv_load_policy: 3,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          if (!settled) {
            settled = true
            resolve(player)
          }
        },
        onStateChange,
        onError,
      },
    })
    // Safety net: some browsers don't fire onReady for an empty player
    setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(player)
      }
    }, 4000)
  })
}

// All player calls are guarded — the iframe can be mid-navigation.
export const safe = (player, method, ...args) => {
  try {
    if (player && typeof player[method] === 'function') {
      return player[method](...args)
    }
  } catch {
    /* player not ready */
  }
  return undefined
}
