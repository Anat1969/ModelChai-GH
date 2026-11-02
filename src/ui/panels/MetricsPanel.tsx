import { useEffect, useRef, useState } from 'react'
import type { Metrics } from '../../engine/metrics'
import { changes, infoOf, type Change } from '../metricMeaning'
import { DENSITY, MATERIAL_LOOK } from '../../engine/materials'
import type { RuleIssue } from '../../recipe/rules'
import { ltr, meters, num, percent, range } from '../format'
import type { Built, Sweep } from '../params'

export interface MetricRow {
  key: string
  label: string
  value: string
  /** Raw number for tests and for copying. */
  raw?: number
  /** Upper end of a range metric. */
  rawMax?: number
  /** Semantic rules whose warning belongs to this metric (RECIPE_SCHEMA.md). */
  rules?: number[]
}

const FAMILY_HE: Record<string, string> = {
  hyperboloid: 'היפרבולואיד',
  catenoid: 'קטנואיד',
  hyperbolic_paraboloid: 'פרבולואיד היפרבולי',
  monkey_saddle: 'אוכף קוף',
  helicoid: 'הליקואיד',
  klein_bottle: 'בקבוק קליין',
}

/** Rows of a parametric surface (DECISIONS.md 139): the ones that apply to it, each with its own explanation. */
function surfaceRows(m: Metrics, r: Built): MetricRow[] {
  const s = m.surface!
  const material = MATERIAL_LOOK[r.realistic.materials.outer].name_he
  const out: MetricRow[] = []
  out.push({ key: 'height', label: 'גובה', value: meters(s.height, 1), raw: s.height })
  if (m.outerDiameter !== null) out.push({ key: 'outerDiameter', label: 'קוטר חיצוני', value: meters(m.outerDiameter), raw: m.outerDiameter })
  else out.push({ key: 'planSize', label: 'מידות בתוכנית', value: `${num(s.planWidth, 1)} × ${num(s.planDepth, 1)} מ'`, raw: s.planWidth * s.planDepth })
  if (s.waistDiameter !== null) out.push({ key: 'waistDiameter', label: 'קוטר המותן מבפנים', value: meters(s.waistDiameter, 2), raw: s.waistDiameter })
  if (m.clearHeight) out.push({ key: 'clearHeight', label: 'גובה חופשי', value: range(m.clearHeight.min, m.clearHeight.max, 2), raw: m.clearHeight.min, rawMax: m.clearHeight.max, rules: [19] })
  out.push({
    key: 'edgeCount',
    label: 'מספר קצוות',
    value: m.edgeCount === 0 ? 'אין קצוות' : m.edgeCount === 1 ? '1 רציף' : `${num(m.edgeCount, 0)} נפרדים`,
    raw: m.edgeCount,
  })
  if (m.edgeCount > 0) out.push({ key: 'edgeLength', label: 'אורך הקצה', value: meters(m.edgeLength, 1), raw: m.edgeLength })
  out.push({ key: 'surfaceArea', label: `שטח ה${FAMILY_HE[s.family]}`, value: `${num(s.midArea, 0)} מ"ר`, raw: s.midArea, rules: [18] })
  out.push({ key: 'curvatureRadius', label: 'רדיוס העיקול הקטן', value: meters(s.minCurvatureRadius, 2), raw: s.minCurvatureRadius, rules: [17] })
  out.push({ key: 'volume', label: `${material}, קליפה בעובי ${meters(s.thickness, 2)}`, value: `${num(m.volume, 0)} מ"ק`, raw: m.volume })
  const weight = m.volume * DENSITY[r.realistic.materials.outer]
  out.push({ key: 'weight', label: 'משקל משוער', value: `${num(weight, 0)} טון`, raw: weight })
  out.push({ key: 'sinkDepth', label: 'עומק הבסיס בקרקע', value: meters(s.sinkDepth, 2), raw: s.sinkDepth })
  return out
}

const PHI = (1 + Math.sqrt(5)) / 2

/** Rows of a tiling (DECISIONS.md 147): the elements, then the mathematics the pattern stands for. */
function tilingRows(m: Metrics, r: Built): MetricRow[] {
  const t = m.tiling!
  const material = MATERIAL_LOOK[r.realistic.materials.outer].name_he
  const out: MetricRow[] = []
  out.push({ key: 'elements', label: 'מספר אלמנטים', value: num(t.elements, 0), raw: t.elements, rules: [24] })
  out.push({ key: 'planSize', label: 'מידות בתוכנית', value: ltr(`${num(t.planWidth, 1)} × ${num(t.planDepth, 1)} מ'`), raw: t.planWidth * t.planDepth })
  out.push({ key: 'height', label: t.tallest === t.lowest ? 'גובה' : 'גובה, מהנמוך לגבוה', value: t.tallest === t.lowest ? meters(t.tallest, 1) : range(t.lowest, t.tallest, 1), raw: t.tallest, rules: [22] })
  if (t.passage !== null) out.push({ key: 'passage', label: 'מעבר בין אלמנטים', value: meters(t.passage, 2), raw: t.passage, rules: [23] })
  if (t.riemannError !== null) {
    out.push({ key: 'riemannSum', label: 'סכום הפסים מול האינטגרל', value: ltr(`${num(t.riemannSum!, 0)} / ${num(t.integral!, 0)} מ"ר`), raw: t.riemannSum! })
    out.push({ key: 'riemannError', label: 'שגיאת הסכום', value: `${num(t.riemannError * 100, 2)}%`, raw: Math.abs(t.riemannError) })
  }
  if (t.primes !== null) out.push({ key: 'primes', label: `ראשוניים עד ${num(t.numbers!, 0)}`, value: `${num(t.primes, 0)}, והערכת N/ln N: ${num(t.primeEstimate!, 0)}`, raw: t.primes })
  if (t.ratio !== null) out.push({ key: 'goldenRatio', label: 'יחס שני הריבועים הגדולים', value: `${num(t.ratio, 4)}, ו-φ = ${num(PHI, 4)}`, raw: Math.abs(t.ratio - PHI) })
  if (t.endDistance !== null) out.push({ key: 'walkDistance', label: 'מרחק הסוף מההתחלה', value: `${meters(t.endDistance, 1)}, ו-√n × משבצת = ${meters(t.expectedDistance!, 1)}`, raw: t.endDistance })
  if (t.maxVisits !== null) out.push({ key: 'maxVisits', label: 'ביקורים במשבצת העמוסה', value: num(t.maxVisits, 0), raw: t.maxVisits })
  out.push({ key: 'footprintArea', label: 'שטח בנוי בתוכנית', value: `${num(t.footprint, 0)} מ"ר`, raw: t.footprint })
  out.push({ key: 'volume', label: `${material}, גופים מלאים`, value: `${num(m.volume, 0)} מ"ק`, raw: m.volume })
  const weight = m.volume * DENSITY[r.realistic.materials.outer]
  out.push({ key: 'weight', label: 'משקל משוער', value: `${num(weight, 0)} טון`, raw: weight })
  return out
}

export function metricRows(m: Metrics, r: Built): MetricRow[] {
  if (m.tiling) return tilingRows(m, r)
  if (m.surface) return surfaceRows(m, r)
  const shell = r.bare.mode === 'shell'
  const material = MATERIAL_LOOK[r.realistic.materials.outer].name_he
  const out: MetricRow[] = []
  if (m.outerDiameter !== null) out.push({ key: 'outerDiameter', label: 'קוטר חיצוני', value: meters(m.outerDiameter), raw: m.outerDiameter })
  if (m.courtyardDiameter !== null) out.push({ key: 'courtyardDiameter', label: 'קוטר החצר', value: meters(m.courtyardDiameter), raw: m.courtyardDiameter })
  const sp = (r as Sweep).generator.params
  const ring = sp.path.type === 'circle' || sp.path.type === 'ellipse'
  if (!ring) {
    // A path that is not a ring has no diameter: its plan size, height and length say how big it is.
    out.push({ key: 'footprint', label: 'רוחב ועומק בתוכנית', value: ltr(`${num(m.extents.x, 1)} × ${num(m.extents.z, 1)} מ'`), raw: m.extents.x * m.extents.z })
    out.push({ key: 'top', label: 'גובה מעל הקרקע', value: meters(m.extents.top, 1), raw: m.extents.top })
    out.push({ key: 'pathLength', label: 'אורך המסלול', value: meters(m.pathLength, 1), raw: m.pathLength })
  }
  if (m.crossingClearance !== null) {
    out.push({ key: 'crossingClearance', label: 'מרווח בהצטלבות', value: meters(m.crossingClearance, 2), raw: m.crossingClearance, rules: [11, 12] })
  }
  out.push({
    key: 'edgeCount',
    label: 'מספר קצוות',
    value: m.edgeCount === 0 ? 'אין קצוות' : m.edgeCount === 1 ? '1 רציף' : `${num(m.edgeCount, 0)} נפרדים`,
    raw: m.edgeCount,
  })
  if (m.edgeCount > 0) {
    out.push({
      key: 'edgeLength',
      label: 'אורך הקצה',
      value: m.edgeCount > 1 ? `${meters(m.edgeLength, 0)} (${num(m.edgeCount, 0)} × ${num(m.edgeLength / m.edgeCount, 0)})` : meters(m.edgeLength, 1),
      raw: m.edgeLength,
    })
  }
  if (shell && m.floorWidth) out.push({ key: 'floorWidth', label: 'רוחב רצפה', value: range(m.floorWidth.min, m.floorWidth.max, 2), raw: m.floorWidth.min, rawMax: m.floorWidth.max, rules: [5] })
  if (shell && m.clearHeight && m.floorContinuous !== null) {
    out.push({ key: 'clearHeight', label: 'גובה חופשי', value: range(m.clearHeight.min, m.clearHeight.max, 2), raw: m.clearHeight.min, rawMax: m.clearHeight.max, rules: [6] })
  }
  if (shell && m.floorContinuous !== null) {
    out.push({
      key: 'floorContinuous',
      label: 'הרצפה לאורך ההקפה',
      value: m.floorContinuous ? 'רציפה, סגורה במעגל' : `נקטעת ב-${percent(1 - (m.floorCoverage ?? 0))} מהמסלול`,
      raw: m.floorContinuous ? 1 : 0,
      rules: [5],
    })
  }
  if (shell && m.wallAtCorners !== null && m.edgeCount > 0) {
    out.push({ key: 'wallAtCorners', label: 'עובי בחודים (צלע)', value: meters(m.wallAtCorners, 2), raw: m.wallAtCorners, rules: [4] })
  }
  if (shell) out.push({ key: 'openingFraction', label: 'פתחים מתוך המעטפת', value: percent(m.openingFraction), raw: m.openingFraction })
  out.push({ key: 'volume', label: `${material}, ${shell ? 'קליפה' : 'גוש מלא'}`, value: `${num(m.volume, 0)} מ"ק`, raw: m.volume })
  // The weight follows the material on screen: a material change does not rebuild, so the build's weight may be stale.
  const weight = m.volume * DENSITY[r.realistic.materials.outer]
  out.push({ key: 'weight', label: 'משקל משוער', value: `${num(weight, 0)} טון`, raw: weight })
  if (shell) out.push({ key: 'saving', label: 'חיסכון לעומת גוש', value: percent(1 - m.volume / m.solidVolume), raw: 1 - m.volume / m.solidVolume })
  out.push({ key: 'envelopeArea', label: 'שטח מעטפת', value: `${num(m.envelopeArea, 0)} מ"ר`, raw: m.envelopeArea })
  out.push({ key: 'cuspBurial', label: ring ? 'עומק החוד בקרקע' : 'עומק מתחת לקרקע', value: meters(m.cuspBurial, 2), raw: m.cuspBurial, rules: [8] })
  return out
}

/**
 * Metrics that explain themselves (DECISIONS.md 106): each one opens to say what it measures, what it teaches and
 * how it helps decide. When a parameter moves, a line on top says which metrics moved and what that means in form,
 * space and use, until the next change.
 */
export function MetricsPanel({ metrics, issues, recipe }: { metrics: Metrics; issues: RuleIssue[]; recipe: Built }) {
  const rows = metricRows(metrics, recipe)
  const prev = useRef<MetricRow[] | null>(null)
  const [moved, setMoved] = useState<Change[]>([])
  useEffect(() => {
    if (prev.current) {
      const c = changes(prev.current, rows)
      if (c.length) setMoved(c)
    }
    prev.current = rows
  }, [metrics]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="panel" aria-labelledby="metrics-title">
      <h2 id="metrics-title">מדדים</h2>
      {moved.length > 0 && (
        <div className="metric-moved" role="status" data-testid="metric-moved">
          <strong>מה השתנה בשינוי האחרון</strong>
          <ul>
            {moved.slice(0, 4).map((c) => (
              <li key={c.key}>
                <span className="num">
                  {c.label}: {c.from} ← {c.to}
                </span>{' '}
                {c.meaning}
              </li>
            ))}
          </ul>
          <button type="button" className="quiet" onClick={() => setMoved([])}>
            הסתרה
          </button>
        </div>
      )}
      <dl className="metrics">
        {rows.map((row) => {
          const hit = issues.filter((i) => row.rules?.includes(i.rule))
          const info = infoOf(row.key)
          return (
            <div key={row.key} className={hit.length ? 'warn' : undefined}>
              <dt>{row.label}</dt>
              <dd data-metric={row.key} data-value={row.raw} data-max={row.rawMax}>
                {row.value}
              </dd>
              {hit.map((i) => (
                <span key={i.rule} className="rule" data-rule={i.rule}>
                  {i.message}
                </span>
              ))}
              {info && (
                <details className="metric-why" data-testid="metric-why">
                  <summary>מה זה אומר</summary>
                  <p>
                    <strong>מודד: </strong>
                    {info.measures}
                  </p>
                  <p>
                    <strong>לומדים: </strong>
                    {info.learn}
                  </p>
                  <p>
                    <strong>להחלטה: </strong>
                    {info.decide}
                  </p>
                </details>
              )}
            </div>
          )
        })}
      </dl>
      {metrics.tiling ? (
        <p className="hint">
          מחושב מהגאומטריה: כל אלמנט הוא מנסרה, והנפח הוא סכום השטח בתוכנית כפול הגובה. האלמנטים לא נוגעים זה בזה, ולכן כל אחד גוף סגור. המספרים
          המתמטיים, כמו סכום רימן מול האינטגרל או מספר הראשוניים, מחושבים מהדפוס עצמו. המשקל לפי צפיפות משוערת, לבדיקת סדר גודל בלבד.
        </p>
      ) : metrics.surface ? (
        <p className="hint">
          מחושב מהגאומטריה: שטח המשטח באינטגרציה נומרית של <span dir="ltr" className="num">|S<sub>u</sub> × S<sub>v</sub>|</span>, והנפח הוא השטח כפול העובי, כי הקליפה היא היסט לאורך הנורמל לשני
          הצדדים. המשקל לפי צפיפות משוערת של החומר, לבדיקת סדר גודל בלבד.
        </p>
      ) : (
        <p className="hint">
          מחושב מהגאומטריה: נפח לפי משפט פאפוס, שטח החתך כפול אורך מסלול המרכז. בקליפה: ההפרש בין החתך החיצוני לפנימי, פחות הפתחים.
          המשקל לפי צפיפות משוערת של החומר, לבדיקת סדר גודל בלבד.
        </p>
      )}
    </section>
  )
}
