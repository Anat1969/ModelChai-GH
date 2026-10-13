/**
 * Paths and their frames (GENERATORS.md 1.2). For each sample u the path gives a point C(u), the section's
 * x axis N(u) and its y axis B(u). Frames satisfy N × B = T, the direction of travel.
 */
import type { SweepPath } from '../../recipe/schema'
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
  }
}

/** Number of path segments for a given number of segments per lap. */
export function pathSegments(p: SweepPath, perLap: number): number {
  return p.type === 'helix' ? Math.max(8, Math.round(perLap * p.turns!)) : perLap
}

export function pathFrames(p: SweepPath, h0: number, perLap: number): PathFrames {
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

  const set = (arr: Float64Array, i: number, x: number, y: number, z: number) => {
    arr[3 * i] = x
    arr[3 * i + 1] = y
    arr[3 * i + 2] = z
  }

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
  for (let i = 0; i + 1 < rows; i++) {
    const o = 3 * i, n = o + 3
    const v1x = C[n]! - C[o]!, v1y = C[n + 1]! - C[o + 1]!, v1z = C[n + 2]! - C[o + 2]!
    const c1 = v1x * v1x + v1y * v1y + v1z * v1z
    const rd = (2 / c1) * (v1x * N[o]! + v1y * N[o + 1]! + v1z * N[o + 2]!)
    const rLx = N[o]! - rd * v1x, rLy = N[o + 1]! - rd * v1y, rLz = N[o + 2]! - rd * v1z
    const td = (2 / c1) * (v1x * T[o]! + v1y * T[o + 1]! + v1z * T[o + 2]!)
    const tLx = T[o]! - td * v1x, tLy = T[o + 1]! - td * v1y, tLz = T[o + 2]! - td * v1z
    const v2x = T[n]! - tLx, v2y = T[n + 1]! - tLy, v2z = T[n + 2]! - tLz
    const c2 = v2x * v2x + v2y * v2y + v2z * v2z
    const r2 = c2 < 1e-30 ? 0 : (2 / c2) * (v2x * rLx + v2y * rLy + v2z * rLz)
    N[n] = rLx - r2 * v2x
    N[n + 1] = rLy - r2 * v2y
    N[n + 2] = rLz - r2 * v2z
  }
  // B = T × N
  for (let i = 0; i < rows; i++) {
    const o = 3 * i
    const tx = T[o]!, ty = T[o + 1]!, tz = T[o + 2]!
    const nx = N[o]!, ny = N[o + 1]!, nz = N[o + 2]!
    B[o] = ty * nz - tz * ny
    B[o + 1] = tz * nx - tx * nz
    B[o + 2] = tx * ny - ty * nx
  }
}
