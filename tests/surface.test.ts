/**
 * The parametric surface generator (GENERATORS.md 4.1, DECISIONS.md 135–142): every family builds a closed,
 * outward-facing shell; its area and volume match closed forms or independent integrals within 0.5%; its edges
 * match their analytic lengths; it stands on the ground; and the surface rules 15–19 fire where they should.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { build } from '../src/engine/build'
import { exportFile, printFiles } from '../src/engine/export'
import { openEdges, PRINT_DEFAULTS } from '../src/engine/export/print'
import { TAU } from '../src/engine/math'
import { buildSurface, buildSurfaceClosedMesh, closedShellVolume } from '../src/engine/surface/build'
import { family, integrateArea, minCurvatureRadius } from '../src/engine/surface/families'
import { checkRules, validateRecipe } from '../src/recipe/rules'
import { parseRecipe, type Recipe, type SurfaceParams } from '../src/recipe/schema'
import { fixture, jsonSchemaValid } from './helpers'

const T = 0.3
const relErr = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

/** A surface recipe on the umbilic fixture's realistic level. */
function surfaceRecipe(params: Record<string, unknown>, bare: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = fixture('umbilic-torus')
  raw.meta.id = `surface-${params.family as string}`.replaceAll('_', '-')
  raw.generator = { type: 'parametric_surface', params }
  raw.bare = { mode: 'shell', section_center_height: 0, shell: { thickness: T, inner_method: 'normal_offset' }, ...bare }
  return raw
}
const parsed = (raw: unknown): Recipe & { generator: { type: 'parametric_surface'; params: SurfaceParams } } => {
  const p = parseRecipe(raw)
  if (!p.ok) throw new Error(JSON.stringify(p.errors))
  if (p.recipe.generator.type !== 'parametric_surface') throw new Error('not a surface')
  return p.recipe as never
}

const FAMILIES: [string, Record<string, unknown>][] = [
  ['hyperboloid', { family: 'hyperboloid', waist_radius: 4, end_radius: 7, height: 24 }],
  ['catenoid', { family: 'catenoid', waist_radius: 6, height: 9 }],
  ['hyperbolic_paraboloid', { family: 'hyperbolic_paraboloid', span: 20, span2: 14, rise: 8 }],
  ['helicoid', { family: 'helicoid', radius: 6, pitch: 3.6, turns: 2 }],
  ['klein_bottle', { family: 'klein_bottle', radius: 8, tube: 3 }],
  ['monkey_saddle', { family: 'monkey_saddle', span: 18, rise: 6 }],
]

/** Every directed edge appears once, and its reverse once: closed and consistently oriented. */
function directedEdgeDefects(indices: Uint32Array, vertices: number): number {
  const seen = new Map<number, number>()
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = indices[t + e]! * vertices + indices[t + ((e + 1) % 3)]!
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
  let bad = 0
  for (const [k, c] of seen) {
    const a = Math.floor(k / vertices), b = k % vertices
    if (c !== 1 || seen.get(b * vertices + a) !== 1) bad++
  }
  return bad
}

describe('parametric surface: each family', () => {
  it.each(FAMILIES)('%s: closed shell, every edge shared by two triangles in opposite directions', (_n, params) => {
    const r = parsed(surfaceRecipe(params))
    const m = buildSurfaceClosedMesh(r, r.generator.params)
    expect(openEdges(m)).toBe(0)
    expect(directedEdgeDefects(m.indices, m.positions.length / 3)).toBe(0)
  })

  it.each(FAMILIES)('%s: area within 0.5% of the reference, volume within 0.5% of t·A, facing outward', (name, params) => {
    const r = parsed(surfaceRecipe(params))
    const f = family(r.generator.params)
    const A = integrateArea(f)
    const ref = f.referenceArea()
    const V = closedShellVolume(buildSurfaceClosedMesh(r, r.generator.params))
    console.info(`[${name}] area ${A.toFixed(3)} m², reference ${ref.toFixed(3)} (${((100 * (A - ref)) / ref).toFixed(4)}%), mesh volume ${V.toFixed(3)} m³ vs t·A ${(T * A).toFixed(3)} (${((100 * (V - T * A)) / (T * A)).toFixed(3)}%)`)
    expect(relErr(A, ref)).toBeLessThan(0.005)
    // Positive signed volume: the triangles face out of the body.
    expect(V).toBeGreaterThan(0)
    expect(relErr(V, T * A)).toBeLessThan(0.005)
  })

  it.each(FAMILIES)('%s: stands on the ground, and builds within 150 ms', (_n, params) => {
    const r = parsed(surfaceRecipe(params))
    // The best of three runs: the suite runs files in parallel, and one run can wait for another file's work.
    let ms = Infinity
    let b = buildSurface(r, r.generator.params, [])
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now()
      b = buildSurface(r, r.generator.params, [])
      ms = Math.min(ms, performance.now() - t0)
    }
    let low = Infinity
    for (const mesh of [b.meshes.outer, b.meshes.inner, b.meshes.caps]) if (mesh) for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i]!)
    expect(Math.abs(low)).toBeLessThan(1e-4)
    expect(b.metrics.surface!.sinkDepth).toBeLessThan(1e-6)
    expect(ms).toBeLessThan(150)
  })
})

describe('parametric surface: closed forms', () => {
  it('catenoid area is πc(H + c·sinh(H/c))', () => {
    const c = 6, H = 9
    const f = family({ family: 'catenoid', waist_radius: c, height: H })
    expect(relErr(integrateArea(f), Math.PI * c * (H + c * Math.sinh(H / c)))).toBeLessThan(1e-4)
  })
  it('helicoid area is U·(R/2·√(R² + c²) + c²/2·asinh(R/c))', () => {
    const R = 6, c = 3.6 / TAU, U = TAU * 2
    const f = family({ family: 'helicoid', radius: R, pitch: 3.6, turns: 2 })
    expect(relErr(integrateArea(f), U * ((R / 2) * Math.sqrt(R * R + c * c) + ((c * c) / 2) * Math.asinh(R / c)))).toBeLessThan(1e-4)
  })
  it('a hyperboloid reaches its end radius at both ends and its waist in the middle', () => {
    const f = family({ family: 'hyperboloid', waist_radius: 4, end_radius: 7, height: 24 })
    expect(Math.hypot(f.point(0, 12)[0], f.point(0, 12)[2])).toBeCloseTo(7, 9)
    expect(Math.hypot(f.point(1, 0)[0], f.point(1, 0)[2])).toBeCloseTo(4, 9)
  })
  it('principal curvature radii: helicoid c at the axis, catenoid c at the waist', () => {
    expect(relErr(minCurvatureRadius(family({ family: 'helicoid', radius: 6, pitch: 3.6, turns: 2 })), 3.6 / TAU)).toBeLessThan(0.005)
    expect(relErr(minCurvatureRadius(family({ family: 'catenoid', waist_radius: 6, height: 9 })), 6)).toBeLessThan(0.005)
  })
})

describe('parametric surface: edges and metrics', () => {
  const metrics = (params: Record<string, unknown>) => {
    const out = build(surfaceRecipe(params))
    if (!out.ok) throw new Error(JSON.stringify(out))
    return out.metrics
  }
  it('a tower has two edge rings: 2 × 2π × end radius', () => {
    const m = metrics({ family: 'hyperboloid', waist_radius: 4, end_radius: 7, height: 24 })
    expect(m.edgeCount).toBe(2)
    expect(relErr(m.edgeLength, 2 * TAU * 7)).toBeLessThan(0.005)
    expect(m.surface!.waistDiameter).toBeCloseTo(2 * (4 - T / 2), 9)
    const c = metrics({ family: 'catenoid', waist_radius: 6, height: 9 })
    expect(relErr(c.edgeLength, 2 * TAU * 6 * Math.cosh(9 / 12))).toBeLessThan(0.005)
  })
  it('a hypar has one edge of four straight lines', () => {
    const m = metrics({ family: 'hyperbolic_paraboloid', span: 20, span2: 14, rise: 8 })
    expect(m.edgeCount).toBe(1)
    expect(relErr(m.edgeLength, 2 * (Math.hypot(20, 8) + Math.hypot(14, 8)))).toBeLessThan(1e-6)
    // Under the plan center: half the rise less half the thickness (the normal is vertical there), plus the
    // lift that sets the low corner's underside on the ground: (t/2)·n_y at the corner.
    const k = 8 / 2 / (10 * 7)
    const nyCorner = 1 / Math.sqrt(1 + k * k * (10 * 10 + 7 * 7))
    expect(m.clearHeight!.min).toBeCloseTo(4 - T / 2 + (T / 2) * nyCorner, 6)
  })
  it('a helicoid has one edge: the outer helix, the axis and two radii; its clear height is the pitch less the vertical wall', () => {
    const R = 6, p = 3.6, n = 2
    const m = metrics({ family: 'helicoid', radius: R, pitch: p, turns: n })
    expect(m.edgeCount).toBe(1)
    expect(relErr(m.edgeLength, n * Math.hypot(TAU * R, p) + n * p + 2 * R)).toBeLessThan(0.005)
    const c = p / TAU
    expect(m.clearHeight!.max).toBeCloseTo(p - T / (R / Math.hypot(R, c)), 9)
  })
  it('a Klein bottle has no edge, and says it passes through itself', () => {
    const m = metrics({ family: 'klein_bottle', radius: 8, tube: 3 })
    expect(m.edgeCount).toBe(0)
    expect(m.surface!.selfIntersecting).toBe(true)
  })
  it('a sunk base is reported as its depth', () => {
    const out = build(surfaceRecipe({ family: 'catenoid', waist_radius: 6, height: 9 }, { section_center_height: -1.5 }))
    if (!out.ok) throw new Error('did not build')
    expect(out.metrics.surface!.sinkDepth).toBeCloseTo(1.5, 6)
    expect(out.metrics.cuspBurial).toBeCloseTo(1.5, 6)
  })
})

describe('parametric surface: rules 15–19', () => {
  const ids = (raw: unknown) => checkRules(parsed(raw)).map((i) => i.rule)
  it('15: a surface is built only as a shell', () => {
    const raw = surfaceRecipe({ family: 'catenoid', waist_radius: 6, height: 9 }, { mode: 'solid' })
    delete (raw.bare as Record<string, unknown>).shell
    expect(ids(raw)).toEqual([15])
    expect(validateRecipe(raw).ok).toBe(false)
  })
  it('16: a hyperboloid must widen from its waist; a Klein ring must clear its figure 8', () => {
    expect(ids(surfaceRecipe({ family: 'hyperboloid', waist_radius: 5, end_radius: 5, height: 20 }))).toEqual([16])
    expect(ids(surfaceRecipe({ family: 'klein_bottle', radius: 4, tube: 3 }))).toEqual([16])
  })
  it('17: the wall cannot be thicker than twice the tightest bend', () => {
    // Helicoid curvature radius at the axis: pitch / 2π = 0.16 m; a 0.5 m wall folds.
    const raw = surfaceRecipe({ family: 'helicoid', radius: 6, pitch: 1, turns: 1 }, { shell: { thickness: 0.5 } })
    expect(ids(raw)).toContain(17)
  })
  it('18: a shell far thinner than its span warns', () => {
    expect(ids(surfaceRecipe({ family: 'hyperbolic_paraboloid', span: 80, rise: 30 }, { shell: { thickness: 0.1 } }))).toEqual([18])
  })
  it('19: no room to stand under a flat saddle or between tight turns', () => {
    expect(ids(surfaceRecipe({ family: 'hyperbolic_paraboloid', span: 20, rise: 4 }))).toEqual([19])
    expect(ids(surfaceRecipe({ family: 'helicoid', radius: 6, pitch: 2.2, turns: 2 }))).toEqual([19])
    expect(ids(surfaceRecipe({ family: 'helicoid', radius: 6, pitch: 3.6, turns: 2 }))).toEqual([])
  })
})

describe('parametric surface: contract, export and print', () => {
  it('a family without its dimensions fails both validators', () => {
    const raw = surfaceRecipe({ family: 'hyperboloid', waist_radius: 4, height: 20 })
    expect(jsonSchemaValid(raw).ok).toBe(false)
    expect(parseRecipe(raw).ok).toBe(false)
  })

  it('STL, OBJ and glTF export a surface', () => {
    const raw = JSON.parse(readFileSync('docs/examples/hypar-canopy.recipe.json', 'utf8'))
    for (const format of ['stl', 'obj', 'glb'] as const) {
      const f = exportFile(raw, format)
      expect('bytes' in f && f.bytes.length > 1000, format).toBe(true)
    }
  })

  it.each(['hyperboloid-water-tower', 'hypar-canopy', 'catenoid-pavilion'])('%s: the print file is closed, at size, with a printable wall', async (id) => {
    const raw = JSON.parse(readFileSync(`docs/examples/${id}.recipe.json`, 'utf8'))
    const out = await printFiles(raw, PRINT_DEFAULTS)
    if ('error' in out) throw new Error(out.error)
    const r = out.report
    console.info(`[print ${id}] 1:${r.scale}, ${r.sizeMm.map((v) => v.toFixed(1)).join(' × ')} mm, wall ${r.wallMm!.toFixed(2)} mm, ${r.body}, open edges ${r.openEdges}, ${r.grams.toFixed(1)} g`)
    expect(r.openEdges).toBe(0)
    expect(Math.max(...r.sizeMm)).toBeCloseTo(PRINT_DEFAULTS.sizeMm, 3)
    expect(r.checks.every((c) => c.ok)).toBe(true)
  })

  it('a sunk base is cut at the ground and capped, and the print stays closed', async () => {
    const raw = surfaceRecipe({ family: 'catenoid', waist_radius: 5, height: 7 }, { section_center_height: -1 })
    const out = await printFiles(raw, PRINT_DEFAULTS)
    if ('error' in out) throw new Error(out.error)
    expect(out.report.groundCut).toBe(true)
    expect(out.report.belowGroundM).toBeCloseTo(1, 3)
    expect(out.report.openEdges).toBe(0)
  })
})
