/**
 * The Claude key (DECISIONS.md 102): a key in the top bar that lights while a request to the Claude API runs,
 * with words that say what is happening. When it ends: "הסתיים" for a moment, or the failure in plain words,
 * which stays until it is closed. The owner asked for this symbol; it is the one sign in the bar beside the
 * app's mark, and it always comes with words.
 */
import { useEffect, useState } from 'react'
import { useClaude } from '../../data/claudeActivity'

export function KeyMark({ lit }: { lit: boolean }) {
  return (
    <svg className="claude-key-mark" data-lit={lit} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="7.5" cy="12" r="4.5" fill={lit ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" />
      <circle cx="7.5" cy="12" r="1.5" fill={lit ? 'var(--bg, #fff)' : 'currentColor'} />
      <path d="M12 12h10M18 12v4M21 12v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  )
}

export function ClaudeKey() {
  const running = useClaude((s) => s.running)
  const last = useClaude((s) => s.last)
  const [shown, setShown] = useState(last)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setShown(last)
    if (last?.ok) {
      const t = setTimeout(() => setShown((s) => (s === last ? null : s)), 6000)
      return () => clearTimeout(t)
    }
  }, [last])
  useEffect(() => {
    if (!running.length) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running.length])

  const active = running.at(-1)
  return (
    <div className="claude-key" role="status" aria-live="polite" data-state={active ? 'running' : shown ? (shown.ok ? 'done' : 'failed') : 'idle'} data-testid="claude-key">
      <KeyMark lit={!!active} />
      {active ? (
        <span>
          {active.label}
          {running.length > 1 ? ` ועוד ${running.length - 1}` : ''} · <span className="num">{Math.round((now - active.startedAt) / 1000)}</span> שניות
        </span>
      ) : shown ? (
        <span>
          {shown.message}
          {!shown.ok && (
            <button type="button" className="quiet" onClick={() => setShown(null)}>
              סגירה
            </button>
          )}
        </span>
      ) : (
        <span className="claude-key-idle">Claude</span>
      )}
    </div>
  )
}
