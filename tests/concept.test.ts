/**
 * The concept-to-recipe loop (AI_PROMPT.md 4) against a scripted model. These test the code paths: repair
 * messages, the two-round limit, refusals. The real model is tested by tests/e2e/concepts.integration.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import recipeSchema from '../docs/schema/recipe.schema.json'
import { parseRecipe } from '../src/recipe/schema'
import {
  conceptToRecipe,
  jerusalemTimestamp,
  systemPrompt,
  userMessage,
  type ModelReply,
  type Progress,
  type Turn,
} from '../supabase/functions/concept-to-recipe/src/core'
import { MAX_OPTIONAL, countOptional, modelSchema } from '../supabase/functions/concept-to-recipe/src/modelSchema'
import { FIXTURE_NAMES, fixture } from './helpers'

const input = { concept: 'Umbilic torus', use: 'ביתן ציבורי', context: 'חוף ים', generators: ['sweep'] }
const now = () => new Date('2026-10-13T09:00:00Z')

function scripted(replies: (unknown | { refusal: true } | { raw: string })[]) {
  const seen: Turn[][] = []
  let i = 0
  const call = async (turns: Turn[]): Promise<ModelReply> => {
    seen.push(structuredClone(turns))
    const r = replies[i++]
    if (r && typeof r === 'object' && 'refusal' in r) return { text: '', content: [], stopReason: 'refusal', model: 'm' }
    const text = r && typeof r === 'object' && 'raw' in r ? (r as { raw: string }).raw : JSON.stringify(r)
    return { text, content: [{ type: 'text', text }], stopReason: 'end_turn', model: 'm' }
  }
  return { call, seen, count: () => i }
}

const broken = (mutate: (r: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = fixture('umbilic-torus')
  mutate(r)
  return r
}

describe('conceptToRecipe', () => {
  it('a valid first answer is accepted in one call', async () => {
    const m = scripted([fixture('umbilic-torus')])
    const progress: Progress[] = []
    const r = await conceptToRecipe(input, { call: m.call, now, onProgress: (p) => progress.push(p) })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(1)
    expect(m.count()).toBe(1)
    expect(r.ok && r.issues.map((i) => i.rule)).toEqual([8])
    expect(progress.map((p) => p.stage)).toEqual(['calling', 'validating'])
  })

  it('a rule error is sent back in the AI_PROMPT.md 4 format, and the repair is accepted', async () => {
    const m = scripted([broken((r) => (r.generator.params.twist.turns_per_lap = 0.25)), fixture('umbilic-torus')])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    const second = m.seen[1]!
    expect(second.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    // The assistant turn goes back exactly as the API returned it (append-only history).
    expect(Array.isArray(second[1]!.content)).toBe(true)
    expect(second[2]!.content).toContain('The recipe failed validation. Fix only these problems and answer again with the full recipe:')
    expect(second[2]!.content).toContain('- 1: החתך לא נסגר על עצמו בסוף ההקפה (current value 0.75, required turns_per_lap × 3 is an integer)')
    expect(second[2]!.content).toContain('Keep every other field unchanged.')
  })

  it('a schema error names the field', async () => {
    const m = scripted([broken((r) => delete r.bare.shell), fixture('umbilic-torus')])
    await conceptToRecipe(input, { call: m.call, now })
    expect(m.seen[1]![2]!.content).toContain('- bare.shell: shell is required when mode is "shell"')
  })

  it('stops after two repair rounds and returns the last recipe with its problems', async () => {
    const bad = broken((r) => (r.generator.params.path.R = 6))
    const m = scripted([bad, bad, bad, fixture('umbilic-torus')])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(m.count()).toBe(3)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('invalid')
    expect(r.attempts).toBe(3)
    expect(r.lastRecipe).toEqual(bad)
    expect(r.issues.some((i) => i.rule === 2 && i.severity === 'error')).toBe(true)
    expect(r.error).toMatch(/[֐-׿]/)
  })

  it('reads JSON wrapped in a fence, for the fallback without structured outputs', async () => {
    const m = scripted([{ raw: 'Here:\n```json\n' + JSON.stringify(fixture('mobius-strip')) + '\n```' }])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(r.ok).toBe(true)
  })

  it('text that is not JSON goes to repair as a root error', async () => {
    const m = scripted([{ raw: 'no recipe here' }, fixture('golden-ratio')])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(r.ok).toBe(true)
    expect(m.seen[1]![2]!.content).toContain('- (root): the answer is not a JSON object')
  })

  it('a generator that is not offered is rejected', async () => {
    const m = scripted([broken((r) => (r.generator = { type: 'tiling', params: {} })), fixture('umbilic-torus')])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(r.attempts).toBe(2)
    expect(m.seen[1]![2]!.content).toContain('generator.type')
  })

  it('a refusal ends the run without repair', async () => {
    const m = scripted([{ refusal: true }])
    const r = await conceptToRecipe(input, { call: m.call, now })
    expect(m.count()).toBe(1)
    expect(!r.ok && r.kind).toBe('refusal')
  })
})

describe('prompt', () => {
  it('user message follows AI_PROMPT.md 3, with the Jerusalem offset', () => {
    expect(userMessage(input, jerusalemTimestamp(now()))).toBe(
      ['Concept: Umbilic torus', 'Use: ביתן ציבורי', 'Context hint: חוף ים', 'Available generators: ["sweep"]', 'Timestamp: 2026-10-13T12:00:00+03:00'].join('\n'),
    )
    expect(jerusalemTimestamp(new Date('2026-12-21T10:00:00Z'))).toBe('2026-12-21T12:00:00+02:00')
    expect(userMessage({ concept: 'x', generators: ['sweep'] }, 't')).toContain('Use: not specified')
  })

  it('system prompt carries the three fixtures and no placeholder', () => {
    const template = readFileSync('supabase/functions/concept-to-recipe/system.md', 'utf8')
    const s = systemPrompt(template, FIXTURE_NAMES.map(fixture))
    expect(s).not.toContain('{{FIXTURES}}')
    for (const id of ['umbilic-torus-pavilion', 'mobius-ribbon-bridge', 'golden-ratio-helix-tower']) expect(s).toContain(id)
  })
})

describe('structured-output schema', () => {
  const s = modelSchema(recipeSchema as Record<string, unknown>, ['sweep'])
  const walk = (n: unknown, f: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(n)) n.forEach((x) => walk(x, f))
    else if (n && typeof n === 'object') {
      f(n as Record<string, unknown>)
      Object.values(n).forEach((x) => walk(x, f))
    }
  }

  it('uses only keywords the compiler supports', () => {
    const banned = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'if', 'then', 'uniqueItems', 'default', '$schema', '$id']
    walk(s, (o) => {
      for (const k of banned) expect(Object.keys(o)).not.toContain(k)
      if (Array.isArray(o.type)) throw new Error('type arrays must become anyOf')
      if (o.type === 'object' && o.properties) expect(o.additionalProperties).toBe(false)
      // Every schema node needs a type unless it is a combinator or a reference.
      const isSchemaNode = 'enum' in o || 'const' in o || 'properties' in o || 'items' in o
      if (isSchemaNode && !o.anyOf && !o.allOf && !o.$ref) expect(o.type, JSON.stringify(o)).toBeDefined()
    })
  })

  it('stays within the API limit of optional fields (it rejected 29 against a limit of 24)', () => {
    expect(countOptional(recipeSchema)).toBeGreaterThan(MAX_OPTIONAL)
    expect(countOptional(s)).toBeLessThanOrEqual(MAX_OPTIONAL)
  })

  it('narrows the generator to the sweep and accepts complete recipes', () => {
    const ajv = new Ajv2020({ strict: false })
    addFormats(ajv)
    const v = ajv.compile(s)
    // The model writes every field it can know; fixtures that lean on defaults get those filled in here.
    const complete = (name: (typeof FIXTURE_NAMES)[number]) => {
      const r = fixture(name)
      delete r.generator.params.resolution
      r.meta.notes ??= 'note'
      r.bare.highlight ??= ['edges']
      r.generator.params.section.aspect ??= 1
      r.generator.params.twist.initial_angle_deg ??= 0
      if (r.bare.floor) r.bare.floor.level ??= 0
      return r
    }
    for (const name of FIXTURE_NAMES) expect(v(complete(name)), `${name}: ${JSON.stringify(v.errors)}`).toBe(true)
    // Whatever the model writes against this schema still passes the app's own contract.
    for (const name of FIXTURE_NAMES) expect(parseRecipe(complete(name)).ok).toBe(true)
    const bad = fixture('umbilic-torus')
    bad.generator.type = 'tiling'
    expect(v(bad)).toBe(false)
  })
})

describe('the key stays on the server', () => {
  it('no file in the client source mentions ANTHROPIC_API_KEY', () => {
    const files: string[] = []
    const walkDir = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walkDir(p)
        else files.push(p)
      }
    }
    walkDir('src')
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/ANTHROPIC_API_KEY|sk-ant-/)
  })
})
