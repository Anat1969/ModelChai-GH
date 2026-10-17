/**
 * The views a clip is made from (DECISIONS.md 116): an ordered list of camera poses, each with the time to
 * the next one, plus the level plan. Pure: a reducer, the two ready paths, and a small JSON form.
 */
import { bounds, cameraPose } from '../scene/cameras'
import { outerRadius } from '../recipe/rules'
import type { Built, Sweep } from '../ui/params'
import { DEFAULT_LEVELS, quarterOrbit, type LevelMode, type LevelPlan } from './clip'
import type { PathKey, Pose, Vec3 } from './path'

export type ShotLevel = 'bare' | 'realistic'
export interface Shot extends Pose {
  id: string
  /** The level on screen when the view was taken: shown on the list, the clip follows the level plan. */
  level: ShotLevel
  /** Seconds from this view to the next; on the last, a hold at the end. */
  seconds: number
}
export interface ShotPlan {
  shots: Shot[]
  levels: LevelPlan
}

export const EMPTY_PLAN: ShotPlan = { shots: [], levels: DEFAULT_LEVELS }
export const SECONDS = { min: 0, max: 20, step: 0.5, initial: 2 } as const

export type ShotAction =
  | { type: 'add'; shots: Shot[] }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'remove'; id: string }
  | { type: 'seconds'; id: string; seconds: number }
  | { type: 'levels'; levels: Partial<LevelPlan> }
  | { type: 'clear' }
  | { type: 'load'; plan: ShotPlan }

const clampSeconds = (s: number) => Math.min(SECONDS.max, Math.max(SECONDS.min, Math.round((Number.isFinite(s) ? s : 0) / SECONDS.step) * SECONDS.step))

export function shotsReducer(plan: ShotPlan, action: ShotAction): ShotPlan {
  switch (action.type) {
    case 'add':
      return { ...plan, shots: [...plan.shots, ...action.shots.map((s) => ({ ...s, seconds: clampSeconds(s.seconds) }))] }
    case 'move': {
      const i = plan.shots.findIndex((s) => s.id === action.id)
      const j = i + action.by
      if (i < 0 || j < 0 || j >= plan.shots.length) return plan
      const shots = [...plan.shots]
      ;[shots[i], shots[j]] = [shots[j]!, shots[i]!]
      return { ...plan, shots }
    }
    case 'remove':
      return { ...plan, shots: plan.shots.filter((s) => s.id !== action.id) }
    case 'seconds':
      return { ...plan, shots: plan.shots.map((s) => (s.id === action.id ? { ...s, seconds: clampSeconds(action.seconds) } : s)) }
    case 'levels': {
      const lv = { ...plan.levels, ...action.levels }
      lv.from = Math.max(0, lv.from)
      lv.to = Math.max(lv.from, lv.to)
      return { ...plan, levels: lv }
    }
    case 'clear':
      return { ...plan, shots: [] }
    case 'load':
      return action.plan
  }
}

/** The keys the camera passes: the chosen views, or the quarter turn around `fallback` when none is chosen. */
export function planKeys(plan: ShotPlan, fallback: Pose | null): PathKey[] {
  if (plan.shots.length) return plan.shots.map(({ position, target, seconds }) => ({ position, target, seconds }))
  return fallback ? quarterOrbit(fallback) : []
}

export const planSeconds = (keys: PathKey[]) => keys.reduce((a, k) => a + Math.max(0, k.seconds), 0)

// ---------- the entry: from afar at eye level, through the way in, inside ----------

/**
 * "מעבר כניסה": the approach to the model as a visitor walks it. A ring with passages is entered through the
 * first passage, across the inner floor, to the courtyard. A ring without passages is approached to its face,
 * then cuts to the courtyard's edge. A straight gallery is entered at its start and walked to its end. Every
 * view looks ahead, slightly down, at eye height.
 */
export function entryPass(r: Built): Omit<Shot, 'id' | 'level'>[] {
  if (r.generator.type === 'parametric_surface') return surfaceEntry(r)
  return sweepEntry(r as Sweep)
}

/**
 * A parametric surface has no passages: the walk comes from afar to its face, then cuts to where one stands
 * inside or under it, when it has such a place (DECISIONS.md 139).
 */
function surfaceEntry(r: Built): Omit<Shot, 'id' | 'level'>[] {
  const eye = r.realistic.camera.height
  const b = bounds(r)
  const far = Math.max(30, b.extent * 2.5)
  const ang = 0.18
  const out: Vec3 = [Math.cos(ang), 0, Math.sin(ang)]
  const at = (radius: number, y: number): Vec3 => [b.center[0] + out[0] * radius, y, b.center[2] + out[2] * radius]
  const look: Vec3 = [b.center[0], Math.max(2.4, Math.min(b.top * 0.5, eye + 6)), b.center[2]]
  const shots = [
    { position: at(b.extent + far, eye), target: look, seconds: 4 },
    { position: at(b.extent + 1.5, eye), target: look, seconds: 2 },
  ]
  const inside = cameraPose(r, 'inside')
  if (!('unavailable' in inside)) shots.push({ position: inside.position, target: inside.target, seconds: 1 })
  else shots[1]!.seconds = 1
  return shots
}

function sweepEntry(r: Sweep): Omit<Shot, 'id' | 'level'>[] {
  const p = r.generator.params
  const eye = r.realistic.camera.height
  const floor = r.bare.floor?.level ?? 0
  const rOut = outerRadius(p.section)
  const b = bounds(r)
  const far = Math.max(30, b.extent * 2.5)
  const ahead = (from: Vec3, dir: Vec3, y = from[1] - 0.2): Vec3 => [from[0] + dir[0] * 12, y, from[2] + dir[2] * 12]
  const view = (position: Vec3, target: Vec3, seconds: number) => ({ position, target, seconds })

  if (p.path.type === 'line') {
    const L = p.path.length!
    const inside = floor + eye
    const fwd: Vec3 = [0, 0, 1]
    const pts: [Vec3, number][] = [
      [[0, eye, -far], 4],
      [[0, inside, -1.5], 2],
      [[0, inside, L / 2], 2],
      [[0, inside, L + 1.5], 1],
    ]
    return pts.map(([pos, s]) => view(pos, ahead(pos, fwd), s))
  }

  const ring = p.path.type === 'circle' || p.path.type === 'ellipse'
  const passages = r.bare.mode === 'shell' && ring ? r.bare.openings?.passages : undefined
  const door = passages && passages.count > 0 ? passages : null
  const ang = door ? (door.start_angle_deg * Math.PI) / 180 : 0.18
  // The path's point at this angle, and the way in: from outside towards the center.
  const R = p.path.R ?? b.extent
  const R2 = p.path.type === 'ellipse' ? p.path.R2! : R
  const rc = Math.hypot(R * Math.cos(ang), R2 * Math.sin(ang))
  const out: Vec3 = [Math.cos(Math.atan2(R2 * Math.sin(ang), R * Math.cos(ang))), 0, Math.sin(Math.atan2(R2 * Math.sin(ang), R * Math.cos(ang)))]
  const inward: Vec3 = [-out[0], 0, -out[2]]
  const at = (radius: number, y: number): Vec3 => [b.center[0] + out[0] * radius, y, b.center[2] + out[2] * radius]
  const ro = (ring ? rc : R) + rOut
  const ri = ring ? Math.max(0, rc - rOut) : 0
  const across: Vec3 = [b.center[0] - out[0] * Math.max(ri, 4), 2.4, b.center[2] - out[2] * Math.max(ri, 4)]

  const farPos = at(ro + far, eye)
  const facePos = at(ro + 1.5, eye)
  if (door) {
    const doorY = Math.min(floor + eye, floor + door.height - 0.4)
    const corridor = at(rc, doorY)
    const yard = at(Math.max(ri - 3, ri * 0.5), eye)
    return [
      view(farPos, ahead(farPos, inward, eye - 0.2), 4),
      view(at(ro + 1.5, doorY), ahead(at(ro + 1.5, doorY), inward), 2),
      view(corridor, ahead(corridor, inward), 2),
      view(yard, across, 1),
    ]
  }
  if (ring && ri > 2) {
    const edge = at(ri - 1.5, eye)
    const yard = at(ri * 0.4, eye)
    return [
      view(farPos, ahead(farPos, inward, eye - 0.2), 4),
      // Without a passage the camera cannot walk through the wall: it cuts from the face to the courtyard.
      view(facePos, ahead(facePos, inward, eye + 0.6), 0),
      view(edge, across, 2),
      view(yard, across, 1),
    ]
  }
  const center = at(0, eye)
  return [view(farPos, ahead(farPos, inward, eye - 0.2), 4), view(facePos, ahead(facePos, inward), 2), view(center, ahead(center, inward), 1)]
}

// ---------- small JSON, per project ----------

const r2 = (v: number) => Math.round(v * 100) / 100
const vec = (a: unknown): a is Vec3 => Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === 'number' && Number.isFinite(n))

/** The plan as small JSON: positions to the centimeter, short keys. */
export function serializePlan(plan: ShotPlan): string {
  return JSON.stringify({
    v: 1,
    levels: { mode: plan.levels.mode, from: r2(plan.levels.from), to: r2(plan.levels.to) },
    shots: plan.shots.map((s) => ({ id: s.id, p: s.position.map(r2), t: s.target.map(r2), l: s.level === 'bare' ? 'b' : 'r', s: s.seconds })),
  })
}

/** Back from the JSON; null when it is not a plan. Bad shots are dropped, a bad level plan falls back. */
export function parsePlan(json: string | null): ShotPlan | null {
  if (!json) return null
  try {
    const o = JSON.parse(json) as { v?: number; levels?: Partial<LevelPlan>; shots?: { id?: unknown; p?: unknown; t?: unknown; l?: unknown; s?: unknown }[] }
    if (o.v !== 1 || !Array.isArray(o.shots)) return null
    const modes: LevelMode[] = ['blend', 'bare', 'realistic']
    const lv = o.levels
    const levels: LevelPlan =
      lv && modes.includes(lv.mode as LevelMode) && Number.isFinite(lv.from) && Number.isFinite(lv.to)
        ? { mode: lv.mode as LevelMode, from: lv.from!, to: Math.max(lv.from!, lv.to!) }
        : DEFAULT_LEVELS
    const shots: Shot[] = []
    for (const s of o.shots) {
      if (typeof s.id !== 'string' || !vec(s.p) || !vec(s.t) || typeof s.s !== 'number') continue
      shots.push({ id: s.id, position: s.p, target: s.t, level: s.l === 'b' ? 'bare' : 'realistic', seconds: clampSeconds(s.s) })
    }
    return { shots, levels }
  } catch {
    return null
  }
}

export const shotsKey = (projectId: string | null) => `mathcreator-shots:${projectId ?? 'draft'}`
export const thumbsKey = (projectId: string | null) => `mathcreator-shot-thumbs:${projectId ?? 'draft'}`
