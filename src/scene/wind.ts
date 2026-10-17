/**
 * Orientation and wind for the realistic level (DECISIONS.md 121, 122). Pure: no three.js and no DOM.
 *
 * What is computed and what is only shown: the sun's bearing relative to the model's front is computed from the
 * real date and place. The wind lines are an illustration: they follow ideal 2D flow around the footprint's
 * bounding circle, so they show the wind's direction and strength, not the flow around the actual shape.
 */
import { DEFAULT_WIND } from '../recipe/schema'

export interface Wind {
  /** Compass bearing the wind blows from: 0 north, 90 east, 270 west. */
  from_deg: number
  speed_ms: number
}

/** The recipe's wind, or the default where an older recipe has none. */
export function windOfRecipe(real: { wind?: Wind }): Wind {
  return real.wind ?? { ...DEFAULT_WIND }
}

/** The recipe's orientation in degrees, 0 where an older recipe has none. */
export function orientationOf(real: { orientation_deg?: number }): number {
  return real.orientation_deg ?? 0
}

const COMPASS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב']
/** Compass word for a bearing, in eight directions. */
export const compassWord = (bearing: number) => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!

/** Adjective of a compass word, as in "הצד הצפון-מערבי": only the last part takes the ending. */
export const compassAdjective = (bearing: number) => {
  const w = compassWord(bearing)
  const parts = w.split('-')
  const last = { צפון: 'צפוני', דרום: 'דרומי', מזרח: 'מזרחי', מערב: 'מערבי' }[parts.at(-1)!]!
  return [...parts.slice(0, -1), last].join('-')
}

const wrap360 = (a: number) => ((a % 360) + 360) % 360
/** Signed difference a − b, in degrees between −180 and 180. */
export const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180

// ---------- Beaufort ----------

/** Upper bound of each Beaufort force in m/s (WMO), and its Hebrew name. */
export const BEAUFORT: readonly { force: number; upTo: number; name_he: string; effect_he: string }[] = [
  { force: 0, upTo: 0.3, name_he: 'דממה', effect_he: 'עשן עולה ישר' },
  { force: 1, upTo: 1.6, name_he: 'משב קל מאוד', effect_he: 'העשן נוטה, השלטים לא זזים' },
  { force: 2, upTo: 3.4, name_he: 'רוח קלה', effect_he: 'מרגישים את הרוח בפנים, עלים מרשרשים' },
  { force: 3, upTo: 5.5, name_he: 'רוח חלשה', effect_he: 'עלים וענפים דקים בתנועה מתמדת' },
  { force: 4, upTo: 8.0, name_he: 'רוח מתונה', effect_he: 'אבק ונייר מתרוממים, ענפים קטנים זזים' },
  { force: 5, upTo: 10.8, name_he: 'רוח ערה', effect_he: 'עצים קטנים מתנדנדים' },
  { force: 6, upTo: 13.9, name_he: 'רוח חזקה', effect_he: 'ענפים גדולים זזים, קשה להחזיק מטרייה' },
  { force: 7, upTo: 17.2, name_he: 'רוח חזקה מאוד', effect_he: 'עצים שלמים זזים, קשה ללכת נגד הרוח' },
  { force: 8, upTo: 20.8, name_he: 'סוערת', effect_he: 'ענפים נשברים, ההליכה נעצרת' },
  { force: 9, upTo: 24.5, name_he: 'סערה', effect_he: 'נזק קל למבנים: רעפים ושלטים' },
  { force: 10, upTo: 28.5, name_he: 'סערה חזקה', effect_he: 'עצים נעקרים, נזק ניכר למבנים' },
  { force: 11, upTo: 32.7, name_he: 'סערה עזה', effect_he: 'נזק נרחב' },
  { force: 12, upTo: Infinity, name_he: 'הוריקן', effect_he: 'הרס' },
]

export function beaufort(speed: number): (typeof BEAUFORT)[number] {
  return BEAUFORT.find((b) => speed < b.upTo) ?? BEAUFORT[BEAUFORT.length - 1]!
}

// ---------- the model's front, the sun and the wind ----------

/**
 * Where something stands relative to the model's front, in words. `rel` is its bearing minus the front's
 * bearing: 0 is straight in front of the façade, 180 behind the model.
 */
export function sideOfFront(rel: number): 'front' | 'right' | 'back' | 'left' {
  const d = angleDiff(rel, 0)
  if (Math.abs(d) <= 45) return 'front'
  if (Math.abs(d) >= 135) return 'back'
  // Looking at the façade from outside, a bearing clockwise from the front is on the viewer's left.
  return d > 0 ? 'left' : 'right'
}

export const SIDE_HE = { front: 'מול החזית', right: 'מימין לחזית', back: 'מאחורי המבנה', left: 'משמאל לחזית' } as const

/** The sun relative to the front, as a bearing difference and words. */
export function sunOnFront(sunBearing: number, orientation: number): { rel: number; words: string } {
  const rel = wrap360(sunBearing - orientation)
  const side = sideOfFront(rel)
  const words = side === 'front' ? 'השמש מאירה את החזית' : side === 'back' ? 'החזית בצל, השמש מאחורי המבנה' : `השמש ${SIDE_HE[side]}, האור נוגע בחזית מהצד`
  return { rel, words }
}

/** Compass bearing of each passage of a ring: path angle θ is measured from +x (east) toward +z (south). */
export function passageBearings(count: number, startDeg: number, orientation: number): number[] {
  return Array.from({ length: count }, (_, i) => wrap360(90 + startDeg + (i * 360) / count + orientation))
}

export interface WindReading {
  force: number
  name_he: string
  /** Bearing the wind blows toward. */
  to_deg: number
  /** The model's side that faces the wind, and the sheltered side behind it, as adjectives ("מערבי"). */
  windward_he: string
  leeward_he: string
  /** Passages facing into the wind (within 60°), along the wind, and sheltered. Empty when there are none. */
  passages: { into: number; across: number; sheltered: number }
}

export function readWind(wind: Wind, passageBearing: number[]): WindReading {
  const b = beaufort(wind.speed_ms)
  const passages = { into: 0, across: 0, sheltered: 0 }
  for (const p of passageBearing) {
    const d = Math.abs(angleDiff(p, wind.from_deg))
    if (d <= 60) passages.into++
    else if (d >= 120) passages.sheltered++
    else passages.across++
  }
  return {
    force: b.force,
    name_he: b.name_he,
    to_deg: wrap360(wind.from_deg + 180),
    windward_he: compassAdjective(wind.from_deg),
    leeward_he: compassAdjective(wind.from_deg + 180),
    passages,
  }
}

// ---------- streamlines (illustration) ----------

export interface Streamline {
  /** Points x, y, z in scene axes (y up, north −z, east +x). */
  points: number[]
  /** Distance along the line at each point, in meters, for the moving dashes. */
  dist: number[]
}

/**
 * Lines of ideal 2D flow around a circle of radius R: ψ = v (1 − R²/(u² + v²)), u along the wind and v
 * across it. Each line keeps its upstream offset v₀ and bends around the circle. An illustration, not a
 * computation of the flow around the shape: no pressure, no separation, no turbulence.
 */
export function streamlines(center: [number, number], R: number, wind: Wind, heights: number[], opts: { lanes?: number; reach?: number; step?: number } = {}): Streamline[] {
  if (wind.speed_ms <= 0) return []
  const lanes = opts.lanes ?? 9
  const reach = opts.reach ?? Math.max(60, R * 3)
  const step = opts.step ?? Math.max(1, R / 12)
  const to = ((wind.from_deg + 180) * Math.PI) / 180
  // Unit vectors: along the wind (toward where it blows) and across it.
  const t = [Math.sin(to), -Math.cos(to)] as const
  const n = [Math.cos(to), Math.sin(to)] as const
  const out: Streamline[] = []
  const span = R * 2.2
  for (const y of heights) {
    for (let k = 0; k < lanes; k++) {
      // Offsets across the wind, skipping the stagnation line through the center.
      const v0 = -span + ((k + 0.5) / lanes) * 2 * span
      if (Math.abs(v0) < 1e-6) continue
      const points: number[] = [], dist: number[] = []
      let px = 0, pz = 0, total = 0
      for (let u = -reach; u <= reach + 1e-9; u += step) {
        const v = solveStream(u, v0, R)
        const x = center[0] + u * t[0] + v * n[0], z = center[1] + u * t[1] + v * n[1]
        if (points.length) total += Math.hypot(x - px, z - pz)
        points.push(x, y, z)
        dist.push(total)
        px = x
        pz = z
      }
      out.push({ points, dist })
    }
  }
  return out
}

/** v on the streamline of upstream offset v₀ at distance u along the wind, outside the circle. */
export function solveStream(u: number, v0: number, R: number): number {
  const s = Math.sign(v0), a = Math.abs(v0)
  const f = (v: number) => v - (R * R * v) / (u * u + v * v) - a
  // Outside the circle f rises monotonically: f < 0 on the circle and at v₀, f > 0 at v₀ + R.
  let lo = Math.max(a, Math.sqrt(Math.max(0, R * R - u * u))), hi = a + R
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) hi = mid
    else lo = mid
  }
  return s * (lo + hi) / 2
}
