/**
 * POST /functions/v1/concept-post, for the concept's library. Two modes:
 * - "post" (default): a short post that reads the concept as a building in its place.
 * - "reading": the concept from mathematics to architecture, in four parts (logic, space, figure-ground, synthesis).
 * Signed-in callers only; it shares the 20-an-hour limit with concept-to-recipe.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { parseRecipe } from '../../../../src/recipe/schema'
import SYSTEM from '../system.md'
import READING from '../reading.md'
import { parsePost, parseReading, postUserMessage, readingUserMessage } from './core'

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'השיטה לא נתמכת' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!apiKey) return json({ ok: false, error: 'מפתח ה-API של Claude לא מוגדר בשרת' }, 500)
  const model = Deno.env.get('CLAUDE_MODEL')?.trim() || DEFAULT_MODEL

  const authHeader = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  const user = userData?.user
  if (!user) return json({ ok: false, error: 'צריך להתחבר כדי לכתוב פוסט' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400)
  }
  const parsed = parseRecipe(body.recipe)
  if (!parsed.ok) return json({ ok: false, error: 'המתכון לא עומד בסכמה' }, 400)
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000) : undefined
  const reading = body.mode === 'reading'
  const strings = (v: unknown) =>
    v && typeof v === 'object'
      ? (Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string').slice(0, 16)) as Record<string, string>)
      : undefined
  const figureGround = strings(body.figureGround)
  const metrics =
    body.metrics && typeof body.metrics === 'object'
      ? Object.fromEntries(Object.entries(body.metrics as Record<string, unknown>).filter(([, v]) => typeof v === 'string').slice(0, 16)) as Record<string, string>
      : undefined

  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await db.from('mathcreator_ai_calls').select('id', { count: 'exact', head: true }).eq('owner', user.id).gte('created_at', since)
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ ok: false, error: `הגעת למגבלה של ${RATE_LIMIT_PER_HOUR} קריאות בשעה. אפשר לנסות שוב בעוד שעה.` }, 429)

  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })
  const started = Date.now()
  const concept = `${reading ? 'פרשנות' : 'פוסט'}: ${parsed.recipe.concept.name_he}`.slice(0, 120)
  const record = (ok: boolean, used: string) =>
    db.from('mathcreator_ai_calls').insert({ owner: user.id, concept, model: used, ok, attempts: 1, first_try_ok: ok, duration_ms: Date.now() - started, issues: [], recipe: null })

  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: reading ? READING : SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: reading
            ? readingUserMessage({ recipe: body.recipe as Record<string, unknown>, metrics, figureGround })
            : postUserMessage({ recipe: body.recipe as Record<string, unknown>, prompt, metrics }),
        },
      ],
    })
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('')
    if (reading) {
      const r = parseReading(text)
      await record(r.ok, res.model)
      if (!r.ok) return json({ ok: false, error: `הפרשנות שהתקבלה לא תקינה (${r.error}). אפשר לנסות שוב.` }, 502)
      return json({ ok: true, reading: r.reading, model: res.model, durationMs: Date.now() - started })
    }
    const out = parsePost(text)
    await record(out.ok, res.model)
    if (!out.ok) return json({ ok: false, error: `הפוסט שהתקבל לא תקין (${out.error}). אפשר לנסות שוב.` }, 502)
    return json({ ok: true, ...out.post, model: res.model, durationMs: Date.now() - started })
  } catch (e) {
    await record(false, model)
    const status = e instanceof Anthropic.APIError ? e.status : undefined
    return json({ ok: false, error: status === 429 ? 'שירות Claude עמוס כרגע. אפשר לנסות שוב בעוד דקה.' : 'לא הצלחנו להגיע ל-Claude. אפשר לנסות שוב.' }, 502)
  }
})
