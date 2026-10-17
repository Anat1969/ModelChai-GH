/**
 * Visual prompt from the current state (LEVELS.md 2.6): the same values the screen shows, so the image and the
 * model tell the same story. Every part names the recipe fields it is derived from; nothing is added because
 * it sounds impressive. tests/visualPrompt.test.ts checks that each field really changes its part.
 */
import { MATERIAL_LOOK } from '../engine/materials'
import { outerRadius, symmetryOrder } from '../recipe/rules'
import type { BuiltRecipe, SurfaceRecipe, SweepParams, SweepRecipe } from '../recipe/schema'
import { CONTEXTS, VEGETATION, type ContextId, type VegetationId } from '../scene/contexts/layout'
import { seasonOf } from '../scene/seasons'
import { clockLabel, dateLabel, localTime, siteWords, sunAt } from '../scene/sun'
import { SIDE_HE, beaufort, compassWord, orientationOf, sideOfFront, windOfRecipe } from '../scene/wind'
import { num, turnsLabel } from '../ui/format'

type Sweep = SweepRecipe
type Built = BuiltRecipe

export interface PromptPart {
  /** The slot in the LEVELS.md 2.6 template. */
  slot: 'shape' | 'material' | 'context' | 'light' | 'season' | 'weather' | 'people' | 'camera'
  text: string
  /** Dotted recipe paths this part is computed from. */
  sources: string[]
}

export interface VisualPrompt {
  distill: string
  parts: PromptPart[]
  prompt: string
}

/** Fixed tail of every prompt (LEVELS.md 2.6, and the user's standing rule for Midjourney). */
export const PROMPT_TAIL = 'Documentary realism, Professional architecture photography, 3:2 --ar 3:2 --no text, words, writing, frame divisions'

const m = (v: number) => `${num(v, 1)} מ'`
const P = 'generator.params'

function sectionWords(p: SweepParams): string {
  const s = p.section
  const base = (() => {
    switch (s.curve) {
      case 'deltoid':
        return 'חתך דלתואיד, משולש קעור עם שלושה חודים'
      case 'hypocycloid':
        return `חתך היפוציקלואיד עם ${s.cusps} חודים`
      case 'polygon':
        return `חתך מצולע עם ${s.sides} צלעות`
      case 'circle':
        return 'חתך עגול'
      case 'superellipse':
        return `חתך סופר-אליפסה במעריך ${num(s.exponent!, 1)}`
    }
  })()
  return s.aspect < 1 ? `${base}, משוטח ביחס ${num(s.aspect, 2)}` : base
}

function pathWords(p: SweepParams): string {
  const rOut = outerRadius(p.section) * Math.max(1, p.scale_along_path)
  switch (p.path.type) {
    case 'circle':
      return `טבעת בקוטר ${m(2 * (p.path.R! + outerRadius(p.section)))}`
    case 'ellipse':
      return `טבעת אליפטית במידות ${m(2 * (p.path.R! + outerRadius(p.section)))} על ${m(2 * (p.path.R2! + outerRadius(p.section)))}`
    case 'helix':
      return `סליל שעולה לגובה ${m(p.path.pitch! * p.path.turns! + rOut)} ב-${num(p.path.turns!, p.path.turns! % 1 ? 2 : 0)} סיבובים`
    case 'line':
      return `מבנה ישר באורך ${m(p.path.length!)}`
  }
}

/** Words for each surface family (DECISIONS.md 139): what the form is, in the numbers the screen shows. */
function surfaceWords(r: SurfaceRecipe): string {
  const p = r.generator.params
  switch (p.family) {
    case 'hyperboloid':
      return `מגדל היפרבולואיד חד-יריעתי בגובה ${m(p.height!)}, מותן בקוטר ${m(2 * p.waist_radius!)} שמתרחבת לקוטר ${m(2 * p.end_radius!)} בקצוות, משטח שכולו קווים ישרים`
    case 'catenoid':
      return `ביתן קטנואיד בגובה ${m(p.height!)}, משטח מינימלי שנמתח בין שתי טבעות בקוטר ${m(2 * p.waist_radius! * Math.cosh(p.height! / 2 / p.waist_radius!))}, מותן בקוטר ${m(2 * p.waist_radius!)}`
    case 'hyperbolic_paraboloid':
      return `גגון פרבולואיד היפרבולי על תוכנית ${m(p.span!)} על ${m(p.span2 ?? p.span!)}, שתי פינות מורמות לגובה ${m(p.rise!)} ושתיים יורדות לקרקע, כל השפות קווים ישרים`
    case 'monkey_saddle':
      return `אוכף קוף על תוכנית ${m(p.span!)} על ${m(p.span2 ?? p.span!)}, שלושה עמקים ושלושה רכסים שנפגשים במרכז שטוח, הפרש גובה ${m(p.rise!)}`
    case 'helicoid':
      return `רמפה הליקואידית ברדיוס ${m(p.radius!)}, שעולה ${m(p.pitch!)} בכל סיבוב, ${num(p.turns!, p.turns! % 1 ? 2 : 0)} סיבובים סביב ציר אחד`
    case 'klein_bottle':
      return `בקבוק קליין: חתך שמינייה שמסתובב חצי סיבוב לאורך טבעת בקוטר ${m(2 * p.radius!)}, משטח חד-צדדי בלי פנים וחוץ, שעובר דרך עצמו בטבעת אחת`
  }
}

function surfaceShape(r: SurfaceRecipe): PromptPart {
  const words = [surfaceWords(r), `קליפה דקה בעובי ${num(r.bare.shell?.thickness ?? 0.08, 2)} מ'`]
  const base = r.bare.section_center_height
  if (base < -0.05) words.push(`הבסיס שקוע בקרקע לעומק ${m(-base)}`)
  if (base > 0.05) words.push(`הבסיס מורם ${m(base)} מעל הקרקע`)
  return { slot: 'shape', text: words.join(', '), sources: [`${P}.family`, P, 'bare.shell', 'bare.section_center_height'] }
}

function shapePart(r: Built): PromptPart {
  if (r.generator.type === 'parametric_surface') return surfaceShape(r as SurfaceRecipe)
  return sweepShape(r as Sweep)
}

function sweepShape(r: Sweep): PromptPart {
  const p = r.generator.params
  const closed = p.path.type === 'circle' || p.path.type === 'ellipse'
  const words = [`מבנה שנוצר מ${sectionWords(p)}, לאורך ${pathWords(p)}`]
  if (p.twist.turns_per_lap !== 0) words.push(`החתך מסתובב ${turnsLabel(p.twist.turns_per_lap, closed ? symmetryOrder(p.section) : Infinity).split(',')[0]} ${closed ? 'בהקפה' : 'לאורך המבנה'}`)
  if (p.scale_along_path > 1) words.push(`החתך גדל פי ${num(p.scale_along_path, 1)} לאורך המסלול`)
  if (p.scale_along_path < 1) words.push(`החתך מצטמצם עד פי ${num(p.scale_along_path, 1)} בקצה המסלול`)
  words.push(r.bare.mode === 'shell' ? `קליפה חלולה בעובי ${m(r.bare.shell!.thickness)}` : 'גוש מלא')
  const passages = r.bare.openings?.passages?.count ?? 0
  const slots = r.bare.openings?.slots?.count ?? 0
  if (r.bare.mode === 'shell' && passages) words.push(`${passages} מעברים דרך הדפנות`)
  if (r.bare.mode === 'shell' && slots) words.push(`${slots} פסי אור בדופן`)
  const burial = outerRadius(p.section) - r.bare.section_center_height
  if (burial > 0.05) words.push(`החודים נקברים בקרקע לעומק ${m(burial)}`)
  return {
    slot: 'shape',
    text: words.join(', '),
    sources: [`${P}.section`, `${P}.path`, `${P}.twist.turns_per_lap`, `${P}.scale_along_path`, 'bare.mode', 'bare.shell', 'bare.openings', 'bare.section_center_height'],
  }
}

function materialPart(r: Built): PromptPart {
  const mats = r.realistic.materials
  const words = [`מעטפת מ${MATERIAL_LOOK[mats.outer].name_he}`]
  if (mats.inner && mats.inner !== mats.outer) words.push(`דופן פנימית מ${MATERIAL_LOOK[mats.inner].name_he}`)
  if (mats.floor) words.push(`רצפה מ${MATERIAL_LOOK[mats.floor].name_he}`)
  return { slot: 'material', text: words.join(', '), sources: ['realistic.materials'] }
}

function contextPart(r: Built): PromptPart {
  const c = CONTEXTS[r.realistic.context.preset as ContextId]
  const site = siteWords(r.realistic.site)
  const where = site ? ` ${site}` : ''
  return { slot: 'context', text: `${c.name_he}${where}: ${c.ground_he}, ${c.elements_he}`, sources: ['realistic.context.preset', 'realistic.site.name'] }
}

export const windOf = compassWord

function lightPart(r: Built): PromptPart {
  const site = r.realistic.site
  const t = localTime(r.realistic.datetime, site)
  const sun = sunAt(site, new Date(r.realistic.datetime))
  const sources = ['realistic.datetime', 'realistic.site.lat', 'realistic.site.lon', 'realistic.orientation_deg']
  const o = orientationOf(r.realistic)
  const facing = `החזית פונה ל${windOf(o)}`
  if (sun.altitude <= 0) return { slot: 'light', text: `אחרי השקיעה, בשעה ${clockLabel(t.hour)}, אור דמדומים בלי שמש ישירה, ${facing}`, sources }
  const height = sun.altitude < 15 ? 'שמש נמוכה' : sun.altitude < 45 ? 'שמש בגובה בינוני' : 'שמש גבוהה'
  const shadow = sun.altitude < 15 ? ', צללים ארוכים' : sun.altitude > 60 ? ', צללים קצרים מתחת למבנה' : ''
  return {
    slot: 'light',
    text: `${height} מה${windOf(sun.bearing)}, ${num(sun.altitude, 0)}° מעל האופק, בשעה ${clockLabel(t.hour)}${shadow}, ${facing}, השמש ${SIDE_HE[sideOfFront(sun.bearing - o)]}`,
    sources,
  }
}

function seasonPart(r: Built): PromptPart {
  const t = localTime(r.realistic.datetime, r.realistic.site)
  const s = seasonOf(t.month)
  const veg = VEGETATION[(r.realistic.context.vegetation ?? CONTEXTS[r.realistic.context.preset as ContextId].vegetation) as VegetationId]
  const words = [`${s.name_he}, ${dateLabel(t)}`]
  if (veg.kind) words.push(`${veg.name_he} בגוון ${s.foliage_he}`)
  words.push(s.ground_he)
  return { slot: 'season', text: words.join(', '), sources: ['realistic.datetime', 'realistic.context.vegetation'] }
}

const WEATHER_WORDS = {
  clear: 'שמיים בהירים, צל חד',
  haze: 'אובך חם, צל רך ומפוזר',
  overcast: 'שמיים מעוננים ואפורים, אור רך בלי צל ישיר',
  rain: 'גשם יורד, קרקע רטובה ומבריקה, שמיים כהים בלי צל ישיר',
  fog: 'ערפל סמיך, אור חלבי וצל רך מאוד, הרקע נבלע בערפל',
  snow: 'שלג יורד, שלג על הקרקע ועל הצמחייה, אור לבן רך בלי צל',
} as const

function weatherPart(r: Built): PromptPart {
  const w = windOfRecipe(r.realistic)
  const b = beaufort(w.speed_ms)
  const wind = b.force === 0 ? 'בלי רוח' : `${b.name_he} מה${windOf(w.from_deg)}, ${num(w.speed_ms, 0)} מ' לשנייה (בופור ${b.force})`
  return { slot: 'weather', text: `${WEATHER_WORDS[r.realistic.weather]}, ${wind}`, sources: ['realistic.weather', 'realistic.wind'] }
}

function peoplePart(r: Built): PromptPart | null {
  const n = r.realistic.context.people ?? 0
  if (!n) return null
  return { slot: 'people', text: n === 1 ? 'אדם אחד לקנה מידה' : `${n} אנשים לקנה מידה`, sources: ['realistic.context.people'] }
}

const CAMERA_WORDS = {
  eye_level_oblique: 'מבט אלכסוני בגובה עיניים',
  aerial: 'מבט על אלכסוני',
  inside: 'מבט מבפנים, על הרצפה הפנימית ולאורך המסלול',
  courtyard: 'מבט מתוך החצר אל המבנה',
} as const

/** "Inside" means a different place on a surface: up the tower, under the canopy, on the ramp. */
const SURFACE_INSIDE: Record<string, string> = {
  hyperboloid: 'מבט מתוך המגדל כלפי מעלה',
  catenoid: 'מבט מתוך הביתן כלפי מעלה',
  hyperbolic_paraboloid: 'מבט מתחת לקליפה',
  monkey_saddle: 'מבט מתחת לקליפה',
  helicoid: 'מבט על הרמפה, במעלה הסיבוב',
  klein_bottle: CAMERA_WORDS.eye_level_oblique,
}

function cameraPart(r: Built): PromptPart {
  const c = r.realistic.camera
  const words = c.preset === 'inside' && r.generator.type === 'parametric_surface' ? SURFACE_INSIDE[r.generator.params.family]! : CAMERA_WORDS[c.preset]
  return { slot: 'camera', text: `${words}, מגובה ${m(c.height)}, זווית ראייה ${num(c.fov_deg, 0)}°`, sources: ['realistic.camera'] }
}

function distill(r: Built): string {
  const n = r.narrative
  const line = n.maxim?.trim() || n.insight.split(/(?<=\.)\s/)[0]!.trim()
  return `${n.name_he}: ${line}`
}

export function visualPrompt(r: Built): VisualPrompt {
  const parts = [shapePart(r), materialPart(r), contextPart(r), lightPart(r), seasonPart(r), weatherPart(r), peoplePart(r), cameraPart(r)].filter(
    (p): p is PromptPart => p !== null,
  )
  return { distill: distill(r), parts, prompt: [...parts.map((p) => p.text), PROMPT_TAIL].join(', ') }
}
