/**
 * Installing the app (DECISIONS.md 95). Chrome offers it through `beforeinstallprompt`; the event is kept
 * here so the top bar's "התקנה" button can open the browser's own prompt later.
 */
import { useSyncExternalStore } from 'react'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState = 'installed' | 'ready' | 'manual'

let deferred: InstallPrompt | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function listenForInstall() {
  installed = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    emit()
  })
}

const state = (): InstallState => (installed ? 'installed' : deferred ? 'ready' : 'manual')

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    state,
    state,
  )
}

/** Opens Chrome's install prompt. False when the browser does not offer one. */
export async function install(): Promise<boolean> {
  if (!deferred) return false
  const d = deferred
  await d.prompt()
  const { outcome } = await d.userChoice
  deferred = null
  if (outcome === 'accepted') installed = true
  emit()
  return true
}
