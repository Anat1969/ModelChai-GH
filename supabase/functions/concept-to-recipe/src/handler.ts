/**
 * POST /functions/v1/concept-to-recipe (ARCHITECTURE.md 5).
 * Signed-in callers only, 20 calls an hour each. ANTHROPIC_API_KEY lives here and nowhere else.
 * The response is NDJSON: progress lines while Claude works, then one result line.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import recipeSchema from '../../../../docs/schema/recipe.schema.json'
import golden from '../../../../docs/fixtures/golden-ratio.recipe.json'
import mobius from '../../../../docs/fixtures/mobius-strip.recipe.json'
import umbilic from '../../../../docs/fixtures/umbilic-torus.recipe.json'
import template from '../system.md'
import { conceptToRecipe, systemPrompt, type ModelReply, type Turn } from './core'
import { modelSchema } from './modelSchema'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const RATE_LIMIT_PER_HOUR = 20
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const GENERATORS = ['sweep']
const SYSTEM = systemPrompt(template, [umbilic, mobius, golden])
const SCHEMA = modelSchema(recipeSchema as Record<string, unknown>, GENERATORS)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function readText(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length <= max ? t : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'השיטה לא נתמכת' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!apiKey) return json({ error: 'מפתח ה-API של Claude לא מוגדר בשרת' }, 500)
  const model = Deno.env.get('CLAUDE_MODEL')?.trim() || DEFAULT_MODEL

  // The caller's own token: every database call below runs under RLS as that user.
  const authHeader = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  const user = userData?.user
  if (!user) return json({ error: 'צריך להתחבר כדי ליצור מתכון' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'גוף הבקשה אינו JSON תקין' }, 400)
  }
  const concept = readText(body.concept, 120)
  const use = readText(body.use, 80)
  const context = readText(body.context, 120)
  if (!concept) return json({ error: 'שדה המושג ריק או ארוך מ-120 תווים' }, 400)
  if (use === null) return json({ error: 'שדה השימוש ארוך מ-80 תווים' }, 400)
  if (context === null) return json({ error: 'שדה ההקשר ארוך מ-120 תווים' }, 400)

  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await db
    .from('mathcreator_ai_calls')
    .select('id', { count: 'exact', head: true })
    .eq('owner', user.id)
    .gte('created_at', since)
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return json({ error: `הגעת למגבלה של ${RATE_LIMIT_PER_HOUR} מושגים בשעה. אפשר לנסות שוב בעוד שעה.` }, 429)
  }

  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })
  // Structured outputs first. If the API refuses to compile the schema, fall back to plain JSON in text:
  // the full validation below catches whatever the looser mode lets through.
  let structured = true
  const call = async (turns: Turn[]): Promise<ModelReply> => {
    const request = {
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      output_config: { effort: 'medium' as const, ...(structured ? { format: { type: 'json_schema' as const, schema: SCHEMA } } : {}) },
      system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
      messages: turns as Anthropic.Beta.BetaMessageParam[],
    }
    let res: Anthropic.Beta.BetaMessage
    try {
      res = await client.beta.messages.create(request)
    } catch (e) {
      if (structured && e instanceof Anthropic.BadRequestError && /schema|format/i.test(e.message)) {
        structured = false
        const { format: _drop, ...rest } = request.output_config as Record<string, unknown>
        res = await client.beta.messages.create({ ...request, output_config: rest })
      } else throw e
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return { text, content: res.content, stopReason: res.stop_reason ?? 'end_turn', model: res.model }
  }

  const started = Date.now()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      // The call is recorded before the stream closes: a serverless worker may stop once the response ends.
      const record = (row: { model: string; ok: boolean; attempts: number; issues: unknown; recipe: unknown }) =>
        db.from('mathcreator_ai_calls').insert({
          owner: user.id,
          concept,
          first_try_ok: row.ok && row.attempts === 1,
          duration_ms: Date.now() - started,
          ...row,
        })
      try {
        const result = await conceptToRecipe({ concept, use, context, generators: GENERATORS }, { call, now: () => new Date(), onProgress: send })
        await record({
          model: result.model || model,
          ok: result.ok,
          attempts: result.attempts,
          issues: result.issues,
          recipe: result.ok ? result.recipe : result.lastRecipe,
        })
        send({ type: 'result', ...result, durationMs: Date.now() - started, structured })
      } catch (e) {
        const status = e instanceof Anthropic.APIError ? e.status : undefined
        const message =
          status === 429 ? 'שירות Claude עמוס כרגע. אפשר לנסות שוב בעוד דקה.'
          : status === 401 ? 'מפתח ה-API של Claude בשרת לא תקין.'
          : 'לא הצלחנו להגיע ל-Claude. אפשר לנסות שוב.'
        await record({ model, ok: false, attempts: 0, issues: [], recipe: null })
        send({ type: 'result', ok: false, kind: 'upstream', error: message, schemaErrors: [], issues: [], attempts: 0 })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
})
