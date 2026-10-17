/**
 * Positive and negative in numbers: how much is built and how much is left open, in plan and in volume.
 * The reading of a concept as architecture rests on this meeting of mass and void, of closed and open,
 * of the building and its surroundings (DECISIONS.md 80). Pure, so it is tested against hand arithmetic.
 */
import type { Metrics } from '../engine/metrics'
import { num, percent } from '../ui/format'

export interface FigureGroundRow {
  key: 'plan' | 'volume' | 'envelope' | 'edge'
  label: string
  value: string
  /** The built share, 0–1, where it applies: the positive against the whole. */
  share?: number
  why: string
}

export function figureGround(m: Metrics, shell: boolean): FigureGroundRow[] {
  const rows: FigureGroundRow[] = []
  // A parametric surface (DECISIONS.md 139): its material against the space it holds, then its edge.
  const held = m.surface?.heldVolume
  if (m.surface && held != null) {
    rows.push({
      key: 'volume',
      label: 'בנפח: חומר מול חלל',
      value: `${num(m.volume, 0)} מ"ק חומר, ${num(held, 0)} מ"ק חלל`,
      share: m.volume / (m.volume + held),
      why: 'קליפה דקה מחזיקה חלל גדול ממנה פי כמה. החומר הוא הגבול, והחלל שהוא סוגר או מכסה הוא המקום.',
    })
  }
  if (m.surface) shell = false
  if (!m.surface && m.outerDiameter !== null && m.courtyardDiameter !== null) {
    const disc = (Math.PI / 4) * m.outerDiameter ** 2
    const court = (Math.PI / 4) * m.courtyardDiameter ** 2
    const built = disc - court
    rows.push({
      key: 'plan',
      label: 'בתוכנית: בנוי מול חצר',
      value: `${num(built, 0)} מ"ר בנוי, ${num(court, 0)} מ"ר חצר`,
      share: built / disc,
      why: 'הטבעת היא הפוזיטיב, והחצר שהיא סוגרת היא הנגטיב. היחס ביניהם קובע אם המקום מרגיש כמבנה או ככיכר.',
    })
  }
  if (shell && m.shellVolume !== null) {
    const voidVol = Math.max(0, m.solidVolume - m.volume)
    rows.push({
      key: 'volume',
      label: 'בנפח: חומר מול חלל',
      value: `${num(m.volume, 0)} מ"ק חומר, ${num(voidVol, 0)} מ"ק חלל`,
      share: m.volume / m.solidVolume,
      why: 'הקליפה מחזיקה חלל שאפשר להיכנס אליו. החומר הוא הגבול, והחלל הוא המקום.',
    })
  }
  if (shell) {
    rows.push({
      key: 'envelope',
      label: 'במעטפת: סגור מול פתוח',
      value: `${percent(1 - m.openingFraction)} סגור, ${percent(m.openingFraction)} פתוח`,
      share: 1 - m.openingFraction,
      why: 'דרך הפתחים הסביבה נכנסת פנימה: אור, רוח ומבט. כאן הבנוי והסביבה נוגעים זה בזה.',
    })
  }
  rows.push({
    key: 'edge',
    label: 'הגבול',
    value: m.edgeCount === 0 ? 'אין קצה: המשטח רציף' : m.edgeCount === 1 ? 'קצה אחד רציף' : `${num(m.edgeCount, 0)} קצוות נפרדים`,
    why:
      m.edgeCount === 1
        ? 'הקו שמפריד בין פנים לחוץ הוא קו אחד, ולכן הפנים והחוץ הם המשך זה של זה.'
        : m.edgeCount === 0
          ? 'אין קו שמפריד: הצורה נשענת על המשטח עצמו כדי להבדיל בין פנים לחוץ.'
          : 'כל קצה הוא גבול נפרד בין פנים לחוץ.',
  })
  return rows
}
