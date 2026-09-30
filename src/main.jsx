import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// No StrictMode: its double-mount in dev would create ghost YouTube players.
createRoot(document.getElementById('root')).render(<App />)

if (import.meta.env.DEV) {
  // dev console handle for poking at state
  Promise.all([
    import('./store'),
    import('./lib/engine'),
    import('./lib/sets'),
    import('./lib/search'),
    import('./lib/fx'),
    import('./lib/dj'),
    import('./lib/freshness'),
  ]).then(([s, e, sets, search, fx, dj, freshness]) => {
    window.__djwys = { store: s.useStore, engine: e, sets, search, fx, dj, freshness }
  })
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js')
      .catch(() => {})
  })
}
