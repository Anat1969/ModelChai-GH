/**
 * Display mesh of one wall (GENERATORS.md 1.4). Each arc between two corners is a separate strip with its own
 * vertices at the corners, so normals are smooth inside an arc and the cusp stays sharp.
 */
import type { MeshData } from '../types'
import { nextRow, type SweepSetup } from './setup'

export function displaySurface(s: SweepSetup, grid: Float64Array, inward: boolean, holes: Uint8Array | null): MeshData {
  const { rows, M, arcs, q, nc, frames } = s
  // Smooth sections wrap around the section; sections with corners repeat the closing corner column.
  const cv = nc ? q + 1 : M
  const vIndex = (a: number, i: number, c: number) => (a * rows + i) * cv + (nc ? c : c % M)

  const positions = new Float32Array(3 * arcs * rows * cv)
  for (let a = 0; a < arcs; a++) {
    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < cv; c++) {
        const src = 3 * (i * M + ((a * q + c) % M))
        const dst = 3 * vIndex(a, i, c)
        positions[dst] = grid[src]!
        positions[dst + 1] = grid[src + 1]!
        positions[dst + 2] = grid[src + 2]!
      }
    }
  }

  const idx = new Uint32Array(6 * rows * arcs * q)
  let t = 0
  for (let i = 0; i < rows; i++) {
    const nx = nextRow(s, i)
    if (!nx) continue
    for (let a = 0; a < arcs; a++) {
      const a2 = (a + nx.arcStep) % arcs
      for (let c = 0; c < q; c++) {
        if (holes && holes[(i * arcs + a) * q + c]) continue
        const A = vIndex(a, i, c)
        const D = vIndex(a, i, c + 1)
        const B = vIndex(a2, nx.row, c + nx.colStep)
        const C = vIndex(a2, nx.row, c + 1 + nx.colStep)
        idx[t++] = A
        idx[t++] = B
        idx[t++] = D
        idx[t++] = B
        idx[t++] = C
        idx[t++] = D
      }
    }
  }
  const indices = idx.slice(0, t)

  // Orientation, tested once on a quad in the middle of the first arc: outer walls face away from the
  // section center, inner walls face toward it.
  const cMid = Math.floor(q / 2)
  const A = vIndex(0, 0, cMid), B = vIndex(0, Math.min(1, rows - 1), cMid), D = vIndex(0, 0, cMid + 1)
  const fn = faceNormal(positions, A, B, D)
  const rx = positions[3 * A]! - frames.C[0]!, ry = positions[3 * A + 1]! - frames.C[1]!, rz = positions[3 * A + 2]! - frames.C[2]!
  const facesOut = fn[0] * rx + fn[1] * ry + fn[2] * rz > 0
  if (facesOut === inward) flipWinding(indices)

  return { positions, normals: vertexNormals(positions, indices), indices }
}

export function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = p[3 * b]! - p[3 * a]!, uy = p[3 * b + 1]! - p[3 * a + 1]!, uz = p[3 * b + 2]! - p[3 * a + 2]!
  const vx = p[3 * c]! - p[3 * a]!, vy = p[3 * c + 1]! - p[3 * a + 1]!, vz = p[3 * c + 2]! - p[3 * a + 2]!
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

export function flipWinding(indices: Uint32Array): void {
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]!
    indices[t + 1] = indices[t + 2]!
    indices[t + 2] = tmp
  }
}

/** Area-weighted vertex normals from the oriented faces. */
export function vertexNormals(p: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(p.length)
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t]!, b = 3 * indices[t + 1]!, c = 3 * indices[t + 2]!
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    n[a] = n[a]! + fx
    n[a + 1] = n[a + 1]! + fy
    n[a + 2] = n[a + 2]! + fz
    n[b] = n[b]! + fx
    n[b + 1] = n[b + 1]! + fy
    n[b + 2] = n[b + 2]! + fz
    n[c] = n[c]! + fx
    n[c + 1] = n[c + 1]! + fy
    n[c + 2] = n[c + 2]! + fz
  }
  for (let v = 0; v < n.length; v += 3) {
    const x = n[v]!, y = n[v + 1]!, z = n[v + 2]!
    const L = Math.sqrt(x * x + y * y + z * z)
    if (L === 0) {
      // A vertex no triangle uses (inside an opening, or a row without floor): any unit vector keeps exports valid.
      n[v + 1] = 1
      continue
    }
    n[v] = x / L
    n[v + 1] = y / L
    n[v + 2] = z / L
  }
  return n
}
