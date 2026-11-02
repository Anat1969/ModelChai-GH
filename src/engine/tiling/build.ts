/**
 * The tiling generator (GENERATORS.md 4.2): build(recipe) → meshes, edge curves and metrics, like the sweep and
 * the surface. Every element is a prism: its plan polygon extruded from the base. Pure: no three.js, no DOM.
 */
import type { RuleIssue } from '../../recipe/rules'
import type { Recipe, TilingParams } from '../../recipe/schema'
import type { BuildSuccess } from '../build'
import { DENSITY } from '../materials'
import { signedVolume } from '../math'
import type { Metrics, TilingMetrics } from '../metrics'
import { EDGE_OFFSET } from '../sweep/edges'
import type { MeshData, SolidMesh } from '../types'
import { layout, polyArea, type Element, type TilingLayout } from './patterns'

/** The base every element stands on: `bare.section_center_height` (RECIPE_SCHEMA.md). */
const baseOf = (recipe: Recipe) => recipe.bare.section_center_height

/** Display mesh: flat shading, so every face has its own vertices and its own normal. */
export function prismsDisplay(elements: Element[], y0: number): MeshData {
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const face = (pts: [number, number, number][], n: [number, number, number]) => {
    const b = pos.length / 3
    for (const p of pts) {
      pos.push(...p)
      nor.push(...n)
    }
    for (let k = 1; k < pts.length - 1; k++) idx.push(b, b + k, b + k + 1)
  }
  for (const e of elements) {
    const y1 = y0 + e.height
    const P = e.poly
    face(P.map(([x, z]) => [x, y1, z]), [0, 1, 0])
    face([...P].reverse().map(([x, z]) => [x, y0, z]), [0, -1, 0])
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i]!, [bx, bz] = P[(i + 1) % P.length]!
      const L = Math.hypot(bx - ax, bz - az) || 1
      // Counter-clockwise from above (negative area in x-z): the outward normal of edge a→b is (−dz, dx)/L.
      const n: [number, number, number] = [-(bz - az) / L, 0, (bx - ax) / L]
      face([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n)
    }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: Uint32Array.from(idx) }
}

/** The closed solid for export and the volume check: each prism welded (top ring, bottom ring), so every edge is shared by two triangles. */
export function prismsSolid(elements: Element[], y0: number): SolidMesh {
  const pos: number[] = []
  const idx: number[] = []
  for (const e of elements) {
    const P = e.poly, n = P.length, b = pos.length / 3, y1 = y0 + e.height
    for (const [x, z] of P) pos.push(x, y1, z)
    for (const [x, z] of P) pos.push(x, y0, z)
    for (let k = 1; k < n - 1; k++) idx.push(b, b + k, b + k + 1)
    for (let k = 1; k < n - 1; k++) idx.push(b + n, b + n + k + 1, b + n + k)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      idx.push(b + n + i, b + n + j, b + j, b + n + i, b + j, b + i)
    }
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }
}

export const tilingLayout = (params: TilingParams): TilingLayout => layout(params)

export function buildTilingClosedMesh(recipe: Recipe, params: TilingParams): SolidMesh {
  return prismsSolid(layout(params).elements, baseOf(recipe))
}

function planBounds(elements: Element[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const e of elements)
    for (const [x, z] of e.poly) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
  return { x0, x1, z0, z1 }
}

export function tilingMetrics(recipe: Recipe, params: TilingParams, L: TilingLayout): Metrics {
  const y0 = baseOf(recipe)
  const E = L.elements
  let volume = 0, footprint = 0, envelope = 0, tallest = 0, lowest = Infinity
  for (const e of E) {
    const a = Math.abs(polyArea(e.poly))
    volume += a * e.height
    footprint += a
    let per = 0
    for (let i = 0; i < e.poly.length; i++) {
      const [ax, az] = e.poly[i]!, [bx, bz] = e.poly[(i + 1) % e.poly.length]!
      per += Math.hypot(bx - ax, bz - az)
    }
    envelope += a + per * e.height
    tallest = Math.max(tallest, e.height)
    lowest = Math.min(lowest, e.height)
  }
  const b = planBounds(E)
  const f = L.facts
  const density = DENSITY[recipe.realistic.materials.outer]
  const pattern = params.pattern
  const tiling: TilingMetrics = {
    pattern,
    elements: E.length,
    footprint,
    tallest,
    lowest: Number.isFinite(lowest) ? lowest : 0,
    planWidth: b.x1 - b.x0,
    planDepth: b.z1 - b.z0,
    passage: pattern === 'riemann_walls' || pattern === 'ulam_grid' ? f.gap! : null,
    riemannSum: pattern === 'riemann_walls' ? f.riemannSum! : null,
    integral: pattern === 'riemann_walls' ? f.integral! : null,
    riemannError: pattern === 'riemann_walls' ? (f.riemannSum! - f.integral!) / f.integral! : null,
    numbers: pattern === 'ulam_grid' ? f.N! : null,
    primes: pattern === 'ulam_grid' ? f.primes! : null,
    primeEstimate: pattern === 'ulam_grid' ? f.estimate! : null,
    ratio: pattern === 'fibonacci_blocks' ? f.ratio! : null,
    envelopeRatio: pattern === 'fibonacci_blocks' ? f.envelopeRatio! : null,
    endDistance: pattern === 'random_walk' ? f.endDistance! : null,
    expectedDistance: pattern === 'random_walk' ? f.expected! : null,
    maxVisits: pattern === 'random_walk' ? f.maxVisits! : null,
  }
  return {
    sectionArea: null,
    pathLength: 0,
    solidVolume: volume,
    shellVolume: null,
    volume,
    envelopeArea: envelope,
    density,
    weight: volume * density,
    outerDiameter: null,
    courtyardDiameter: null,
    floorWidth: null,
    clearHeight: null,
    floorContinuous: null,
    floorCoverage: null,
    cuspBurial: Math.max(0, -y0),
    extents: { x: b.x1 - b.x0, z: b.z1 - b.z0, top: y0 + tallest },
    crossingClearance: null,
    edgeCount: E.length,
    edgeLength: E.reduce((n, e) => n + e.poly.reduce((m, p, i) => m + Math.hypot(e.poly[(i + 1) % e.poly.length]![0] - p[0], e.poly[(i + 1) % e.poly.length]![1] - p[1]), 0), 0),
    openingFraction: 0,
    innerScale: null,
    wallAtCorners: null,
    tiling,
  }
}

/** The top outline of each element, pushed out a little so the drawn line sits on the edge, not inside it. */
function topOutlines(elements: Element[], y0: number): Float32Array[] {
  return elements.map((e) => {
    const P = e.poly
    const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length
    const out = new Float32Array(3 * P.length)
    P.forEach(([x, z], k) => {
      const d = Math.hypot(x - cx, z - cz) || 1
      out[3 * k] = x + ((x - cx) / d) * EDGE_OFFSET
      out[3 * k + 1] = y0 + e.height + EDGE_OFFSET
      out[3 * k + 2] = z + ((z - cz) / d) * EDGE_OFFSET
    })
    return out
  })
}

export function buildTiling(recipe: Recipe, params: TilingParams, issues: RuleIssue[]): BuildSuccess {
  const started = performance.now()
  const L = layout(params)
  const y0 = baseOf(recipe)
  const outer = prismsDisplay(L.elements, y0)
  const metrics = tilingMetrics(recipe, params, L)
  // The order the elements were laid down in, at ground level: the tracer walks it.
  const path = Float32Array.from(L.order.flatMap(([x, z]) => [x, y0 + 0.05, z]))
  return {
    ok: true,
    meshes: { outer, inner: null, floor: null, caps: null },
    curves: { edges: topOutlines(L.elements, y0), edgesClosed: true, path },
    metrics,
    issues,
    stats: { ms: performance.now() - started, vertices: outer.positions.length / 3, triangles: outer.indices.length / 3 },
  }
}

/** Volume of the closed mesh by the divergence theorem, m³: the check against Σ area × height. */
export const closedTilingVolume = (m: SolidMesh) => signedVolume(m.positions, m.indices)

/** The model's box on the ground, for cameras and scene sizes: plan center, the largest distance from it, and the top. */
export function tilingBox(recipe: Recipe, params: TilingParams): { center: [number, number, number]; extent: number; top: number; bottom: number } {
  const L = layout(params)
  const y0 = baseOf(recipe)
  const b = planBounds(L.elements)
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2
  let extent = 0, top = y0
  for (const e of L.elements) {
    top = Math.max(top, y0 + e.height)
    for (const [x, z] of e.poly) extent = Math.max(extent, Math.hypot(x - cx, z - cz))
  }
  return { center: [cx, (y0 + top) / 2, cz], extent, top, bottom: y0 }
}
