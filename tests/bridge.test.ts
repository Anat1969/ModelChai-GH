import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/learn/atlas'
import { readFileSync } from 'node:fs'
import { buildBridge, conceptsForModel, CONTEXT_LIMIT, verifiedContext, type MusagConcept } from '../src/learn/bridge'

describe('bridge to "מושג מתמטי" (DECISIONS.md 143)', () => {
  const b = buildBridge()

  it('publishes every atlas model, with a link that opens it', () => {
    expect(b.models).toHaveLength(MODELS.length)
    for (const m of b.models) expect(m.url).toBe(`https://math-creator.vercel.app/#/learn?m=${m.id}`)
  })

  it('carries the traits in words, never bare ids', () => {
    const mobius = b.models.find((m) => m.id === 'mobius')!
    expect(mobius.traits.map((t) => t.id)).toEqual(['one_sided', 'single_edge', 'twist', 'closed_loop'])
    for (const t of mobius.traits) expect(t.label.length).toBeGreaterThan(2)
    expect(mobius.fit).toEqual({ level: 'partial', word: 'נבנה בקירוב', note: expect.any(String) })
  })

  it('finds the concepts that link to a model, the same concept first', () => {
    const concept = (slug: string, models: MusagConcept['models']) => ({ slug, models }) as MusagConcept
    const list = [concept('golden-ratio', [{ id: 'golden_spiral', relation: 'near', why: 'φ' }]), concept('spiral', [{ id: 'golden_spiral', relation: 'same', why: 'x' }])]
    expect(conceptsForModel(list, 'golden_spiral').map((x) => x.concept.slug)).toEqual(['spiral', 'golden-ratio'])
    expect(conceptsForModel(list, 'klein')).toEqual([])
  })

  const recorded = JSON.parse(readFileSync(new URL('./e2e/recorded/musag-bridge.json', import.meta.url), 'utf8')).concepts as MusagConcept[]

  it('every model "מושג מתמטי" links to exists in the atlas', () => {
    const ids = new Set(MODELS.map((m) => m.id))
    const linked = recorded.flatMap((c) => c.models.map((l) => l.id))
    expect(linked.length).toBeGreaterThanOrEqual(7)
    for (const id of linked) expect(ids.has(id), id).toBe(true)
  })

  it('every concept there has a body here: no concept is left without a model', () => {
    for (const c of recorded) expect(c.models.length, c.slug).toBeGreaterThan(0)
  })

  it('gives Claude the checked precedent, inside the server limit (DECISIONS.md 144)', () => {
    for (const m of MODELS) {
      const ctx = verifiedContext(conceptsForModel(recorded, m.id))
      if (!ctx) continue
      expect(ctx.length, m.id).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(ctx, m.id).toContain('Precedent:')
    }
    expect(verifiedContext(conceptsForModel(recorded, 'mobius'))).toContain('Möbius House, Het Gooi')
    expect(verifiedContext(conceptsForModel(recorded, 'umbilic_torus'))).toBeUndefined()
  })
})
