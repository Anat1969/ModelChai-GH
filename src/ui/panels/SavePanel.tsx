/**
 * Saving a version (PRODUCT.md "מודל נתונים"): the full recipe, a short note, the view it was looked at from,
 * a 3:2 snapshot and the visual prompt. A version is never edited; the next save points back to it.
 */
import { useState } from 'react'
import { ensureSession, type SessionState } from '../../data/supabase'
import { navigate } from '../router'
import { saveCurrent } from '../saveCurrent'
import { useStudio } from '../store'
import { EmailLogin } from './EmailLogin'

const time = (ms: number) => new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

export function SavePanel() {
  const project = useStudio((s) => s.project)
  const versionId = useStudio((s) => s.versionId)
  const dirty = useStudio((s) => s.dirty)
  const save = useStudio((s) => s.save)
  const building = useStudio((s) => s.building)
  const [note, setNote] = useState('')
  const [session, setSession] = useState<SessionState | null>(null)

  const run = async () => {
    if (!useStudio.getState().validRecipe) return
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    const out = await saveCurrent(note)
    if (out.status === 'saved' || out.status === 'queued') setNote('')
  }

  return (
    <section className="panel" aria-labelledby="save-title" data-testid="save-panel">
      <h2 id="save-title">שמירה</h2>
      <p className="hint">
        {project ? `פרויקט: ${project.title_he}. ` : 'עוד לא נשמר. השמירה הראשונה פותחת פרויקט. '}
        {versionId ? 'גרסה חדשה תצביע על הגרסה הנוכחית ולא תשנה אותה.' : ''}
      </p>
      <div className="field">
        <label htmlFor="version-note">הערה לגרסה</label>
        <input id="version-note" maxLength={280} value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="למשל: רדיוס גדול יותר, חצר רחבה" data-testid="version-note" />
      </div>
      <div className="toolbar">
        <button type="button" className="primary" onClick={run} disabled={save.status === 'saving' || building || (!dirty && !!versionId)} data-testid="save-version">
          {save.status === 'saving' ? 'שומר' : 'שמירת גרסה'}
        </button>
        {project && (
          <button type="button" onClick={() => navigate('projects')}>
            כל הגרסאות
          </button>
        )}
      </div>
      <p className="hint" role="status" data-testid="save-status" data-status={save.status}>
        {save.status === 'saved' && `הגרסה נשמרה ב-${time(save.at)}, עם צילום ופרומפט.`}
        {save.status === 'queued' && `אין חיבור לשרת. הגרסה נשמרה במכשיר ב-${time(save.at)}, ותישלח כשהחיבור יחזור.`}
        {save.status === 'failed' && `השמירה נכשלה: ${save.message} אפשר לנסות שוב.`}
        {save.status === 'idle' && !dirty && versionId && 'אין שינויים מאז הגרסה הזאת.'}
      </p>
      {session?.status === 'needs-email' && <EmailLogin why="כדי לשמור גרסאות צריך להיות מחוברים." />}
      {session?.status === 'error' && <p className="notice error">החיבור נכשל: {session.message}. אפשר לנסות שוב.</p>}
    </section>
  )
}
