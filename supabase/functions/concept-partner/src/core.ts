/**
 * The pure part of concept-partner (DECISIONS.md 101): what Claude is told in each mode, and how its answer is
 * read and checked. No network, no Deno: tested in node (tests/partner.test.ts).
 */

export type Mode = 'suggest' | 'explore' | 'article'

export interface AtlasEntry {
  id: string
  name: string
  name_he: string
  traits: string[]
}

export interface SuggestInput {
  need: { use?: string; place?: string; idea?: string; intent?: string; inspiration?: string; images?: string[] }
  chosen?: { name: string; name_he?: string } | null
  atlas: AtlasEntry[]
}

export interface ExploreInput {
  concept: { name: string; name_he?: string; plain?: string; dna?: string[] }
  context?: string
  atlas: AtlasEntry[]
}

export const ARTICLE_KEYS = ['concept', 'knowledge', 'context', 'inspiration', 'image', 'model', 'environment', 'production', 'result', 'closing'] as const
export type ArticleKey = (typeof ARTICLE_KEYS)[number]

export interface ArticleInput {
  materials: Partial<Record<ArticleKey, string>>
  title?: string
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')
const atlasText = (a: AtlasEntry[]) => a.map((m) => `- ${m.id}: ${m.name_he} (${m.name}); traits: ${m.traits.join(', ')}`).join('\n')

export function suggestMessage(i: SuggestInput): string {
  const n = i.need
  const lines = [
    'MODE: suggest',
    `Use: ${clip(n.use, 200) || '(not given)'}`,
    `Place: ${clip(n.place, 200) || '(not given)'}`,
    `Idea: ${clip(n.idea, 1200) || '(not given)'}`,
    `Intent: ${clip(n.intent, 800) || '(not given)'}`,
    `Inspiration: ${clip(n.inspiration, 1200) || '(not given)'}`,
    `Inspiration images attached: ${n.images?.length ?? 0}`,
    `Chosen concept: ${i.chosen ? `${i.chosen.name_he ?? ''} (${i.chosen.name})` : '(none yet)'}`,
    `Atlas:\n${atlasText(i.atlas)}`,
  ]
  return lines.join('\n')
}

export function exploreMessage(i: ExploreInput): string {
  const c = i.concept
  return [
    'MODE: explore',
    `Concept: ${clip(c.name_he, 120)} (${clip(c.name, 120)})`,
    c.plain ? `Atlas entry: ${clip(c.plain, 800)}` : '',
    c.dna?.length ? `Atlas DNA: ${c.dna.map((d) => clip(d, 200)).join(' | ')}` : '',
    `Context: ${clip(i.context, 600) || '(not given)'}`,
    `Atlas:\n${atlasText(i.atlas)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function articleMessage(i: ArticleInput): string {
  const parts = ARTICLE_KEYS.filter((k) => k !== 'closing').map((k) => `## ${k}\n${clip(i.materials[k], 4000) || '(empty)'}`)
  return [`Project title: ${clip(i.title, 120) || '(none)'}`, ...parts, 'Write the article now. Output: one JSON object and nothing else.'].join('\n\n')
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

function readJson(text: string): Record<string, unknown> | string {
  const start = text.indexOf('{'),
    end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return 'no JSON object in the reply'
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return 'the reply is not valid JSON'
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max && !EMOJI.test(v) ? v.trim() : null)

export interface Suggestion {
  name_he: string
  name: string
  atlas_id: string | null
  why: string
  experience: string
  limits: string
  buildable: 'full' | 'partial' | 'none'
}
export interface SuggestOutput {
  understanding: string
  suggestions: Suggestion[]
  alternatives: { name_he: string; name: string; why: string }[]
  knowledge: { title: string; text: string }[]
  statement: string
}

export function parseSuggest(text: string, atlasIds: string[]): { ok: true; out: SuggestOutput } | { ok: false; error: string } {
  const o = readJson(text)
  if (typeof o === 'string') return { ok: false, error: o }
  const understanding = str(o.understanding, 800)
  if (!understanding) return { ok: false, error: 'understanding is missing' }
  const sugg = Array.isArray(o.suggestions) ? o.suggestions : []
  const suggestions: Suggestion[] = []
  for (const s of sugg.slice(0, 5) as Record<string, unknown>[]) {
    const name_he = str(s.name_he, 120),
      name = str(s.name, 120),
      why = str(s.why, 900)
    if (!name_he || !name || !why) continue
    const id = typeof s.atlas_id === 'string' && atlasIds.includes(s.atlas_id) ? s.atlas_id : null
    const b = s.buildable === 'full' || s.buildable === 'partial' ? s.buildable : 'none'
    suggestions.push({ name_he, name, atlas_id: id, why, experience: str(s.experience, 500) ?? '', limits: str(s.limits, 500) ?? '', buildable: b })
  }
  if (!suggestions.length) return { ok: false, error: 'no suggestions' }
  const alternatives = (Array.isArray(o.alternatives) ? o.alternatives : [])
    .slice(0, 4)
    .map((a: Record<string, unknown>) => ({ name_he: str(a.name_he, 120), name: str(a.name, 120), why: str(a.why, 600) }))
    .filter((a): a is { name_he: string; name: string; why: string } => !!(a.name_he && a.name && a.why))
  const knowledge = (Array.isArray(o.knowledge) ? o.knowledge : [])
    .slice(0, 4)
    .map((k: Record<string, unknown>) => ({ title: str(k.title, 160), text: str(k.text, 900) }))
    .filter((k): k is { title: string; text: string } => !!(k.title && k.text))
  return { ok: true, out: { understanding, suggestions, alternatives, knowledge, statement: str(o.statement, 1200) ?? '' } }
}

export interface ExploreOutput {
  summary: string
  dna: string[]
  uses: { use: string; why: string; how: string }[]
  limits: string[]
  connections: { title: string; text: string }[]
  questions: string[]
}

export function parseExplore(text: string): { ok: true; out: ExploreOutput } | { ok: false; error: string } {
  const o = readJson(text)
  if (typeof o === 'string') return { ok: false, error: o }
  const summary = str(o.summary, 900)
  if (!summary) return { ok: false, error: 'summary is missing' }
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, n) : [])
  const uses = (Array.isArray(o.uses) ? o.uses : [])
    .slice(0, 5)
    .map((u: Record<string, unknown>) => ({ use: str(u.use, 120), why: str(u.why, 600), how: str(u.how, 600) ?? '' }))
    .filter((u): u is { use: string; why: string; how: string } => !!(u.use && u.why))
  if (!uses.length) return { ok: false, error: 'no uses' }
  const connections = (Array.isArray(o.connections) ? o.connections : [])
    .slice(0, 4)
    .map((k: Record<string, unknown>) => ({ title: str(k.title, 160), text: str(k.text, 900) }))
    .filter((k): k is { title: string; text: string } => !!(k.title && k.text))
  return { ok: true, out: { summary, dna: list(o.dna, 6, 300), uses, limits: list(o.limits, 4, 400), connections, questions: list(o.questions, 4, 300) } }
}

export function parseArticle(text: string, given: Partial<Record<ArticleKey, string>>): { ok: true; out: Record<ArticleKey, string> } | { ok: false; error: string } {
  const o = readJson(text)
  if (typeof o === 'string') return { ok: false, error: o }
  const out = {} as Record<ArticleKey, string>
  let any = false
  for (const k of ARTICLE_KEYS) {
    const v = typeof o[k] === 'string' ? (o[k] as string).trim() : ''
    if (v.length > 2400) return { ok: false, error: `${k} is too long` }
    if (EMOJI.test(v)) return { ok: false, error: 'the article has emoji' }
    // A section with no materials stays empty: nothing is written in place of a gap.
    out[k] = k === 'closing' || (given[k] ?? '').trim() ? v : ''
    if (out[k]) any = true
  }
  return any ? { ok: true, out } : { ok: false, error: 'the article is empty' }
}
