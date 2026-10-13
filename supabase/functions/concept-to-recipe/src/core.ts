/**
 * Concept to recipe (AI_PROMPT.md): one call to Claude, validation against the schema and the hard semantic
 * rules, and up to two repair rounds in the same conversation. Pure: the model call is injected, so the loop
 * is tested without the network, and the Edge Function supplies the real call.
 */
import { repairMessage, validateRecipe, type RuleIssue } from '../../../../src/recipe/rules'
import type { SchemaError } from '../../../../src/recipe/schema'

export const MAX_REPAIRS = 2

export interface ConceptInput {
  concept: string
  use?: string
  context?: string
  generators: string[]
}

/** A turn in the conversation; assistant content is passed back exactly as the API returned it. */
export interface Turn {
  role: 'user' | 'assistant'
  content: string | unknown[]
}

export interface ModelReply {
  /** The text of the answer: the recipe JSON. */
  text: string
  /** The full content blocks, appended to the conversation unchanged for the repair round. */
  content: unknown[]
  stopReason: string
  model: string
}

export type ModelCall = (turns: Turn[]) => Promise<ModelReply>

export type Progress =
  | { type: 'progress'; stage: 'calling'; attempt: number }
  | { type: 'progress'; stage: 'validating'; attempt: number }
  | { type: 'progress'; stage: 'repairing'; attempt: number; problems: string[] }

export type ConceptResult =
  | { ok: true; recipe: unknown; attempts: number; issues: RuleIssue[]; model: string }
  | {
      ok: false
      /** Hebrew, for the user. */
      error: string
      kind: 'invalid' | 'refusal' | 'truncated'
      lastRecipe: unknown
      schemaErrors: SchemaError[]
      issues: RuleIssue[]
      attempts: number
      model: string
    }

export function userMessage(input: ConceptInput, timestamp: string): string {
  return [
    `Concept: ${input.concept}`,
    `Use: ${input.use?.trim() || 'not specified'}`,
    `Context hint: ${input.context?.trim() || 'not specified'}`,
    `Available generators: ${JSON.stringify(input.generators)}`,
    `Timestamp: ${timestamp}`,
  ].join('\n')
}

/** Builds the system prompt: the instructions with the three fixtures appended (AI_PROMPT.md 1). */
export function systemPrompt(template: string, fixtures: unknown[]): string {
  const block = fixtures.map((f) => '```json\n' + JSON.stringify(f, null, 2) + '\n```').join('\n\n')
  return template.replace('{{FIXTURES}}', block)
}

/** ISO 8601 with the Asia/Jerusalem offset, as AI_PROMPT.md 3 asks. */
export function jerusalemTimestamp(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'longOffset',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  const offset = (parts.timeZoneName ?? 'GMT+02:00').replace('GMT', '') || '+00:00'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

function parse(text: string): { value: unknown; error?: SchemaError } {
  try {
    return { value: JSON.parse(text) }
  } catch {
    // Without structured outputs the model may wrap the JSON in a fence; take the outermost object.
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return { value: JSON.parse(text.slice(a, b + 1)) }
      } catch {
        /* fall through */
      }
    }
    return { value: null, error: { path: '(root)', message: 'the answer is not a JSON object' } }
  }
}

export async function conceptToRecipe(
  input: ConceptInput,
  deps: { call: ModelCall; now: () => Date; onProgress?: (p: Progress) => void },
): Promise<ConceptResult> {
  const turns: Turn[] = [{ role: 'user', content: userMessage(input, jerusalemTimestamp(deps.now())) }]
  let last: { recipe: unknown; schemaErrors: SchemaError[]; issues: RuleIssue[] } = { recipe: null, schemaErrors: [], issues: [] }
  let model = ''

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
    deps.onProgress?.({ type: 'progress', stage: 'calling', attempt })
    const reply = await deps.call(turns)
    model = reply.model
    if (reply.stopReason === 'refusal') {
      return { ok: false, kind: 'refusal', error: 'Claude סירב לתרגם את המושג הזה. אפשר לנסח אותו אחרת.', lastRecipe: last.recipe, ...pick(last), attempts: attempt, model }
    }
    if (reply.stopReason === 'max_tokens') {
      return { ok: false, kind: 'truncated', error: 'התשובה נקטעה לפני שהמתכון הושלם. אפשר לנסות שוב.', lastRecipe: last.recipe, ...pick(last), attempts: attempt, model }
    }

    deps.onProgress?.({ type: 'progress', stage: 'validating', attempt })
    const parsed = parse(reply.text)
    let schemaErrors: SchemaError[] = parsed.error ? [parsed.error] : []
    let issues: RuleIssue[] = []
    if (!parsed.error) {
      const v = validateRecipe(parsed.value)
      schemaErrors = v.schemaErrors
      issues = v.issues
      const g = (parsed.value as { generator?: { type?: string } }).generator?.type
      if (v.stage === 'rules' && g && !input.generators.includes(g)) {
        schemaErrors = [{ path: 'generator.type', message: `"${g}" is not available; use one of ${JSON.stringify(input.generators)}` }]
      }
      if (!schemaErrors.length && v.ok) {
        const first = { ok: true as const, recipe: parsed.value, attempts: attempt, issues, model }
        // The ideal state (DECISIONS.md 83): a recipe that builds but misses a human-scale rule gets one polish.
        const soft = issues.filter((i) => i.severity === 'warning' && POLISH_RULES.includes(i.rule))
        if (!soft.length || attempt > MAX_REPAIRS) return first
        deps.onProgress?.({ type: 'progress', stage: 'repairing', attempt, problems: soft.map((i) => `rule ${i.rule}`) })
        deps.onProgress?.({ type: 'progress', stage: 'calling', attempt: attempt + 1 })
        const polished = await deps.call([...turns, { role: 'assistant', content: reply.content }, { role: 'user', content: polishMessage(soft) }])
        if (polished.stopReason !== 'end_turn') return first
        deps.onProgress?.({ type: 'progress', stage: 'validating', attempt: attempt + 1 })
        const pp = parse(polished.text)
        if (pp.error) return first
        const pv = validateRecipe(pp.value)
        const stillSoft = pv.issues.filter((i) => i.severity === 'warning' && POLISH_RULES.includes(i.rule)).length
        if (!pv.ok || stillSoft >= soft.length) return first
        return { ok: true, recipe: pp.value, attempts: attempt + 1, issues: pv.issues, model: polished.model }
      }
    }
    last = { recipe: parsed.value, schemaErrors, issues }
    if (attempt > MAX_REPAIRS) break

    const message = repairMessage(schemaErrors, issues)
    deps.onProgress?.({
      type: 'progress',
      stage: 'repairing',
      attempt,
      problems: [...schemaErrors.map((e) => e.path), ...issues.filter((i) => i.severity === 'error').map((i) => `rule ${i.rule}`)],
    })
    turns.push({ role: 'assistant', content: reply.content }, { role: 'user', content: message })
  }

  return {
    ok: false,
    kind: 'invalid',
    error: 'המתכון עדיין לא תקין אחרי שני סבבי תיקון. אפשר לערוך אותו ידנית או לנסות שוב.',
    lastRecipe: last.recipe,
    ...pick(last),
    attempts: MAX_REPAIRS + 1,
    model,
  }
}

/**
 * Human-scale rules worth one more round: wall thickness (4), a continuous floor (5), full standing height (6).
 * Rule 8, cusp burial, is a design choice with a cost (the reference model buries its cusp 5.7 m), so it stays
 * a warning and is never polished away.
 */
export const POLISH_RULES = [4, 5, 6]

export function polishMessage(soft: RuleIssue[]): string {
  return [
    'The recipe builds, but it is not yet in its ideal default state. These human-scale rules are not met:',
    ...soft.map((i) => `- ${i.rule}: ${i.message} (current value ${i.value}, required ${i.required})`),
    'Adjust only what is needed to meet them, keep the concept and its proportions, and answer again with the full recipe.',
  ].join('\n')
}

const pick = (l: { schemaErrors: SchemaError[]; issues: RuleIssue[] }) => ({ schemaErrors: l.schemaErrors, issues: l.issues })
