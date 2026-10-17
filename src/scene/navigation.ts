/**
 * Navigation steps for the model window (DECISIONS.md 110): orbit, tilt, pan, zoom, frame the model and
 * the eased path between two poses. Pure functions of plain vectors, y up, the same spherical angles as
 * three's OrbitControls (azimuth θ around y from +z, polar φ from +y).
 */
import type { Vec3 } from './cameras'

export type Pose = { position: Vec3; target: Vec3 }

/** The limits OrbitControls holds in `CameraRig`; the buttons respect the same ones. */
export const LIMITS = { minDistance: 0.5, maxDistance: 600, minPolar: 0.05, maxPolar: Math.PI * 0.495 }

/** One click: 15° around, 8° up or down, a 1.25 zoom factor, and 15% of the visible height sideways. */
export const STEP = { azimuth: (15 * Math.PI) / 180, polar: (8 * Math.PI) / 180, zoom: 1.25, pan: 0.15 }

export type NavStep =
  | { kind: 'orbit'; azimuth: number; polar: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; right: number; up: number }

type Spherical = { radius: number; theta: number; phi: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 0 ? scale(a, 1 / l) : [0, 0, 1]
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function toSpherical(offset: Vec3): Spherical {
  const radius = len(offset)
  if (radius === 0) return { radius: 0, theta: 0, phi: Math.PI / 2 }
  return { radius, theta: Math.atan2(offset[0], offset[2]), phi: Math.acos(clamp(offset[1] / radius, -1, 1)) }
}

export function fromSpherical({ radius, theta, phi }: Spherical): Vec3 {
  const s = Math.sin(phi) * radius
  return [s * Math.sin(theta), Math.cos(phi) * radius, s * Math.cos(theta)]
}

export const distance = (p: Pose) => len(sub(p.position, p.target))

/** The camera's right and up directions on screen, for a camera that keeps y up. */
export function screenAxes(p: Pose): { right: Vec3; up: Vec3 } {
  const forward = norm(sub(p.target, p.position))
  let right = cross(forward, [0, 1, 0])
  if (len(right) < 1e-9) right = [1, 0, 0]
  right = norm(right)
  return { right, up: cross(right, forward) }
}

/**
 * The pose after one step. Orbit is the camera's own movement: a positive azimuth moves it to its right
 * around the target, a positive polar raises it (looks more from above). Pan moves the camera and the target
 * together, in fractions of the visible height at the target. Zoom divides the distance by the factor.
 */
export function step(p: Pose, s: NavStep, fovDeg: number): Pose {
  const offset = sub(p.position, p.target)
  if (s.kind === 'orbit') {
    const sp = toSpherical(offset)
    // A turn around leaves the height alone; only a tilt is held between straight down and the ground.
    const phi = s.polar ? clamp(sp.phi - s.polar, LIMITS.minPolar, LIMITS.maxPolar) : sp.phi
    const next = { radius: sp.radius, theta: sp.theta + s.azimuth, phi }
    return { position: add(p.target, fromSpherical(next)), target: [...p.target] }
  }
  if (s.kind === 'zoom') {
    const r = clamp(len(offset) / s.factor, LIMITS.minDistance, LIMITS.maxDistance)
    return { position: add(p.target, scale(norm(offset), r)), target: [...p.target] }
  }
  const height = 2 * len(offset) * Math.tan((fovDeg * Math.PI) / 360)
  const { right, up } = screenAxes(p)
  const move = add(scale(right, s.right * height), scale(up, s.up * height))
  return { position: add(p.position, move), target: add(p.target, move) }
}

/** The smallest sphere-like bound of the meshes: the box center, and the farthest vertex from it. */
export function boundingSphere(arrays: (Float32Array | null | undefined)[]): { center: Vec3; radius: number } | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  let any = false
  for (const a of arrays) {
    if (!a) continue
    for (let i = 0; i + 2 < a.length; i += 3) {
      any = true
      for (let k = 0; k < 3; k++) {
        const v = a[i + k]!
        if (v < lo[k]!) lo[k] = v
        if (v > hi[k]!) hi[k] = v
      }
    }
  }
  if (!any) return null
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  let r2 = 0
  for (const a of arrays) {
    if (!a) continue
    for (let i = 0; i + 2 < a.length; i += 3) {
      const dx = a[i]! - center[0], dy = a[i + 1]! - center[1], dz = a[i + 2]! - center[2]
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz)
    }
  }
  return { center, radius: Math.sqrt(r2) }
}

/** The distance at which a sphere of `radius` just fits the narrower of the two fields of view. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const half = (fovDeg * Math.PI) / 360
  const halfH = Math.atan(Math.tan(half) * aspect)
  return radius / Math.sin(Math.min(half, halfH))
}

/** Frame the sphere: the target at its center, the camera along the current view direction, 5% margin. */
export function frame(p: Pose, sphere: { center: Vec3; radius: number }, fovDeg: number, aspect: number): Pose {
  const d = clamp(fitDistance(sphere.radius, fovDeg, aspect) * 1.05, LIMITS.minDistance, LIMITS.maxDistance)
  const dir = norm(sub(p.position, p.target))
  return { position: add(sphere.center, scale(dir, d)), target: [...sphere.center] }
}

/** Ease in and out, so a click reads as a short move and not a jump. */
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/**
 * The pose a fraction `t` of the way from `a` to `b`: the target moves straight, the camera moves around it
 * along an arc (radius, azimuth by the short way, polar), so an orbit step does not cut through the model.
 */
export function between(a: Pose, b: Pose, t: number): Pose {
  const target: Vec3 = [a.target[0] + (b.target[0] - a.target[0]) * t, a.target[1] + (b.target[1] - a.target[1]) * t, a.target[2] + (b.target[2] - a.target[2]) * t]
  const sa = toSpherical(sub(a.position, a.target))
  const sb = toSpherical(sub(b.position, b.target))
  let dTheta = sb.theta - sa.theta
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta))
  const s = { radius: sa.radius + (sb.radius - sa.radius) * t, theta: sa.theta + dTheta * t, phi: sa.phi + (sb.phi - sa.phi) * t }
  return { position: add(target, fromSpherical(s)), target }
}

/** Keyboard on the focused model window: arrows orbit, Shift with arrows pans, + and − zoom, 0 resets. */
export function keyStep(key: string, shift: boolean): NavStep | 'reset' | 'center' | null {
  const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
  const d = dir[key]
  if (d) return shift ? { kind: 'pan', right: d[0] * STEP.pan, up: d[1] * STEP.pan } : { kind: 'orbit', azimuth: d[0] * STEP.azimuth, polar: d[1] * STEP.polar }
  if (key === '+' || key === '=') return { kind: 'zoom', factor: STEP.zoom }
  if (key === '-' || key === '_') return { kind: 'zoom', factor: 1 / STEP.zoom }
  if (key === '0') return 'reset'
  if (key === 'c' || key === 'C') return 'center'
  return null
}
