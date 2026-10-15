import { useState } from 'react'
import type { ExportFormat } from '../../engine/export'
import { viewport } from '../../scene/Viewport'
import { download } from '../download'
import { engine } from '../engine'
import { useStudio } from '../store'

/** A format is a design decision: each button says what the file keeps and where it goes (docs/DNA.md). */
const FORMATS: { id: ExportFormat | 'png'; label: string; note: string }[] = [
  { id: 'glb', label: 'glTF', note: 'רשתות עם חומרים, ל-Blender' },
  { id: 'obj', label: 'OBJ', note: 'רשתות וקו הקצה, ל-Rhino' },
  { id: 'stl', label: 'STL', note: 'גוף אחד במטרים, Z למעלה, לתוכנות תלת-ממד' },
  { id: 'json', label: 'JSON', note: 'המתכון, לשחזור ולשיתוף' },
  { id: 'png', label: 'PNG', note: 'צילום 3:2 של חלון המודל' },
]

export function ExportPanel() {
  const recipe = useStudio((s) => s.validRecipe)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const id = ((recipe?.meta as { id?: string } | undefined)?.id ?? 'model').replace(/[^a-z0-9-]/g, '')

  const run = async (fmt: ExportFormat | 'png') => {
    if (!recipe) return
    setBusy(fmt)
    setMessage('')
    try {
      if (fmt === 'png') {
        const canvas = viewport.canvas
        if (!canvas) throw new Error('חלון המודל עדיין לא מוכן')
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
        if (!blob) throw new Error('הדפדפן לא הפיק תמונה')
        download(blob, 'image/png', `${id}.png`)
        setMessage(`נשמר ${id}.png, ${canvas.width} × ${canvas.height} פיקסלים`)
      } else {
        const f = await engine.exportFile(recipe, fmt)
        if ('error' in f) throw new Error(f.error)
        download(f.bytes as BlobPart, f.mime, f.filename)
        setMessage(`נשמר ${f.filename}, ${(f.bytes.length / 1e6).toLocaleString('he-IL', { maximumFractionDigits: 1 })} מגה-בייט`)
      }
    } catch (e) {
      setMessage(`הייצוא נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel" aria-labelledby="export-title">
      <h2 id="export-title">ייצוא</h2>
      <div className="exports">
        {FORMATS.map((f) => (
          <button key={f.id} type="button" disabled={!recipe || busy !== null} onClick={() => run(f.id)} data-testid={`export-${f.id}`}>
            <span>{busy === f.id ? `מכין ${f.label}` : f.label}</span>
            <small>{f.note}</small>
          </button>
        ))}
      </div>
      <p className="hint">להדפסה: "קובץ להדפסה" למעלה. הוא מוקטן לגודל במילימטרים, אטום, ובודק את עובי הדופן.</p>
      <p className="hint" role="status" data-testid="export-status">
        {message}
      </p>
    </section>
  )
}
