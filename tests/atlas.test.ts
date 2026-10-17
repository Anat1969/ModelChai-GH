/** The concept atlas: every model is drawn from its equation, and its uses follow from its traits, with reasons. */
import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../src/data/examples'
import { MODELS, modelsForUse, withUses } from '../src/learn/atlas'
import { FIGURES } from '../src/learn/figures'
import { fitUse, TRAITS, USES, usesFor } from '../src/learn/traits'

describe('atlas', () => {
  it('has at least twenty models, each fully described', () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length)
    for (const m of MODELS) {
      expect(m.plain.length, m.id).toBeGreaterThan(40)
      expect(m.dna.length, m.id).toBeGreaterThanOrEqual(3)
      expect(m.flow && m.program && m.ask, m.id).toBeTruthy()
      expect(m.limits.length, m.id).toBeGreaterThanOrEqual(1)
      for (const t of m.traits) expect(TRAITS[t], `${m.id}:${t}`).toBeDefined()
    }
  })

  it('draws every model from its equation, inside the box', () => {
    for (const m of MODELS) {
      const f = FIGURES[m.id]
      expect(f, m.id).toBeDefined()
      const lines = f!().lines
      expect(lines.some((l) => l.role === 'main'), m.id).toBe(true)
      for (const p of lines.flatMap((l) => l.pts)) {
        expect(p[0]).toBeGreaterThanOrEqual(0)
        expect(p[0]).toBeLessThanOrEqual(240)
        expect(p[1]).toBeGreaterThanOrEqual(0)
        expect(p[1]).toBeLessThanOrEqual(160)
        expect(Number.isFinite(p[0] + p[1])).toBe(true)
      }
    }
  })

  it('recommends uses only with a reason that comes from a trait the model has', () => {
    for (const m of MODELS) {
      const uses = withUses(m).uses
      expect(uses.length, m.id).toBeGreaterThan(0)
      for (const u of uses) {
        expect(u.reasons.length).toBeGreaterThan(0)
        for (const r of u.reasons) expect(m.traits).toContain(r.trait.id)
      }
    }
  })

  it('reads the reasoning for a gateway: an open path fits, a closed loop works against it', () => {
    const fit = fitUse(['open_path', 'closed_loop', 'cusps'], USES.gateway)
    expect(fit.score).toBe(3 - 1 + 2)
    expect(fit.reasons.map((r) => r.trait.id)).toEqual(['open_path', 'cusps'])
    expect(fit.against.map((r) => r.trait.id)).toEqual(['closed_loop'])
    expect(usesFor([])).toEqual([])
  })

  it('ranks models for a need, best first', () => {
    const towers = modelsForUse('tower')
    expect(towers[0]!.fit.score).toBeGreaterThanOrEqual(towers.at(-1)!.fit.score)
    expect(towers.map((t) => t.model.id)).toContain('hyperboloid')
    expect(modelsForUse('gateway').map((t) => t.model.id)).toContain('catenary')
  })

  it('links buildable models to a ready example', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id))
    for (const m of MODELS.filter((x) => x.fit.example)) expect(ids.has(m.fit.example!), m.id).toBe(true)
    expect(MODELS.filter((m) => m.fit.level === 'full').length).toBeGreaterThanOrEqual(5)
  })
})
