import { describe, expect, it } from 'vitest'
import { RULES, checkRules, outerRadius, repairMessage, symmetryOrder, validateRecipe } from '../src/recipe/rules'
import { parseRecipe, type Recipe } from '../src/recipe/schema'
import { fixture } from './helpers'

const parsed = (raw: unknown): Recipe => {
  const r = parseRecipe(raw)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.recipe
}
const ruleIds = (raw: unknown) => checkRules(parsed(raw)).map((i) => i.rule)

describe('rule catalogue', () => {
  // Rules 10–14 belong to the parametric surface (stage 6); the sweep's 1–9 are unchanged.
  it('has rules 1–14 with Hebrew messages, matching RECIPE_SCHEMA.md', () => {
    expect(RULES.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(RULES.filter((r) => r.severity === 'error').map((r) => r.id)).toEqual([1, 2, 3, 7, 9, 10, 11, 12])
    for (const r of RULES) expect(r.message).toMatch(/[֐-׿]/)
  })
})

describe('Stage 0 acceptance', () => {
  it('umbilic torus returns warning 8 and no error', () => {
    const r = validateRecipe(fixture('umbilic-torus'))
    expect(r.ok).toBe(true)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ rule: 8, severity: 'warning', value: 5.7 })
  })

  it('deltoid with turns_per_lap = 0.25 returns error 1', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.twist.turns_per_lap = 0.25
    const r = validateRecipe(raw)
    expect(r.ok).toBe(false)
    expect(r.issues.find((i) => i.rule === 1)).toMatchObject({
      severity: 'error',
      message: 'החתך לא נסגר על עצמו בסוף ההקפה',
      path: 'generator.params.twist.turns_per_lap',
      value: 0.75,
    })
  })

  it('shell mode without shell fails the schema with a clear message', () => {
    const raw = fixture('umbilic-torus')
    delete raw.bare.shell
    const r = validateRecipe(raw)
    expect(r.stage).toBe('schema')
    expect(r.schemaErrors).toContainEqual({ path: 'bare.shell', message: 'shell is required when mode is "shell"' })
  })

  it('hypocycloid without cusps fails the schema with a clear message', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.section.curve = 'hypocycloid'
    const r = validateRecipe(raw)
    expect(r.schemaErrors).toContainEqual({
      path: 'generator.params.section.cusps',
      message: 'cusps is required when curve is "hypocycloid"',
    })
  })
})

describe('rule 1: closure', () => {
  it.each([
    [1 / 3, true],
    [0.3333, true],
    [0, true],
    [2 / 3, true],
    [-1 / 3, true],
    [0.25, false],
    [0.5, false],
  ])('deltoid, turns_per_lap %s → closes: %s', (turns, closes) => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.twist.turns_per_lap = turns
    expect(ruleIds(raw).includes(1)).toBe(!closes)
  })

  it('aspect ≠ 1 lowers the order: square strip closes at half a turn, triangle strip needs a full one', () => {
    const raw = fixture('mobius-strip')
    expect(ruleIds(raw)).not.toContain(1)
    raw.generator.params.section.sides = 3
    expect(ruleIds(raw)).toContain(1)
    raw.generator.params.twist.turns_per_lap = 1
    expect(ruleIds(raw)).not.toContain(1)
  })

  it('open paths are never checked', () => {
    const raw = fixture('golden-ratio')
    raw.generator.params.section = { curve: 'deltoid', a: 1 }
    raw.generator.params.twist.turns_per_lap = 0.25
    expect(ruleIds(raw)).not.toContain(1)
  })

  it('symmetry orders', () => {
    const s = (o: object) => ({ a: 1, aspect: 1, ...o }) as never
    expect(symmetryOrder(s({ curve: 'deltoid' }))).toBe(3)
    expect(symmetryOrder(s({ curve: 'hypocycloid', cusps: 5 }))).toBe(5)
    expect(symmetryOrder(s({ curve: 'polygon', sides: 6 }))).toBe(6)
    expect(symmetryOrder(s({ curve: 'circle' }))).toBe(Infinity)
    expect(symmetryOrder(s({ curve: 'superellipse', exponent: 4 }))).toBe(4)
    expect(symmetryOrder(s({ curve: 'deltoid', aspect: 0.5 }))).toBe(1)
    expect(symmetryOrder(s({ curve: 'polygon', sides: 6, aspect: 0.5 }))).toBe(2)
    expect(symmetryOrder(s({ curve: 'circle', aspect: 0.5 }))).toBe(2)
  })
})

describe('rule 2: ring self-intersection', () => {
  it('R must exceed 3a for a deltoid', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.path.R = 7.2
    expect(ruleIds(raw)).toContain(2)
    raw.generator.params.path.R = 7.3
    expect(ruleIds(raw)).not.toContain(2)
  })

  it('ellipse uses the shorter radius', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.path = { type: 'ellipse', R: 18, R2: 7 }
    expect(ruleIds(raw)).toContain(2)
  })

  it('outer radii', () => {
    const s = (o: object) => ({ a: 2, aspect: 1, ...o }) as never
    expect(outerRadius(s({ curve: 'deltoid' }))).toBe(6)
    expect(outerRadius(s({ curve: 'hypocycloid', cusps: 5 }))).toBe(10)
    expect(outerRadius(s({ curve: 'circle' }))).toBe(2)
    expect(outerRadius(s({ curve: 'superellipse', exponent: 1 }))).toBe(2)
    expect(outerRadius(s({ curve: 'superellipse', exponent: 8 }))).toBeCloseTo(2 * 2 ** 0.375, 9)
  })
})

describe('rules 3–6: shell and floor', () => {
  it('3: thickness must be below a', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.section.a = 1.2
    raw.generator.params.path.R = 12
    raw.bare.shell.thickness = 1.2
    const issues = checkRules(parsed(raw))
    expect(issues.map((i) => i.rule)).toContain(3)
    expect(validateRecipe(raw).ok).toBe(false)
  })

  it('4: thickness above 0.4a warns', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.shell.thickness = 1.0
    expect(ruleIds(raw)).toContain(4)
    raw.bare.shell.thickness = 0.96
    expect(ruleIds(raw)).not.toContain(4)
  })

  it('umbilic shell: floor is continuous and min clear height is 4.65 m', () => {
    // h0 − level = 1.5 < 1.5(2.4 − 0.3) = 3.15; clear = 1.5 + 3.15 − 0 = 4.65 (GENERATORS.md test 4)
    const raw = fixture('umbilic-torus')
    expect(ruleIds(raw)).not.toContain(5)
    expect(ruleIds(raw)).not.toContain(6)
  })

  it('5: floor too low breaks along the lap', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.floor.level = -1.7 // gap 3.2 ≥ 3.15
    expect(ruleIds(raw)).toContain(5)
  })

  it('6: floor too high loses full standing height', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.floor.level = 2.3 // clear 2.35 < 2.4
    expect(ruleIds(raw)).toContain(6)
    raw.bare.floor.level = 2.25 // clear 2.4
    expect(ruleIds(raw)).not.toContain(6)
  })

  it('solid mode skips shell rules', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.mode = 'solid'
    raw.bare.shell.thickness = 1.5
    expect(ruleIds(raw).filter((id) => id >= 3 && id <= 6)).toEqual([])
  })
})

describe('rule 7: passages', () => {
  it('count × width must stay below 0.8 of the perimeter', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.path.R = 8
    raw.generator.params.section.a = 2.4
    raw.bare.openings.passages = { count: 12, width: 3.4 } // 40.8 ≥ 0.8·2π·8 = 40.2
    expect(ruleIds(raw)).toContain(7)
    raw.bare.openings.passages.width = 3.3 // 39.6
    expect(ruleIds(raw)).not.toContain(7)
  })
})

describe('rule 8: cusp burial', () => {
  it('warns above 3 m and not at 3 m', () => {
    const raw = fixture('umbilic-torus')
    raw.bare.section_center_height = 4.2 // 7.2 − 4.2 = 3
    expect(ruleIds(raw)).not.toContain(8)
    raw.bare.section_center_height = 4.1
    expect(ruleIds(raw)).toContain(8)
  })
})

describe('repair message', () => {
  it('follows AI_PROMPT.md section 4', () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.twist.turns_per_lap = 0.25
    const r = validateRecipe(raw)
    expect(repairMessage(r.schemaErrors, r.issues)).toBe(
      [
        'The recipe failed validation. Fix only these problems and answer again with the full recipe:',
        '- 1: החתך לא נסגר על עצמו בסוף ההקפה (current value 0.75, required turns_per_lap × 3 is an integer)',
        'Keep every other field unchanged.',
      ].join('\n'),
    )
  })
})
