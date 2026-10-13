import { describe, expect, it } from 'vitest'
import { parseRecipe } from '../src/recipe/schema'
import { validateRecipe } from '../src/recipe/rules'
import { FIXTURE_NAMES, fixture, jsonSchemaValid } from './helpers'

describe('Stage 0: the three fixtures pass the contract', () => {
  it.each(FIXTURE_NAMES)('%s passes JSON Schema', (name) => {
    const r = jsonSchemaValid(fixture(name))
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it.each(FIXTURE_NAMES)('%s passes zod', (name) => {
    const r = parseRecipe(fixture(name))
    expect(r.ok ? [] : r.errors).toEqual([])
  })

  it.each(FIXTURE_NAMES)('%s has no semantic errors', (name) => {
    const r = validateRecipe(fixture(name))
    expect(r.ok).toBe(true)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('zod fills schema defaults', () => {
    const r = parseRecipe(fixture('mobius-strip'))
    if (!r.ok) throw new Error('expected ok')
    expect(r.recipe.realistic.camera.fov_deg).toBe(42)
    const g = r.recipe.generator
    if (g.type !== 'sweep') throw new Error('expected sweep')
    expect(g.params.twist.initial_angle_deg).toBe(0)
    expect(g.params.section.aspect).toBe(0.08)
  })
})
