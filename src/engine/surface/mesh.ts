/**
 * The shell of a parametric surface by normal offset (GENERATORS.md 4.1): two sheets at ±t/2 along the unit
 * normal of the mid-surface, joined along every open edge of the domain by a strip, so the body is closed.
 * A Klein bottle has no edge: its two sheets join each other across the seam, where the normal flips, and make
 * one closed surface (the boundary of a thickened one-sided surface is two-sided). Pure typed arrays.
 */
import type { SurfaceParams } from '../../recipe/schema'
import type { MeshData, SolidMesh } from '../types'
import { vertexNormals } from '../sweep/surface'
import { family, normalAt, orientation, type Family } from './families'

export interface SurfaceGrid {
  f: Family
  /** Samples along u and v. A wrapped direction has as many samples as segments, an open one one more. */
  nu: number
  nv: number
  /** Mid-surface, sheet +t/2 (outer) and sheet −t/2 (inner), xyz triples, already placed on the ground. */
  mid: Float64Array
  outer: Float64Array
  inner: Float64Array
  /** Unit normals of the mid-surface, pointing to the outer sheet. */
  normal: Float64Array
  /** Y added to every point so the shell's lowest point sits at the recipe's base height. */
  lift: number
  thickness: number
  /** +1 when S_u × S_v points to the outside, −1 when the outside is the other way. */
  sign: 1 | -1
}

export interface Resolution {
  u: number
  v: number
}

export function surfaceResolution(p: SurfaceParams, scale = 1): Resolution {
  const f = family(p)
  return {
    u: Math.round((p.resolution?.u_segments ?? f.segments[0]) * scale),
    v: Math.round((p.resolution?.v_segments ?? f.segments[1]) * scale),
  }
}

export function sampleGrid(p: SurfaceParams, thickness: number, base: number, res: Resolution): SurfaceGrid {
  const f = family(p)
  const sign = orientation(f)
  const nu = f.uClosure === 'open' ? res.u + 1 : res.u
  const nv = f.vClosure === 'open' ? res.v + 1 : res.v
  const n = nu * nv
  const mid = new Float64Array(3 * n), outer = new Float64Array(3 * n), inner = new Float64Array(3 * n), normal = new Float64Array(3 * n)
  const h = thickness / 2
  let low = Infinity
  for (let i = 0; i < nu; i++) {
    const u = f.u[0] + ((f.u[1] - f.u[0]) * i) / res.u
    for (let j = 0; j < nv; j++) {
      const v = f.v[0] + ((f.v[1] - f.v[0]) * j) / res.v
      const P = f.point(u, v)
      const N = normalAt(f, u, v)
      const k = 3 * (i * nv + j)
      for (let d = 0; d < 3; d++) {
        const nd = sign * N[d]!
        mid[k + d] = P[d]!
        normal[k + d] = nd
        outer[k + d] = P[d]! + h * nd
        inner[k + d] = P[d]! - h * nd
      }
      low = Math.min(low, outer[k + 1]!, inner[k + 1]!)
    }
  }
  const lift = base - low
  for (let k = 1; k < 3 * n; k += 3) {
    mid[k] = mid[k]! + lift
    outer[k] = outer[k]! + lift
    inner[k] = inner[k]! + lift
  }
  return { f, nu, nv, mid, outer, inner, normal, lift, thickness, sign }
}

type Part = 'outer' | 'inner' | 'caps'

export interface ShellTopology {
  /** Welded positions: the outer sheet, then the inner sheet. */
  positions: Float64Array
  /** Triangles with the part each belongs to. */
  indices: Uint32Array
  parts: Part[]
}

/**
 * Welded, consistently oriented triangles of the closed shell. Vertex (L, i, j): sheet L (0 outer, 1 inner),
 * row i along u, column j along v. Wrapped rows and columns index back to 0; the Klein seam crosses sheets.
 */
export function shellTopology(g: SurfaceGrid): ShellTopology {
  const { f, nu, nv } = g
  const per = nu * nv
  const positions = new Float64Array(6 * per)
  positions.set(g.outer, 0)
  positions.set(g.inner, 3 * per)
  const uq = f.uClosure === 'open' ? nu - 1 : nu
  const vq = f.vClosure === 'open' ? nv - 1 : nv

  const id = (L: number, i: number, j: number): number => {
    if (i >= nu) {
      if (f.uClosure === 'flip') return id(1 - L, i - nu, (nv - (j % nv)) % nv)
      i -= nu
    }
    if (j >= nv) j -= nv
    return L * per + i * nv + j
  }

  const idx: number[] = []
  const parts: Part[] = []
  const tri = (a: number, b: number, c: number, part: Part) => {
    idx.push(a, b, c)
    parts.push(part)
  }
  // Sheets. (A, B, C) with A = (i, j), B = (i+1, j), C = (i+1, j+1) faces along S_u × S_v. When that is the
  // outside (sign +1) the outer sheet keeps this winding and the inner one runs the other way; otherwise the
  // two swap. On the Klein seam B and C belong to the other sheet.
  const forward = g.sign === 1 ? 0 : 1
  for (const L of [0, 1]) {
    for (let i = 0; i < uq; i++) {
      for (let j = 0; j < vq; j++) {
        const A = id(L, i, j), B = id(L, i + 1, j), C = id(L, i + 1, j + 1), D = id(L, i, j + 1)
        const part: Part = f.uClosure === 'flip' ? 'outer' : L === 0 ? 'outer' : 'inner'
        if (L === forward) {
          tri(A, B, C, part)
          tri(A, C, D, part)
        } else {
          tri(A, C, B, part)
          tri(A, D, C, part)
        }
      }
    }
  }
  // Strips along the open edges, oriented by the sheets: each strip quad runs its outer edge against the
  // direction the outer sheet runs it, so every edge joins exactly two triangles in opposite directions.
  const strip = (o1: number, o2: number) => {
    // The sheet with the forward winding uses the edge o1 → o2; the strip uses o2 → o1, then crosses to the
    // other sheet. With the windings swapped, the strip runs the other way too.
    const i1 = o1 + per, i2 = o2 + per
    if (forward === 0) {
      tri(o2, o1, i1, 'caps')
      tri(o2, i1, i2, 'caps')
    } else {
      tri(o1, o2, i1, 'caps')
      tri(i1, o2, i2, 'caps')
    }
  }
  if (f.vClosure === 'open') {
    for (let i = 0; i < uq; i++) {
      // Column 0: the outer triangle (A, B, C) runs A → B, i.e. (i, 0) → (i+1, 0).
      strip(id(0, i, 0), id(0, i + 1, 0))
      // Last column: the outer triangle (A, C, D) runs C → D, i.e. (i+1, last) → (i, last).
      strip(id(0, i + 1, nv - 1), id(0, i, nv - 1))
    }
  }
  if (f.uClosure === 'open') {
    for (let j = 0; j < vq; j++) {
      // Row 0: (A, C, D) runs D → A, i.e. (0, j+1) → (0, j).
      strip(id(0, 0, j + 1), id(0, 0, j))
      // Last row: (A, B, C) runs B → C, i.e. (last, j) → (last, j+1).
      strip(id(0, nu - 1, j), id(0, nu - 1, j + 1))
    }
  }
  return { positions, indices: Uint32Array.from(idx), parts }
}

/** The closed shell for export, volume checks and the print file. */
export function closedShell(g: SurfaceGrid): SolidMesh {
  const t = shellTopology(g)
  return { positions: t.positions, indices: t.indices }
}

/** One display mesh per part, each with its own vertices, so normals are smooth inside a sheet and the rim is crisp. */
export function displayMeshes(g: SurfaceGrid): { outer: MeshData; inner: MeshData | null; caps: MeshData | null } {
  const t = shellTopology(g)
  const pick = (part: Part): MeshData | null => {
    const map = new Map<number, number>()
    const pos: number[] = []
    const idx: number[] = []
    for (let k = 0; k < t.parts.length; k++) {
      if (t.parts[k] !== part) continue
      for (let e = 0; e < 3; e++) {
        const v = t.indices[3 * k + e]!
        let m = map.get(v)
        if (m === undefined) {
          m = pos.length / 3
          map.set(v, m)
          pos.push(t.positions[3 * v]!, t.positions[3 * v + 1]!, t.positions[3 * v + 2]!)
        }
        idx.push(m)
      }
    }
    if (!idx.length) return null
    const positions = Float32Array.from(pos)
    const indices = Uint32Array.from(idx)
    return { positions, normals: vertexNormals(positions, indices), indices }
  }
  return { outer: pick('outer')!, inner: pick('inner'), caps: pick('caps') }
}

/** Sum of triangle areas of a grid sheet, m². */
export function sheetArea(g: SurfaceGrid, sheet: Float64Array): number {
  const { f, nu, nv } = g
  const uq = f.uClosure === 'open' ? nu - 1 : nu
  const vq = f.vClosure === 'open' ? nv - 1 : nv
  const at = (i: number, j: number): number => {
    let jj = j
    if (i >= nu) {
      i -= nu
      if (f.uClosure === 'flip') jj = (nv - (j % nv)) % nv
    }
    if (jj >= nv) jj -= nv
    return 3 * (i * nv + jj)
  }
  // On the Klein seam the mirrored row of the same sheet is the other side; the mid-surface has no sides, so
  // the area is measured on the mid-surface there. Callers pass g.mid for Klein.
  let A = 0
  const tri = (a: number, b: number, c: number) => {
    const ux = sheet[b]! - sheet[a]!, uy = sheet[b + 1]! - sheet[a + 1]!, uz = sheet[b + 2]! - sheet[a + 2]!
    const vx = sheet[c]! - sheet[a]!, vy = sheet[c + 1]! - sheet[a + 1]!, vz = sheet[c + 2]! - sheet[a + 2]!
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    A += Math.sqrt(x * x + y * y + z * z) / 2
  }
  for (let i = 0; i < uq; i++)
    for (let j = 0; j < vq; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1)
      tri(a, b, c)
      tri(a, c, d)
    }
  return A
}
