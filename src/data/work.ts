/**
 * The work path's data (DECISIONS.md 97). What the owner writes on each step lives in
 * `mathcreator_projects.journey`, the article's edits in `.article`; images of inspiration and photos of the
 * built model are library items (`reference`, `photo`). Everything else is read from what already exists:
 * versions, frozen views, prompts and their images, the reading, the post, the print file.
 */
import type { ArticleEdits } from '../journey/article'
import type { Journey, Sweep, WorkImage, WorkState } from '../journey/stages'
import { parseRecipe } from '../recipe/schema'
import { loadCollection, type Collection } from './collection'
import { fail, LIBRARY_BUCKET, imageProblem, loadLibrary, userId, type Library, type LibraryItem } from './library'
import { DataError, type ProjectRow } from './projects'
import { supabase } from './supabase'

const CAMERA_LABEL: Record<string, string> = { eye_level_oblique: 'גובה עיניים', aerial: 'מבט על', inside: 'בפנים', courtyard: 'מהחצר' }
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })

export interface ProjectWork extends ProjectRow {
  journey: Journey
  article: ArticleEdits
}

export interface Work {
  row: ProjectWork
  collection: Collection
  library: Library
  references: LibraryItem[]
  photos: LibraryItem[]
  /** Without metrics: those come from a build, on the screen that needs them. */
  state: WorkState
}

async function sign(items: LibraryItem[]) {
  if (!items.length) return
  const signed = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrls(
    items.map((i) => i.image_path!),
    3600,
  )
  const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]))
  for (const i of items) i.url = byPath.get(i.image_path!) ?? undefined
}

export async function loadWork(projectId: string): Promise<Work> {
  const p = await supabase.from('mathcreator_projects').select('id,concept,title_he,created_at,updated_at,journey,article').eq('id', projectId).single()
  if (p.error) fail(p.error, 'טעינת הפרויקט')
  const row = p.data as ProjectWork
  row.journey ??= {}
  row.article ??= {}
  const [collection, library, extra] = await Promise.all([
    loadCollection(projectId),
    loadLibrary(projectId),
    supabase.from('mathcreator_library').select('*').eq('project_id', projectId).in('kind', ['reference', 'photo']).order('created_at', { ascending: true }),
  ])
  if (extra.error) fail(extra.error, 'טעינת התמונות')
  const items = extra.data as LibraryItem[]
  await sign(items)
  const references = items.filter((i) => i.kind === 'reference')
  const photos = items.filter((i) => i.kind === 'photo')
  return { row, collection, library, references, photos, state: workState(row, collection, library, references, photos) }
}

const img = (i: LibraryItem, caption: string): WorkImage => ({ id: i.id, src: i.url, caption, created_at: i.created_at })

export function workState(row: ProjectWork, c: Collection, lib: Library, references: LibraryItem[], photos: LibraryItem[]): WorkState {
  const parsed = c.latest ? parseRecipe(c.latest.recipe) : null
  const recipe = parsed?.ok && parsed.recipe.generator.type === 'sweep' ? (parsed.recipe as Sweep) : null
  const numberOf = (id: string | null) => c.versions.find((v) => v.id === id)?.number
  const stillsOn = (stage: string) =>
    c.stills
      .filter((s) => s.kind === 'still' && s.stage === stage && s.url)
      .map((s) =>
        img(
          s,
          [stage === 'render' ? 'הדמיה' : 'מבט קפוא', numberOf(s.version_id) ? `גרסה ${numberOf(s.version_id)}` : null, s.view ? CAMERA_LABEL[s.view.camera.preset] : null, dateShort(s.created_at)]
            .filter(Boolean)
            .join(', '),
        ),
      )
  const post = lib.posts[0]
  return {
    project: { id: row.id, title_he: row.title_he, concept: row.concept, created_at: row.created_at },
    journey: row.journey,
    recipe,
    versions: c.versions.map((v) => ({ id: v.id, number: v.number, created_at: v.created_at, note: v.note })),
    reading: c.reading,
    post: post ? { short: post.distill ?? '', body: post.body ?? '' } : null,
    prompts: lib.prompts.map((p) => ({
      id: p.id,
      distill: p.distill ?? '',
      body: p.body ?? '',
      created_at: p.created_at,
      images: p.images.filter((i) => i.url).map((i) => img(i, `תמונה מהפרומפט, ${dateShort(i.created_at)}`)),
    })),
    references: references.filter((i) => i.url).map((i) => img(i, i.distill || `השראה, ${dateShort(i.created_at)}`)),
    stills: { bare: stillsOn('bare'), realistic: stillsOn('realistic'), render: stillsOn('render') },
    print: [...c.stills].reverse().find((s) => s.kind === 'print')?.distill ?? null,
    hasClip: c.stills.some((s) => s.kind === 'clip'),
    photos: photos.filter((i) => i.url).map((i) => img(i, i.distill || `תיעוד, ${dateShort(i.created_at)}`)),
    metrics: [],
  }
}

/** A project that starts from an idea, before there is any recipe. */
export async function createProject(input: { title: string; idea?: string }): Promise<string> {
  await userId()
  const id = crypto.randomUUID()
  const title = input.title.trim().slice(0, 80) || 'פרויקט חדש'
  const journey: Journey = { idea: { title, ...(input.idea?.trim() ? { idea: input.idea.trim() } : {}) } }
  const res = await supabase.from('mathcreator_projects').insert({ id, concept: title.slice(0, 120), title_he: title, journey })
  if (res.error) fail(res.error, 'יצירת הפרויקט')
  return id
}

/** Writes what was written on the steps. The project's name follows the title written on step 1. */
export async function saveJourney(projectId: string, journey: Journey): Promise<void> {
  const title = journey.idea?.title?.trim().slice(0, 80)
  const res = await supabase
    .from('mathcreator_projects')
    .update({ journey, ...(title ? { title_he: title } : {}) })
    .eq('id', projectId)
  if (res.error) fail(res.error, 'שמירת השלב')
}

export async function saveArticle(projectId: string, article: ArticleEdits): Promise<void> {
  const res = await supabase.from('mathcreator_projects').update({ article }).eq('id', projectId)
  if (res.error) fail(res.error, 'שמירת המאמר')
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** An inspiration image (step 2) or a photo of the result (step 8). */
export async function uploadWorkImage(input: { kind: 'reference' | 'photo'; projectId: string; file: File; caption?: string }): Promise<LibraryItem> {
  const problem = imageProblem(input.file)
  if (problem) throw new DataError(problem, false)
  const uid = await userId()
  const id = crypto.randomUUID()
  const path = `${uid}/${input.projectId}/${id}.${EXT[input.file.type]}`
  const up = await supabase.storage.from(LIBRARY_BUCKET).upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (up.error) fail(up.error, 'העלאת התמונה')
  const res = await supabase
    .from('mathcreator_library')
    .insert({ id, project_id: input.projectId, kind: input.kind, image_path: path, distill: input.caption?.trim().slice(0, 400) || null })
    .select()
    .single()
  if (res.error) fail(res.error, 'שמירת התמונה')
  return res.data as LibraryItem
}
