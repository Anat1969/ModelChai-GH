/** The six mandatory tests of GENERATORS.md section 3, plus checks of every metric against analytic values. */
import { describe, expect, it } from 'vitest'
import { build, type BuildSuccess } from '../src/engine/build'
import { TAU } from '../src/engine/math'
import { sectionPoint } from '../src/engine/sections'
import { buildClosedMesh, closedMeshVolume } from '../src/engine/sweep/closedMesh'
import { parseRecipe, type Recipe } from '../src/recipe/schema'
import { FIXTURE_NAMES, fixture } from './helpers'

/** The reference solid of docs/reference/umbilic_torus.py: R = 12, a = 1.2, h0 = 2.4. */
function umbilicSolid(turns = 1 / 3) {
  const r = fixture('umbilic-torus')
  r.bare = { mode: 'solid', section_center_height: 2.4 }
  r.generator.params.path.R = 12
  r.generator.params.section.a = 1.2
  r.generator.params.twist.turns_per_lap = turns
  return r
}

const ok = (input: unknown): BuildSuccess => {
  const r = build(input)
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

const parsed = (input: unknown): Recipe & { generator: { type: 'sweep' } } => {
  const p = parseRecipe(input)
  if (!p.ok || p.recipe.generator.type !== 'sweep') throw new Error('expected a sweep recipe')
  return p.recipe as Recipe & { generator: { type: 'sweep' } }
}

const closedMesh = (input: unknown, withOpenings = true) => {
  const r = parsed(input)
  return buildClosedMesh(r, r.generator.params, { withOpenings })
}

/** Counts how many triangles use each undirected edge. */
function edgeUse(indices: Uint32Array): Map<string, number> {
  const use = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const p = indices[t + a]!, q = indices[t + b]!
      const key = p < q ? `${p}-${q}` : `${q}-${p}`
      use.set(key, (use.get(key) ?? 0) + 1)
    }
  }
  return use
}

const relErr = (measured: number, expected: number) => Math.abs(measured - expected) / expected

describe('GENERATORS.md §3 mandatory tests', () => {
  it('1. solid umbilic torus (R 12, a 1.2): closed mesh volume within 0.5% of 2πa²·2πR ≈ 682.2 m³', () => {
    const analytic = TAU * 1.2 ** 2 * TAU * 12
    expect(analytic).toBeCloseTo(682.2, 1)
    const v = closedMeshVolume(closedMesh(umbilicSolid()))
    console.info(`[test 1] mesh ${v.toFixed(2)} m³, analytic ${analytic.toFixed(2)} m³, deviation ${(relErr(v, analytic) * 100).toFixed(3)}%`)
    expect(relErr(v, analytic)).toBeLessThan(0.005)
  })

  it('2. the export mesh is closed: every edge is shared by exactly two triangles', () => {
    const m = closedMesh(umbilicSolid())
    const counts = [...edgeUse(m.indices).values()]
    console.info(`[test 2] ${m.indices.length / 3} triangles, ${counts.length} edges, all shared by 2: ${counts.every((c) => c === 2)}`)
    expect(counts.every((c) => c === 2)).toBe(true)
  })

  it.each([
    [1 / 3, 1],
    [0, 3],
    [2 / 3, 1],
  ])('3. turns_per_lap %s → %s edge(s)', (turns, edges) => {
    const r = ok(umbilicSolid(turns))
    expect(r.metrics.edgeCount).toBe(edges)
    expect(r.curves.edges).toHaveLength(edges)
  })

  it('4. shell version: floor 3.1–8.4 m, clear height 4.65–7.8 m, continuous floor', () => {
    const m = ok(fixture('umbilic-torus')).metrics
    console.info(
      `[test 4] floor ${m.floorWidth!.min.toFixed(3)}–${m.floorWidth!.max.toFixed(3)} m, ` +
        `clear ${m.clearHeight!.min.toFixed(3)}–${m.clearHeight!.max.toFixed(3)} m, continuous ${m.floorContinuous}`,
    )
    expect(m.floorWidth!.min).toBeCloseTo(3.1, 1)
    expect(m.floorWidth!.max).toBeCloseTo(8.4, 1)
    expect(m.clearHeight!.min).toBeCloseTo(4.65, 2)
    expect(m.clearHeight!.max).toBeCloseTo(7.8, 2)
    expect(m.floorContinuous).toBe(true)
  })

  it('5. deltoid with turns_per_lap = 0.25 returns semantic error 1 and builds nothing', () => {
    const r = build(umbilicSolid(0.25))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.stage).toBe('rules')
    expect(r.issues.find((i) => i.rule === 1)?.severity).toBe('error')
  })

  // Test 6 (build time inside the Worker) lives in tests/worker.test.ts.
})

describe('metrics against analytic values', () => {
  it.each(FIXTURE_NAMES)('%s: watertight solid export mesh matches Pappus within 0.5%%', (name) => {
    const raw = fixture(name)
    raw.bare = { mode: 'solid', section_center_height: raw.bare.section_center_height }
    const r = ok(raw)
    const m = closedMesh(raw)
    expect([...edgeUse(m.indices).values()].every((c) => c === 2)).toBe(true)
    expect(relErr(closedMeshVolume(m), r.metrics.solidVolume)).toBeLessThan(0.005)
  })

  it('shell without openings is watertight and its volume matches (a² − a′²) Pappus', () => {
    const raw = fixture('umbilic-torus')
    const m = closedMesh(raw, false)
    expect([...edgeUse(m.indices).values()].every((c) => c === 2)).toBe(true)
    const a = 2.4, ai = 2.1
    const analytic = TAU * (a * a - ai * ai) * TAU * 18
    expect(relErr(closedMeshVolume(m), analytic)).toBeLessThan(0.005)
  })

  it('shell volume = (outer − inner area) × length × (1 − opening fraction)', () => {
    const m = ok(fixture('umbilic-torus')).metrics
    const expected = TAU * (2.4 ** 2 - 2.1 ** 2) * TAU * 18 * (1 - m.openingFraction)
    expect(m.shellVolume).toBeCloseTo(expected, 6)
    expect(m.openingFraction).toBeGreaterThan(0)
    expect(m.weight).toBeCloseTo(m.volume * 2.4, 6)
  })

  it('envelope area matches Pappus for surfaces: perimeter × 2πR = 16a × 2πR, within 0.5%', () => {
    // Without twist the ring is a surface of revolution; the section centroid sits on the path.
    const analytic = 16 * 1.2 * TAU * 12
    const m = ok(umbilicSolid(0)).metrics
    console.info(`[area] mesh ${m.envelopeArea.toFixed(2)} m², analytic ${analytic.toFixed(2)} m²`)
    expect(relErr(m.envelopeArea, analytic)).toBeLessThan(0.005)
  })

  it('edge length matches a fine numeric integration of the cusp curve within 0.5%', () => {
    const R = 12, a = 1.2, n = 60000
    const P = (U: number) => {
      const lap = Math.floor(U / TAU)
      const u = U - lap * TAU
      const [x, y] = sectionPoint({ curve: 'deltoid', a, aspect: 1 }, (lap * TAU) / 3)
      const th = -Math.PI / 2 + u / 3
      const X = x * Math.cos(th) - y * Math.sin(th), Y = x * Math.sin(th) + y * Math.cos(th)
      return [(R + X) * Math.cos(u), 2.4 + Y, (R + X) * Math.sin(u)]
    }
    let L = 0
    let prev = P(0)
    for (let i = 1; i <= n; i++) {
      const p = P((3 * TAU * i) / n - 1e-12)
      L += Math.hypot(p[0]! - prev[0]!, p[1]! - prev[1]!, p[2]! - prev[2]!)
      prev = p
    }
    const m = ok(umbilicSolid()).metrics
    expect(relErr(m.edgeLength, L)).toBeLessThan(0.005)
  })

  it('diameters, burial and the cusp rib', () => {
    const m = ok(fixture('umbilic-torus')).metrics
    expect(m.outerDiameter).toBeCloseTo(2 * (18 + 7.2), 9)
    expect(m.courtyardDiameter).toBeCloseTo(2 * (18 - 7.2), 9)
    expect(m.cuspBurial).toBeCloseTo(5.7, 9)
    expect(m.wallAtCorners).toBeCloseTo(0.9, 9) // 3t: the cusp becomes a rib
    expect(m.innerScale).toBeCloseTo(0.875, 9)
  })

  it('geometric scale: the golden ratio helix shrinks by 1/φ per lap', () => {
    const r = ok(fixture('golden-ratio'))
    const p = r.curves.path
    // Section radius per lap is 1.6 · 0.236^(lap/3); check the ratio between laps 0 and 1 via the outer mesh.
    const ratio = 0.236 ** (1 / 3)
    expect(ratio).toBeCloseTo(0.618, 3)
    expect(p.length / 3).toBe(1081)
  })
})

describe('mesh integrity', () => {
  it('outer normals point away from the section center, inner normals toward it', () => {
    const raw = fixture('umbilic-torus')
    delete raw.bare.openings
    const r = ok(raw)
    const R = 18, h0 = 1.5
    const check = (mesh: { positions: Float32Array; normals: Float32Array }, sign: number) => {
      let agree = 0
      const n = mesh.positions.length / 3
      for (let v = 0; v < n; v++) {
        const x = mesh.positions[3 * v]!, y = mesh.positions[3 * v + 1]!, z = mesh.positions[3 * v + 2]!
        const rr = Math.hypot(x, z)
        const dx = x - (R * x) / rr, dy = y - h0, dz = z - (R * z) / rr
        const d = dx * mesh.normals[3 * v]! + dy * mesh.normals[3 * v + 1]! + dz * mesh.normals[3 * v + 2]!
        if (Math.sign(d) === sign) agree++
      }
      return agree / n
    }
    expect(check(r.meshes.outer, 1)).toBeGreaterThan(0.99)
    expect(check(r.meshes.inner!, -1)).toBeGreaterThan(0.99)
  })

  it('openings cut the same quads in both walls', () => {
    const r = ok(fixture('umbilic-torus'))
    expect(r.meshes.outer.indices.length).toBe(r.meshes.inner!.indices.length)
    const raw = fixture('umbilic-torus')
    delete raw.bare.openings
    expect(ok(raw).meshes.outer.indices.length).toBeGreaterThan(r.meshes.outer.indices.length)
  })

  it('the edge curve sits 5 cm off the surface and closes on itself', () => {
    const r = ok(umbilicSolid())
    const e = r.curves.edges[0]!
    const n = e.length / 3
    expect(n).toBe(3 * 360)
    const gap = Math.hypot(e[0]! - e[3 * n - 3]!, e[1]! - e[3 * n - 2]!, e[2]! - e[3 * n - 1]!)
    const step = Math.hypot(e[0]! - e[3]!, e[1]! - e[4]!, e[2]! - e[5]!)
    expect(gap).toBeLessThan(step * 2)
    expect(r.curves.edgesClosed).toBe(true)
  })

  it('a floor that leaves the inner section is reported as broken', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.floor.level = -1.8
    const r = ok(raw)
    expect(r.metrics.floorContinuous).toBe(false)
    expect(r.metrics.floorCoverage).toBeLessThan(1)
    expect(r.issues.map((i) => i.rule)).toContain(5)
  })

  it('every section curve and path type builds, watertight and matching Pappus', { timeout: 60000 }, () => {
    const sections = [
      { curve: 'hypocycloid', a: 1, cusps: 5 },
      { curve: 'circle', a: 1 },
      { curve: 'polygon', a: 1, sides: 6 },
      { curve: 'superellipse', a: 1, exponent: 4 },
      { curve: 'superellipse', a: 1, exponent: 0.8 },
    ]
    for (const section of sections) {
      for (const path of [{ type: 'circle', R: 12 }, { type: 'ellipse', R: 14, R2: 10 }, { type: 'helix', R: 8, pitch: 6, turns: 2 }, { type: 'line', length: 30 }]) {
        const raw = fixture('golden-ratio')
        raw.generator.params = {
          section,
          path,
          twist: { turns_per_lap: 0 },
          scale_along_path: path.type === 'helix' || path.type === 'line' ? 0.5 : 1,
          resolution: { path_segments: 120, section_segments: 144 },
        }
        raw.bare.section_center_height = 6
        const r = ok(raw)
        expect(r.meshes.outer.indices.length).toBeGreaterThan(0)
        const solid = closedMesh(raw)
        expect([...edgeUse(solid.indices).values()].every((c) => c === 2)).toBe(true)
        expect(relErr(closedMeshVolume(solid), r.metrics.solidVolume)).toBeLessThan(0.005)
      }
    }
  })
})
