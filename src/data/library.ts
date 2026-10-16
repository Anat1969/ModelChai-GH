/**
 * The concept's library: saved visual prompts, the images made from them (uploaded by the owner), and posts
 * that read the concept as a building in its place. One table, `mathcreator_library`, and a private bucket.
 */
import { DataError, type ProjectRow, type VersionRow, type View } from './projects'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from './supabase'

export const LIBRARY_BUCKET = 'mathcreator-library'
/** Same limits as the bucket, checked before the upload so the error is clear. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024

export interface LibraryItem {
  id: string
  project_id: string
  version_id: string | null
  kind: 'prompt' | 'image' | 'post' | 'reading' | 'still' | 'clip' | 'print' | 'dossier'
  prompt_id: string | null
  distill: string | null
  body: string | null
  image_path: string | null
  /** For a frozen view: the step of the process it documents, and how it was looked at (DECISIONS.md 84). */
  stage?: string | null
  view?: View | null
  created_at: string
  /** Signed URL, for images. */
  url?: string
}

export interface Library {
  /** Newest first. body holds the four parts as JSON; distill holds the synthesis. */
  readings: LibraryItem[]
  posts: LibraryItem[]
  /** Newest first, each with its images. */
  prompts: (LibraryItem & { images: LibraryItem[] })[]
}

export function fail(error: { message: string } | null, what: string): never {
  const msg = error?.message ?? 'unknown'
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|load failed/i.test(msg)
  throw new DataError(offline ? `אין חיבור לשרת (${what}).` : `${what} נכשל: ${msg}`, offline)
}

export async function loadLibrary(projectId: string): Promise<Library> {
  const res = await supabase.from('mathcreator_library').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  if (res.error) fail(res.error, 'טעינת הספרייה')
  const items = res.data as LibraryItem[]
  const images = items.filter((i) => i.kind === 'image')
  if (images.length) {
    const signed = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrls(
      images.map((i) => i.image_path!),
      3600,
    )
    const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]))
    for (const i of images) i.url = byPath.get(i.image_path!) ?? undefined
  }
  return {
    readings: items.filter((i) => i.kind === 'reading'),
    posts: items.filter((i) => i.kind === 'post'),
    prompts: items
      .filter((i) => i.kind === 'prompt')
      .map((p) => ({ ...p, images: images.filter((i) => i.prompt_id === p.id).reverse() })),
  }
}

export async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new DataError('צריך להיות מחוברים כדי לשמור בספרייה.', false)
  return id
}

export async function addPrompt(input: { projectId: string; versionId: string | null; distill: string; prompt: string }): Promise<LibraryItem> {
  const row = { id: crypto.randomUUID(), project_id: input.projectId, version_id: input.versionId, kind: 'prompt' as const, distill: input.distill, body: input.prompt }
  const res = await supabase.from('mathcreator_library').insert(row).select().single()
  if (res.error) fail(res.error, 'שמירת הפרומפט')
  return res.data as LibraryItem
}

export async function addPost(input: { projectId: string; versionId: string | null; short: string; post: string }): Promise<LibraryItem> {
  const row = { id: crypto.randomUUID(), project_id: input.projectId, version_id: input.versionId, kind: 'post' as const, distill: input.short, body: input.post }
  const res = await supabase.from('mathcreator_library').insert(row).select().single()
  if (res.error) fail(res.error, 'שמירת הפוסט')
  return res.data as LibraryItem
}

/** Checks a file against the bucket's rules. Returns the reason it cannot be uploaded, or null. */
export function imageProblem(file: { type: string; size: number; name: string }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return `הקובץ "${file.name}" אינו PNG,‏ JPEG או WebP.`
  if (file.size > IMAGE_MAX_BYTES) return `הקובץ "${file.name}" גדול מ-10 מגה-בייט.`
  return null
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export async function uploadImage(input: { projectId: string; promptId: string; versionId: string | null; file: File }): Promise<LibraryItem> {
  const problem = imageProblem(input.file)
  if (problem) throw new DataError(problem, false)
  const uid = await userId()
  const id = crypto.randomUUID()
  const path = `${uid}/${input.projectId}/${id}.${EXT[input.file.type]}`
  const up = await supabase.storage.from(LIBRARY_BUCKET).upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (up.error) fail(up.error, 'העלאת התמונה')
  const res = await supabase
    .from('mathcreator_library')
    .insert({ id, project_id: input.projectId, version_id: input.versionId, kind: 'image', prompt_id: input.promptId, image_path: path })
    .select()
    .single()
  if (res.error) fail(res.error, 'שמירת התמונה')
  const signed = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrl(path, 3600)
  return { ...(res.data as LibraryItem), url: signed.data?.signedUrl }
}

/** Removes an item; for an image, its file too. A prompt takes its images with it. */
export async function removeItem(item: LibraryItem, images: LibraryItem[] = []): Promise<void> {
  const paths = [item, ...images].map((i) => i.image_path).filter((p): p is string => !!p)
  if (paths.length) {
    const rm = await supabase.storage.from(LIBRARY_BUCKET).remove(paths)
    if (rm.error) fail(rm.error, 'מחיקת הקובץ')
  }
  const res = await supabase.from('mathcreator_library').delete().eq('id', item.id)
  if (res.error) fail(res.error, 'המחיקה')
}

export type PostOutcome = { ok: true; short: string; post: string; durationMs: number } | { ok: false; error: string }

/** Asks the server function for a post. The Claude key never leaves the server. */
export async function requestPost(input: { recipe: unknown; prompt?: string; metrics?: Record<string, string> }): Promise<PostOutcome> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, error: 'צריך להיות מחוברים כדי לכתוב פוסט.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/concept-post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? `השרת החזיר שגיאה ${res.status}. אפשר לנסות שוב.` }
    return body as PostOutcome
  } catch (e) {
    return { ok: false, error: `לא הצלחנו להגיע לשרת (${String(e)}). כדאי לבדוק את החיבור ולנסות שוב.` }
  }
}

/** A project with its newest version's recipe, for the library screen. */
export async function projectWithLatest(projectId: string): Promise<{ project: ProjectRow; latest: (VersionRow & { recipe: Record<string, unknown> }) | null }> {
  const p = await supabase.from('mathcreator_projects').select('id,concept,title_he,created_at,updated_at').eq('id', projectId).single()
  if (p.error) fail(p.error, 'טעינת הפרויקט')
  const v = await supabase.from('mathcreator_recipe_versions').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1)
  if (v.error) fail(v.error, 'טעינת הגרסה')
  return { project: p.data as ProjectRow, latest: ((v.data ?? [])[0] as (VersionRow & { recipe: Record<string, unknown> }) | undefined) ?? null }
}

// ---------- reading ----------

export interface Reading {
  logic: string
  space: string
  figure_ground: string
  synthesis: string
}

export function readingOf(item: LibraryItem): Reading | null {
  try {
    const r = JSON.parse(item.body ?? '') as Reading
    return r.logic && r.space && r.figure_ground ? { ...r, synthesis: item.distill ?? r.synthesis } : null
  } catch {
    return null
  }
}

export async function addReading(input: { projectId: string; versionId: string | null; reading: Reading }): Promise<LibraryItem> {
  const row = {
    id: crypto.randomUUID(),
    project_id: input.projectId,
    version_id: input.versionId,
    kind: 'reading' as const,
    distill: input.reading.synthesis,
    body: JSON.stringify({ logic: input.reading.logic, space: input.reading.space, figure_ground: input.reading.figure_ground }),
  }
  const res = await supabase.from('mathcreator_library').insert(row).select().single()
  if (res.error) fail(res.error, 'שמירת הפרשנות')
  return res.data as LibraryItem
}

export type ReadingOutcome = { ok: true; reading: Reading; durationMs: number } | { ok: false; error: string }

export async function requestReading(input: { recipe: unknown; metrics?: Record<string, string>; figureGround?: Record<string, string> }): Promise<ReadingOutcome> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, error: 'החיבור לשרת עוד לא מוכן. אפשר לנסות שוב בעוד רגע.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/concept-post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'reading', ...input }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? `השרת החזיר שגיאה ${res.status}. אפשר לנסות שוב.` }
    return body as ReadingOutcome
  } catch (e) {
    return { ok: false, error: `לא הצלחנו להגיע לשרת (${String(e)}). כדאי לבדוק את החיבור ולנסות שוב.` }
  }
}
