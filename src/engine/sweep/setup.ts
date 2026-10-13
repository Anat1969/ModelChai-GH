/**
 * The sampled sweep (GENERATORS.md 1.3): every surface point is
 *   (x, y) = section(t, k);  (X, Y) = rotate((x, y), θ(u)) · s(u);  P = C(u) + X·N(u) + Y·B(u)
 * The grid has one row per path sample and M columns around the section.
 */
import type { Recipe, SweepParams } from '../../recipe/schema'
import { symmetryOrder } from '../../recipe/rules'
import { TAU, lcm } from '../math'
import { pathFrames, type PathFrames } from '../paths'
import { cornerCount, sampleSection } from '../sections'

export interface SweepSetup {
  params: SweepParams
  frames: PathFrames
  rows: number
  /** Columns around the whole section; a multiple of the corner count and of the symmetry order. */
  M: number
  /** Number of sharp corners; 0 for smooth sections. */
  nc: number
  /** Arcs meshed separately: nc, or 1 for a smooth section. */
  arcs: number
  /** Quads per arc across the section. */
  q: number
  /** Column shift where the last row wraps to the first, in a closed path. */
  shift: number
  theta: Float64Array
  scale: Float64Array
}

export interface Resolution {
  pathSegments: number
  sectionSegments: number
}

export const DISPLAY_RESOLUTION: Resolution = { pathSegments: 360, sectionSegments: 144 }

/** Export doubles the path samples and keeps the section samples, as in docs/reference/umbilic_torus.py (720 × 144). */
export function exportResolution(r: Resolution): Resolution {
  return { pathSegments: r.pathSegments * 2, sectionSegments: r.sectionSegments }
}

export function recipeResolution(params: SweepParams): Resolution {
  return {
    pathSegments: params.resolution?.path_segments ?? DISPLAY_RESOLUTION.pathSegments,
    sectionSegments: params.resolution?.section_segments ?? DISPLAY_RESOLUTION.sectionSegments,
  }
}

export function createSetup(recipe: Recipe, params: SweepParams, res: Resolution): SweepSetup {
  const { section, path, twist } = params
  const frames = pathFrames(path, recipe.bare.section_center_height, res.pathSegments)
  const nc = cornerCount(section)
  const order = symmetryOrder(section)
  const L = lcm(Math.max(1, nc), Number.isFinite(order) ? order : 1)
  const M = Math.max(L, Math.ceil(res.sectionSegments / L) * L)
  const arcs = Math.max(1, nc)
  const q = M / arcs
  const shift = frames.closed ? ((Math.round(M * twist.turns_per_lap) % M) + M) % M : 0

  const rows = frames.rows
  const theta = new Float64Array(rows)
  const scale = new Float64Array(rows)
  const theta0 = (twist.initial_angle_deg * Math.PI) / 180
  // A closed path must meet itself, so geometric scaling applies only to open paths (DECISIONS.md).
  const sTotal = frames.closed ? 1 : params.scale_along_path
  for (let i = 0; i < rows; i++) {
    const u = frames.u[i]!
    theta[i] = theta0 + (TAU * twist.turns_per_lap * u) / frames.lapLength
    scale[i] = sTotal ** (u / frames.uMax)
  }
  return { params, frames, rows, M, nc, arcs, q, shift, theta, scale }
}

/** Surface positions for scale factor k: 3 × rows × M, row-major. */
export function surfaceGrid(s: SweepSetup, k: number): Float64Array {
  const { rows, M, frames, theta, scale } = s
  const sec = sampleSection(s.params.section, k, M)
  const out = new Float64Array(3 * rows * M)
  for (let i = 0; i < rows; i++) {
    const c = Math.cos(theta[i]!) * scale[i]!, sn = Math.sin(theta[i]!) * scale[i]!
    const o = 3 * i
    const Cx = frames.C[o]!, Cy = frames.C[o + 1]!, Cz = frames.C[o + 2]!
    const Nx = frames.N[o]!, Ny = frames.N[o + 1]!, Nz = frames.N[o + 2]!
    const Bx = frames.B[o]!, By = frames.B[o + 1]!, Bz = frames.B[o + 2]!
    let p = 3 * i * M
    for (let j = 0; j < M; j++) {
      const x = sec.x[j]!, y = sec.y[j]!
      const X = x * c - y * sn
      const Y = x * sn + y * c
      out[p++] = Cx + X * Nx + Y * Bx
      out[p++] = Cy + X * Ny + Y * By
      out[p++] = Cz + X * Nz + Y * Bz
    }
  }
  return out
}

/** Inner wall scale: the same section with k = (a − t) / a (GENERATORS.md 1.5). */
export function innerScale(recipe: Recipe, params: SweepParams): number | null {
  const shell = recipe.bare.mode === 'shell' ? recipe.bare.shell : undefined
  if (!shell) return null
  return (params.section.a - shell.thickness) / params.section.a
}

/** Global column of arc a, local column c (c may equal q at the arc's closing cusp). */
export const globalCol = (s: SweepSetup, a: number, c: number) => (a * s.q + c) % s.M

/**
 * The row after i and the arc it continues into. In a closed path the last row wraps to row 0, where arc a
 * continues as arc (a + shift / q) mod arcs (GENERATORS.md 1.4). Smooth sections use a column offset instead.
 */
export function nextRow(s: SweepSetup, i: number): { row: number; arcStep: number; colStep: number } | null {
  if (i + 1 < s.rows) return { row: i + 1, arcStep: 0, colStep: 0 }
  if (!s.frames.closed) return null
  if (s.nc === 0) return { row: 0, arcStep: 0, colStep: s.shift }
  return { row: 0, arcStep: Math.round(s.shift / s.q) % s.arcs, colStep: 0 }
}
