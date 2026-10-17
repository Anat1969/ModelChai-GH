/**
 * Paths and their frames (GENERATORS.md 1.2). For each sample u the path gives a point C(u), the section's
 * x axis N(u) and its y axis B(u). Frames satisfy N × B = T, the direction of travel.
 *
 * The four paths of the MVP (circle, ellipse, helix, line) keep their closed-form frames. The four paths of
 * DECISIONS.md 130–134 (lemniscate, torus_knot, wave, arch) are written once as a curve with an analytic
 * derivative; their frames follow from it:
 * - lemniscate, wave: N is the horizontal normal of the plan curve, B = T × N. On the wave B is vertical.
 * - arch: the curve lies in the vertical xy plane; N = (0, 0, −1) across the arch, B is the in-plane normal.
 * - torus_knot: a rotation-minimizing frame with a closure correction, so the twist closes after one lap.
 */
import { CLOSED_PATH_TYPES, type SweepPath } from '../../recipe/schema'
import { TAU, ellipsePerimeter } from '../math'

export interface PathFrames {
  /** Number of sampled rows. Closed paths do not repeat the first row at the end. */
  rows: number
  closed: boolean
  /** Path parameter per row. */
  u: Float64Array
  /** Parameter length of one lap: the twist turns by turns_per_lap over this length. */
  lapLength: number
  /** Total parameter length. */
  uMax: number
  /** True when B is vertical everywhere, so a horizontal floor is meaningful. */
  horizontalFrames: boolean
  C: Float64Array
  N: Float64Array
  B: Float64Array
  /** Torus knot: the angle a rotation-minimizing frame turns by over one lap, removed by the closure correction. */
  holonomy?: number
}

type V3 = [number, number, number]

/** A path written as a curve: its point and its derivative at u, for u in [0, uMax]. */
export interface Curve {
  closed: boolean
  uMax: number
  point(u: number): V3
  deriv(u: number): V3
}

export const isClosedPath = (p: Pick<SweepPath, 'type'>) => CLOSED_PATH_TYPES.includes(p.type)

/**
 * The catenary y = c(cosh(x / c) − 1) through the feet (±span / 2, 0) and the apex (0, height): solves
 * height = c(cosh(span / 2c) − 1) for c by bisection in log space. The left side falls monotonically in c.
 */
export function catenaryC(span: number, height: number): number {
  let lo = Math.log(span * 1e-4), hi = Math.log(span * 1e4)
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2
    const c = Math.exp(mid)
    const h = c * (Math.cosh(span / (2 * c)) - 1)
    if (h > height) lo = mid
    else hi = mid
  }
  return Math.exp((lo + hi) / 2)
}

/** Arc length of the catenary arch between its feet: 2c·sinh(span / 2c). */
export function archLength(span: number, height: number): number {
  const c = catenaryC(span, height)
  return 2 * c * Math.sinh(span / (2 * c))
}

/** The curve of one of the new paths, or null for the MVP paths that keep their closed forms. */
export function curveOf(p: SweepPath, h0: number): Curve | null {
  switch (p.type) {
    case 'lemniscate': {
      // Bernoulli's lemniscate, x = a cos u / (1 + sin²u), z = a sin u cos u / (1 + sin²u). The branch through
      // the crossing at u = π/2 rises by cross_height; the one at u = 3π/2 stays at h0 (DECISIONS.md 131).
      const a = p.R!, ch = p.cross_height!
      return {
        closed: true,
        uMax: TAU,
        point(u) {
          const s = Math.sin(u), c = Math.cos(u), d = 1 + s * s
          return [(a * c) / d, h0 + (ch * (1 + s)) / 2, (a * s * c) / d]
        },
        deriv(u) {
          const s = Math.sin(u), c = Math.cos(u), d = 1 + s * s
          return [(-a * s * (3 - s * s)) / (d * d), (ch * c) / 2, (a * ((c * c - s * s) * d - 2 * s * s * c * c)) / (d * d)]
        },
      }
    }
    case 'torus_knot': {
      // T(p, q) on a torus of radii R and r: p times around the y axis, q times around the tube.
      const R = p.R!, r = p.r!, P = p.p!, Q = p.q!
      return {
        closed: true,
        uMax: TAU,
        point(u) {
          const rho = R + r * Math.cos(Q * u)
          return [rho * Math.cos(P * u), h0 + r * Math.sin(Q * u), rho * Math.sin(P * u)]
        },
        deriv(u) {
          const rho = R + r * Math.cos(Q * u), dRho = -r * Q * Math.sin(Q * u)
          const c = Math.cos(P * u), s = Math.sin(P * u)
          return [dRho * c - rho * P * s, r * Q * Math.cos(Q * u), dRho * s + rho * P * c]
        },
      }
    }
    case 'wave': {
      // x = A sin(2πz / λ) along z ∈ [0, length], like the line path.
      const A = p.amplitude!, k = TAU / p.wavelength!, L = p.length!
      return {
        closed: false,
        uMax: L,
        point: (u) => [A * Math.sin(k * u), h0, u],
        deriv: (u) => [A * k * Math.cos(k * u), 0, 1],
      }
    }
    case 'arch': {
      // The catenary by its arc length σ from the apex: x = c·asinh(σ / c), y = h0 + height + c − √(c² + σ²).
      // u runs from the left foot (σ = −L/2) to the right one; the feet sit at y = h0, x = ±span / 2.
      const c = catenaryC(p.span!, p.height!)
      const L = 2 * c * Math.sinh(p.span! / (2 * c))
      return {
        closed: false,
        uMax: L,
        point(u) {
          const sg = u - L / 2
          return [c * Math.asinh(sg / c), h0 + p.height! + c - Math.hypot(c, sg), 0]
        },
        deriv(u) {
          const sg = u - L / 2, w = Math.hypot(c, sg)
          return [c / w, -sg / w, 0]
        },
      }
    }
    default:
      return null
  }
}

/** ∫|C'(u)| du by composite Simpson's rule; the curves are smooth, so 4096 panels are far below 0.01%. */
export function curveLength(c: Curve, weight: (u: number) => number = () => 1, panels = 4096): number {
  const h = c.uMax / panels
  const f = (u: number) => Math.hypot(...c.deriv(u)) * weight(u)
  let sum = f(0) + f(c.uMax)
  for (let i = 1; i < panels; i++) sum += (i % 2 ? 4 : 2) * f(i * h)
  return (sum * h) / 3
}

export function pathLength(p: SweepPath): number {
  switch (p.type) {
    case 'circle':
      return TAU * p.R!
    case 'ellipse':
      return ellipsePerimeter(p.R!, p.R2!)
    case 'helix':
      return p.turns! * Math.hypot(TAU * p.R!, p.pitch!)
    case 'line':
      return p.length!
    case 'arch':
      return archLength(p.span!, p.height!)
    default:
      return curveLength(curveOf(p, 0)!)
  }
}

/** The most rows a path gets, so a long knot or wave at a high resolution stays light enough to build. */
const MAX_ROWS = 6144

/** Number of path segments for a given number of segments per lap. */
export function pathSegments(p: SweepPath, perLap: number): number {
  switch (p.type) {
    case 'helix':
      return Math.max(8, Math.round(perLap * p.turns!))
    case 'torus_knot':
      // Each lap winds p times around the axis and q times around the tube.
      return Math.min(MAX_ROWS, perLap * Math.max(p.p!, p.q!))
    case 'wave':
      // At least 120 rows per wavelength at the default 360.
      return Math.min(MAX_ROWS, Math.max(perLap, Math.round((perLap * p.length!) / p.wavelength! / 3)))
    case 'lemniscate':
      // Rows on the two crossings (u = π/2, 3π/2) and the two tips: a multiple of four.
      return Math.ceil(perLap / 4) * 4
    default:
      return perLap
  }
}

const set = (arr: Float64Array, i: number, x: number, y: number, z: number) => {
  arr[3 * i] = x
  arr[3 * i + 1] = y
  arr[3 * i + 2] = z
}

export function pathFrames(p: SweepPath, h0: number, perLap: number): PathFrames {
  const curve = curveOf(p, h0)
  if (curve) return curveFrames(p, curve, pathSegments(p, perLap))
  const segs = pathSegments(p, perLap)
  const closed = p.type === 'circle' || p.type === 'ellipse'
  const rows = closed ? segs : segs + 1
  const uMax = p.type === 'helix' ? TAU * p.turns! : p.type === 'line' ? p.length! : TAU
  const lapLength = p.type === 'line' ? p.length! : TAU
  const u = new Float64Array(rows)
  const C = new Float64Array(3 * rows)
  const N = new Float64Array(3 * rows)
  const B = new Float64Array(3 * rows)
  for (let i = 0; i < rows; i++) u[i] = (uMax * i) / segs

  switch (p.type) {
    case 'circle':
      for (let i = 0; i < rows; i++) {
        const c = Math.cos(u[i]!), s = Math.sin(u[i]!)
        set(C, i, p.R! * c, h0, p.R! * s)
        set(N, i, c, 0, s)
        set(B, i, 0, 1, 0)
      }
      break
    case 'ellipse':
      for (let i = 0; i < rows; i++) {
        const c = Math.cos(u[i]!), s = Math.sin(u[i]!)
        set(C, i, p.R! * c, h0, p.R2! * s)
        const nx = p.R2! * c, nz = p.R! * s, L = Math.hypot(nx, nz)
        set(N, i, nx / L, 0, nz / L)
        set(B, i, 0, 1, 0)
      }
      break
    case 'line':
      for (let i = 0; i < rows; i++) {
        set(C, i, 0, h0, u[i]!)
        set(N, i, 1, 0, 0)
        set(B, i, 0, 1, 0)
      }
      break
    case 'helix':
      helixFrames(p.R!, p.pitch!, h0, u, C, N, B)
      break
  }
  return { rows, closed, u, lapLength, uMax, horizontalFrames: p.type !== 'helix', C, N, B }
}

/** Frames of a path written as a curve (the new paths). */
function curveFrames(p: SweepPath, curve: Curve, segs: number): PathFrames {
  const closed = curve.closed
  const rows = closed ? segs : segs + 1
  const uMax = curve.uMax
  const u = new Float64Array(rows)
  const C = new Float64Array(3 * rows)
  const T = new Float64Array(3 * rows)
  const N = new Float64Array(3 * rows)
  const B = new Float64Array(3 * rows)
  let holonomy: number | undefined
  for (let i = 0; i < rows; i++) {
    u[i] = (uMax * i) / segs
    const c = curve.point(u[i]!)
    const d = curve.deriv(u[i]!)
    const L = Math.hypot(d[0], d[1], d[2])
    set(C, i, c[0], c[1], c[2])
    set(T, i, d[0] / L, d[1] / L, d[2] / L)
  }
  if (p.type === 'torus_knot') {
    // The first N points away from the y axis: the knot's own "outside" at u = 0, where it is radial.
    const o = Math.hypot(C[0]!, C[2]!)
    const r: V3 = [C[0]! / o, 0, C[2]! / o]
    const dot = r[0] * T[0]! + r[2] * T[2]!
    const n: V3 = [r[0] - dot * T[0]!, -dot * T[1]!, r[2] - dot * T[2]!]
    const nl = Math.hypot(...n)
    set(N, 0, n[0] / nl, n[1] / nl, n[2] / nl)
    propagateRMF(C, T, N, rows)
    holonomy = closeRMF(C, T, N, u, uMax, rows)
  } else {
    for (let i = 0; i < rows; i++) {
      const o = 3 * i
      if (p.type === 'arch') {
        set(N, i, 0, 0, -1)
      } else {
        // The horizontal normal of the plan curve; with T = (x', y', z') it is (z', 0, −x') normalized.
        const nx = T[o + 2]!, nz = -T[o]!, nl = Math.hypot(nx, nz)
        set(N, i, nx / nl, 0, nz / nl)
      }
    }
  }
  crossInto(T, N, B, rows)
  return { rows, closed, u, lapLength: closed ? TAU : uMax, uMax, horizontalFrames: p.type === 'wave', C, N, B, holonomy }
}

/** B = T × N, so N × B = T. */
function crossInto(T: Float64Array, N: Float64Array, B: Float64Array, rows: number) {
  for (let i = 0; i < rows; i++) {
    const o = 3 * i
    const tx = T[o]!, ty = T[o + 1]!, tz = T[o + 2]!
    const nx = N[o]!, ny = N[o + 1]!, nz = N[o + 2]!
    B[o] = ty * nz - tz * ny
    B[o + 1] = tz * nx - tx * nz
    B[o + 2] = tx * ny - ty * nx
  }
}

/**
 * One step of the double reflection method (Wang, Jüttler, Zheng, Liu 2008): carries the normal n at (C0, T0)
 * to (C1, T1) with no rotation about the tangent.
 */
function reflectStep(c0: V3, t0: V3, n0: V3, c1: V3, t1: V3): V3 {
  const v1x = c1[0] - c0[0], v1y = c1[1] - c0[1], v1z = c1[2] - c0[2]
  const c1n = v1x * v1x + v1y * v1y + v1z * v1z
  const rd = (2 / c1n) * (v1x * n0[0] + v1y * n0[1] + v1z * n0[2])
  const rLx = n0[0] - rd * v1x, rLy = n0[1] - rd * v1y, rLz = n0[2] - rd * v1z
  const td = (2 / c1n) * (v1x * t0[0] + v1y * t0[1] + v1z * t0[2])
  const tLx = t0[0] - td * v1x, tLy = t0[1] - td * v1y, tLz = t0[2] - td * v1z
  const v2x = t1[0] - tLx, v2y = t1[1] - tLy, v2z = t1[2] - tLz
  const c2 = v2x * v2x + v2y * v2y + v2z * v2z
  const r2 = c2 < 1e-30 ? 0 : (2 / c2) * (v2x * rLx + v2y * rLy + v2z * rLz)
  return [rLx - r2 * v2x, rLy - r2 * v2y, rLz - r2 * v2z]
}

const at = (a: Float64Array, i: number): V3 => [a[3 * i]!, a[3 * i + 1]!, a[3 * i + 2]!]

/** Rotation-minimizing normals from N[0] along the rows. */
function propagateRMF(C: Float64Array, T: Float64Array, N: Float64Array, rows: number) {
  for (let i = 0; i + 1 < rows; i++) {
    const n = reflectStep(at(C, i), at(T, i), at(N, i), at(C, i + 1), at(T, i + 1))
    set(N, i + 1, n[0], n[1], n[2])
  }
}

/**
 * A rotation-minimizing frame does not come back to itself on a closed curve: after one lap it is turned by
 * the curve's holonomy angle. α is the angle from the carried-around normal back to the first one; the
 * correction spreads it evenly along the lap, N(u) turned about T(u) by α·u / uMax, so the frame at the end of
 * the lap meets the frame at its start and the twist closes (DECISIONS.md 132). Returns α.
 */
function closeRMF(C: Float64Array, T: Float64Array, N: Float64Array, u: Float64Array, uMax: number, rows: number): number {
  const last = rows - 1
  const nEnd = reflectStep(at(C, last), at(T, last), at(N, last), at(C, 0), at(T, 0))
  const n0 = at(N, 0), t0 = at(T, 0)
  const cx = nEnd[1] * n0[2] - nEnd[2] * n0[1], cy = nEnd[2] * n0[0] - nEnd[0] * n0[2], cz = nEnd[0] * n0[1] - nEnd[1] * n0[0]
  const alpha = Math.atan2(cx * t0[0] + cy * t0[1] + cz * t0[2], nEnd[0] * n0[0] + nEnd[1] * n0[1] + nEnd[2] * n0[2])
  for (let i = 1; i < rows; i++) {
    const beta = (alpha * u[i]!) / uMax
    const t = at(T, i), n = at(N, i)
    // b = T × N; N' = N cos β + b sin β.
    const bx = t[1] * n[2] - t[2] * n[1], by = t[2] * n[0] - t[0] * n[2], bz = t[0] * n[1] - t[1] * n[0]
    const c = Math.cos(beta), s = Math.sin(beta)
    set(N, i, n[0] * c + bx * s, n[1] * c + by * s, n[2] * c + bz * s)
  }
  return alpha
}

/**
 * Rotation-minimizing frame by double reflection (Wang, Jüttler, Zheng, Liu 2008), so the section does not
 * twist on its own along the helix. The first N is radial, matching the circle path at u = 0.
 */
function helixFrames(R: number, pitch: number, h0: number, u: Float64Array, C: Float64Array, N: Float64Array, B: Float64Array) {
  const rows = u.length
  const rise = pitch / TAU
  const T = new Float64Array(3 * rows)
  for (let i = 0; i < rows; i++) {
    const c = Math.cos(u[i]!), s = Math.sin(u[i]!)
    C[3 * i] = R * c
    C[3 * i + 1] = h0 + rise * u[i]!
    C[3 * i + 2] = R * s
    const tx = -R * s, ty = rise, tz = R * c, L = Math.hypot(tx, ty, tz)
    T[3 * i] = tx / L
    T[3 * i + 1] = ty / L
    T[3 * i + 2] = tz / L
  }
  // Radial (1, 0, 0) is already orthogonal to T at u = 0.
  N[0] = 1
  N[1] = 0
  N[2] = 0
  propagateRMF(C, T, N, rows)
  crossInto(T, N, B, rows)
}

/** Lowest and highest centerline point on each axis, from 1024 samples; for framing the camera. */
export function pathBounds(p: SweepPath, h0: number): { min: V3; max: V3 } {
  const f = pathFrames(p, h0, 1024)
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < f.rows; i++)
    for (let k = 0; k < 3; k++) {
      const v = f.C[3 * i + k]!
      if (v < min[k]!) min[k] = v
      if (v > max[k]!) max[k] = v
    }
  return { min, max }
}
