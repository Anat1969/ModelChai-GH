/**
 * The tiling patterns (GENERATORS.md 4.2, DECISIONS.md 146): each turns its few dimensions into a list of
 * elements, a plan polygon extruded from a base height. The elements never touch, so each is its own closed
 * solid and the volume is Σ area × height. Pure: no three.js, no React, no DOM.
 * Plan coordinates are (x, z), with y up; the plan is centered on the origin.
 */
import type { TilingParams } from '../../recipe/schema'

export type P2 = [number, number]

export interface Element {
  /** Convex plan polygon in (x, z), counter-clockwise seen from above (negative signed area in x-z). */
  poly: P2[]
  height: number
  /** The number this element stands for: the wall index, the integer on the spiral, the square's size, the visits. */
  tag: number
}

export interface TilingLayout {
  elements: Element[]
  /** The order the elements were laid down in, as plan points (for the drawn path and the tracer). */
  order: P2[]
  /** Pattern-specific numbers for the metrics (see tilingMetrics). */
  facts: Record<string, number>
}

export const polyArea = (p: P2[]): number => {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i]!, [x2, z2] = p[(i + 1) % p.length]!
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

/** Seen from above (y up, x right, z toward the viewer) counter-clockwise means negative area in (x, z). */
const ccw = (p: P2[]): P2[] => (polyArea(p) > 0 ? [...p].reverse() : p)
const rect = (x0: number, x1: number, z0: number, z1: number): P2[] => ccw([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])

/** A small, fixed pseudo-random generator (mulberry32): the same seed always gives the same model. */
export function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const isPrime = (n: number) => {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

// ---------- Riemann walls ----------

/** The curve the walls sample, 0..1 along the row (RECIPE_SCHEMA.md). */
export const profileShape = (profile: string, s: number) => (profile === 'arch' ? Math.sin(Math.PI * s) : profile === 'parabola' ? 1 - (2 * s - 1) ** 2 : s)
/** ∫₀¹ g(s) ds, the exact area under each profile. */
export const PROFILE_INTEGRAL: Record<string, number> = { arch: 2 / Math.PI, parabola: 2 / 3, ramp: 1 / 2 }

function riemann(p: TilingParams): TilingLayout {
  const L = p.length!, n = p.count!, D = p.depth!, t = p.thickness!, base = p.base_height ?? 0, peak = p.peak!
  const dx = L / n
  const f = (xl: number) => base + (peak - base) * profileShape(p.profile!, xl / L)
  const elements: Element[] = []
  const order: P2[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const xl = (i + 0.5) * dx
    const h = f(xl)
    sum += h * dx
    const x = xl - L / 2
    elements.push({ poly: rect(x - t / 2, x + t / 2, -D / 2, D / 2), height: h, tag: i + 1 })
    order.push([x, 0])
  }
  const integral = base * L + (peak - base) * L * PROFILE_INTEGRAL[p.profile!]!
  return { elements, order, facts: { riemannSum: sum, integral, dx, gap: dx - t } }
}

// ---------- Ulam spiral ----------

/** Plan cell of each integer 1..N on the square spiral around 1 (right, up, left, down, the run growing every two turns). */
export function ulamCells(N: number): P2[] {
  const cells: P2[] = []
  let x = 0, z = 0, dx = 1, dz = 0, run = 1, done = 0, turns = 0
  for (let k = 1; k <= N; k++) {
    cells.push([x, z])
    x += dx
    z += dz
    if (++done === run) {
      done = 0
      ;[dx, dz] = [-dz, dx]
      if (++turns % 2 === 0) run++
    }
  }
  return cells
}

function ulam(p: TilingParams): TilingLayout {
  const N = p.side! ** 2, c = p.cell!, s = (p.fill! * c) / 2
  const cells = ulamCells(N)
  const xs = cells.map((q) => q[0]), zs = cells.map((q) => q[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const elements: Element[] = []
  const order: P2[] = []
  let primes = 0
  cells.forEach(([i, j], k) => {
    const n = k + 1
    const prime = isPrime(n)
    if (prime) primes++
    const x = (i - cx) * c, z = (j - cz) * c
    order.push([x, z])
    if (prime !== !!p.invert) elements.push({ poly: rect(x - s, x + s, z - s, z + s), height: p.height!, tag: n })
  })
  return { elements, order, facts: { N, primes, estimate: N / Math.log(N), gap: c - 2 * s } }
}

// ---------- Fibonacci squares ----------

function fibonacci(p: TilingParams): TilingLayout {
  const n = p.count!, u = p.unit!, j = p.joint! / 2
  const F = [1, 1]
  while (F.length < n) F.push(F.at(-1)! + F.at(-2)!)
  // The first square, then each next one attached to the right, top, left and bottom of the rectangle so far.
  let x0 = 0, x1 = 1, z0 = 0, z1 = 1
  const squares: [number, number, number, number, number][] = [[0, 1, 0, 1, 1]]
  for (let k = 1; k < n; k++) {
    const s = F[k]!
    switch (k % 4) {
      case 1: squares.push([x1, x1 + s, z0, z0 + s, s]); x1 += s; break
      case 2: squares.push([x0, x0 + s, z1, z1 + s, s]); z1 += s; break
      case 3: squares.push([x0 - s, x0, z1 - s, z1, s]); x0 -= s; break
      default: squares.push([x0, x0 + s, z0 - s, z0, s]); z0 -= s
    }
  }
  const cx = ((x0 + x1) / 2) * u, cz = ((z0 + z1) / 2) * u
  const elements: Element[] = squares.map(([a, b, c, d, s]) => ({
    poly: rect(a * u - cx + j, b * u - cx - j, c * u - cz + j, d * u - cz - j),
    height: p.height_ratio! * s * u,
    tag: s,
  }))
  const order = squares.map(([a, b, c, d]) => [((a + b) / 2) * u - cx, ((c + d) / 2) * u - cz] as P2)
  const W = (x1 - x0) * u, D = (z1 - z0) * u
  return { elements, order, facts: { ratio: n >= 2 ? F[n - 1]! / F[n - 2]! : 1, envelopeRatio: Math.max(W, D) / Math.min(W, D), largest: F[n - 1]! * u } }
}

// ---------- Voronoi cells ----------

/** Sutherland–Hodgman: keeps the part of a convex polygon where n·p ≤ d. */
function clip(poly: P2[], n: P2, d: number): P2[] {
  const out: P2[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    const fa = n[0] * a[0] + n[1] * a[1] - d, fb = n[0] * b[0] + n[1] * b[1] - d
    if (fa <= 0) out.push(a)
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb)
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
  }
  return out
}

export function voronoiSeeds(p: TilingParams): P2[] {
  const W = p.width!, D = p.depth!
  const rnd = mulberry32(p.seed!)
  return Array.from({ length: p.count! }, () => [(rnd() - 0.5) * W * 0.96, (rnd() - 0.5) * D * 0.96] as P2)
}

function voronoi(p: TilingParams): TilingLayout {
  const W = p.width!, D = p.depth!, half = p.joint! / 2
  const seeds = voronoiSeeds(p)
  const rMax = Math.hypot(W / 2, D / 2)
  const elements: Element[] = []
  let total = 0, vanished = 0, smallest = Infinity
  seeds.forEach((s, i) => {
    let poly: P2[] = rect(-W / 2, W / 2, -D / 2, D / 2)
    for (let k = 0; k < seeds.length && poly.length; k++) {
      if (k === i) continue
      const o = seeds[k]!
      const v: P2 = [o[0] - s[0], o[1] - s[1]]
      const len = Math.hypot(v[0], v[1])
      if (len < 1e-9) continue
      const n: P2 = [v[0] / len, v[1] / len]
      // The bisector, pulled back by half the joint: n·p ≤ n·s + len/2 − joint/2.
      poly = clip(poly, n, n[0] * s[0] + n[1] * s[1] + len / 2 - half)
    }
    const a = poly.length >= 3 ? Math.abs(polyArea(poly)) : 0
    if (a < 0.01) {
      vanished++
      return
    }
    total += a
    smallest = Math.min(smallest, a)
    const h = p.height_min! + (p.height! - p.height_min!) * (1 - Math.hypot(s[0], s[1]) / rMax)
    elements.push({ poly: ccw(poly), height: h, tag: i + 1 })
  })
  return { elements, order: seeds, facts: { area: W * D, cellArea: total, vanished, smallest: Number.isFinite(smallest) ? smallest : 0 } }
}

// ---------- Random walk ----------

/** The block of a visited cell is this share of the cell, so neighbors never touch (RECIPE_SCHEMA.md). */
export const WALK_FILL = 0.92

function walk(p: TilingParams): TilingLayout {
  const c = p.cell!
  const rnd = mulberry32(p.seed!)
  const visits = new Map<string, { i: number; j: number; n: number }>()
  const path: [number, number][] = [[0, 0]]
  let i = 0, j = 0
  const visit = () => {
    const key = `${i},${j}`
    const v = visits.get(key)
    if (v) v.n++
    else visits.set(key, { i, j, n: 1 })
  }
  visit()
  for (let k = 0; k < p.steps!; k++) {
    const r = Math.floor(rnd() * 4)
    if (r === 0) i++
    else if (r === 1) i--
    else if (r === 2) j++
    else j--
    visit()
    path.push([i, j])
  }
  const cells = [...visits.values()]
  const xs = cells.map((v) => v.i), zs = cells.map((v) => v.j)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const s = (WALK_FILL * c) / 2
  const elements: Element[] = cells.map((v) => {
    const x = (v.i - cx) * c, z = (v.j - cz) * c
    return { poly: rect(x - s, x + s, z - s, z + s), height: p.height! * v.n, tag: v.n }
  })
  const end = path.at(-1)!
  return {
    elements,
    order: path.map(([a, b]) => [(a - cx) * c, (b - cz) * c] as P2),
    facts: { cells: cells.length, maxVisits: Math.max(...cells.map((v) => v.n)), endDistance: Math.hypot(end[0], end[1]) * c, expected: Math.sqrt(p.steps!) * c },
  }
}

export function layout(p: TilingParams): TilingLayout {
  switch (p.pattern) {
    case 'riemann_walls': return riemann(p)
    case 'ulam_grid': return ulam(p)
    case 'fibonacci_blocks': return fibonacci(p)
    case 'voronoi_cells': return voronoi(p)
    case 'random_walk': return walk(p)
  }
}

/** The allowed count per pattern (rule 21): a row of walls, a spiral of squares, a field of cells. */
export const COUNT_RANGE: Partial<Record<TilingParams['pattern'], [number, number]>> = {
  riemann_walls: [3, 120],
  fibonacci_blocks: [3, 12],
  voronoi_cells: [3, 200],
}
