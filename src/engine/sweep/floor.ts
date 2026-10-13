/**
 * Floor (GENERATORS.md 1.7): the plane y = level inside the inner section. For each row the inner section is
 * sampled at 360 points; crossings with y = level are sorted and paired, and the longest pair is the floor.
 * Only meaningful where the section's y axis is vertical (circle, ellipse, line); not on a helix.
 */
import { TAU } from '../math'
import { sectionPoint } from '../sections'
import type { MeshData, Range } from '../types'
import type { SweepSetup } from './setup'
import { nextRow } from './setup'

export const FLOOR_SAMPLES = 360

export interface FloorResult {
  /** Per row: chord ends in the section's x axis, or NaN where there is no floor. */
  x0: Float64Array
  x1: Float64Array
  width: Range | null
  /** Highest point of the inner section minus the floor level. */
  clearHeight: Range
  /** True when every row has a chord. */
  continuous: boolean
  /** Share of rows that have a chord. */
  coverage: number
  mesh: MeshData | null
}

/** The inner section sampled at FLOOR_SAMPLES points, unrotated. */
export function floorSamples(s: SweepSetup, kInner: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(FLOOR_SAMPLES)
  const y = new Float64Array(FLOOR_SAMPLES)
  for (let j = 0; j < FLOOR_SAMPLES; j++) {
    const p = sectionPoint(s.params.section, (TAU * j) / FLOOR_SAMPLES, kInner)
    x[j] = p[0]
    y[j] = p[1]
  }
  return { x, y }
}

export interface RowChord {
  /** Chord ends in the section's x axis, or null where the floor misses the inner section. */
  x0: number
  x1: number
  ok: boolean
  /** Highest inner point minus the floor level. */
  clear: number
}

/** Floor chord and clear height in one row (GENERATORS.md 1.7). */
export function chordAtRow(s: SweepSetup, samples: { x: Float64Array; y: Float64Array }, level: number, i: number, xs: number[] = []): RowChord {
  const c = Math.cos(s.theta[i]!) * s.scale[i]!, sn = Math.sin(s.theta[i]!) * s.scale[i]!
  const yLevel = level - s.frames.C[3 * i + 1]!
  xs.length = 0
  let top = -Infinity
  let px = 0, py = 0
  for (let j = 0; j <= FLOOR_SAMPLES; j++) {
    const jj = j % FLOOR_SAMPLES
    const X = samples.x[jj]! * c - samples.y[jj]! * sn
    const Y = samples.x[jj]! * sn + samples.y[jj]! * c
    if (Y > top) top = Y
    if (j > 0 && (py <= yLevel) !== (Y <= yLevel)) xs.push(px + ((X - px) * (yLevel - py)) / (Y - py))
    px = X
    py = Y
  }
  xs.sort((p, q) => p - q)
  let best = -1, x0 = NaN, x1 = NaN
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1]! - xs[k]!
    if (w > best) {
      best = w
      x0 = xs[k]!
      x1 = xs[k + 1]!
    }
  }
  return best > 0 ? { x0, x1, ok: true, clear: top - yLevel } : { x0: NaN, x1: NaN, ok: false, clear: top - yLevel }
}

export function computeFloor(s: SweepSetup, kInner: number, level: number): FloorResult {
  const { rows } = s
  const samples = floorSamples(s, kInner)
  const x0 = new Float64Array(rows).fill(NaN)
  const x1 = new Float64Array(rows).fill(NaN)
  let wMin = Infinity, wMax = -Infinity, hMin = Infinity, hMax = -Infinity, found = 0
  const xs: number[] = []
  for (let i = 0; i < rows; i++) {
    const r = chordAtRow(s, samples, level, i, xs)
    hMin = Math.min(hMin, r.clear)
    hMax = Math.max(hMax, r.clear)
    if (r.ok) {
      x0[i] = r.x0
      x1[i] = r.x1
      found++
      wMin = Math.min(wMin, r.x1 - r.x0)
      wMax = Math.max(wMax, r.x1 - r.x0)
    }
  }
  return {
    x0,
    x1,
    width: found ? { min: wMin, max: wMax } : null,
    clearHeight: { min: hMin, max: hMax },
    continuous: found === rows,
    coverage: found / rows,
    mesh: found ? floorMesh(s, x0, x1, level) : null,
  }
}

/** A strip between the chords of consecutive rows. Rows without a chord leave a gap. */
function floorMesh(s: SweepSetup, x0: Float64Array, x1: Float64Array, level: number): MeshData {
  const { rows, frames } = s
  const positions = new Float32Array(6 * rows)
  for (let i = 0; i < rows; i++) {
    const o = 3 * i
    const ok = !Number.isNaN(x0[i]!)
    const a = ok ? x0[i]! : 0
    const b = ok ? x1[i]! : 0
    positions[6 * i] = frames.C[o]! + a * frames.N[o]!
    positions[6 * i + 1] = level
    positions[6 * i + 2] = frames.C[o + 2]! + a * frames.N[o + 2]!
    positions[6 * i + 3] = frames.C[o]! + b * frames.N[o]!
    positions[6 * i + 4] = level
    positions[6 * i + 5] = frames.C[o + 2]! + b * frames.N[o + 2]!
  }
  const idx: number[] = []
  for (let i = 0; i < rows; i++) {
    const nx = nextRow(s, i)
    if (!nx || Number.isNaN(x0[i]!) || Number.isNaN(x0[nx.row]!)) continue
    const a = 2 * i, b = a + 1, c = 2 * nx.row, d = c + 1
    // Upward-facing for paths that run counterclockwise seen from above (all MVP paths, N × B = T).
    idx.push(a, c, b, b, c, d)
  }
  const indices = new Uint32Array(idx)
  if (indices.length) {
    const [a, b, c] = [indices[0]!, indices[1]!, indices[2]!]
    const ux = positions[3 * b]! - positions[3 * a]!, uz = positions[3 * b + 2]! - positions[3 * a + 2]!
    const vx = positions[3 * c]! - positions[3 * a]!, vz = positions[3 * c + 2]! - positions[3 * a + 2]!
    if (uz * vx - ux * vz < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1]!
        indices[t + 1] = indices[t + 2]!
        indices[t + 2] = tmp
      }
    }
  }
  const normals = new Float32Array(positions.length)
  for (let v = 1; v < normals.length; v += 3) normals[v] = 1
  return { positions, normals, indices }
}
