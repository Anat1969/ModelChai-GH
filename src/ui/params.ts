/**
 * The bare-level parameters (LEVELS.md 1.2). Each one has a value, a unit and one sentence on its effect.
 * Ranges follow the semantic rules where they can, so most slider positions build; the rest are caught by the
 * engine and the slider returns to the last valid value.
 */
import { outerRadius, symmetryOrder } from '../recipe/rules'
import type { Recipe, SweepParams } from '../recipe/schema'
import { num, percent, turnsLabel } from './format'

type Sweep = Recipe & { generator: { type: 'sweep'; params: SweepParams } }

export interface SliderDef {
  kind: 'slider'
  id: string
  path: string
  label: string
  why: string
  min: (r: Sweep) => number
  max: (r: Sweep) => number
  step: number
  value: (r: Sweep) => number
  format: (v: number) => string
  /** Value written back to the recipe; defaults to the slider value. */
  write?: (v: number, r: Sweep) => unknown
  show?: (r: Sweep) => boolean
}

export interface ChoiceDef {
  kind: 'choice'
  id: string
  path: string
  label: string
  why: string
  options: { value: string; label: string }[]
  value: (r: Sweep) => string
  show?: (r: Sweep) => boolean
}

export type ParamDef = SliderDef | ChoiceDef

export interface ParamGroup {
  title: string
  params: ParamDef[]
}

const P = 'generator.params'
const m = (d: number) => (v: number) => `${num(v, d)} מ'`
const shell = (r: Sweep) => r.bare.mode === 'shell'
const closed = (r: Sweep) => r.generator.params.path.type === 'circle' || r.generator.params.path.type === 'ellipse'
const hasR = (r: Sweep) => r.generator.params.path.type !== 'line'
const isHypo = (r: Sweep) => r.generator.params.section.curve === 'deltoid' || r.generator.params.section.curve === 'hypocycloid'
const rOut = (r: Sweep) => outerRadius(r.generator.params.section) * Math.max(1, closed(r) ? 1 : r.generator.params.scale_along_path)
const roundUp = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step

/** The twist slider moves over whole multiples of 1 / symmetry order, so the ring always closes (rule 1). */
export function twistSteps(r: Sweep): { order: number; k: number } {
  const order = closed(r) ? symmetryOrder(r.generator.params.section) : Infinity
  return { order, k: Math.round(r.generator.params.twist.turns_per_lap * (Number.isFinite(order) ? order : 20)) }
}

export const GROUPS: ParamGroup[] = [
  {
    title: 'גאומטריה',
    params: [
      {
        kind: 'slider',
        id: 'R',
        path: `${P}.path.R`,
        label: 'רדיוס הטבעת',
        why: 'מרכז הטבעת עד מרכז החתך. קובע את גודל החצר.',
        min: (r) => roundUp(rOut(r) + 0.5, 0.5),
        max: (r) => Math.max(60, r.generator.params.path.R ?? 0),
        step: 0.5,
        value: (r) => r.generator.params.path.R ?? 0,
        format: m(1),
        show: hasR,
      },
      {
        kind: 'slider',
        id: 'a',
        path: `${P}.section.a`,
        label: 'מקדם החתך',
        why: 'החודים במרחק 3a, הפאות במרחק a.',
        min: (r) => Math.max(0.3, roundUp((r.bare.shell?.thickness ?? 0) / 0.95, 0.05)),
        max: (r) => {
          const perA = outerRadius({ ...r.generator.params.section, a: 1 })
          const R = r.generator.params.path.R
          return hasR(r) && R ? Math.min(8, Math.floor(((R - 0.3) / perA) * 20) / 20) : 8
        },
        step: 0.05,
        value: (r) => r.generator.params.section.a,
        format: m(2),
      },
      {
        kind: 'slider',
        id: 'twist',
        path: `${P}.twist.turns_per_lap`,
        label: 'סיבוב החתך',
        why: 'שליש סיבוב מחבר את שלושת הקצוות לאחד.',
        min: (r) => (Number.isFinite(twistSteps(r).order) ? -twistSteps(r).order : -20),
        max: (r) => (Number.isFinite(twistSteps(r).order) ? twistSteps(r).order : 20),
        step: 1,
        value: (r) => twistSteps(r).k,
        format: () => '',
        write: (k, r) => {
          const { order } = twistSteps(r)
          return Number.isFinite(order) ? k / order : k / 20
        },
      },
      {
        kind: 'slider',
        id: 'aspect',
        path: `${P}.section.aspect`,
        label: 'יחס החתך',
        why: 'ערך נמוך משטיח את החתך לרצועה.',
        min: () => 0.03,
        max: () => 1,
        step: 0.01,
        value: (r) => r.generator.params.section.aspect,
        format: (v) => num(v, 2),
        show: (r) => !isHypo(r) || r.generator.params.section.aspect !== 1,
      },
      {
        kind: 'slider',
        id: 'pitch',
        path: `${P}.path.pitch`,
        label: 'פסיעת הסליל',
        why: 'הגובה שהסליל עולה בכל הקפה.',
        min: () => 0.5,
        max: () => 40,
        step: 0.1,
        value: (r) => r.generator.params.path.pitch ?? 1,
        format: m(1),
        show: (r) => r.generator.params.path.type === 'helix',
      },
      {
        kind: 'slider',
        id: 'turns',
        path: `${P}.path.turns`,
        label: 'מספר הקפות',
        why: 'כמה פעמים הסליל מקיף את הציר.',
        min: () => 0.25,
        max: () => 10,
        step: 0.25,
        value: (r) => r.generator.params.path.turns ?? 1,
        format: (v) => num(v, 2),
        show: (r) => r.generator.params.path.type === 'helix',
      },
      {
        kind: 'slider',
        id: 'scale',
        path: `${P}.scale_along_path`,
        label: 'קנה מידה לאורך המסלול',
        why: 'היחס בין סוף המסלול לתחילתו. היחס בין שתי הקפות עוקבות נשאר קבוע.',
        min: () => 0.1,
        max: () => 2,
        step: 0.001,
        value: (r) => r.generator.params.scale_along_path,
        format: (v) => num(v, 3),
        show: (r) => !closed(r),
      },
    ],
  },
  {
    title: 'מיקום ומבנה',
    params: [
      {
        kind: 'slider',
        id: 'h0',
        path: 'bare.section_center_height',
        label: 'גובה מרכז החתך',
        why: 'נמוך מרדיוס החוד: החוד נקבר בקרקע.',
        min: () => -5,
        max: () => 20,
        step: 0.1,
        value: (r) => r.bare.section_center_height,
        format: m(1),
      },
      {
        kind: 'choice',
        id: 'mode',
        path: 'bare.mode',
        label: 'גוש או קליפה',
        why: 'בקליפה אפשר להיכנס, והבטון יורד לפחות מרבע.',
        options: [
          { value: 'shell', label: 'קליפה חלולה' },
          { value: 'solid', label: 'גוש מלא' },
        ],
        value: (r) => r.bare.mode,
      },
      {
        kind: 'slider',
        id: 'thickness',
        path: 'bare.shell.thickness',
        label: 'עובי דופן',
        why: 'בחודים העובי משולש, ולכן החוד הופך לצלע.',
        min: () => 0.08,
        max: (r) => Math.min(1.5, Math.floor(r.generator.params.section.a * 0.95 * 100) / 100),
        step: 0.01,
        value: (r) => r.bare.shell?.thickness ?? 0.3,
        format: m(2),
        show: shell,
      },
    ],
  },
  {
    title: 'פתחים',
    params: [
      {
        kind: 'slider',
        id: 'passages',
        path: 'bare.openings.passages.count',
        label: 'מעברים',
        why: 'כל מעבר חוצה את שתי הדפנות, מהחוץ לחצר.',
        min: () => 0,
        max: (r) => {
          const w = r.bare.openings?.passages?.width ?? 3.2
          const R = r.generator.params.path.R ?? 1
          return Math.max(0, Math.min(12, Math.ceil((0.8 * 2 * Math.PI * R) / w) - 1))
        },
        step: 1,
        value: (r) => r.bare.openings?.passages?.count ?? 0,
        format: (v) => num(v, 0),
        show: (r) => shell(r) && closed(r),
      },
      {
        kind: 'slider',
        id: 'slots',
        path: 'bare.openings.slots.count',
        label: 'פסי אור',
        why: 'הפסים מסתובבים עם החתך: חלון גג במקום אחד, חלון צד במקום אחר.',
        min: () => 0,
        max: () => 96,
        step: 1,
        value: (r) => r.bare.openings?.slots?.count ?? 0,
        format: (v) => num(v, 0),
        show: shell,
      },
      {
        kind: 'slider',
        id: 'slotWidth',
        path: 'bare.openings.slots.width_fraction',
        label: 'רוחב פס האור',
        why: 'חלק מרוחב הפאה. רחב יותר: יותר אור ופחות חומר.',
        min: () => 0.05,
        max: () => 0.8,
        step: 0.01,
        value: (r) => r.bare.openings?.slots?.width_fraction ?? 0.28,
        format: percent,
        show: (r) => shell(r) && (r.bare.openings?.slots?.count ?? 0) > 0,
      },
    ],
  },
  {
    title: 'רצפה',
    params: [
      {
        kind: 'slider',
        id: 'floor',
        path: 'bare.floor.level',
        label: 'מפלס רצפה',
        why: 'הרצפה רציפה רק כשהיא חוצה את החתך הפנימי בכל ההקפה.',
        min: () => -3,
        max: () => 10,
        step: 0.05,
        value: (r) => r.bare.floor?.level ?? 0,
        format: m(2),
        show: (r) => shell(r) && r.generator.params.path.type !== 'helix',
      },
    ],
  },
]

export function twistFormat(r: Sweep, k: number): string {
  const { order } = twistSteps(r)
  return turnsLabel(Number.isFinite(order) ? k / order : k / 20, order)
}

export type { Sweep }
