/** Cutting a closed mesh at the ground and capping it (DECISIONS.md 113). */
import { describe, expect, it } from 'vitest'
import { cutBelow } from '../src/engine/planeCut'
import { openEdges } from '../src/engine/export/print'
import { signedVolume } from '../src/engine/math'
import type { SolidMesh } from '../src/engine/types'

const volume = (m: SolidMesh) => signedVolume(m.positions, m.indices)

/** Every edge joins exactly two triangles, and runs once each way (consistent orientation). */
function watertight(m: SolidMesh): { open: number; oneWay: number } {
  const nv = m.positions.length / 3
  const dir = new Map<number, number>()
  const I = m.indices
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!
      dir.set(a * nv + b, (dir.get(a * nv + b) ?? 0) + 1)
    }
  let oneWay = 0
  for (const [k, c] of dir) {
    const a = Math.floor(k / nv), b = k % nv
    if (c !== 1 || dir.get(b * nv + a) !== 1) oneWay++
  }
  return { open: openEdges(m), oneWay }
}

const minY = (m: SolidMesh) => {
  let v = Infinity
  for (let i = 1; i < m.positions.length; i += 3) v = Math.min(v, m.positions[i]!)
  return v
}

/** A box from −1 to 1 on each axis, each face split into n × n squares, faces outward. */
function cube(n: number): SolidMesh {
  const pos: number[] = []
  const idx: number[] = []
  const key = new Map<string, number>()
  const vtx = (p: number[]) => {
    const k = p.map((v) => v.toFixed(9)).join(',')
    let i = key.get(k)
    if (i === undefined) (i = pos.length / 3), pos.push(...p), key.set(k, i)
    return i
  }
  for (let axis = 0; axis < 3; axis++)
    for (const s of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const at = (a: number, b: number) => {
            const p = [0, 0, 0]
            p[axis] = s
            p[u] = -1 + (2 * a) / n
            p[v] = -1 + (2 * b) / n
            return vtx(p)
          }
          const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1)
          if (s > 0) idx.push(A, B, C, A, C, D)
          else idx.push(A, C, B, A, D, C)
        }
    }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }
}

/** A torus lying flat (axis Y), its tube centered at height cy; inward faces when `inward`. */
function torus(R: number, r: number, cy: number, nu = 256, nv = 128, inward = false): SolidMesh {
  const pos = new Float64Array(3 * nu * nv)
  const idx: number[] = []
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const u = (2 * Math.PI * i) / nu, v = (2 * Math.PI * j) / nv
      const o = 3 * (i * nv + j)
      pos[o] = (R + r * Math.cos(v)) * Math.cos(u)
      pos[o + 1] = cy + r * Math.sin(v)
      pos[o + 2] = (R + r * Math.cos(v)) * Math.sin(u)
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j, b = ((i + 1) % nu) * nv + j, c = ((i + 1) % nu) * nv + ((j + 1) % nv), d = i * nv + ((j + 1) % nv)
      if (inward) idx.push(a, b, c, a, c, d)
      else idx.push(a, c, b, a, d, c)
    }
  const m = { positions: pos, indices: Uint32Array.from(idx) }
  return m
}
const merge = (a: SolidMesh, b: SolidMesh): SolidMesh => {
  const off = a.positions.length / 3
  const positions = new Float64Array(a.positions.length + b.positions.length)
  positions.set(a.positions)
  positions.set(b.positions, a.positions.length)
  const indices = new Uint32Array(a.indices.length + b.indices.length)
  indices.set(a.indices)
  indices.set(b.indices.map((i) => i + off), a.indices.length)
  return { positions, indices }
}
/** Area of the part of a disc of radius r above a line at height d from its center. */
const segment = (r: number, d: number) => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d)

describe('plane cut', () => {
  it('halves a cube: volume within 0.5%, closed, nothing below the plane', () => {
    const m = cube(1)
    expect(volume(m)).toBeCloseTo(8, 9)
    const c = cutBelow(m, 0)
    expect(Math.abs(volume(c.mesh) - 4) / 4).toBeLessThan(0.005)
    expect(watertight(c.mesh)).toEqual({ open: 0, oneWay: 0 })
    expect(minY(c.mesh)).toBeGreaterThanOrEqual(0)
    expect(c.loops).toBe(1)
    expect(c.holes).toBe(0)
    console.info(`[cut] cube: ${volume(m).toFixed(4)} → ${volume(c.mesh).toFixed(4)}, cap ${c.capTriangles} triangles`)
  })

  it('cuts through a row of vertices by moving the plane a hair, and stays closed', () => {
    const m = cube(4) // vertices at y = −1, −0.5, 0, 0.5, 1
    const c = cutBelow(m, 0)
    expect(Math.abs(c.level)).toBeLessThan(1e-7)
    expect(Math.abs(volume(c.mesh) - 4) / 4).toBeLessThan(0.005)
    expect(watertight(c.mesh)).toEqual({ open: 0, oneWay: 0 })
    expect(minY(c.mesh)).toBeGreaterThanOrEqual(0)
  })

  it('leaves a mesh above the plane as it is, and a cut a third of the way up gives a third', () => {
    const m = cube(3)
    expect(cutBelow(m, -2).cut).toBe(false)
    const c = cutBelow(m, 1 / 3)
    expect(Math.abs(volume(c.mesh) - 4 * (2 / 3)) / (8 / 3)).toBeLessThan(0.005)
    expect(watertight(c.mesh).open).toBe(0)
  })

  it('caps a torus with a ring: one outline, one hole, volume as Pappus gives it', () => {
    const R = 3, r = 1, cy = 0.4
    const m = torus(R, r, cy)
    const c = cutBelow(m, 0)
    expect(c.loops).toBe(2)
    expect(c.holes).toBe(1)
    expect(watertight(c.mesh)).toEqual({ open: 0, oneWay: 0 })
    expect(minY(c.mesh)).toBeGreaterThanOrEqual(0)
    const expected = 2 * Math.PI * R * (Math.PI * r * r - segment(r, cy))
    expect(Math.abs(volume(c.mesh) - expected) / expected).toBeLessThan(0.005)
    console.info(`[cut] torus: ${volume(m).toFixed(3)} → ${volume(c.mesh).toFixed(3)} (Pappus ${expected.toFixed(3)}), cap ${c.capTriangles} triangles`)
  })

  it('caps a torus shell with two rings: four loops, two holes, still closed', () => {
    const R = 3, r = 1, k = 0.7, cy = 0.4
    const shell = merge(torus(R, r, cy), torus(R, r * k, cy, 256, 128, true))
    const c = cutBelow(shell, 0)
    expect(c.loops).toBe(4)
    expect(c.holes).toBe(2)
    expect(watertight(c.mesh)).toEqual({ open: 0, oneWay: 0 })
    expect(minY(c.mesh)).toBeGreaterThanOrEqual(0)
    const outer = Math.PI * r * r - segment(r, cy), inner = Math.PI * (k * r) ** 2 - segment(k * r, cy)
    const expected = 2 * Math.PI * R * (outer - inner)
    expect(Math.abs(volume(c.mesh) - expected) / expected).toBeLessThan(0.005)
    console.info(`[cut] torus shell: ${volume(shell).toFixed(3)} → ${volume(c.mesh).toFixed(3)} (Pappus ${expected.toFixed(3)})`)
  })
})
