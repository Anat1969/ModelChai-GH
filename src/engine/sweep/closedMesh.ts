/**
 * Welded mesh for export and volume checks. One vertex per grid point; the last row wraps to the first
 * shifted by round(M · turns_per_lap) mod M (GENERATORS.md 1.4). Open paths get end caps: a fan for a solid,
 * an annulus for a shell. Without openings the result is watertight.
 */
import type { Recipe, SweepParams } from '../../recipe/schema'
import { signedVolume } from '../math'
import type { SolidMesh } from '../types'
import { computeOpenings } from './openings'
import { createSetup, exportResolution, globalCol, innerScale, nextRow, recipeResolution, surfaceGrid, type SweepSetup } from './setup'

export function buildClosedMesh(recipe: Recipe, params: SweepParams, opts: { withOpenings?: boolean } = {}): SolidMesh {
  const s = createSetup(recipe, params, exportResolution(recipeResolution(params)))
  const { rows, M, arcs, q, frames } = s
  const outer = surfaceGrid(s, 1)
  const kIn = innerScale(recipe, params)
  const inner = kIn === null ? null : surfaceGrid(s, kIn)
  const holes = opts.withOpenings === false ? null : computeOpenings(recipe, s, outer).holes

  const grids = inner ? [outer, inner] : [outer]
  const perGrid = rows * M
  const capCenters = !inner && !frames.closed ? 2 : 0
  const positions = new Float64Array(3 * (perGrid * grids.length + capCenters))
  grids.forEach((g, n) => positions.set(g, 3 * perGrid * n))
  if (capCenters) {
    positions.set(frames.C.subarray(0, 3), 3 * perGrid)
    positions.set(frames.C.subarray(3 * (rows - 1), 3 * rows), 3 * perGrid + 3)
  }

  const out: number[] = []
  grids.forEach((_grid, n) => {
    const base = n * perGrid
    const tris: number[] = []
    for (let i = 0; i < rows; i++) {
      const nx = nextRow(s, i)
      if (!nx) continue
      for (let a = 0; a < arcs; a++) {
        const a2 = (a + nx.arcStep) % arcs
        for (let c = 0; c < q; c++) {
          if (holes && holes[(i * arcs + a) * q + c]) continue
          const A = base + i * M + globalCol(s, a, c)
          const D = base + i * M + globalCol(s, a, c + 1)
          const B = base + nx.row * M + ((globalCol(s, a2, c) + nx.colStep) % M)
          const C = base + nx.row * M + ((globalCol(s, a2, c + 1) + nx.colStep) % M)
          tris.push(A, B, D, B, C, D)
        }
      }
    }
    orient(tris, positions, s, base, n === 1)
    for (const v of tris) out.push(v)
  })

  if (!frames.closed) {
    for (const end of [0, rows - 1]) {
      const tris: number[] = []
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        if (inner) {
          const o1 = end * M + j, o2 = end * M + j2
          const i1 = perGrid + o1, i2 = perGrid + o2
          tris.push(o1, i1, o2, i1, i2, o2)
        } else {
          tris.push(perGrid + (end === 0 ? 0 : 1), end * M + j, end * M + j2)
        }
      }
      orientCap(tris, positions, s, end)
      for (const v of tris) out.push(v)
    }
  }
  return { positions, indices: Uint32Array.from(out) }
}

function triNormalDot(tris: number[], p: Float64Array, d: [number, number, number], from: [number, number, number] | null): number {
  const a = tris[0]!, b = tris[1]!, c = tris[2]!
  const ux = p[3 * b]! - p[3 * a]!, uy = p[3 * b + 1]! - p[3 * a + 1]!, uz = p[3 * b + 2]! - p[3 * a + 2]!
  const vx = p[3 * c]! - p[3 * a]!, vy = p[3 * c + 1]! - p[3 * a + 1]!, vz = p[3 * c + 2]! - p[3 * a + 2]!
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const dir = from ? [p[3 * a]! - from[0], p[3 * a + 1]! - from[1], p[3 * a + 2]! - from[2]] : d
  return n[0]! * dir[0]! + n[1]! * dir[1]! + n[2]! * dir[2]!
}

const flip = (tris: number[]) => {
  for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2]!, tris[t + 1]!]
}

/**
 * Outer wall faces away from the section center, inner wall toward it. Tested on a fixed quad (row 0, middle of
 * the first arc) read straight from the grid, so removed openings never change the test.
 */
function orient(tris: number[], p: Float64Array, s: SweepSetup, base: number, inward: boolean) {
  if (!tris.length) return
  const c = Math.floor(s.q / 2)
  const A = base + globalCol(s, 0, c)
  const B = base + s.M * Math.min(1, s.rows - 1) + globalCol(s, 0, c)
  const D = base + globalCol(s, 0, c + 1)
  const C: [number, number, number] = [s.frames.C[0]!, s.frames.C[1]!, s.frames.C[2]!]
  const out = triNormalDot([A, B, D], p, [0, 0, 0], C) > 0
  if (out === inward) flip(tris)
}

/** End caps face backward at the start and forward at the end of the path. */
function orientCap(tris: number[], p: Float64Array, s: SweepSetup, end: number) {
  const C = s.frames.C
  const i0 = end === 0 ? 0 : s.rows - 2
  const t: [number, number, number] = [C[3 * i0 + 3]! - C[3 * i0]!, C[3 * i0 + 4]! - C[3 * i0 + 1]!, C[3 * i0 + 5]! - C[3 * i0 + 2]!]
  const want = end === 0 ? -1 : 1
  if (Math.sign(triNormalDot(tris, p, t, null)) !== want) flip(tris)
}

export function closedMeshVolume(m: SolidMesh): number {
  return signedVolume(m.positions, m.indices)
}
