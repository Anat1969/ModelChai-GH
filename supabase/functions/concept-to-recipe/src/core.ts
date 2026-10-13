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
      if (!schemaErrors.length && v.ok) return { ok: true, recipe: parsed.value, attempts: attempt, issues, model }
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

const pick = (l: { schemaErrors: SchemaError[]; issues: RuleIssue[] }) => ({ schemaErrors: l.schemaErrors, issues: l.issues })
