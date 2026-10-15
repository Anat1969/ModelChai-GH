/**
 * The 4-second clip (DECISIONS.md 88): the camera turns 90° around the model while it passes from the bare
 * level to the realistic one. Second one is bare, seconds two and three blend, second four is realistic.
 */
import type { Vec3 } from '../data/projects'

export const CLIP = { fps: 30, seconds: 4, width: 1200, height: 800, turnDeg: 90 } as const
export const FRAMES = CLIP.fps * CLIP.seconds
const LAST = FRAMES - 1

/** Share of the realistic level in frame f: 0 up to one second, 1 from three seconds, smooth between. */
export function mixAt(f: number): number {
  const u = Math.min(1, Math.max(0, (f / CLIP.fps - 1) / 2))
  return u * u * (3 - 2 * u)
}

/** Frames that need the bare level drawn, and those that need the realistic one. */
export const needsBare = (f: number) => mixAt(f) < 1
export const needsRealistic = (f: number) => mixAt(f) > 0

/** The turn in frame f, in radians: a steady turn, as on a turntable. */
export const angleAt = (f: number) => ((CLIP.turnDeg * Math.PI) / 180) * (f / LAST)

/** The start pose turned by an angle around the vertical axis through its target. */
export function orbit(start: { position: Vec3; target: Vec3 }, angle: number): { position: Vec3; target: Vec3 } {
  const [px, py, pz] = start.position
  const [tx, , tz] = start.target
  const dx = px - tx, dz = pz - tz
  const c = Math.cos(angle), s = Math.sin(angle)
  return { position: [tx + dx * c + dz * s, py, tz - dx * s + dz * c], target: start.target }
}

/** Frame f's time in microseconds, as WebCodecs counts it. */
export const timestampAt = (f: number) => Math.round((f * 1e6) / CLIP.fps)
