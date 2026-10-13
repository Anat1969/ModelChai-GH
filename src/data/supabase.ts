/**
 * The Supabase client. The URL and the publishable key are public by design (they identify the project;
 * RLS protects the data), so they ship with the app and can be overridden by Vite env variables.
 * Server secrets, such as the Claude API key, never reach this side.
 */
import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://ktqmwpbzcnzkhjskqisy.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_IkreG7naPa1h-d4kGp1gpA_sLU4tg5q'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mathcreator-auth' },
})

export type SessionState =
  | { status: 'signed-in'; token: string; anonymous: boolean; email?: string }
  | { status: 'needs-email' }
  | { status: 'error'; message: string }

/**
 * A session without friction: an anonymous user when the project allows it, otherwise a magic link by email.
 * Either way every row is owned by a real auth user, so RLS works the same.
 */
export async function ensureSession(): Promise<SessionState> {
  const { data } = await supabase.auth.getSession()
  const s = data.session
  if (s) return { status: 'signed-in', token: s.access_token, anonymous: !!s.user.is_anonymous, email: s.user.email ?? undefined }
  const anon = await supabase.auth.signInAnonymously()
  if (anon.data.session) return { status: 'signed-in', token: anon.data.session.access_token, anonymous: true }
  if (anon.error && /anonymous/i.test(anon.error.message)) return { status: 'needs-email' }
  return { status: 'error', message: anon.error?.message ?? 'unknown' }
}

export async function sendMagicLink(email: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0] + '#/new' } })
  return error ? { ok: false, message: error.message } : { ok: true }
}
