/**
 * Saving a version (PRODUCT.md "מודל נתונים"): the full recipe, a short note, the view it was looked at from,
 * a 1:1 snapshot and the visual prompt. A version is never edited; the next save points back to it.
 */
import { useState } from 'react'
import { clearDraft, saveOrQueue } from '../../data/offline'
import type { SaveInput, View } from '../../data/projects'
import { ensureSession, type SessionState } from '../../data/supabase'
import { visualPrompt } from '../../prompt/visualPrompt'
import { parseRecipe } from '../../recipe/schema'
import { cameraControl } from '../../scene/BareScene'
import { viewport } from '../../scene/Viewport'
import { navigate } from '../router'
import { useStudio } from '../store'
import { EmailLogin } from './EmailLogin'

const SNAPSHOT_SIZE = 768

/**
 * The model window as a square PNG data URL, scaled down for storage. Read asynchronously (toBlob, then an
 * ImageBitmap): a synchronous drawImage of a WebGL canvas waits for the GPU and freezes the page meanwhile.
 */
async function snapshot(): Promise<string | null> {
  const src = viewport.canvas
  if (!src) return null
  const blob = await new Promise<Blob | null>((res) => src.toBlob(res, 'image/png'))
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = c.height = SNAPSHOT_SIZE
  const g = c.getContext('2d')
  if (!g) return null
  const side = Math.min(bmp.width, bmp.height)
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SNAPSHOT_SIZE, SNAPSHOT_SIZE)
  bmp.close()
  return c.toDataURL('image/png')
}

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
    const st = useStudio.getState()
    const recipe = st.validRecipe
    if (!recipe) return
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    useStudio.setState({ save: { status: 'saving' } })

    const parsed = parseRecipe(recipe)
    const r = parsed.ok ? parsed.recipe : null
    const pose = cameraControl.get?.() ?? { position: [0, 0, 0] as View['camera']['position'], target: [0, 0, 0] as View['camera']['target'] }
    const nextProject = st.project ?? {
      id: crypto.randomUUID(),
      concept: st.origin?.concept ?? r?.concept.name_he ?? st.sourceName,
      title_he: r?.narrative.name_he ?? r?.concept.name_he ?? 'פרויקט',
    }
    const input: SaveInput = {
      project: nextProject,
      versionId: crypto.randomUUID(),
      parentId: st.versionId,
      recipe,
      view: { level: st.level, camera: { preset: st.camera, ...pose } },
      note: note.trim() || null,
      snapshot: await snapshot().catch(() => null),
      visualPrompt: r && r.generator.type === 'sweep' ? visualPrompt(r as never).prompt : null,
    }
    const out = await saveOrQueue(input)
    if (out.status === 'failed') {
      useStudio.setState({ save: { status: 'failed', message: out.message } })
      return
    }
    useStudio.setState({
      project: nextProject,
      versionId: input.versionId,
      dirty: false,
      save: out.status === 'saved' ? { status: 'saved', at: Date.now() } : { status: 'queued', at: Date.now() },
    })
    // The address now names the saved version, so a reload reopens it.
    history.replaceState(null, '', `#/studio?v=${input.versionId}`)
    clearDraft()
    setNote('')
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
