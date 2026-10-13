import { useState } from 'react'
import { sendMagicLink } from '../../data/supabase'

/** Sign-in by a link sent to the email, with no password. Shown when the project does not allow anonymous users. */
export function EmailLogin({ why }: { why: string }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="panel" data-testid="email-login">
      <h2>כניסה</h2>
      <p className="hint">{why} נשלח קישור כניסה למייל, בלי סיסמה.</p>
      <div className="field">
        <label htmlFor="email">מייל</label>
        <input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      </div>
      <div>
        <button
          type="button"
          className="primary"
          disabled={!email.includes('@')}
          onClick={async () => {
            const r = await sendMagicLink(email)
            setNote(r.ok ? `נשלח קישור ל-${email}. פותחים אותו באותו דפדפן.` : `השליחה נכשלה: ${r.message}`)
          }}
        >
          שליחת קישור כניסה
        </button>
      </div>
      <p className="hint" role="status">
        {note}
      </p>
    </div>
  )
}
