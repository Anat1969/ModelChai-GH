import type { Metrics } from '../../engine/metrics'
import { MATERIAL_LOOK } from '../../engine/materials'
import type { RuleIssue } from '../../recipe/rules'
import { meters, num, percent, range } from '../format'
import type { Sweep } from '../params'

interface Row {
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

function rows(m: Metrics, r: Sweep): Row[] {
  const shell = r.bare.mode === 'shell'
  const material = MATERIAL_LOOK[r.realistic.materials.outer].name_he
  const out: Row[] = []
  if (m.outerDiameter !== null) out.push({ key: 'outerDiameter', label: 'קוטר חיצוני', value: meters(m.outerDiameter), raw: m.outerDiameter })
  if (m.courtyardDiameter !== null) out.push({ key: 'courtyardDiameter', label: 'קוטר החצר', value: meters(m.courtyardDiameter), raw: m.courtyardDiameter })
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
  out.push({ key: 'weight', label: 'משקל משוער', value: `${num(m.weight, 0)} טון`, raw: m.weight })
  if (shell) out.push({ key: 'saving', label: 'חיסכון לעומת גוש', value: percent(1 - m.volume / m.solidVolume), raw: 1 - m.volume / m.solidVolume })
  out.push({ key: 'envelopeArea', label: 'שטח מעטפת', value: `${num(m.envelopeArea, 0)} מ"ר`, raw: m.envelopeArea })
  out.push({ key: 'cuspBurial', label: 'עומק החוד בקרקע', value: meters(m.cuspBurial, 2), raw: m.cuspBurial, rules: [8] })
  return out
}

export function MetricsPanel({ metrics, issues, recipe }: { metrics: Metrics; issues: RuleIssue[]; recipe: Sweep }) {
  return (
    <section className="panel" aria-labelledby="metrics-title">
      <h2 id="metrics-title">מדדים</h2>
      <dl className="metrics">
        {rows(metrics, recipe).map((row) => {
          const hit = issues.filter((i) => row.rules?.includes(i.rule))
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
            </div>
          )
        })}
      </dl>
      <p className="hint">
        נפח לפי משפט פאפוס: שטח החתך כפול אורך מסלול המרכז. בקליפה: ההפרש בין החתך החיצוני לפנימי, פחות הפתחים. המשקל לפי צפיפות
        משוערת של החומר, לבדיקת סדר גודל בלבד.
      </p>
    </section>
  )
}
