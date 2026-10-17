/**
 * Measurements of a path that the semantic rules and the metrics share (DECISIONS.md 130–134): how tightly the
 * path bends, how close its branches pass at a crossing, and how low the surface reaches. Numeric, from the
 * path's own curve; pure, like the rest of the engine.
 */
import type { SweepParams, SweepPath } from '../../recipe/schema'
import { TAU } from '../math'
import { sectionPoint } from '../sections'
import { curveOf, isClosedPath, pathFrames, type PathFrames } from '.'

/** Which section axis a measurement runs along: N (the section's x), B (its y), or any direction. */
export type Axis = 'N' | 'B' | 'any'

/** The new paths, measured here; the MVP paths keep their closed-form rules. */
export const CURVE_PATHS = new Set<SweepPath['type']>(['lemniscate', 'torus_knot', 'wave', 'arch'])

/** The axis along which a path bends: in plan along N, in the arch's plane along B, anywhere on a knot. */
export function bendAxis(p: SweepPath): Axis {
  return p.type === 'arch' ? 'B' : p.type === 'torus_knot' ? 'any' : 'N'
}

/** The axis along which two branches meet at a crossing: vertically on the lemniscate, anywhere on a knot. */
export function crossAxis(p: SweepPath): Axis {
  return p.type === 'lemniscate' ? 'B' : 'any'
}

/**
 * Half the section's extent along a frame axis, scaled to its largest size along the path. A twisted section
 * turns through every direction, so it takes the outer radius; so does any direction.
 */
export function sectionExtent(g: SweepParams, axis: Axis, rOut: number): number {
  const maxScale = isClosedPath(g.path) ? 1 : Math.max(1, g.scale_along_path)
  if (axis === 'any' || g.twist.turns_per_lap !== 0) return rOut * maxScale
  const th = (g.twist.initial_angle_deg * Math.PI) / 180
  const c = Math.cos(th), s = Math.sin(th)
  let ext = 0
  for (let j = 0; j < 720; j++) {
    const [x, y] = sectionPoint(g.section, (TAU * j) / 720)
    ext = Math.max(ext, Math.abs(axis === 'N' ? x * c - y * s : x * s + y * c))
  }
  return ext * maxScale
}

/** Smallest radius of curvature along the path, from the circle through each three consecutive samples. */
export function minCurvatureRadius(f: PathFrames): number {
  const { C, rows, closed } = f
  let best = Infinity
  for (let i = closed ? 0 : 1; i < (closed ? rows : rows - 1); i++) {
    const a = 3 * ((i - 1 + rows) % rows), b = 3 * i, c = 3 * ((i + 1) % rows)
    const ux = C[a]! - C[b]!, uy = C[a + 1]! - C[b + 1]!, uz = C[a + 2]! - C[b + 2]!
    const vx = C[c]! - C[b]!, vy = C[c + 1]! - C[b + 1]!, vz = C[c + 2]! - C[b + 2]!
    const wx = C[c]! - C[a]!, wy = C[c + 1]! - C[a + 1]!, wz = C[c + 2]! - C[a + 2]!
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const cross = Math.hypot(cx, cy, cz)
    if (cross < 1e-15) continue
    const r = (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) * Math.hypot(wx, wy, wz)) / (2 * cross)
    if (r < best) best = r
  }
  return best
}

export interface Crossing {
  /** Distance between the two branches' centerlines where they pass closest, in meters. */
  distance: number
  /** Path parameters of the two closest points. */
  u: [number, number]
  /** Midpoint between them. */
  at: [number, number, number]
}

/**
 * Where a closed path passes closest to itself away from its own neighborhood: the smallest local minimum of
 * the distance between two of its points. Pairs within `exclude` meters of each other along the path are left
 * out, and only minima that are local on every side count, so a straight stretch never reads as a crossing.
 * The sampled minimum is then refined on the curve itself. Null when the path never comes back near itself.
 */
export function closestApproach(p: SweepPath, h0: number, exclude: number, samples = 600): Crossing | null {
  const curve = curveOf(p, h0)
  if (!curve || !curve.closed) return null
  const n = samples
  const P = new Float64Array(3 * n)
  const s = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) P.set(curve.point((curve.uMax * i) / n), 3 * i)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s[i + 1] = s[i]! + Math.hypot(P[3 * j]! - P[3 * i]!, P[3 * j + 1]! - P[3 * i + 1]!, P[3 * j + 2]! - P[3 * i + 2]!)
  }
  const L = s[n]!
  const far = (i: number, j: number) => {
    const d = Math.abs(s[i]! - s[j]!)
    return Math.min(d, L - d) > exclude
  }
  const D = new Float64Array(n * n).fill(Infinity)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j || !far(i, j)) continue
      D[i * n + j] = Math.hypot(P[3 * j]! - P[3 * i]!, P[3 * j + 1]! - P[3 * i + 1]!, P[3 * j + 2]! - P[3 * i + 2]!)
    }
  let best = Infinity, bi = -1, bj = -1
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = D[i * n + j]!
      if (!(d < best)) continue
      let local = true
      for (let di = -1; di <= 1 && local; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue
          const e = D[((i + di + n) % n) * n + ((j + dj + n) % n)]!
          // A neighbor inside the excluded band means the minimum leans on the band: not a crossing.
          if (e === Infinity || e < d) {
            local = false
            break
          }
        }
      if (local) (best = d), (bi = i), (bj = j)
    }
  if (bi < 0) return null
  // Refine on the curve: a pattern search over both parameters with shrinking steps.
  let u1 = (curve.uMax * bi) / n, u2 = (curve.uMax * bj) / n
  const dist = (a: number, b: number) => {
    const x = curve.point(a), y = curve.point(b)
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
  }
  let d = dist(u1, u2)
  for (let step = curve.uMax / n; step > 1e-9; step /= 2) {
    let moved = true
    while (moved) {
      moved = false
      for (const [a, b] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]] as const) {
        const e = dist(u1 + a, u2 + b)
        if (e < d - 1e-12) {
          d = e
          u1 += a
          u2 += b
          moved = true
        }
      }
    }
  }
  const x = curve.point(u1), y = curve.point(u2)
  return { distance: d, u: [u1, u2], at: [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2] }
}

/**
 * The free space between two branches at a crossing: the centerline distance minus the section on both sides,
 * measured along the axis where they meet. Null for a path without a crossing.
 */
export function crossingClearance(g: SweepParams, h0: number, rOut: number): number | null {
  if (g.path.type !== 'lemniscate' && g.path.type !== 'torus_knot') return null
  const ext = sectionExtent(g, crossAxis(g.path), rOut)
  const c = closestApproach(g.path, h0, Math.max(Math.PI * rOut, 1))
  return c ? c.distance - 2 * ext : null
}

/**
 * The lowest point of the outer surface, and of the two end sections of an open path. Sampled at the path's own
 * rows (180 per lap) and 120 section points, with the same twist and scale as the build (GENERATORS.md 1.3).
 */
export function lowestPoints(g: SweepParams, h0: number): { surface: number; ends: number } {
  const f = pathFrames(g.path, h0, 180)
  const sTotal = f.closed ? 1 : g.scale_along_path
  const theta0 = (g.twist.initial_angle_deg * Math.PI) / 180
  const sec = Array.from({ length: 120 }, (_, j) => sectionPoint(g.section, (TAU * j) / 120))
  let surface = Infinity, ends = Infinity
  for (let i = 0; i < f.rows; i++) {
    const u = f.u[i]!
    const th = theta0 + (TAU * g.twist.turns_per_lap * u) / f.lapLength
    const k = sTotal ** (u / f.uMax)
    const c = Math.cos(th) * k, s = Math.sin(th) * k
    const ny = f.N[3 * i + 1]!, by = f.B[3 * i + 1]!
    let low = Infinity
    for (const [x, y] of sec) low = Math.min(low, (x * c - y * s) * ny + (x * s + y * c) * by)
    low += f.C[3 * i + 1]!
    surface = Math.min(surface, low)
    if (!f.closed && (i === 0 || i === f.rows - 1)) ends = Math.min(ends, low)
  }
  return { surface, ends }
}
