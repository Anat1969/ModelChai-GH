import '@fontsource/ibm-plex-sans-hebrew/200.css'
import '@fontsource/ibm-plex-sans-hebrew/300.css'
import '@fontsource/ibm-plex-sans-hebrew/500.css'
import '@fontsource/ibm-plex-sans-hebrew/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './ui/theme/app.css'
import { startFreshness } from './ui/freshness'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

startFreshness()
// The service worker makes the app installable from Chrome (DECISIONS.md 95). Not in development, where
// Vite serves every file fresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
