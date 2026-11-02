import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/learn/atlas'
import { buildBridge, conceptsForModel, type MusagConcept } from '../src/learn/bridge'

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

  it('every model "מושג מתמטי" links to exists in the atlas', () => {
    const ids = new Set(MODELS.map((m) => m.id))
    for (const id of ['golden_spiral', 'fibonacci', 'mobius', 'riemann', 'klein']) expect(ids.has(id)).toBe(true)
  })
})
