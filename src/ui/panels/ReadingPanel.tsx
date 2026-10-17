/**
 * "פרשנות": the concept read from mathematics to architecture. Three layers, from fixed to generated:
 * the recipe's own narrative, positive and negative measured on the model, and Claude's reading in four parts,
 * which is kept in the concept's library (DECISIONS.md 80).
 */
import { useEffect, useMemo, useState } from 'react'
import { addReading, loadLibrary, readingOf, requestReading, type Reading } from '../../data/library'
import { ensureSession } from '../../data/supabase'
import { figureGround } from '../../prompt/figureGround'
import { percent } from '../format'
import type { Built } from '../params'
import { useStudio } from '../store'
import { metricRows } from './MetricsPanel'

export function ReadingText({ r }: { r: Reading }) {
  return (
    <div className="reading" data-testid="reading">
      <p className="reading-synthesis">{r.synthesis}</p>
      <section>
        <h3>המושג הלוגי</h3>
        <p>{r.logic}</p>
      </section>
      <section>
        <h3>המושג המרחבי</h3>
        <p>{r.space}</p>
      </section>
      <section>
        <h3>פוזיטיב ונגטיב</h3>
        <p>{r.figure_ground}</p>
      </section>
    </div>
  )
}

export function ReadingPanel({ recipe }: { recipe: Built }) {
  const result = useStudio((s) => s.result)
  const project = useStudio((s) => s.project)
  const versionId = useStudio((s) => s.versionId)
  const [reading, setReading] = useState<Reading | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const fg = useMemo(() => (result ? figureGround(result.metrics, recipe.bare.mode === 'shell') : []), [result, recipe.bare.mode])

  // The latest saved reading of this project, if there is one.
  useEffect(() => {
    setReading(null)
    if (!project) return
    loadLibrary(project.id).then(
      (l) => setReading(l.readings[0] ? readingOf(l.readings[0]) : null),
      () => undefined,
    )
  }, [project])

  const write = async () => {
    setBusy(true)
    setStatus('')
    const s = await ensureSession()
    if (s.status !== 'signed-in') {
      setStatus(s.status === 'error' ? s.message : 'החיבור לשרת נכשל.')
      setBusy(false)
      return
    }
    const metrics = result ? Object.fromEntries(metricRows(result.metrics, recipe).map((r) => [r.label, r.value.replace(/[⁦⁩]/g, '')])) : undefined
    const out = await requestReading({ recipe, metrics, figureGround: Object.fromEntries(fg.map((r) => [r.label, r.value])) })
    if (!out.ok) {
      setStatus(out.error)
      setBusy(false)
      return
    }
    setReading(out.reading)
    if (project) {
      try {
        await addReading({ projectId: project.id, versionId, reading: out.reading })
        setStatus(`נכתבה תוך ${Math.round(out.durationMs / 1000)} שניות ונשמרה בספרייה.`)
      } catch (e) {
        setStatus(`נכתבה, אבל לא נשמרה: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else setStatus('נכתבה. כדי לשמור אותה בספרייה, שומרים גרסה.')
    setBusy(false)
  }

  return (
    <div className="readingpanel">
      <section className="library-section" aria-labelledby="concept-title">
        <h2 id="concept-title">המושג</h2>
        <p className="reading-insight">{recipe.narrative.insight}</p>
        {recipe.narrative.fit_note && (
          <p className="hint">
            <strong>מה אבד בתרגום: </strong>
            {recipe.narrative.fit_note}
          </p>
        )}
      </section>

      {fg.length > 0 && (
        <section className="library-section" aria-labelledby="fg-title">
          <h2 id="fg-title">פוזיטיב ונגטיב במספרים</h2>
          <dl className="fg" data-testid="figure-ground">
            {fg.map((r) => (
              <div key={r.key} data-key={r.key} data-share={r.share}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
                {r.share !== undefined && (
                  <div className="fg-bar" role="img" aria-label={`${percent(r.share)} בנוי, ${percent(1 - r.share)} ריק`}>
                    <span style={{ inlineSize: `${(r.share * 100).toFixed(1)}%` }} />
                  </div>
                )}
                <p className="why">{r.why}</p>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="library-section" aria-labelledby="reading-title">
        <h2 id="reading-title">מעולם המתמטיקה לעולם האדריכלי</h2>
        {reading ? (
          <ReadingText r={reading} />
        ) : (
          <p className="hint">Claude קורא את המושג בארבעה חלקים: מה הוא במתמטיקה, איך הצורה נושאת אותו אל המרחב, איפה הבנוי והסביבה נפגשים, ומשפט אחד שמחבר ביניהם. רק מהעובדות ומהמספרים שעל המסך.</p>
        )}
        <div className="toolbar compact">
          <button type="button" className="primary" onClick={write} disabled={busy} data-testid="write-reading">
            {busy ? 'Claude כותב' : reading ? 'כתיבה מחדש' : 'כתיבת פרשנות'}
          </button>
        </div>
        <p className="hint" role="status" data-testid="reading-status">
          {status}
        </p>
      </section>
    </div>
  )
}
