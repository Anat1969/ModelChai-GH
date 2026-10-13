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
 * The device account (DECISIONS.md 81): no email and nothing to remember. The first visit asks the server for
 * an account with a random address and password, keeps them on this device, and signs in with them. Every row
 * is still owned by a real user, so RLS works the same. Another device joins by opening the personal link.
 */
const DEVICE_KEY = 'mathcreator-device'
interface DeviceCredentials {
  email: string
  password: string
}

function readDevice(): DeviceCredentials | null {
  try {
    const s = localStorage.getItem(DEVICE_KEY)
    const c = s ? (JSON.parse(s) as DeviceCredentials) : null
    return c?.email && c.password ? c : null
  } catch {
    return null
  }
}
function writeDevice(c: DeviceCredentials | null) {
  try {
    if (c) localStorage.setItem(DEVICE_KEY, JSON.stringify(c))
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Without storage the account lasts for this visit only; the app still works.
  }
}

async function createDevice(): Promise<DeviceCredentials> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mathcreator-device`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.email) throw new Error(body?.error ?? `השרת החזיר שגיאה ${res.status}`)
  return { email: body.email, password: body.password }
}

let pending: Promise<SessionState> | null = null

export function ensureSession(): Promise<SessionState> {
  // Several screens ask at once on the first visit; they share one sign-in.
  pending ??= (async (): Promise<SessionState> => {
    const { data } = await supabase.auth.getSession()
    const s = data.session
    if (s) return { status: 'signed-in', token: s.access_token, anonymous: false, email: s.user.email ?? undefined }
    try {
      let creds = readDevice()
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!creds) {
          creds = await createDevice()
          writeDevice(creds)
        }
        const r = await supabase.auth.signInWithPassword(creds)
        if (r.data.session) return { status: 'signed-in', token: r.data.session.access_token, anonymous: false, email: creds.email }
        // A device account that no longer exists: start a new one, once.
        writeDevice(null)
        creds = null
      }
      return { status: 'error', message: 'הכניסה האוטומטית נכשלה.' }
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  })().finally(() => (pending = null))
  return pending
}

/** Sign-in by email link: kept as a fallback, not shown while the device account works. */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0] + '#/new' } })
  return error ? { ok: false, message: error.message } : { ok: true }
}

/** A link that opens this device's projects on another device. It is a key: whoever has it can open them. */
export function deviceLink(): string | null {
  const c = readDevice()
  if (!c) return null
  const code = btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${window.location.origin}${window.location.pathname}#/connect?d=${code}`
}

/** Adopts the account in a personal link: this device then opens the same projects. */
export async function connectDevice(code: string): Promise<SessionState> {
  try {
    const json = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
    const c = JSON.parse(json) as DeviceCredentials
    if (!c.email || !c.password) throw new Error('bad link')
    await supabase.auth.signOut()
    writeDevice(c)
    return await ensureSession()
  } catch {
    return { status: 'error', message: 'הקישור האישי לא תקין. אפשר להעתיק אותו שוב מהמכשיר הראשון.' }
  }
}
