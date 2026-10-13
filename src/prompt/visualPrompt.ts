/**
 * Visual prompt from the current state (LEVELS.md 2.6): the same values the screen shows, so the image and the
 * model tell the same story. Every part names the recipe fields it is derived from; nothing is added because
 * it sounds impressive. tests/visualPrompt.test.ts checks that each field really changes its part.
 */
import { MATERIAL_LOOK } from '../engine/materials'
import { outerRadius, symmetryOrder } from '../recipe/rules'
import type { Recipe, SweepParams } from '../recipe/schema'
import { CONTEXTS, VEGETATION, type ContextId, type VegetationId } from '../scene/contexts/layout'
import { seasonOf } from '../scene/seasons'
import { clockLabel, dateLabel, localTime, siteWords, sunAt } from '../scene/sun'
import { num, turnsLabel } from '../ui/format'

type Sweep = Recipe & { generator: { type: 'sweep'; params: SweepParams } }

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
export const PROMPT_TAIL = 'Documentary realism, Professional architecture photography, 1:1 --ar 1:1 --no text, words, writing, frame divisions'

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

function shapePart(r: Sweep): PromptPart {
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

function materialPart(r: Sweep): PromptPart {
  const mats = r.realistic.materials
  const words = [`מעטפת מ${MATERIAL_LOOK[mats.outer].name_he}`]
  if (mats.inner && mats.inner !== mats.outer) words.push(`דופן פנימית מ${MATERIAL_LOOK[mats.inner].name_he}`)
  if (mats.floor) words.push(`רצפה מ${MATERIAL_LOOK[mats.floor].name_he}`)
  return { slot: 'material', text: words.join(', '), sources: ['realistic.materials'] }
}

function contextPart(r: Sweep): PromptPart {
  const c = CONTEXTS[r.realistic.context.preset as ContextId]
  const site = siteWords(r.realistic.site)
  const where = site ? ` ${site}` : ''
  return { slot: 'context', text: `${c.name_he}${where}: ${c.ground_he}, ${c.elements_he}`, sources: ['realistic.context.preset', 'realistic.site.name'] }
}

const WINDS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב']
export const windOf = (bearing: number) => WINDS[Math.round(bearing / 45) % 8]!

function lightPart(r: Sweep): PromptPart {
  const site = r.realistic.site
  const t = localTime(r.realistic.datetime, site)
  const sun = sunAt(site, new Date(r.realistic.datetime))
  const sources = ['realistic.datetime', 'realistic.site.lat', 'realistic.site.lon']
  if (sun.altitude <= 0) return { slot: 'light', text: `אחרי השקיעה, בשעה ${clockLabel(t.hour)}, אור דמדומים בלי שמש ישירה`, sources }
  const height = sun.altitude < 15 ? 'שמש נמוכה' : sun.altitude < 45 ? 'שמש בגובה בינוני' : 'שמש גבוהה'
  const shadow = sun.altitude < 15 ? ', צללים ארוכים' : sun.altitude > 60 ? ', צללים קצרים מתחת למבנה' : ''
  return {
    slot: 'light',
    text: `${height} מה${windOf(sun.bearing)}, ${num(sun.altitude, 0)}° מעל האופק, בשעה ${clockLabel(t.hour)}${shadow}`,
    sources,
  }
}

function seasonPart(r: Sweep): PromptPart {
  const t = localTime(r.realistic.datetime, r.realistic.site)
  const s = seasonOf(t.month)
  const veg = VEGETATION[(r.realistic.context.vegetation ?? CONTEXTS[r.realistic.context.preset as ContextId].vegetation) as VegetationId]
  const words = [`${s.name_he}, ${dateLabel(t)}`]
  if (veg.kind) words.push(`${veg.name_he} בגוון ${s.foliage_he}`)
  words.push(s.ground_he)
  return { slot: 'season', text: words.join(', '), sources: ['realistic.datetime', 'realistic.context.vegetation'] }
}

const WEATHER_WORDS = { clear: 'שמיים בהירים, צל חד', haze: 'אובך חם, צל רך ומפוזר', overcast: 'שמיים מעוננים ואפורים, אור רך בלי צל ישיר' } as const

function weatherPart(r: Sweep): PromptPart {
  return { slot: 'weather', text: WEATHER_WORDS[r.realistic.weather], sources: ['realistic.weather'] }
}

function peoplePart(r: Sweep): PromptPart | null {
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

function cameraPart(r: Sweep): PromptPart {
  const c = r.realistic.camera
  return { slot: 'camera', text: `${CAMERA_WORDS[c.preset]}, מגובה ${m(c.height)}, זווית ראייה ${num(c.fov_deg, 0)}°`, sources: ['realistic.camera'] }
}

function distill(r: Sweep): string {
  const n = r.narrative
  const line = n.maxim?.trim() || n.insight.split(/(?<=\.)\s/)[0]!.trim()
  return `${n.name_he}: ${line}`
}

export function visualPrompt(r: Sweep): VisualPrompt {
  const parts = [shapePart(r), materialPart(r), contextPart(r), lightPart(r), seasonPart(r), weatherPart(r), peoplePart(r), cameraPart(r)].filter(
    (p): p is PromptPart => p !== null,
  )
  return { distill: distill(r), parts, prompt: [...parts.map((p) => p.text), PROMPT_TAIL].join(', ') }
}
