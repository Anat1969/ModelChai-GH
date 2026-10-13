/**
 * The continuous edge (GENERATORS.md 1.8). Corner j on lap L sits at column (j + L·k) · q, with k = corners ×
 * turns_per_lap. There are gcd(corners, k) edges; each circles the path corners / gcd times.
 */
import { gcd } from '../math'
import type { SweepSetup } from './setup'

export const EDGE_OFFSET = 0.05

export interface EdgeResult {
  /** One polyline per edge, xyz triples, offset 5 cm outward so the surface does not swallow it. */
  curves: Float32Array[]
  closed: boolean
  count: number
  /** Total length of all edges along the surface itself, without the offset. */
  length: number
}

export function computeEdges(s: SweepSetup, outer: Float64Array): EdgeResult {
  const { nc, q, M, rows, frames } = s
  if (nc === 0) return { curves: [], closed: frames.closed, count: 0, length: 0 }

  const k = frames.closed ? Math.round(s.shift / q) : 0
  const count = frames.closed ? gcd(nc, k) : nc
  const laps = frames.closed ? nc / count : 1
  const curves: Float32Array[] = []
  let length = 0
  for (let j = 0; j < count; j++) {
    const n = laps * rows
    const pts = new Float32Array(3 * n)
    let prev: [number, number, number] | null = null
    let first: [number, number, number] | null = null
    for (let L = 0; L < laps; L++) {
      const corner = (((j + L * k) % nc) + nc) % nc
      const col = corner * q
      for (let i = 0; i < rows; i++) {
        const g = 3 * (i * M + col)
        const p: [number, number, number] = [outer[g]!, outer[g + 1]!, outer[g + 2]!]
        const o = 3 * i
        const dx = p[0] - frames.C[o]!, dy = p[1] - frames.C[o + 1]!, dz = p[2] - frames.C[o + 2]!
        const d = Math.hypot(dx, dy, dz) || 1
        const w = 3 * (L * rows + i)
        pts[w] = p[0] + (dx / d) * EDGE_OFFSET
        pts[w + 1] = p[1] + (dy / d) * EDGE_OFFSET
        pts[w + 2] = p[2] + (dz / d) * EDGE_OFFSET
        if (prev) length += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])
        else first = p
        prev = p
      }
    }
    if (frames.closed && prev && first) length += Math.hypot(first[0] - prev[0], first[1] - prev[1], first[2] - prev[2])
    curves.push(pts)
  }
  return { curves, closed: frames.closed, count, length }
}

/** The path centerline, for highlighting. */
export function pathCurve(s: SweepSetup): Float32Array {
  return Float32Array.from(s.frames.C)
}
