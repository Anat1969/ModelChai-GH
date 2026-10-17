/**
 * Claude as a partner (DECISIONS.md 101): concepts for a need, a concept explored, and the exhibition article
 * written from the project's materials. The key stays on the server; the indicator shows every call.
 */
import { MODELS } from '../learn/atlas'
import { withClaude } from './claudeActivity'
import { ensureSession } from './supabase'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase'

const ATLAS = MODELS.map((m) => ({ id: m.id, name: m.name, name_he: m.name_he, traits: m.traits }))

export interface Suggestion {
  name_he: string
  name: string
  atlas_id: string | null
  why: string
  experience: string
  limits: string
  buildable: 'full' | 'partial' | 'none'
}
export interface SuggestResult {
  understanding: string
  suggestions: Suggestion[]
  alternatives: { name_he: string; name: string; why: string }[]
  knowledge: { title: string; text: string }[]
  statement: string
}
export interface ExploreResult {
  summary: string
  dna: string[]
  uses: { use: string; why: string; how: string }[]
  limits: string[]
  connections: { title: string; text: string }[]
  questions: string[]
}
export type ArticleKey = 'concept' | 'knowledge' | 'context' | 'inspiration' | 'image' | 'model' | 'environment' | 'production' | 'result' | 'closing'

export type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string }

async function call<T>(label: string, body: Record<string, unknown>): Promise<Outcome<T>> {
  return withClaude(
    label,
    async () => {
      const s = await ensureSession()
      if (s.status !== 'signed-in') return { ok: false as const, error: 'החיבור לחשבון עוד לא מוכן. אפשר לנסות שוב בעוד רגע.' }
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/concept-partner`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s.token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, atlas: ATLAS }),
        })
        const out = await res.json().catch(() => null)
        if (!res.ok || !out?.ok) return { ok: false as const, error: out?.error ?? `השרת החזיר שגיאה ${res.status}. אפשר לנסות שוב.` }
        return out as { ok: true } & T
      } catch (e) {
        return { ok: false as const, error: `לא הצלחנו להגיע לשרת (${String(e)}). כדאי לבדוק את החיבור ולנסות שוב.` }
      }
    },
    (r) => (r.ok ? { ok: true } : { ok: false, error: r.error }),
  )
}

export const suggestConcepts = (need: { use?: string; place?: string; idea?: string; intent?: string; inspiration?: string; images?: string[] }, chosen?: { name: string; name_he?: string } | null) =>
  call<SuggestResult>('Claude מציע מושגים', { mode: 'suggest', need, chosen: chosen ?? null })

export const exploreConcept = (concept: { name: string; name_he?: string; plain?: string; dna?: string[] }, context?: string) =>
  call<ExploreResult>('Claude חוקר את המושג', { mode: 'explore', concept, context })

export const draftArticle = (materials: Partial<Record<ArticleKey, string>>, title?: string) =>
  call<{ [K in ArticleKey]: string }>('Claude כותב את המאמר', { mode: 'article', materials, title })
