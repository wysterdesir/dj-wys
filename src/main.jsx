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
  ]).then(([s, e, sets, search, fx]) => {
    window.__djwys = { store: s.useStore, engine: e, sets, search, fx }
  })
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js')
      .catch(() => {})
  })
}
