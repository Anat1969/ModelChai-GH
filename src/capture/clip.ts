/**
 * The clip (DECISIONS.md 88, 116–118): 30 frames a second at 1200 × 800, along a camera path through chosen
 * views. With no views chosen, the path is today's quarter turn around the current view, four seconds long.
 * The level passes from bare to realistic over a chosen window, or stays on one level.
 */
import type { PathKey, Pose, Vec3 } from './path'

export const CLIP = { fps: 30, width: 1200, height: 800 } as const

/** The default clip: a quarter turn in four seconds, as before (DECISIONS.md 88). */
export const QUARTER = { turnDeg: 90, seconds: 4, keys: 5 } as const

export type LevelMode = 'blend' | 'bare' | 'realistic'
export interface LevelPlan {
  mode: LevelMode
  /** The blend's window, in seconds from the start: bare up to `from`, realistic from `to`. */
  from: number
  to: number
}
export const DEFAULT_LEVELS: LevelPlan = { mode: 'blend', from: 1, to: 3 }

export const LEVEL_MODES: { id: LevelMode; label: string; why: string }[] = [
  { id: 'blend', label: 'ערום ← ריאליסטי', why: 'מתחיל ערום, שמבהיר את הגאומטריה, ועובר בהדרגה לחומרים ולסביבה.' },
  { id: 'bare', label: 'ערום בלבד', why: 'כל הסרטון ברמה הערומה: צורה, קצה ואור אחיד.' },
  { id: 'realistic', label: 'ריאליסטי בלבד', why: 'כל הסרטון ברמה הריאליסטית: חומרים, שמש וסביבה.' },
]

/** Frames in a clip of this many seconds: at least one. */
export const framesFor = (seconds: number) => Math.max(1, Math.round(seconds * CLIP.fps))

/** The camera's time in frame f of N: the first frame is on the first key and the last on the last. */
export const cameraTime = (f: number, frames: number, seconds: number) => (frames > 1 ? (f * seconds) / (frames - 1) : 0)

/** Share of the realistic level at time t (seconds): 0 before the window, 1 after it, smoothstep within. */
export function mixAt(t: number, lv: LevelPlan = DEFAULT_LEVELS): number {
  if (lv.mode === 'bare') return 0
  if (lv.mode === 'realistic') return 1
  const span = lv.to - lv.from
  if (span <= 0) return t >= lv.from ? 1 : 0
  const u = Math.min(1, Math.max(0, (t - lv.from) / span))
  return u * u * (3 - 2 * u)
}

/** The level's mix in frame f: frames are 1/30 s apart. */
export const mixAtFrame = (f: number, lv: LevelPlan = DEFAULT_LEVELS) => mixAt(f / CLIP.fps, lv)
export const needsBare = (f: number, lv: LevelPlan = DEFAULT_LEVELS) => mixAtFrame(f, lv) < 1
export const needsRealistic = (f: number, lv: LevelPlan = DEFAULT_LEVELS) => mixAtFrame(f, lv) > 0

/** The start pose turned by an angle around the vertical axis through its target. */
export function orbit(start: Pose, angle: number): { position: Vec3; target: Vec3 } {
  const [px, py, pz] = start.position
  const [tx, , tz] = start.target
  const dx = px - tx, dz = pz - tz
  const c = Math.cos(angle), s = Math.sin(angle)
  return { position: [tx + dx * c + dz * s, py, tz - dx * s + dz * c], target: [...start.target] }
}

/**
 * The quarter turn as keys: five views 22.5° apart, one second between each. Two keys would make the camera
 * cut across the chord; five keep it on the circle, within a thousandth of the radius.
 */
export function quarterOrbit(start: Pose, seconds: number = QUARTER.seconds): PathKey[] {
  const steps = QUARTER.keys - 1
  return Array.from({ length: QUARTER.keys }, (_, i) => ({
    ...orbit(start, ((QUARTER.turnDeg * Math.PI) / 180) * (i / steps)),
    seconds: i < steps ? seconds / steps : 0,
  }))
}

/** Frame f's time in microseconds, as WebCodecs counts it. */
export const timestampAt = (f: number) => Math.round((f * 1e6) / CLIP.fps)

/** The clip's level parts and their length in seconds, read from the blend over the frames: bare, blend, realistic. */
export function clipPhases(lv: LevelPlan, seconds: number): { id: 'bare' | 'blend' | 'realistic'; label: string; seconds: number }[] {
  const frames = framesFor(seconds)
  const all = [...Array(frames).keys()]
  const first = all.find((f) => mixAtFrame(f, lv) > 0)
  const full = all.find((f) => mixAtFrame(f, lv) >= 1)
  const blendStart = first === undefined ? frames : Math.max(0, first - 1)
  const blendEnd = full === undefined ? frames : full
  const parts = [
    { id: 'bare' as const, label: 'ערום', seconds: blendStart / CLIP.fps },
    { id: 'blend' as const, label: 'מעבר', seconds: (blendEnd - blendStart) / CLIP.fps },
    { id: 'realistic' as const, label: 'ריאליסטי', seconds: (frames - blendEnd) / CLIP.fps },
  ]
  return parts.filter((p) => p.seconds > 0)
}
