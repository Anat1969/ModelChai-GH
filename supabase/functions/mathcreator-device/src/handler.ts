/**
 * POST /functions/v1/mathcreator-device: a device account, so the app works with no login (DECISIONS.md 81).
 * Creates a confirmed user with a random address and a random 256-bit password, and returns both once. The
 * browser keeps them and signs in with them; every row stays owned by a real user, so RLS is unchanged.
 * No JWT is required (there is no user yet); instead each address may create 5 accounts an hour, and
 * everyone together 60.
 */
import { createClient } from '@supabase/supabase-js'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const PER_ADDRESS_PER_HOUR = 5
const ALL_PER_HOUR = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'השיטה לא נתמכת' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return json({ error: 'השרת לא מוגדר ליצירת חשבונות מכשיר' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // The address is kept only as a salted hash, for the hourly limit.
  const address = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown'
  const ipHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mathcreator:${address}`)))
  const since = new Date(Date.now() - 3600_000).toISOString()
  const [mine, all] = await Promise.all([
    admin.from('mathcreator_device_signups').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since),
    admin.from('mathcreator_device_signups').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ])
  if ((mine.count ?? 0) >= PER_ADDRESS_PER_HOUR || (all.count ?? 0) >= ALL_PER_HOUR) {
    return json({ error: 'נוצרו יותר מדי חשבונות מכשיר בשעה האחרונה. אפשר לנסות שוב בעוד שעה.' }, 429)
  }

  const email = `device-${crypto.randomUUID()}@device.math-creator.app`
  const password = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { mathcreator_device: true } })
  if (error || !data.user) return json({ error: `יצירת חשבון המכשיר נכשלה: ${error?.message ?? 'unknown'}` }, 500)
  await admin.from('mathcreator_device_signups').insert({ ip_hash: ipHash })
  return json({ email, password })
})
