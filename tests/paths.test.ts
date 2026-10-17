/**
 * The four new sweep paths (DECISIONS.md 130–134): lemniscate, torus knot, wave and catenary arch. Each closes or
 * ends where it should, carries continuous frames, and measures against an analytic value or a high-resolution
 * numeric reference within 0.5%.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { build, type BuildSuccess } from '../src/engine/build'
import { printFiles } from '../src/engine/export'
import { openEdges, PRINT_DEFAULTS } from '../src/engine/export/print'
import { TAU } from '../src/engine/math'
import { archLength, catenaryC, curveOf, pathFrames, pathLength, type PathFrames } from '../src/engine/paths'
import { closestApproach, crossingClearance, lowestPoints } from '../src/engine/paths/analysis'
import { buildClosedMesh, closedMeshVolume } from '../src/engine/sweep/closedMesh'
import { visualPrompt } from '../src/prompt/visualPrompt'
import { checkRules, outerRadius } from '../src/recipe/rules'
import { parseRecipe, type Recipe, type SweepParams } from '../src/recipe/schema'
import { GROUPS, type Sweep } from '../src/ui/params'
import { fixture } from './helpers'

type Raw = ReturnType<typeof fixture>

/** A recipe around a path, from the golden-ratio fixture: a solid circle section of radius a unless told. */
function recipe(path: Record<string, unknown>, opts: { a?: number; h0?: number; section?: Record<string, unknown>; twist?: number; bare?: Record<string, unknown> } = {}): Raw {
  const raw = fixture('golden-ratio')
  raw.generator.params = {
    section: opts.section ?? { curve: 'circle', a: opts.a ?? 1 },
    path,
    twist: { turns_per_lap: opts.twist ?? 0 },
    scale_along_path: 1,
  }
  raw.bare = opts.bare ?? { mode: 'solid', section_center_height: opts.h0 ?? 1 }
  return raw
}

const parsed = (raw: unknown) => {
  const p = parseRecipe(raw)
  if (!p.ok || p.recipe.generator.type !== 'sweep') throw new Error(JSON.stringify(p))
  return p.recipe as Recipe & { generator: { type: 'sweep'; params: SweepParams } }
}
const ok = (raw: unknown, res?: { pathSegments: number; sectionSegments: number }): BuildSuccess => {
  const r = build(raw, res)
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 400))
  return r
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
const ruleIds = (raw: unknown) => checkRules(parsed(raw)).map((i) => i.rule)
const example = (id: string) => JSON.parse(readFileSync(`docs/examples/${id}.recipe.json`, 'utf8'))

const LEMNISCATE = { type: 'lemniscate', R: 24, cross_height: 3.2 }
const TREFOIL = { type: 'torus_knot', R: 12, r: 5, p: 2, q: 3 }
const WAVE = { type: 'wave', length: 120, amplitude: 4, wavelength: 40 }
const ARCH = { type: 'arch', span: 14, height: 10 }
const ALL = [
  ['lemniscate', LEMNISCATE, 1],
  ['torus_knot', TREFOIL, 6.2],
  ['wave', WAVE, 1.2],
  ['arch', ARCH, 0],
] as const

/** Polyline length of a curve at n samples: the reference for the integrated lengths. */
function polylineLength(path: Record<string, unknown>, n: number): number {
  const c = curveOf(parsed(recipe(path)).generator.params.path, 0)!
  let L = 0
  let prev = c.point(0)
  for (let i = 1; i <= n; i++) {
    const p = c.point((c.uMax * i) / n)
    L += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])
    prev = p
  }
  return L
}

/** Complete elliptic integral of the second kind E(m), by the arithmetic-geometric mean. */
function ellipticE(m: number): number {
  let a = 1, b = Math.sqrt(1 - m), sum = 1 - m / 2, pow = 0.5
  for (let i = 0; i < 30; i++) {
    const an = (a + b) / 2, bn = Math.sqrt(a * b), cn = (a - b) / 2
    pow *= 2
    sum -= pow * cn * cn
    a = an
    b = bn
  }
  return (Math.PI / (2 * a)) * sum
}

/** Edges of a binary STL that do not join exactly two triangles, after welding by 32-bit coordinates. */
function stlOpenEdges(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ids = new Map<string, number>()
  const id = (o: number) => {
    const k = `${dv.getFloat32(o, true)},${dv.getFloat32(o + 4, true)},${dv.getFloat32(o + 8, true)}`
    let i = ids.get(k)
    if (i === undefined) ids.set(k, (i = ids.size))
    return i
  }
  const edges = new Map<string, number>()
  for (let t = 0; t < dv.getUint32(80, true); t++) {
    const o = 84 + 50 * t + 12
    const w = [0, 1, 2].map((k) => id(o + 12 * k))
    for (let e = 0; e < 3; e++) {
      const a = w[e]!, b = w[(e + 1) % 3]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  return [...edges.values()].filter((c) => c !== 2).length
}

const v = (a: Float64Array, i: number) => [a[3 * i]!, a[3 * i + 1]!, a[3 * i + 2]!] as const
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
const angle = (a: readonly number[], b: readonly number[]) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/** Largest angle between the normals of consecutive rows, and across the seam of a closed path. */
function frameSteps(f: PathFrames): { step: number; seam: number } {
  let step = 0
  for (let i = 0; i + 1 < f.rows; i++) step = Math.max(step, angle(v(f.N, i), v(f.N, i + 1)), angle(v(f.B, i), v(f.B, i + 1)))
  const seam = f.closed ? Math.max(angle(v(f.N, f.rows - 1), v(f.N, 0)), angle(v(f.B, f.rows - 1), v(f.B, 0))) : 0
  return { step, seam }
}

describe('the contract', () => {
  it('each new path requires its own fields, and the examples pass it', () => {
    expect(parseRecipe(recipe({ type: 'lemniscate', R: 20 })).ok).toBe(false)
    expect(parseRecipe(recipe({ type: 'torus_knot', R: 12, r: 5, p: 2 })).ok).toBe(false)
    expect(parseRecipe(recipe({ type: 'torus_knot', R: 12, r: 5, p: 2.5, q: 3 })).ok).toBe(false)
    expect(parseRecipe(recipe({ type: 'wave', length: 100, amplitude: 3 })).ok).toBe(false)
    expect(parseRecipe(recipe({ type: 'arch', span: 10 })).ok).toBe(false)
    for (const [, path] of ALL) expect(parseRecipe(recipe(path)).ok).toBe(true)
  })
})

describe('frames', () => {
  it.each(ALL)('%s: orthonormal, facing the direction of travel, continuous through the seam', (_t, path, h0) => {
    const p = parsed(recipe(path, { h0 })).generator.params.path
    const f = pathFrames(p, h0, 360)
    for (let i = 0; i < f.rows; i++) {
      const N = v(f.N, i), B = v(f.B, i)
      expect(Math.abs(dot(N, N) - 1)).toBeLessThan(1e-9)
      expect(Math.abs(dot(B, B) - 1)).toBeLessThan(1e-9)
      expect(Math.abs(dot(N, B))).toBeLessThan(1e-9)
      // N × B is the direction of travel.
      const a = f.closed ? (i - 1 + f.rows) % f.rows : Math.max(0, i - 1)
      const b = f.closed ? (i + 1) % f.rows : Math.min(f.rows - 1, i + 1)
      const d = [0, 1, 2].map((k) => f.C[3 * b + k]! - f.C[3 * a + k]!)
      expect(dot(cross(N, B), d) / Math.hypot(...d)).toBeGreaterThan(0.999)
    }
    const s = frameSteps(f)
    expect(s.step).toBeLessThan(0.1)
    // The seam is no larger a step than any other: the frame closes.
    expect(s.seam).toBeLessThanOrEqual(s.step * 1.01 + 1e-12)
    console.info(`[paths] ${_t}: ${f.rows} rows, largest frame step ${((s.step * 180) / Math.PI).toFixed(3)}°, seam ${((s.seam * 180) / Math.PI).toFixed(3)}°${f.holonomy !== undefined ? `, holonomy corrected ${((f.holonomy * 180) / Math.PI).toFixed(2)}°` : ''}`)
  })

  it('the knot: a rotation-minimizing frame turns by its holonomy over a lap, and the correction closes it', { timeout: 60000 }, () => {
    const f = pathFrames(parsed(recipe(TREFOIL)).generator.params.path, 6.2, 360)
    expect(Math.abs(f.holonomy!)).toBeGreaterThan(0.01)
    // Twisted by 1/3 with a deltoid, the closed knot is watertight: the twist meets itself at the seam.
    const raw = recipe(TREFOIL, { section: { curve: 'deltoid', a: 0.4 }, twist: 1 / 3, h0: 6.2 })
    expect(ruleIds(raw)).toEqual([])
    const m = buildClosedMesh(parsed(raw), parsed(raw).generator.params)
    expect(openEdges(m)).toBe(0)
    expect(ok(raw).metrics.edgeCount).toBe(1)
  })

  it('the lemniscate: the upper branch crosses at cross_height, the lower at h0, and both are level there', () => {
    const f = pathFrames(parsed(recipe(LEMNISCATE)).generator.params.path, 1, 360)
    const up = v(f.C, f.rows / 4), low = v(f.C, (3 * f.rows) / 4)
    expect(Math.hypot(up[0], up[1] - 4.2, up[2])).toBeLessThan(1e-9)
    expect(Math.hypot(low[0], low[1] - 1, low[2])).toBeLessThan(1e-9)
    expect(Math.abs(v(f.B, f.rows / 4)[1] - 1)).toBeLessThan(1e-9)
    expect(f.horizontalFrames).toBe(false)
  })

  it('the wave keeps B vertical, so its shell has a floor', () => {
    const f = pathFrames(parsed(recipe(WAVE)).generator.params.path, 1.2, 360)
    for (let i = 0; i < f.rows; i++) expect(v(f.B, i)[1]).toBeCloseTo(1, 12)
    expect(f.horizontalFrames).toBe(true)
  })

  it('the arch stands on its feet at ±span/2 and reaches its height at the middle', () => {
    const f = pathFrames(parsed(recipe(ARCH)).generator.params.path, 0, 360)
    const a = v(f.C, 0), b = v(f.C, f.rows - 1), top = v(f.C, (f.rows - 1) / 2)
    expect(a[0]).toBeCloseTo(-7, 9)
    expect(b[0]).toBeCloseTo(7, 9)
    expect(a[1]).toBeCloseTo(0, 9)
    expect(top[1]).toBeCloseTo(10, 9)
    const c = catenaryC(14, 10)
    expect(c * (Math.cosh(7 / c) - 1)).toBeCloseTo(10, 9)
  })
})

describe('metrics against analytic and high-resolution references, within 0.5%', () => {
  it('path length: the lemniscate is 2ϖa without its bridge; the knot and the arch match a 200 000-point polyline', () => {
    const LEMNISCATE_CONSTANT = 2.62205755429211981046
    const flat = parsed(recipe({ type: 'lemniscate', R: 24, cross_height: 0 })).generator.params.path
    expect(rel(pathLength(flat), 2 * LEMNISCATE_CONSTANT * 24)).toBeLessThan(1e-6)
    for (const path of [LEMNISCATE, TREFOIL, ARCH]) {
      const L = pathLength(parsed(recipe(path)).generator.params.path)
      expect(rel(L, polylineLength(path, 200000))).toBeLessThan(1e-6)
    }
    expect(rel(archLength(14, 10), polylineLength(ARCH, 200000))).toBeLessThan(1e-6)
  })

  it('path length: the wave matches the elliptic integral (4/k)·√(1+m)·E(m/(1+m)) per wavelength', () => {
    const k = TAU / 40, m = (4 * k) ** 2
    const perWave = (4 / k) * Math.sqrt(1 + m) * ellipticE(m / (1 + m))
    const L = pathLength(parsed(recipe(WAVE)).generator.params.path)
    expect(rel(L, 3 * perWave)).toBeLessThan(1e-6)
    console.info(`[paths] wave length ${L.toFixed(4)} m, elliptic ${(3 * perWave).toFixed(4)} m`)
  })

  it.each(ALL)('%s: the closed mesh is watertight, solid and shell, and its volume matches Pappus', { timeout: 60000 }, (_t, path, h0) => {
    for (const bare of [
      { mode: 'solid', section_center_height: h0 },
      { mode: 'shell', section_center_height: h0, shell: { thickness: 0.2 } },
    ]) {
      const raw = recipe(path, { bare })
      const r = ok(raw)
      const m = buildClosedMesh(parsed(raw), parsed(raw).generator.params)
      expect(openEdges(m)).toBe(0)
      const want = r.metrics.shellVolume ?? r.metrics.solidVolume
      expect(rel(Math.abs(closedMeshVolume(m)), want)).toBeLessThan(0.005)
      if (bare.mode === 'solid') console.info(`[paths] ${_t}: volume mesh ${Math.abs(closedMeshVolume(m)).toFixed(2)} m³, Pappus ${want.toFixed(2)} m³ (${(rel(Math.abs(closedMeshVolume(m)), want) * 100).toFixed(3)}%)`)
    }
  })

  it.each(ALL)('%s: the envelope of a round section is its perimeter times the path length (Pappus)', (_t, path, h0) => {
    const r = ok(recipe(path, { h0 }))
    expect(rel(r.metrics.envelopeArea, TAU * 1 * r.metrics.pathLength)).toBeLessThan(0.005)
  })

  it('a wave that grows along its length: the volume integrates the scale over the uneven speed', { timeout: 60000 }, () => {
    const raw = recipe(WAVE, { h0: 2 })
    raw.generator.params.scale_along_path = 1.8
    const r = ok(raw)
    const m = buildClosedMesh(parsed(raw), parsed(raw).generator.params)
    expect(rel(Math.abs(closedMeshVolume(m)), r.metrics.solidVolume)).toBeLessThan(0.005)
  })

  it('outer extents follow the geometry', () => {
    const lem = ok(recipe(LEMNISCATE)).metrics.extents
    expect(rel(lem.x, 2 * (24 + 1))).toBeLessThan(1e-9)
    expect(rel(lem.top, 1 + 3.2 + 1)).toBeLessThan(1e-9)
    // The lobe's widest point is a/(2√2) from the axis.
    expect(rel(lem.z, 2 * (24 / (2 * Math.SQRT2) + 1))).toBeLessThan(0.005)
    expect(rel(ok(recipe(TREFOIL, { h0: 6.2 })).metrics.extents.top, 6.2 + 5 + 1)).toBeLessThan(1e-6)
    expect(rel(ok(recipe(WAVE)).metrics.extents.x, 2 * (4 + 1))).toBeLessThan(0.005)
    expect(rel(ok(recipe(ARCH, { h0: 0 })).metrics.extents.top, 10 + 1)).toBeLessThan(1e-9)
  })

  it.each(ALL)('%s: the edge length of a square section matches a high-resolution build', (_t, path, h0) => {
    const raw = recipe(path, { h0, section: { curve: 'polygon', sides: 4, a: 0.8 } })
    const lo = ok(raw).metrics
    const hi = ok(raw, { pathSegments: 2048, sectionSegments: 48 }).metrics
    expect(lo.edgeCount).toBe(4)
    expect(rel(lo.edgeLength, hi.edgeLength)).toBeLessThan(0.005)
  })

  it('the crossing: exact on the lemniscate, and on the knot equal to a dense brute-force search', () => {
    const lem = parsed(recipe(LEMNISCATE, { section: { curve: 'superellipse', exponent: 6, a: 1.8, aspect: 0.15 } })).generator.params
    expect(crossingClearance(lem, 0.27, outerRadius(lem.section))).toBeCloseTo(3.2 - 2 * 0.27, 9)

    const knot = parsed(recipe(TREFOIL)).generator.params.path
    const c = curveOf(knot, 0)!
    const n = 3000
    const P = Array.from({ length: n }, (_, i) => c.point((c.uMax * i) / n))
    const L = pathLength(knot)
    let best = Infinity
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const sep = (Math.min(j - i, n - (j - i)) / n) * L
        if (sep < L / 6) continue
        best = Math.min(best, Math.hypot(P[i]![0] - P[j]![0], P[i]![1] - P[j]![1], P[i]![2] - P[j]![2]))
      }
    const found = closestApproach(knot, 0, Math.PI)!
    expect(rel(found.distance, best)).toBeLessThan(0.005)
    console.info(`[paths] trefoil R 12 r 5: strands pass ${found.distance.toFixed(3)} m apart (brute force ${best.toFixed(3)} m)`)
  })
})

describe('rules of the new paths', () => {
  it('10: a wave tighter than the section reaches errs, at the analytic bend λ = 2π√(A·a)', () => {
    const crit = TAU * Math.sqrt(4 * 2.2)
    expect(ruleIds(recipe({ ...WAVE, wavelength: crit * 0.98 }, { a: 2.2, h0: 2.2 }))).toContain(10)
    expect(ruleIds(recipe({ ...WAVE, wavelength: crit * 1.02 }, { a: 2.2, h0: 2.2 }))).not.toContain(10)
  })

  it('11 and 12: the lemniscate collides without a bridge, warns under 2.4 m, and passes above', () => {
    expect(ruleIds(recipe({ ...LEMNISCATE, cross_height: 0 }))).toContain(11)
    expect(ruleIds(recipe({ ...LEMNISCATE, cross_height: 3 }))).toEqual([12])
    expect(ruleIds(recipe({ ...LEMNISCATE, cross_height: 4.5 }))).toEqual([])
  })

  it('13: an arch whose feet float above the ground errs', () => {
    expect(ruleIds(recipe(ARCH, { h0: 0 }))).toEqual([])
    expect(ruleIds(recipe(ARCH, { h0: 1.5 }))).toContain(13)
  })

  it('14: a knot whose p and q share a factor falls apart into loops', () => {
    expect(ruleIds(recipe({ ...TREFOIL, q: 4 }, { h0: 6.2 }))).toEqual([14])
  })

  it('2: the knot must clear its axis by the section, R − r > outer radius', () => {
    expect(ruleIds(recipe({ ...TREFOIL, R: 5.9, r: 5 }, { h0: 6.2 }))).toContain(2)
  })

  it('1: a closed knot needs a twist that closes with the section', () => {
    expect(ruleIds(recipe(TREFOIL, { section: { curve: 'deltoid', a: 0.4 }, twist: 0.25, h0: 6.2 }))).toContain(1)
  })

  it('8: depth below the ground is measured on the surface of the new paths', () => {
    expect(ruleIds(recipe(LEMNISCATE, { h0: -2.5 }))).toContain(8)
    expect(lowestPoints(parsed(recipe(LEMNISCATE)).generator.params, -2.5).surface).toBeCloseTo(-3.5, 9)
  })

  it('passages belong to rings: on other paths they do nothing and raise nothing', () => {
    const raw = recipe(WAVE, { bare: { mode: 'shell', section_center_height: 1.2, shell: { thickness: 0.2 }, openings: { passages: { count: 12, width: 12 } } } })
    expect(ruleIds(raw)).not.toContain(7)
    expect(ok(raw).metrics.openingFraction).toBe(0)
  })
})

describe('the examples, in the studio, in words and in print', () => {
  const ids = ['trefoil-knot', 'lemniscate-walk', 'sine-promenade', 'catenary-arch'] as const

  it('each shows the sliders of its path', () => {
    const visible = (id: string) =>
      GROUPS.flatMap((g) => g.params)
        .filter((p) => !p.show || p.show(parsed(example(id)) as Sweep))
        .map((p) => p.id)
    expect(visible('trefoil-knot')).toEqual(expect.arrayContaining(['knotR', 'knotr', 'knotp', 'knotq']))
    expect(visible('trefoil-knot')).not.toContain('R')
    expect(visible('lemniscate-walk')).toEqual(expect.arrayContaining(['lemniscateR', 'crossHeight']))
    expect(visible('sine-promenade')).toEqual(expect.arrayContaining(['length', 'amplitude', 'wavelength', 'floor']))
    expect(visible('sine-promenade')).not.toContain('passages')
    expect(visible('catenary-arch')).toEqual(expect.arrayContaining(['span', 'archHeight']))
  })

  it('each names its path in the visual prompt', () => {
    const words = { 'trefoil-knot': 'קשר תלתן', 'lemniscate-walk': 'למניסקטה', 'sine-promenade': 'גל סינוס', 'catenary-arch': 'קשת שרשרת' }
    for (const id of ids) expect(visualPrompt(parsed(example(id)) as Sweep).parts[0]!.text).toContain(words[id])
  })

  it.each(ids)('%s prints watertight, in the file as stored too, with a recommended face', { timeout: 120000 }, async (id) => {
    const out = await printFiles(example(id), PRINT_DEFAULTS)
    if ('error' in out) throw new Error(out.error)
    const report = out.report
    expect(report.openEdges).toBe(0)
    // The STL read back the way a slicer reads it: vertices welded by their 32-bit coordinates.
    expect(stlOpenEdges(out.stl.bytes)).toBe(0)
    expect(report.checks.every((c) => c.ok)).toBe(true)
    expect(report.orientation.label.length).toBeGreaterThan(5)
    console.info(`[paths] print ${id}: 1:${report.scale}, ${report.sizeMm.map((x) => x.toFixed(0)).join(' × ')} mm, ${report.body}, openings ${report.openingsCut}, face ${report.orientation.down}, support ${(report.orientation.supportMm2 / 100).toFixed(1)} cm²`)
  })
})
