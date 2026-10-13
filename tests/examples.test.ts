/**
 * The examples in docs/examples: each arrives in its ideal state (DECISIONS.md 83). It passes the contract, builds,
 * and breaks no rule at all, not even a warning: balanced proportions at human scale.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from '../src/engine/build'
import { validateRecipe } from '../src/recipe/rules'
import { jsonSchemaValid } from './helpers'

const dir = fileURLToPath(new URL('../docs/examples/', import.meta.url))
const examples = readdirSync(dir)
  .filter((f) => f.endsWith('.recipe.json'))
  .map((f) => [f, JSON.parse(readFileSync(dir + f, 'utf8'))] as const)

describe('examples arrive in their ideal state', () => {
  it('there are at least five', () => expect(examples.length).toBeGreaterThanOrEqual(5))
  it.each(examples)('%s passes JSON Schema and zod, with no rule broken', (_f, r) => {
    expect(jsonSchemaValid(r).errors).toEqual([])
    const v = validateRecipe(r)
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
  })
  it.each(examples)('%s builds, at human scale', (_f, r) => {
    const out = build(r, { pathSegments: 180, sectionSegments: 96 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const m = out.metrics
    if (r.bare.mode === 'shell') {
      // Enterable: a continuous floor at least 1.2 m wide, and at least 2.4 m to stand under.
      expect(m.floorContinuous).toBe(true)
      expect(m.floorWidth!.min).toBeGreaterThanOrEqual(1.2)
      expect(m.clearHeight!.min).toBeGreaterThanOrEqual(2.4)
    }
    expect(m.cuspBurial).toBeLessThanOrEqual(3)
    console.log(_f, JSON.stringify({ outer: m.outerDiameter, court: m.courtyardDiameter, clear: m.clearHeight, floor: m.floorWidth, cont: m.floorContinuous, edges: m.edgeCount, vol: Math.round(m.volume) }))
  })
})
