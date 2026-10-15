/**
 * The collection: one concept's way from an abstract idea to a figure, in fixed steps (DECISIONS.md 84).
 * Every frozen view hangs on a step and on the version it was taken from, with the camera it was taken with.
 * Stills live in the library table and bucket, as `kind = 'still'`.
 */
import { fail, LIBRARY_BUCKET, projectWithLatest, readingOf, userId, type LibraryItem, type Reading } from './library'
import { SNAPSHOT_BUCKET, VERSION_COLUMNS, type ProjectRow, type SnapshotRow, type VersionRow, type View } from './projects'
import { supabase } from './supabase'

export const STAGES = [
  { id: 'concept', label: 'מושג', why: 'הרעיון המתמטי במילים, לפני שיש לו צורה.' },
  { id: 'recipe', label: 'מתכון', why: 'הגרסאות של המתכון. כל גרסה שומרת צילום ואת נקודת המבט.' },
  { id: 'bare', label: 'ערום', why: 'הגאומטריה לבדה: גוון אחד, הקצה והמידות.' },
  { id: 'realistic', label: 'ריאליסטי', why: 'אותה צורה בחומר, באור של שעה מסוימת ובמקום.' },
  { id: 'render', label: 'הדמיה', why: 'מבט נבחר ברינדור מלא, ותמונות שנוצרו מהפרומפט.' },
  { id: 'print', label: 'הדפסה', why: 'הקובץ שהופך למודל שאפשר לגעת בו.' },
] as const
export type Stage = (typeof STAGES)[number]['id']

/** A frozen view documents the level it was frozen in. */
export const stageOfView = (view: View): Stage => view.level

export interface CollectionVersion extends VersionRow {
  /** 1 for the first version, so "גרסה 3" means the same thing everywhere. */
  number: number
  thumbnail: string | null
}

export interface Collection {
  project: ProjectRow
  latest: (VersionRow & { recipe: Record<string, unknown> }) | null
  /** Oldest first: the order the work was done in. */
  versions: CollectionVersion[]
  /** Oldest first, each with a signed URL. */
  stills: LibraryItem[]
  /** Images uploaded from the visual prompts. */
  images: LibraryItem[]
  reading: Reading | null
}

async function sign(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const signed = await supabase.storage.from(bucket).createSignedUrls(paths, 3600)
  for (const s of signed.data ?? []) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl)
  return out
}

export async function loadCollection(projectId: string): Promise<Collection> {
  const { project, latest } = await projectWithLatest(projectId)
  const v = await supabase.from('mathcreator_recipe_versions').select(VERSION_COLUMNS).eq('project_id', projectId).order('created_at', { ascending: true })
  if (v.error) fail(v.error, 'טעינת הגרסאות')
  const versions = v.data as VersionRow[]
  const snaps = versions.length
    ? await supabase
        .from('mathcreator_snapshots')
        .select('id,version_id,image_path,level,created_at')
        .in(
          'version_id',
          versions.map((x) => x.id),
        )
    : { data: [], error: null }
  if (snaps.error) fail(snaps.error, 'טעינת הצילומים')
  const snapOf = new Map((snaps.data as SnapshotRow[]).map((s) => [s.version_id, s.image_path]))

  const lib = await supabase.from('mathcreator_library').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
  if (lib.error) fail(lib.error, 'טעינת הקולקציה')
  const items = lib.data as LibraryItem[]
  const stills = items.filter((i) => i.kind === 'still')
  const images = items.filter((i) => i.kind === 'image')

  const [snapUrls, libUrls] = await Promise.all([sign(SNAPSHOT_BUCKET, [...snapOf.values()]), sign(LIBRARY_BUCKET, [...stills, ...images].map((i) => i.image_path!))])
  for (const i of [...stills, ...images]) i.url = libUrls.get(i.image_path!)
  const readingItem = [...items].reverse().find((i) => i.kind === 'reading')

  return {
    project,
    latest,
    versions: versions.map((x, i) => ({ ...x, number: i + 1, thumbnail: snapOf.has(x.id) ? (snapUrls.get(snapOf.get(x.id)!) ?? null) : null })),
    stills,
    images,
    reading: readingItem ? readingOf(readingItem) : null,
  }
}

/** Uploads a frozen view and records it on its step. */
export async function addStill(input: { projectId: string; versionId: string; view: View; blob: Blob }): Promise<LibraryItem> {
  const uid = await userId()
  const id = crypto.randomUUID()
  const path = `${uid}/${input.projectId}/${id}.jpg`
  const up = await supabase.storage.from(LIBRARY_BUCKET).upload(path, input.blob, { contentType: 'image/jpeg', upsert: false })
  if (up.error) fail(up.error, 'העלאת המבט')
  const res = await supabase
    .from('mathcreator_library')
    .insert({ id, project_id: input.projectId, version_id: input.versionId, kind: 'still', stage: stageOfView(input.view), view: input.view, image_path: path })
    .select()
    .single()
  if (res.error) fail(res.error, 'שמירת המבט')
  const signed = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrl(path, 3600)
  return { ...(res.data as LibraryItem), url: signed.data?.signedUrl }
}
