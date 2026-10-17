/**
 * Client for the concept-to-recipe Edge Function. The function streams NDJSON: progress lines while Claude
 * works, then one result line. Cancel with the AbortSignal.
 */
import { withClaude } from './claudeActivity'
import type { RuleIssue } from '../recipe/rules'
import type { SchemaError } from '../recipe/schema'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase'

export interface ConceptRequest {
  concept: string
  use?: string
  context?: string
}

export type ConceptProgress =
  | { type: 'progress'; stage: 'calling' | 'validating'; attempt: number }
  | { type: 'progress'; stage: 'repairing'; attempt: number; problems: string[] }

export type ConceptOutcome =
  | { type: 'result'; ok: true; recipe: unknown; attempts: number; issues: RuleIssue[]; durationMs: number; model: string }
  | {
      type: 'result'
      ok: false
      kind: 'invalid' | 'refusal' | 'truncated' | 'upstream' | 'http'
      error: string
      lastRecipe?: unknown
      schemaErrors: SchemaError[]
      issues: RuleIssue[]
      attempts: number
      status?: number
    }

export function requestRecipe(
  req: ConceptRequest,
  token: string,
  opts: { signal?: AbortSignal; onProgress?: (p: ConceptProgress) => void } = {},
): Promise<ConceptOutcome> {
  return withClaude('Claude מתרגם את המושג למתכון', () => requestRecipeRaw(req, token, opts), (r) => (r.ok ? { ok: true } : { ok: false, error: r.error }))
}

async function requestRecipeRaw(
  req: ConceptRequest,
  token: string,
  opts: { signal?: AbortSignal; onProgress?: (p: ConceptProgress) => void } = {},
): Promise<ConceptOutcome> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/concept-to-recipe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    return {
      type: 'result',
      ok: false,
      kind: 'http',
      status: res.status,
      error: body?.error ?? body?.message ?? `השרת החזיר שגיאה ${res.status}`,
      schemaErrors: [],
      issues: [],
      attempts: 0,
    }
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line) as ConceptProgress | ConceptOutcome
      if (msg.type === 'progress') opts.onProgress?.(msg)
      else return msg
    }
    if (done) break
  }
  return { type: 'result', ok: false, kind: 'upstream', error: 'החיבור לשרת נקטע לפני שהתקבל מתכון. אפשר לנסות שוב.', schemaErrors: [], issues: [], attempts: 0 }
}
