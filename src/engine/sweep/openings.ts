/**
 * Openings (GENERATORS.md 1.6): a removed quad, decided once per (row, arc, column) from the outer wall,
 * so the holes in both walls line up. Openings apply to shells only (DECISIONS.md).
 */
import type { Recipe } from '../../recipe/schema'
import { TAU } from '../math'
import { globalCol, nextRow, type SweepSetup } from './setup'

export interface Openings {
  /** One byte per quad, indexed (row · arcs + arc) · q + col. Null when nothing is removed. */
  holes: Uint8Array | null
  /** Removed outer area divided by total outer area. */
  fraction: number
  /** Total outer envelope area, before openings. */
  envelopeArea: number
}

const wrapPi = (d: number) => ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI

function quadArea(g: Float64Array, a: number, b: number, c: number, d: number): number {
  // Quad a-b-c-d split into triangles (a, b, d) and (b, c, d).
  return triArea(g, a, b, d) + triArea(g, b, c, d)
}

function triArea(g: Float64Array, a: number, b: number, c: number): number {
  const ux = g[3 * b]! - g[3 * a]!, uy = g[3 * b + 1]! - g[3 * a + 1]!, uz = g[3 * b + 2]! - g[3 * a + 2]!
  const vx = g[3 * c]! - g[3 * a]!, vy = g[3 * c + 1]! - g[3 * a + 1]!, vz = g[3 * c + 2]! - g[3 * a + 2]!
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
}

export function computeOpenings(recipe: Recipe, s: SweepSetup, outer: Float64Array): Openings {
  const { rows, M, arcs, q, frames } = s
  const bare = recipe.bare
  const slots = bare.mode === 'shell' ? bare.openings?.slots : undefined
  const passages = bare.mode === 'shell' && frames.closed ? bare.openings?.passages : undefined
  const useSlots = !!slots && slots.count > 0
  const usePassages = !!passages && passages.count > 0
  const level = bare.floor?.level ?? 0
  const R = s.params.path.R ?? 0
  const doorAngles = usePassages
    ? Array.from({ length: passages.count }, (_, i) => ((passages.start_angle_deg + (i * 360) / passages.count) * Math.PI) / 180)
    : []

  const holes = useSlots || usePassages ? new Uint8Array(rows * arcs * q) : null
  let total = 0
  let removed = 0
  for (let i = 0; i < rows; i++) {
    const nx = nextRow(s, i)
    if (!nx) continue
    const u0 = frames.u[i]!
    const u1 = nx.row === 0 ? frames.uMax : frames.u[nx.row]!
    const uc = (u0 + u1) / 2
    for (let a = 0; a < arcs; a++) {
      const a2 = (a + nx.arcStep) % arcs
      for (let c = 0; c < q; c++) {
        const A = i * M + globalCol(s, a, c)
        const D = i * M + globalCol(s, a, c + 1)
        const Bv = nx.row * M + ((globalCol(s, a2, c) + nx.colStep) % M)
        const Cv = nx.row * M + ((globalCol(s, a2, c + 1) + nx.colStep) % M)
        const area = quadArea(outer, A, Bv, Cv, D)
        total += area
        if (!holes) continue
        let hole = false
        if (useSlots) {
          const sigma = (c + 0.5) / q
          const inBand =
            slots.position === 'face_center'
              ? Math.abs(sigma - 0.5) < slots.width_fraction / 2
              : Math.abs(sigma - 0.2) < slots.width_fraction / 4 || Math.abs(sigma - 0.8) < slots.width_fraction / 4
          if (inBand) {
            const f = ((((uc * slots.count) / frames.lapLength) % 1) + 1) % 1
            if (f < slots.duty) hole = true
          }
        }
        if (!hole && usePassages) {
          const y = (outer[3 * A + 1]! + outer[3 * Bv + 1]! + outer[3 * Cv + 1]! + outer[3 * D + 1]!) / 4
          if (y > level - 0.8 && y < level + passages.height) {
            for (const da of doorAngles) {
              if (Math.abs(wrapPi(uc - da)) * R < passages.width / 2) {
                hole = true
                break
              }
            }
          }
        }
        if (hole) {
          holes[(i * arcs + a) * q + c] = 1
          removed += area
        }
      }
    }
  }
  return { holes, fraction: total ? removed / total : 0, envelopeArea: total }
}
