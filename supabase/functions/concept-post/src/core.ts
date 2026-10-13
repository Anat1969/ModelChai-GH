/**
 * The pure part of concept-post: what Claude is told, and how its answer is read. No network, no Deno, so it is
 * tested in node (tests/post.test.ts).
 */

export interface PostInput {
  recipe: Record<string, unknown>
  /** The visual prompt as shown on screen, when there is one. */
  prompt?: string
  /** A few measured metrics, already rounded, e.g. { "קוטר חיצוני": "50.4 מ'" }. */
  metrics?: Record<string, string>
}

export interface Post {
  short: string
  post: string
}

const pick = (o: unknown, keys: string[]) =>
  o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => k in (o as object)).map((k) => [k, (o as Record<string, unknown>)[k]])) : {}

/** Only the fields a reader can see: the engine's resolution and ids would invite invented detail. */
export function postUserMessage(input: PostInput): string {
  const r = input.recipe
  const facts = {
    concept: r.concept,
    narrative: r.narrative,
    generator: (r.generator as { type?: string; params?: Record<string, unknown> } | undefined)?.params
      ? { type: (r.generator as { type: string }).type, params: pick((r.generator as { params: unknown }).params, ['section', 'path', 'twist', 'scale_along_path']) }
      : r.generator,
    bare: pick(r.bare, ['mode', 'section_center_height', 'shell', 'openings', 'floor']),
    realistic: r.realistic,
  }
  const parts = [`Recipe facts:\n${JSON.stringify(facts, null, 2)}`]
  if (input.metrics && Object.keys(input.metrics).length) parts.push(`Measured metrics:\n${Object.entries(input.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`)
  if (input.prompt) parts.push(`Visual prompt on screen:\n${input.prompt}`)
  parts.push('Write the post now. Output: one JSON object and nothing else.')
  return parts.join('\n\n')
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

/** Reads {"short","post"} from the reply, tolerating a code fence or text around it. */
export function parsePost(text: string): { ok: true; post: Post } | { ok: false; error: string } {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'no JSON object in the reply' }
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { ok: false, error: 'the reply is not valid JSON' }
  }
  const o = raw as Record<string, unknown>
  if (typeof o.short !== 'string' || typeof o.post !== 'string') return { ok: false, error: 'short and post must be strings' }
  const short = o.short.trim(), post = o.post.trim()
  if (!short || !post) return { ok: false, error: 'empty post' }
  if (short.length > 400 || post.length > 4000) return { ok: false, error: 'the post is too long' }
  if (EMOJI.test(short + post)) return { ok: false, error: 'the post has emoji' }
  return { ok: true, post: { short, post } }
}

// ---------- reading: the concept from mathematics to architecture ----------

export interface Reading {
  logic: string
  space: string
  figure_ground: string
  synthesis: string
}

export interface ReadingInput extends PostInput {
  /** Figure-ground rows as shown on screen, e.g. { "בתוכנית: בנוי מול חצר": "1,600 מ\"ר בנוי, 366 מ\"ר חצר" }. */
  figureGround?: Record<string, string>
}

export function readingUserMessage(input: ReadingInput): string {
  const base = postUserMessage({ recipe: input.recipe, metrics: input.metrics }).replace(/\n\nWrite the post now\.[^]*$/, '')
  const fg = input.figureGround && Object.keys(input.figureGround).length
    ? `\n\nFigure-ground numbers:\n${Object.entries(input.figureGround).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : ''
  return `${base}${fg}\n\nWrite the reading now. Output: one JSON object and nothing else.`
}

const READING_KEYS = ['logic', 'space', 'figure_ground', 'synthesis'] as const

export function parseReading(text: string): { ok: true; reading: Reading } | { ok: false; error: string } {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'no JSON object in the reply' }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { ok: false, error: 'the reply is not valid JSON' }
  }
  const out = {} as Reading
  for (const k of READING_KEYS) {
    const v = o[k]
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `${k} is missing` }
    if (v.length > 900) return { ok: false, error: `${k} is too long` }
    if (EMOJI.test(v)) return { ok: false, error: 'the reading has emoji' }
    out[k] = v.trim()
  }
  return { ok: true, reading: out }
}
