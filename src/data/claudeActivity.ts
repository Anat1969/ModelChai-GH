/**
 * Every call to the Claude API, seen from the screen (DECISIONS.md 102): while a request runs the key in the top
 * bar is lit with what it is doing; when it ends the bar says it finished, or why it failed in plain words.
 * Each client call goes through `withClaude`, so no call can run unseen.
 */
import { create } from 'zustand'

export interface ClaudeCall {
  id: number
  label: string
  startedAt: number
}

export interface ClaudeOutcome {
  label: string
  ok: boolean
  message: string
  at: number
}

interface ClaudeState {
  running: ClaudeCall[]
  last: ClaudeOutcome | null
}

export const useClaude = create<ClaudeState>(() => ({ running: [], last: null }))

let seq = 0

/** Runs a Claude request with the indicator on. `ok` reads the outcome; a thrown error counts as a failure. */
export async function withClaude<T>(label: string, job: () => Promise<T>, ok: (r: T) => { ok: boolean; error?: string } = () => ({ ok: true })): Promise<T> {
  const call = { id: ++seq, label, startedAt: Date.now() }
  useClaude.setState((s) => ({ running: [...s.running, call] }))
  const end = (outcome: Omit<ClaudeOutcome, 'at' | 'label'>) =>
    useClaude.setState((s) => ({ running: s.running.filter((c) => c.id !== call.id), last: { label, ...outcome, at: Date.now() } }))
  try {
    const r = await job()
    const o = ok(r)
    const secs = Math.max(1, Math.round((Date.now() - call.startedAt) / 1000))
    end(o.ok ? { ok: true, message: `${label}: הסתיים תוך ${secs} שניות.` } : { ok: false, message: `${label} נכשל: ${o.error ?? 'סיבה לא ידועה'}` })
    return r
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    end({ ok: false, message: aborted ? `${label}: בוטל.` : `${label} נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.` })
    throw e
  }
}
