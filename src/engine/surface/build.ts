/**
 * The parametric surface generator (GENERATORS.md 4.1): build(recipe) → meshes, edge curves and metrics,
 * like the sweep. Pure: no three.js, no React, no DOM.
 */
import type { RuleIssue } from '../../recipe/rules'
import type { Recipe, SurfaceParams } from '../../recipe/schema'
import type { BuildSuccess } from '../build'
import { DENSITY } from '../materials'
import { signedVolume } from '../math'
import type { Metrics } from '../metrics'
import { EDGE_OFFSET } from '../sweep/edges'
import type { SolidMesh } from '../types'
import { clearance, family, integrateArea, minCurvatureRadius, normalAt, simpson } from './families'
import { closedShell, displayMeshes, sampleGrid, sheetArea, surfaceResolution, type SurfaceGrid } from './mesh'

/** The thickness a surface is built with. A surface is always a shell (rule 10); the schema floor is the fallback. */
export const surfaceThickness = (recipe: Recipe): number => recipe.bare.shell?.thickness ?? 0.08

export function surfaceGridOf(recipe: Recipe, params: SurfaceParams, scale = 1): SurfaceGrid {
  return sampleGrid(params, surfaceThickness(recipe), recipe.bare.section_center_height, surfaceResolution(params, scale))
}

/** The closed shell at export resolution (twice the display segments in each direction). */
export function buildSurfaceClosedMesh(recipe: Recipe, params: SurfaceParams, scale = 2): SolidMesh {
  return closedShell(surfaceGridOf(recipe, params, scale))
}

interface Loop {
  points: [number, number, number][]
  /** One step inward from each point, to push the drawn edge outward off the rim. */
  inward: [number, number, number][]
}

/** The open edges of the mid-surface as closed loops (GENERATORS.md 4.1): two rings on a tower, one loop on a saddle or a ramp. */
export function boundaryLoops(g: SurfaceGrid): Loop[] {
  const { f, nu, nv, mid } = g
  const P = (i: number, j: number): [number, number, number] => [mid[3 * (i * nv + j)]!, mid[3 * (i * nv + j) + 1]!, mid[3 * (i * nv + j) + 2]!]
  if (f.vClosure === 'wrap' && f.uClosure !== 'open') return []
  if (f.uClosure === 'wrap') {
    return [0, nv - 1].map((j) => {
      const jIn = j === 0 ? 1 : nv - 2
      const points: [number, number, number][] = []
      const inward: [number, number, number][] = []
      for (let i = 0; i < nu; i++) {
        points.push(P(i, j))
        inward.push(P(i, jIn))
      }
      return { points, inward }
    })
  }
  // Both directions open: walk the rectangle of the domain once.
  const points: [number, number, number][] = []
  const inward: [number, number, number][] = []
  const add = (i: number, j: number, ii: number, jj: number) => {
    points.push(P(i, j))
    inward.push(P(ii, jj))
  }
  const ci = (i: number) => Math.min(nu - 2, Math.max(1, i))
  const cj = (j: number) => Math.min(nv - 2, Math.max(1, j))
  for (let j = 0; j < nv - 1; j++) add(0, j, 1, cj(j))
  for (let i = 0; i < nu - 1; i++) add(i, nv - 1, ci(i), nv - 2)
  for (let j = nv - 1; j > 0; j--) add(nu - 1, j, nu - 2, cj(j))
  for (let i = nu - 1; i > 0; i--) add(i, 0, ci(i), 1)
  return [{ points, inward }]
}

function loopLength(points: [number, number, number][]): number {
  let L = 0
  for (let k = 0; k < points.length; k++) {
    const a = points[k]!, b = points[(k + 1) % points.length]!
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return L
}

function bounds(a: Float64Array, b: Float64Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of [a, b])
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k]! < min[k]!) min[k] = p[i + k]!
        if (p[i + k]! > max[k]!) max[k] = p[i + k]!
      }
  return { min, max }
}

export function surfaceMetrics(recipe: Recipe, params: SurfaceParams, g: SurfaceGrid, loops: Loop[]): Metrics {
  const f = g.f
  const t = g.thickness
  const midArea = integrateArea(f)
  // Offset by ±t/2: the volume is t·A plus (t³/12)·∫K dA, under 0.1% for any thickness the schema allows.
  const volume = t * midArea
  const density = DENSITY[recipe.realistic.materials.outer]
  const b = bounds(g.outer, g.inner)
  let rMax = 0
  for (const p of [g.outer, g.inner]) for (let i = 0; i < p.length; i += 3) rMax = Math.max(rMax, Math.hypot(p[i]!, p[i + 2]!))
  const waist = params.family === 'hyperboloid' || params.family === 'catenoid' ? 2 * (params.waist_radius! - t / 2) : null
  const edgeLength = loops.reduce((n, l) => n + loopLength(l.points), 0)
  const sink = Math.max(0, -b.min[1]!)
  return {
    sectionArea: null,
    pathLength: null,
    solidVolume: volume,
    shellVolume: volume,
    volume,
    envelopeArea: f.outward === 'none' ? sheetArea(g, g.mid) : sheetArea(g, g.outer),
    density,
    weight: volume * density,
    outerDiameter: f.revolution ? 2 * rMax : null,
    courtyardDiameter: null,
    floorWidth: null,
    clearHeight: clearance(params, t, recipe.bare.section_center_height),
    floorContinuous: null,
    floorCoverage: null,
    cuspBurial: sink,
    edgeCount: loops.length,
    edgeLength,
    openingFraction: 0,
    innerScale: null,
    wallAtCorners: null,
    surface: {
      family: params.family,
      midArea,
      thickness: t,
      height: b.max[1]!,
      planWidth: b.max[0]! - b.min[0]!,
      planDepth: b.max[2]! - b.min[2]!,
      waistDiameter: waist,
      minCurvatureRadius: minCurvatureRadius(f),
      sinkDepth: sink,
      heldVolume: heldVolume(params, g),
      selfIntersecting: params.family === 'klein_bottle',
    },
  }
}

export function buildSurface(recipe: Recipe, params: SurfaceParams, issues: RuleIssue[], scale = 1): BuildSuccess {
  const started = performance.now()
  const g = surfaceGridOf(recipe, params, scale)
  const meshes = displayMeshes(g)
  const loops = boundaryLoops(g)
  const edges = loops.map(({ points, inward }) => {
    const out = new Float32Array(3 * points.length)
    points.forEach((p, k) => {
      const q = inward[k]!
      const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
      const L = Math.hypot(d[0]!, d[1]!, d[2]!) || 1
      for (let e = 0; e < 3; e++) out[3 * k + e] = p[e]! + (d[e]! / L) * EDGE_OFFSET
    })
    return out
  })
  // The tracer counts laps against this curve: the first edge itself, so one trip around is one lap.
  const path = loops[0] ? Float32Array.from(loops[0].points.flat()) : midRow(g)
  const metrics = surfaceMetrics(recipe, params, g, loops)
  const all = [meshes.outer, meshes.inner, meshes.caps].filter((m) => m !== null)
  return {
    ok: true,
    meshes: { outer: meshes.outer, inner: meshes.inner, floor: null, caps: meshes.caps },
    curves: { edges, edgesClosed: true, path },
    metrics,
    issues,
    stats: {
      ms: performance.now() - started,
      vertices: all.reduce((n, m) => n + m.positions.length / 3, 0),
      triangles: all.reduce((n, m) => n + m.indices.length / 3, 0),
    },
  }
}

/** The space a tower holds inside its inner face, or a saddle holds under its underside (SurfaceMetrics.heldVolume). */
function heldVolume(params: SurfaceParams, g: SurfaceGrid): number | null {
  const f = g.f, h = g.thickness / 2
  switch (params.family) {
    case 'hyperboloid':
    case 'catenoid': {
      // π ∫ (r − t/2)² dy along the axis, from the mid-surface radius.
      const r = (y: number) => Math.hypot(f.point(0, y)[0], f.point(0, y)[2]) - h
      return Math.PI * simpson((y) => r(y) ** 2, f.v[0], f.v[1], 400)
    }
    case 'hyperbolic_paraboloid':
    case 'monkey_saddle': {
      // ∫∫ underside height over the plan, where it is above the ground.
      const n = 120
      const du = (f.u[1] - f.u[0]) / n, dv = (f.v[1] - f.v[0]) / n
      let V = 0
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const u = f.u[0] + (i + 0.5) * du, v = f.v[0] + (j + 0.5) * dv
          V += Math.max(0, f.point(u, v)[1] + g.lift - h / Math.abs(normalAt(f, u, v)[1]))
        }
      return V * du * dv
    }
    default:
      return null
  }
}

function midRow(g: SurfaceGrid): Float32Array {
  const j = Math.floor(g.nv / 2)
  const out = new Float32Array(3 * g.nu)
  for (let i = 0; i < g.nu; i++) for (let e = 0; e < 3; e++) out[3 * i + e] = g.mid[3 * (i * g.nv + j) + e]!
  return out
}

/** Volume of the closed shell by the divergence theorem, m³: the check against t·A. */
export function closedShellVolume(m: SolidMesh): number {
  return signedVolume(m.positions, m.indices)
}

/**
 * The shell's box on a coarse grid, placed on the ground, for cameras and scene sizes: plan center, the largest
 * horizontal distance from it, and the top. Cheap enough for the main thread.
 */
export function surfaceBox(recipe: Recipe, params: SurfaceParams): { center: [number, number, number]; extent: number; top: number; bottom: number } {
  const g = sampleGrid(params, surfaceThickness(recipe), recipe.bare.section_center_height, { u: 48, v: 24 })
  const b = bounds(g.outer, g.inner)
  const cx = (b.min[0]! + b.max[0]!) / 2, cz = (b.min[2]! + b.max[2]!) / 2
  let extent = 0
  for (const p of [g.outer, g.inner]) for (let i = 0; i < p.length; i += 3) extent = Math.max(extent, Math.hypot(p[i]! - cx, p[i + 2]! - cz))
  return { center: [cx, (b.min[1]! + b.max[1]!) / 2, cz], extent, top: b.max[1]!, bottom: b.min[1]! }
}

export { family }
