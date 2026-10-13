/** No login: this device owns its projects. The personal link opens them on another device. */
import { useState } from 'react'
import { deviceLink } from '../../data/supabase'

export function DevicePanel() {
  const [note, setNote] = useState('')
  return (
    <section className="panel" aria-labelledby="device-title" data-testid="device-panel">
      <h2 id="device-title">מכשיר נוסף</h2>
      <p className="hint">אין כניסה ואין סיסמה: הפרויקטים שמורים לחשבון של המכשיר הזה. כדי לפתוח אותם גם במחשב או בטלפון אחר, פותחים שם את הקישור האישי.</p>
      <div className="toolbar compact">
        <button
          type="button"
          onClick={async () => {
            const link = deviceLink()
            if (!link) return setNote('עוד לא נוצר חשבון למכשיר. שומרים גרסה ראשונה ומנסים שוב.')
            const ok = await navigator.clipboard?.writeText(link).then(
              () => true,
              () => false,
            )
            setNote(ok ? 'הקישור הועתק. הוא כמו מפתח: מי שמחזיק בו יכול לפתוח את הפרויקטים, ולכן שולחים אותו רק לעצמך.' : link)
          }}
          data-testid="copy-device-link"
        >
          העתקת הקישור האישי
        </button>
      </div>
      <p className="hint" role="status">
        {note}
      </p>
    </section>
  )
}
