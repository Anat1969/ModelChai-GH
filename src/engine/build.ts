/**
 * Generator entry point: build(recipe) → { meshes, curves, metrics, issues } (GENERATORS.md).
 * Pure: no three.js, no React, no DOM. Runs inside the Web Worker.
 */
import { validateRecipe, type RuleIssue } from '../recipe/rules'
import type { Recipe, SchemaError, SweepParams } from '../recipe/schema'
import { computeMetrics, type Metrics } from './metrics'
import { buildSurface } from './surface/build'
import { computeEdges, pathCurve } from './sweep/edges'
import { computeFloor, type FloorResult } from './sweep/floor'
import { computeOpenings } from './sweep/openings'
import { createSetup, innerScale, recipeResolution, surfaceGrid, type Resolution, type SweepSetup } from './sweep/setup'
import { displaySurface, faceNormal, flipWinding, vertexNormals } from './sweep/surface'
import type { MeshData } from './types'

export interface BuildMeshes {
  outer: MeshData
  inner: MeshData | null
  floor: MeshData | null
  /** End caps of an open path; on a parametric surface, the strips that close the shell along its open edges. */
  caps: MeshData | null
}

export interface BuildSuccess {
  ok: true
  meshes: BuildMeshes
  curves: { edges: Float32Array[]; edgesClosed: boolean; path: Float32Array }
  metrics: Metrics
  /** Warnings only; an error stops the build. */
  issues: RuleIssue[]
  stats: { ms: number; vertices: number; triangles: number }
}

export interface BuildFailure {
  ok: false
  stage: 'schema' | 'rules' | 'generator'
  schemaErrors: SchemaError[]
  issues: RuleIssue[]
  message?: string
}

export type BuildResult = BuildSuccess | BuildFailure

/** Validates raw input (schema, then semantic rules) and builds it when nothing blocks. */
export function build(input: unknown, resolution?: Resolution): BuildResult {
  const v = validateRecipe(input)
  if (v.stage === 'schema') return { ok: false, stage: 'schema', schemaErrors: v.schemaErrors, issues: [] }
  if (!v.ok) return { ok: false, stage: 'rules', schemaErrors: [], issues: v.issues }
  const g = v.recipe.generator
  if (g.type === 'parametric_surface') return buildSurface(v.recipe, g.params, v.issues)
  if (g.type !== 'sweep') {
    return { ok: false, stage: 'generator', schemaErrors: [], issues: v.issues, message: `generator "${g.type}" arrives later in Stage 6` }
  }
  return buildSweep(v.recipe, g.params, v.issues, resolution)
}

export function buildSweep(recipe: Recipe, params: SweepParams, issues: RuleIssue[], resolution?: Resolution): BuildSuccess {
  const started = performance.now()
  const s = createSetup(recipe, params, resolution ?? recipeResolution(params))
  const outerGrid = surfaceGrid(s, 1)
  const kIn = innerScale(recipe, params)
  const innerGrid = kIn === null ? null : surfaceGrid(s, kIn)
  const openings = computeOpenings(recipe, s, outerGrid)

  const outer = displaySurface(s, outerGrid, false, openings.holes)
  const inner = innerGrid ? displaySurface(s, innerGrid, true, openings.holes) : null

  const floorSpec = recipe.bare.floor ?? { level: 0, type: 'chord' as const }
  let floor: FloorResult | null = null
  if (kIn !== null && floorSpec.type === 'chord' && s.frames.horizontalFrames) {
    floor = computeFloor(s, kIn, floorSpec.level)
  }
  const edges = computeEdges(s, outerGrid)
  const caps = s.frames.closed ? null : capsMesh(s, outerGrid, innerGrid)
  const metrics = computeMetrics(recipe, params, { closed: s.frames.closed, openings, floor, edges, innerScale: kIn })

  const meshes: BuildMeshes = { outer, inner, floor: floor?.mesh ?? null, caps }
  const all = [outer, inner, meshes.floor, caps].filter((m): m is MeshData => m !== null)
  return {
    ok: true,
    meshes,
    curves: { edges: edges.curves, edgesClosed: edges.closed, path: pathCurve(s) },
    metrics,
    issues,
    stats: {
      ms: performance.now() - started,
      vertices: all.reduce((n, m) => n + m.positions.length / 3, 0),
      triangles: all.reduce((n, m) => n + m.indices.length / 3, 0),
    },
  }
}

/** Flat end caps for an open path: a fan for a solid, an annulus for a shell. */
function capsMesh(s: SweepSetup, outer: Float64Array, inner: Float64Array | null): MeshData {
  const { M, rows, frames } = s
  const pos: number[] = []
  const idx: number[] = []
  for (const [end, sign] of [[0, -1], [rows - 1, 1]] as const) {
    const base = pos.length / 3
    for (let j = 0; j < M; j++) pos.push(...outer.subarray(3 * (end * M + j), 3 * (end * M + j) + 3))
    if (inner) for (let j = 0; j < M; j++) pos.push(...inner.subarray(3 * (end * M + j), 3 * (end * M + j) + 3))
    else pos.push(...frames.C.subarray(3 * end, 3 * end + 3))
    const start = idx.length
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M
      if (inner) idx.push(base + j, base + M + j, base + j2, base + M + j, base + M + j2, base + j2)
      else idx.push(base + M, base + j, base + j2)
    }
    const i0 = end === 0 ? 0 : rows - 2
    const t = [0, 1, 2].map((d) => frames.C[3 * i0 + 3 + d]! - frames.C[3 * i0 + d]!)
    const p = Float64Array.from(pos)
    // Probe the middle of the cap: the first annulus quad or fan triangle can be degenerate at a corner.
    const probe = start + 3 * Math.floor(M / 2) * (inner ? 2 : 1)
    const fn = faceNormal(p, idx[probe]!, idx[probe + 1]!, idx[probe + 2]!)
    if (Math.sign(fn[0] * t[0]! + fn[1] * t[1]! + fn[2] * t[2]!) !== sign) {
      const part = Uint32Array.from(idx.slice(start))
      flipWinding(part)
      idx.splice(start, part.length, ...part)
    }
  }
  const positions = Float32Array.from(pos)
  const indices = Uint32Array.from(idx)
  return { positions, normals: vertexNormals(positions, indices), indices }
}

/** Typed-array buffers of a result, for zero-copy transfer out of the Worker. */
export function transferables(r: BuildResult): ArrayBuffer[] {
  if (!r.ok) return []
  const bufs = new Set<ArrayBuffer>()
  for (const m of Object.values(r.meshes)) {
    if (!m) continue
    bufs.add(m.positions.buffer as ArrayBuffer)
    bufs.add(m.normals.buffer as ArrayBuffer)
    bufs.add(m.indices.buffer as ArrayBuffer)
  }
  for (const c of r.curves.edges) bufs.add(c.buffer as ArrayBuffer)
  bufs.add(r.curves.path.buffer as ArrayBuffer)
  return [...bufs]
}
