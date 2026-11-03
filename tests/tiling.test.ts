/** The tiling generator (GENERATORS.md 4.2, DECISIONS.md 146): every pattern against the mathematics it stands for. */
import { describe, expect, it } from 'vitest'
import { build } from '../src/engine/build'
import { buildTilingClosedMesh, closedTilingVolume } from '../src/engine/tiling/build'
import { isPrime, layout, polyArea, PROFILE_INTEGRAL } from '../src/engine/tiling/patterns'
import { checkRules } from '../src/recipe/rules'
import { kochMaxSteps } from '../src/ui/params'
import { parseRecipe, type Recipe, type TilingParams } from '../src/recipe/schema'
import { fixture } from './helpers'

/** A recipe around tiling params, on the umbilic fixture's realistic and narrative. */
function recipe(params: Record<string, unknown>, mode: 'solid' | 'shell' = 'solid'): Recipe {
  const r = fixture('umbilic-torus')
  r.generator = { type: 'tiling', params }
  r.bare = mode === 'solid' ? { mode: 'solid', section_center_height: 0 } : { mode: 'shell', section_center_height: 0, shell: { thickness: 0.3 } }
  const p = parseRecipe(r)
  if (!p.ok) throw new Error(JSON.stringify(p.errors))
  return p.recipe
}

const RIEMANN = { pattern: 'riemann_walls', length: 60, count: 24, peak: 30, depth: 12, thickness: 1, profile: 'arch' }
const ULAM = { pattern: 'ulam_grid', side: 15, cell: 2.4, fill: 0.55, height: 5 }
const FIB = { pattern: 'fibonacci_blocks', count: 8, unit: 1.5, height_ratio: 0.5, joint: 0.3 }
const VORONOI = { pattern: 'voronoi_cells', width: 48, depth: 32, count: 24, seed: 11, height_min: 2, height: 10, joint: 0 }
const WALK = { pattern: 'random_walk', steps: 500, cell: 1.6, height: 0.6, seed: 7 }
const KOCH = { pattern: 'koch_snowflake', length: 36, count: 3, height: 6, height_ratio: 0.6, joint: 0.3 }
const ALL = { RIEMANN, ULAM, FIB, VORONOI, WALK, KOCH }

/** Every edge of the closed mesh is shared by exactly two triangles, once in each direction. */
function closed(m: { indices: Uint32Array }) {
  const edges = new Map<string, number>()
  for (let i = 0; i < m.indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = m.indices[i + k]!, b = m.indices[i + ((k + 1) % 3)]!
      edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1)
    }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>')
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false
  }
  return true
}

describe('tiling: every pattern builds a closed solid whose volume is Σ area × height', () => {
  for (const [name, params] of Object.entries(ALL)) {
    it(name, () => {
      const r = recipe(params)
      const out = build(r)
      expect(out.ok, JSON.stringify(out)).toBe(true)
      if (!out.ok) return
      const m = buildTilingClosedMesh(r, r.generator.params as TilingParams)
      expect(closed(m)).toBe(true)
      const v = closedTilingVolume(m)
      expect(Math.abs(v - out.metrics.volume) / out.metrics.volume).toBeLessThan(1e-9)
      expect(out.metrics.tiling!.elements).toBeGreaterThan(2)
      expect(out.stats.ms).toBeLessThan(400)
    })
  }
})

describe('the mathematics behind each pattern', () => {
  it('Riemann walls: the sum against the exact integral, and the error shrinks with narrower strips', () => {
    const at = (count: number, profile: string) => build(recipe({ ...RIEMANN, count, profile })) as Extract<ReturnType<typeof build>, { ok: true }>
    const m = at(24, 'arch').metrics.tiling!
    expect(m.integral).toBeCloseTo(60 * 30 * (2 / Math.PI), 9)
    // The midpoint sum of sin over 24 strips, by hand.
    let s = 0
    for (let i = 0; i < 24; i++) s += 30 * Math.sin((Math.PI * (i + 0.5)) / 24) * 2.5
    expect(m.riemannSum).toBeCloseTo(s, 9)
    for (const profile of ['arch', 'parabola']) expect(Math.abs(at(48, profile).metrics.tiling!.riemannError!)).toBeLessThan(Math.abs(at(6, profile).metrics.tiling!.riemannError!))
    // A ramp is a straight line: the midpoint sum is exact.
    expect(Math.abs(at(7, 'ramp').metrics.tiling!.riemannError!)).toBeLessThan(1e-12)
    expect(PROFILE_INTEGRAL.parabola).toBeCloseTo(2 / 3, 12)
  })

  it('Ulam spiral: 48 primes up to 225 (π(225) = 48), and the inverse leaves them open', () => {
    const L = layout(ULAM as TilingParams)
    expect(L.facts.primes).toBe(48)
    expect(L.elements).toHaveLength(48)
    expect(L.elements.every((e) => isPrime(e.tag))).toBe(true)
    const inv = layout({ ...ULAM, invert: true } as TilingParams)
    expect(inv.elements).toHaveLength(225 - 48)
    // 1 sits at the center, 2 to its right, 3 above it: the spiral turns counter-clockwise.
    const at = (n: number) => L.order[n - 1]!
    expect(at(2)[0] - at(1)[0]).toBeCloseTo(2.4, 9)
    expect(at(3)[1] - at(2)[1]).toBeCloseTo(2.4, 9)
  })

  it('Fibonacci squares: the last two sizes approach φ, and the squares tile the envelope with no gap', () => {
    const L = layout({ ...FIB, joint: 0 } as TilingParams)
    expect(L.elements.map((e) => e.tag)).toEqual([1, 1, 2, 3, 5, 8, 13, 21])
    expect(L.facts.ratio).toBeCloseTo(21 / 13, 12)
    expect(Math.abs(L.facts.ratio! - (1 + Math.sqrt(5)) / 2)).toBeLessThan(0.01)
    const area = L.elements.reduce((s, e) => s + Math.abs(polyArea(e.poly)), 0)
    // Σ F_k² = F_n · F_(n+1): 21 × 34 squares of 1.5 m.
    expect(area).toBeCloseTo(21 * 34 * 1.5 * 1.5, 6)
    expect(L.facts.envelopeRatio).toBeCloseTo(34 / 21, 12)
  })

  it('Voronoi: without a joint the cells tile the rectangle exactly; each cell holds its own seed', () => {
    const L = layout(VORONOI as TilingParams)
    expect(L.facts.cellArea).toBeCloseTo(48 * 32, 6)
    expect(L.facts.vanished).toBe(0)
    const again = layout(VORONOI as TilingParams)
    expect(again.elements.map((e) => e.height)).toEqual(L.elements.map((e) => e.height))
  })

  it('Koch snowflake: 4ⁿ triangles, the outline grows by 4/3 a step, the area converges to 8/5', () => {
    const at = (count: number) => layout({ ...KOCH, count, joint: 0 } as TilingParams)
    expect(at(3).elements).toHaveLength(1 + 3 + 12 + 48)
    expect(at(3).facts.perimeter).toBeCloseTo(3 * 36 * (4 / 3) ** 3, 9)
    // A_n / A_0 = 8/5 − 3/5 (4/9)ⁿ
    for (const n of [1, 2, 4]) expect(at(n).facts.areaRatio).toBeCloseTo(8 / 5 - (3 / 5) * (4 / 9) ** n, 9)
    // The triangles really cover that area: Σ of their own polygons.
    const L4 = at(4)
    const sum = L4.elements.reduce((s, e) => s + Math.abs(polyArea(e.poly)), 0)
    expect(sum / ((Math.sqrt(3) / 4) * 36 * 36)).toBeCloseTo(8 / 5 - (3 / 5) * (4 / 9) ** 4, 6)
  })

  it('Random walk: the same seed draws the same walk, and the visits add up to the steps', () => {
    const a = layout(WALK as TilingParams), b = layout(WALK as TilingParams)
    expect(a.order).toEqual(b.order)
    expect(a.elements.reduce((s, e) => s + e.tag, 0)).toBe(501)
    expect(a.facts.expected).toBeCloseTo(Math.sqrt(500) * 1.6, 9)
  })
})

describe('rules 20–24', () => {
  const rules = (params: Record<string, unknown>, mode: 'solid' | 'shell' = 'solid') => checkRules(recipe(params, mode)).map((i) => i.rule)
  it('20: a tiling is built of solids', () => expect(rules(RIEMANN, 'shell')).toEqual([20]))
  it('21: walls as thick as their strip touch', () => expect(rules({ ...RIEMANN, thickness: 2.5 })).toContain(21))
  it('21: columns that fill the cell touch', () => expect(rules({ ...ULAM, fill: 1 })).toContain(21))
  it('21: a joint as wide as the smallest square erases it', () => expect(rules({ ...FIB, joint: 1.5 })).toContain(21))
  it('21: too many walls', () => expect(rules({ ...RIEMANN, count: 121, thickness: 0.2, length: 300 })).toContain(21))
  it('22: a wall 30 m high and 0.5 m thick is slender', () => expect(rules({ ...RIEMANN, thickness: 0.5 })).toContain(22))
  it('23: no passage between walls', () => expect(rules({ ...RIEMANN, thickness: 1.8 })).toContain(23))
  it('21: a joint wider than the smallest teeth erases them', () => expect(rules({ ...KOCH, count: 5, joint: 0.5 })).toContain(21))
  it('the Koch steps slider never offers a step that rule 21 rejects', () => {
    for (const [L, j] of [[36, 0.3], [36, 0], [120, 1], [12, 0.5]] as const) {
      const n = kochMaxSteps(L, j)
      expect(rules({ ...KOCH, length: L, joint: j, count: n })).not.toContain(21)
      if (n < 5) expect(rules({ ...KOCH, length: L, joint: j, count: n + 1 })).toContain(21)
    }
  })
  it('the example dimensions break no rule', () => {
    for (const p of Object.values(ALL)) expect(rules(p)).toEqual([])
  })
})
