/**
 * "קובץ להדפסה" (DECISIONS.md 87): the model closed, at a chosen size in millimeters, with a wall a home FDM
 * printer lays in PLA. The checks come before the download, each with its number and a way out when it fails.
 * The size in centimeters, the scale and the building in meters, the ground the print stands on, and a preview of
 * the exact file (DECISIONS.md 113–115).
 */
import { useState } from 'react'
import { addItem } from '../../data/collection'
import type { PrintFiles } from '../../engine/export'
import { PRINT_DEFAULTS, type PrintOptions, type PrintReport } from '../../engine/export/print'
import { PrintPreview } from '../../scene/PrintPreview'
import { download } from '../download'
import { engine } from '../engine'
import { ltr, num } from '../format'
import { navigate } from '../router'
import { anchorVersion } from '../saveCurrent'
import { useStudio } from '../store'

type State =
  | { status: 'idle' }
  | { status: 'busy'; step: string }
  | { status: 'ready'; files: PrintFiles; saved: { projectId: string } | null; message: string }
  | { status: 'failed'; message: string }

function NumberField({ id, label, unit, why, value, min, max, onChange }: { id: string; label: string; unit: string; why: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} ({unit})
      </label>
      <input id={id} type="number" inputMode="decimal" className="num" min={min} max={max} step="any" value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.currentTarget.value) || min)))} data-testid={id} />
      <span className="why">{why}</span>
    </div>
  )
}

/** Something everyone has held, about as long as the model's longest side. */
function likeSize(mm: number): string {
  if (mm <= 45) return 'מטבע גדול'
  if (mm <= 95) return 'כרטיס אשראי'
  if (mm <= 160) return 'טלפון נייד'
  if (mm <= 215) return 'כף יד פתוחה'
  if (mm <= 260) return 'ספר'
  if (mm <= 330) return 'דף A4'
  return 'מגש'
}

const triple = (v: number[], d: number) => ltr(v.map((x) => num(x, d)).join(' × '))

function SizeReport({ r }: { r: PrintReport }) {
  const [w, d, h] = r.sizeMm
  const longest = Math.max(w, d, h)
  return (
    <dl className="print-size" data-testid="print-dimensions">
      <dt>הדגם</dt>
      <dd>
        <span data-testid="print-size-cm">
          רוחב <span className="num">{num(w / 10, 1)}</span> ס"מ · עומק <span className="num">{num(d / 10, 1)}</span> ס"מ · גובה <span className="num">{num(h / 10, 1)}</span> ס"מ
        </span>
        <span className="why">
          {' '}
          (<span className="num">{triple(r.sizeMm, 0)}</span> מ"מ). בערך בגודל של {likeSize(longest)}.
        </span>
      </dd>
      <dt>קנה מידה</dt>
      <dd>
        <span className="num" data-testid="print-scale-ratio">
          {ltr(`1:${r.scale}`)}
        </span>
        <span className="why">
          {' '}
          מטר במבנה הוא <span className="num">{num(r.mmPerM, 1)}</span> מ"מ בדגם, וסנטימטר בדגם הוא <span className="num">{num(10 / r.mmPerM, 1)}</span> מ' במבנה.
        </span>
      </dd>
      <dt>המבנה</dt>
      <dd>
        רוחב <span className="num">{num(r.sizeM[0], 1)}</span> מ' · עומק <span className="num">{num(r.sizeM[1], 1)}</span> מ' · גובה <span className="num">{num(r.sizeM[2], 1)}</span> מ' מעל הקרקע
      </dd>
    </dl>
  )
}

function GroundReport({ r, surface }: { r: PrintReport; surface: boolean }) {
  if (surface && r.groundCut)
    return (
      <p className="print-ground" data-testid="print-ground" data-cut="true">
        <strong>מפלס הקרקע:</strong> בסיס המשטח שקוע <span className="num">{num(r.belowGroundM, 2)}</span> מ' מתחת לקרקע. הגאומטריה שמתחת לקרקע (
        <span className="num">{num(r.belowGroundM3, 1)}</span> מ"ק, <span className="num">{num(r.belowGroundShare * 100, 0)}%</span> מהמבנה) לא מודפסת. החיתוך נסגר במשטח ישר, והדגם עומד עליו על השולחן.
      </p>
    )
  if (!r.groundCut)
    return (
      <p className="print-ground" data-testid="print-ground" data-cut="false">
        <strong>מפלס הקרקע:</strong> המודל כולו מעל הקרקע, ומודפס במלואו. הנקודה הנמוכה שלו עומדת על השולחן.
      </p>
    )
  const cusp = Math.max(0, r.belowGroundM - r.sectionCenterM)
  return (
    <p className="print-ground" data-testid="print-ground" data-cut="true">
      <strong>מפלס הקרקע:</strong> <span className="num">{num(r.sectionCenterM, 2)}</span> מ' מתחת למרכז החתך
      {cusp > 0.005 && (
        <>
          , והחוד יורד <span className="num">{num(r.belowGroundM, 2)}</span> מ' מתחת לקרקע
        </>
      )}
      . הגאומטריה שמתחת לקרקע (<span className="num">{num(r.belowGroundM3, 1)}</span> מ"ק, <span className="num">{num(r.belowGroundShare * 100, 0)}%</span> מהמבנה) לא מודפסת. החיתוך נסגר במשטח ישר, והדגם עומד עליו על השולחן.
    </p>
  )
}

export function PrintPanel() {
  const recipe = useStudio((s) => s.validRecipe)
  const [opts, setOpts] = useState<PrintOptions>(PRINT_DEFAULTS)
  const [state, setState] = useState<State>({ status: 'idle' })
  const busy = state.status === 'busy'
  const set = (patch: Partial<PrintOptions>) => (setOpts((o) => ({ ...o, ...patch })), state.status === 'ready' && setState({ status: 'idle' }))

  const prepare = async () => {
    if (!recipe) return
    setState({ status: 'busy', step: 'מכין ובודק' })
    const out = await engine.printFiles(recipe, opts).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
    if ('error' in out) return setState({ status: 'failed', message: `ההכנה נכשלה: ${out.error}. אפשר לנסות שוב.` })
    setState({ status: 'ready', files: out, saved: null, message: '' })
  }

  const keep = async () => {
    if (state.status !== 'ready') return
    const files = state.files
    setState({ status: 'busy', step: 'שומר בקולקציה' })
    const anchor = await anchorVersion('נשמרה עם קובץ הדפסה')
    if (!anchor.ok) return setState({ status: 'ready', files, saved: null, message: `${anchor.message} הקובץ עדיין זמין להורדה.` })
    try {
      await addItem({
        kind: 'print',
        projectId: anchor.projectId,
        versionId: anchor.versionId,
        stage: 'print',
        view: null,
        blob: new Blob([files.threeMf.bytes as BlobPart], { type: 'model/3mf' }),
        ext: '3mf',
        distill: `1:${files.report.scale}, ${files.report.sizeMm.map((v) => num(v / 10, 1)).join(' × ')} ס"מ, ${num(files.report.grams, 0)} גרם PLA${files.report.groundCut ? ', חתוך במפלס הקרקע' : ''}`,
      })
      setState({ status: 'ready', files, saved: { projectId: anchor.projectId }, message: 'קובץ ה-3MF נשמר בקולקציה, בשלב הדפסה.' })
    } catch (e) {
      setState({ status: 'ready', files, saved: null, message: `${e instanceof Error ? e.message : String(e)} הקובץ עדיין זמין להורדה.` })
    }
  }

  const r = state.status === 'ready' ? state.files.report : null
  return (
    <section className="panel" aria-labelledby="print-title" data-testid="print-panel">
      <h2 id="print-title">קובץ להדפסה</h2>
      <p className="hint">למדפסת FDM ביתית ב-PLA. המודל נחתך במפלס הקרקע, נסגר לגוף אטום, מוקטן לגודל שבחרת במילימטרים, והדופן מעובה כשהיא דקה מדי. המתכון לא משתנה.</p>
      <NumberField id="print-size" label="הצלע הארוכה של המודל" unit='מ"מ' why="קובע את קנה המידה. 150 מ״מ נכנס לשולחן רגיל ומודפס בכמה שעות." value={opts.sizeMm} min={20} max={600} onChange={(v) => set({ sizeMm: v })} />
      <NumberField id="print-wall" label="דופן מינימלית" unit='מ"מ' why="הדופן הדקה ביותר שהמדפסת מניחה היטב. ב-FDM עם PLA: 2 מ״מ." value={opts.minWallMm} min={0.8} max={6} onChange={(v) => set({ minWallMm: v })} />
      <div className="field">
        <label htmlFor="print-bed-x">שולחן ההדפסה (מ"מ)</label>
        <div className="bed">
          {(['רוחב', 'עומק', 'גובה'] as const).map((name, i) => (
            <input
              key={name}
              id={i === 0 ? 'print-bed-x' : undefined}
              aria-label={`${name} השולחן`}
              type="number"
              inputMode="decimal"
              className="num"
              min={50}
              max={1000}
              value={opts.bed[i]}
              onChange={(e) => {
                const bed = [...opts.bed] as PrintOptions['bed']
                bed[i] = Math.max(50, Number(e.currentTarget.value) || 50)
                set({ bed })
              }}
            />
          ))}
        </div>
        <span className="why">רוחב, עומק וגובה. המודל צריך להיכנס בשלושתם.</span>
      </div>
      <div className="toolbar">
        <button type="button" className="primary" onClick={prepare} disabled={!recipe || busy} data-testid="print-prepare">
          {busy ? state.step : 'הכנה ובדיקה'}
        </button>
      </div>

      {state.status === 'failed' && (
        <p className="notice error" role="alert">
          {state.message}
        </p>
      )}

      {r && state.status === 'ready' && (
        <div className="print-report" data-testid="print-report" data-ok={r.checks.every((c) => c.ok)}>
          <p className="print-scale">
            קנה מידה <span className="num">{ltr(`1:${r.scale}`)}</span> · <span className="num">{triple(r.sizeMm.map((v) => v / 10), 1)}</span> ס"מ · <span className="num">{num(r.grams, 0)}</span> גרם PLA
          </p>
          <SizeReport r={r} />
          <GroundReport r={r} surface={(recipe as { generator?: { type?: string } } | null)?.generator?.type === 'parametric_surface'} />
          <figure className="print-preview" data-testid="print-preview">
            <div className="print-preview-view" aria-label="תצוגה מקדימה של הקובץ שיודפס, על שולחן ההדפסה. גרירה מסובבת, גלגלת מקרבת." role="img">
              <PrintPreview stl={state.files.stl.bytes} bed={opts.bed} />
            </div>
            <figcaption className="why">הקובץ שיודפס בפועל, על שולחן של <span className="num">{ltr(`${num(opts.bed[0] / 10, 0)} × ${num(opts.bed[1] / 10, 0)}`)}</span> ס"מ עם רשת של סנטימטר. גרירה מסובבת, גלגלת מקרבת.</figcaption>
          </figure>
          <ul className="checks">
            {r.checks.map((c) => (
              <li key={c.id} data-check={c.id} data-ok={c.ok}>
                <strong>{c.ok ? 'עובר' : 'לא עובר'}</strong> · {c.label}: <span className="num">{c.value}</span>
                {c.fix && <span className="why"> {c.fix}</span>}
              </li>
            ))}
          </ul>
          {r.bodyNote && <p className="hint">{r.bodyNote}</p>}
          {r.openingsNote && (
            <p className="hint" data-testid="print-openings" data-cut={r.openingsCut}>
              {r.openingsNote}
            </p>
          )}
          <p className="print-orientation" data-testid="print-orientation" data-down={r.orientation.down}>
            <strong>כיוון הדפסה מומלץ:</strong> {r.orientation.label}. <span className="why">{r.orientation.reason}</span>
          </p>
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => download(state.files.threeMf.bytes as BlobPart, state.files.threeMf.mime, state.files.threeMf.filename)} data-testid="print-3mf">
              הורדת 3MF
            </button>
            <button type="button" onClick={() => download(state.files.stl.bytes as BlobPart, state.files.stl.mime, state.files.stl.filename)} data-testid="print-stl">
              הורדת STL
            </button>
            {state.saved ? (
              <button type="button" onClick={() => navigate('collection', { p: state.saved!.projectId })} data-testid="open-collection">
                לקולקציה
              </button>
            ) : (
              <button type="button" onClick={keep} data-testid="print-keep">
                שמירה בקולקציה
              </button>
            )}
          </div>
          <p className="hint">3MF שומר את היחידות במילימטרים, ולכן הסלייסר פותח אותו בגודל הנכון. STL לסלייסרים שלא קוראים 3MF.</p>
          {state.message && (
            <p className="hint" role="status" data-testid="print-status">
              {state.message}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
