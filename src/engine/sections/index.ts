/**
 * Section curves (GENERATORS.md 1.1). section(t, k) returns a 2D point in the section plane for t ∈ [0, 2π).
 * k = 1 is the outer envelope, k < 1 the inner wall. aspect multiplies y after evaluation.
 */
import type { SweepSection } from '../../recipe/schema'
import { TAU } from '../math'

export type Section = Pick<SweepSection, 'curve' | 'a' | 'cusps' | 'sides' | 'exponent' | 'aspect'>

/** Number of cusps of a hypocycloid; the deltoid is the case n = 3, implemented once. */
const cuspsOf = (s: Section) => (s.curve === 'deltoid' ? 3 : (s.cusps ?? 3))

export function sectionPoint(s: Section, t: number, k = 1): [number, number] {
  const A = s.a * k
  let x: number
  let y: number
  switch (s.curve) {
    case 'deltoid':
    case 'hypocycloid': {
      const n = cuspsOf(s)
      x = A * ((n - 1) * Math.cos(t) + Math.cos((n - 1) * t))
      y = A * ((n - 1) * Math.sin(t) - Math.sin((n - 1) * t))
      break
    }
    case 'circle':
      x = A * Math.cos(t)
      y = A * Math.sin(t)
      break
    case 'polygon': {
      // Linear interpolation between vertices at radius A; vertex 0 at angle 0, so t = 2πj/m hits vertex j.
      const m = s.sides ?? 3
      const f = (((t / TAU) * m) % m + m) % m
      const j = Math.floor(f)
      const w = f - j
      const a0 = (TAU * j) / m
      const a1 = (TAU * (j + 1)) / m
      x = A * ((1 - w) * Math.cos(a0) + w * Math.cos(a1))
      y = A * ((1 - w) * Math.sin(a0) + w * Math.sin(a1))
      break
    }
    case 'superellipse': {
      const q = 2 / (s.exponent ?? 2)
      const c = Math.cos(t)
      const sn = Math.sin(t)
      x = A * Math.sign(c) * Math.abs(c) ** q
      y = A * Math.sign(sn) * Math.abs(sn) ** q
      break
    }
  }
  return [x, y * s.aspect]
}

/**
 * Number of sharp corners: cusps of a hypocycloid, vertices of a polygon, and the four axis points of a
 * superellipse with exponent ≤ 1 (a diamond or a star). Corners sit at t = 2πj / count and split the
 * section into arcs that are meshed separately, so the corners stay sharp.
 */
export function cornerCount(s: Section): number {
  switch (s.curve) {
    case 'deltoid':
    case 'hypocycloid':
      return cuspsOf(s)
    case 'polygon':
      return s.sides ?? 3
    case 'superellipse':
      return (s.exponent ?? 2) <= 1 ? 4 : 0
    case 'circle':
      return 0
  }
}

/** Section area at scale k. Closed forms from GENERATORS.md 1.1, numeric (shoelace) for the superellipse. */
export function sectionArea(s: Section, k = 1): number {
  const A = s.a * k
  let area: number
  switch (s.curve) {
    case 'deltoid':
    case 'hypocycloid': {
      const n = cuspsOf(s)
      area = Math.PI * A * A * (n - 1) * (n - 2)
      break
    }
    case 'circle':
      area = Math.PI * A * A
      break
    case 'polygon': {
      const m = s.sides ?? 3
      area = (m / 2) * A * A * Math.sin(TAU / m)
      break
    }
    case 'superellipse': {
      const n = 4096
      let sum = 0
      let [px, py] = sectionPoint({ ...s, aspect: 1 }, 0, k)
      for (let i = 1; i <= n; i++) {
        const [x, y] = sectionPoint({ ...s, aspect: 1 }, (TAU * i) / n, k)
        sum += px * y - x * py
        px = x
        py = y
      }
      area = Math.abs(sum) / 2
      break
    }
  }
  return area * s.aspect
}

/** Samples the section at M points, t_j = 2πj / M. */
export function sampleSection(s: Section, k: number, M: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(M)
  const y = new Float64Array(M)
  for (let j = 0; j < M; j++) {
    const p = sectionPoint(s, (TAU * j) / M, k)
    x[j] = p[0]
    y[j] = p[1]
  }
  return { x, y }
}
