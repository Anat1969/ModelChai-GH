import { useStudio } from '../store'

/** Every error explains what happened and offers a way out (CLAUDE.md, "ממשק"). */
export function NoticeBox({ onAction }: { onAction?: () => void }) {
  const notice = useStudio((s) => s.notice)
  const dismiss = useStudio((s) => s.dismissNotice)
  if (!notice) return null
  return (
    <div className={`notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="notice">
      <p>
        <strong>{notice.title}</strong>
      </p>
      {notice.lines.length > 0 && (
        <ul>
          {notice.lines.map((l, i) => (
            <li key={i}>
              {l.field && <span className="field">{l.field}</span>} {l.text}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          onClick={() => {
            dismiss()
            onAction?.()
          }}
        >
          {notice.action}
        </button>
      </div>
    </div>
  )
}
