/** Hebrew number formatting. Every value has a unit; decimals are fixed so digits do not jump. */
const cache = new Map<number, Intl.NumberFormat>()
function nf(d: number) {
  let f = cache.get(d)
  if (!f) {
    f = new Intl.NumberFormat('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d })
    cache.set(d, f)
  }
  return f
}

export const num = (v: number, d = 1) => nf(d).format(v)
export const meters = (v: number, d = 1) => `${num(v, d)} מ'`
/** Left-to-right isolate (U+2066 … U+2069), so a range reads low to high inside Hebrew text. */
export const ltr = (s: string) => `\u2066${s}\u2069`
export const range = (min: number, max: number, d = 1) => `${ltr(`${num(min, d)}–${num(max, d)}`)} מ'`
export const percent = (v: number) => `${num(v * 100, 0)}%`

const GCD = (a: number, b: number): number => (b ? GCD(b, a % b) : a)
/** 1/3 → "שליש סיבוב, 120°". Falls back to degrees for values that are not simple fractions. */
export function turnsLabel(turns: number, order: number): string {
  const deg = num(turns * 360, 0)
  if (turns === 0) return 'ללא סיבוב, 0°'
  if (!Number.isFinite(order)) return `${deg}°`
  const k = Math.round(turns * order)
  const g = GCD(Math.abs(k), order)
  const p = k / g, q = order / g
  const names: Record<string, string> = { '1/2': 'חצי סיבוב', '1/3': 'שליש סיבוב', '2/3': 'שני שלישים', '1/4': 'רבע סיבוב', '3/4': 'שלושה רבעים', '1/1': 'סיבוב שלם' }
  const key = `${Math.abs(p)}/${q}`
  const name = names[key] ?? `${Math.abs(p)}/${q} סיבוב`
  return `${p < 0 ? 'נגד הכיוון, ' : ''}${name}, ${deg}°`
}
