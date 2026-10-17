/**
 * POST /functions/v1/concept-partner (DECISIONS.md 101): Claude as a partner in research and design.
 * - "suggest": from a need (use, place, idea, inspiration, images) to concepts, with reasons, alternatives and
 *   background knowledge; with a chosen concept, also a concept statement.
 * - "explore": from a concept to uses, limits and connections.
 * - "article": the exhibition article, written only from the project's materials.
 * Signed-in callers only; shares the 20-an-hour limit with the other functions.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import PARTNER from '../partner.md'
import ARTICLE from '../article.md'
import { articleMessage, exploreMessage, parseArticle, parseExplore, parseSuggest, suggestMessage, type AtlasEntry, type Mode } from './core'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const RATE_LIMIT_PER_HOUR = 20
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const LABEL: Record<Mode, string> = { suggest: 'הצעת מושגים', explore: 'חקירת מושג', article: 'מאמר' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'השיטה לא נתמכת' }, 405)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!apiKey) return json({ ok: false, error: 'מפתח ה-API של Claude לא מוגדר בשרת' }, 500)
  const model = Deno.env.get('CLAUDE_MODEL')?.trim() || DEFAULT_MODEL

  const authHeader = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: userData } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  const user = userData?.user
  if (!user) return json({ ok: false, error: 'צריך להיות מחוברים' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400)
  }
  const mode = body.mode as Mode
  if (!['suggest', 'explore', 'article'].includes(mode)) return json({ ok: false, error: 'מצב לא מוכר' }, 400)
  const atlas = (Array.isArray(body.atlas) ? body.atlas : []).slice(0, 40) as AtlasEntry[]

  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await db.from('mathcreator_ai_calls').select('id', { count: 'exact', head: true }).eq('owner', user.id).gte('created_at', since)
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ ok: false, error: `הגעת למגבלה של ${RATE_LIMIT_PER_HOUR} קריאות בשעה. אפשר לנסות שוב בעוד שעה.` }, 429)

  let content: Anthropic.Beta.BetaContentBlockParam[]
  if (mode === 'suggest') {
    const need = (body.need ?? {}) as { images?: unknown }
    const images = (Array.isArray(need.images) ? need.images : []).filter((x): x is string => typeof x === 'string' && x.length < 2_000_000).slice(0, 2)
    content = [
      ...images.map((d) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: d.replace(/^data:image\/\w+;base64,/, '') } })),
      { type: 'text', text: suggestMessage({ need: { ...(body.need as object), images }, chosen: (body.chosen as never) ?? null, atlas }) },
    ]
  } else if (mode === 'explore') {
    if (!body.concept || typeof (body.concept as { name?: unknown }).name !== 'string') return json({ ok: false, error: 'חסר מושג' }, 400)
    content = [{ type: 'text', text: exploreMessage({ concept: body.concept as never, context: body.context as string, atlas }) }]
  } else {
    content = [{ type: 'text', text: articleMessage({ materials: (body.materials ?? {}) as never, title: body.title as string }) }]
  }

  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })
  const started = Date.now()
  const record = (ok: boolean, used: string) =>
    db.from('mathcreator_ai_calls').insert({ owner: user.id, concept: LABEL[mode], model: used, ok, attempts: 1, first_try_ok: ok, duration_ms: Date.now() - started, issues: [], recipe: null })
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: mode === 'article' ? 5000 : 3000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: mode === 'article' ? ARTICLE : PARTNER, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    })
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('')
    const parsed = mode === 'suggest' ? parseSuggest(text, atlas.map((a) => a.id)) : mode === 'explore' ? parseExplore(text) : parseArticle(text, (body.materials ?? {}) as never)
    await record(parsed.ok, res.model)
    if (!parsed.ok) return json({ ok: false, error: `התשובה שהתקבלה לא תקינה (${parsed.error}). אפשר לנסות שוב.` }, 502)
    return json({ ok: true, mode, ...parsed.out, model: res.model, durationMs: Date.now() - started })
  } catch (e) {
    await record(false, model)
    const status = e instanceof Anthropic.APIError ? e.status : undefined
    return json({ ok: false, error: status === 429 ? 'שירות Claude עמוס כרגע. אפשר לנסות שוב בעוד דקה.' : 'לא הצלחנו להגיע ל-Claude. אפשר לנסות שוב.' }, 502)
  }
})
