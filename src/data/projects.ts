/**
 * Projects, immutable versions and snapshots (ARCHITECTURE.md 4, PRODUCT.md "מודל נתונים").
 * Ids are made on the client, so a save that is retried after a dropped connection writes the same rows
 * instead of new ones: every insert ignores a row that already exists.
 */
import type { CameraPreset, Level } from '../ui/store'
import { supabase } from './supabase'

export const SNAPSHOT_BUCKET = 'mathcreator-snapshots'

export type Vec3 = [number, number, number]

/** How the version was being looked at when it was saved. */
export interface View {
  level: Level
  camera: { preset: CameraPreset; position: Vec3; target: Vec3 }
}

export interface ProjectRow {
  id: string
  concept: string
  title_he: string
  created_at: string
  updated_at: string
}

export interface VersionRow {
  id: string
  project_id: string
  parent_id: string | null
  note: string | null
  schema_version: string
  view: View | null
  created_at: string
  recipe?: Record<string, unknown>
}

export interface SnapshotRow {
  id: string
  version_id: string
  image_path: string
  visual_prompt: string | null
  level: Level
  created_at: string
}

export interface ProjectSummary extends ProjectRow {
  /** Newest first. */
  versions: VersionRow[]
  /** Signed URL of the newest snapshot, if any. */
  thumbnail: string | null
}

const VERSION_COLUMNS = 'id,project_id,parent_id,note,schema_version,view,created_at'

export class DataError extends Error {
  constructor(
    message: string,
    /** True when the request never reached the server: the save can wait in the offline queue. */
    readonly offline: boolean,
  ) {
    super(message)
  }
}

function fail(error: { message: string } | null, what: string): never {
  const msg = error?.message ?? 'unknown'
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|load failed/i.test(msg)
  throw new DataError(offline ? `אין חיבור לשרת (${what}).` : `${what} נכשל: ${msg}`, offline)
}

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new DataError('צריך להיות מחוברים כדי לשמור.', false)
  return id
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await supabase.from('mathcreator_projects').select('id,concept,title_he,created_at,updated_at').order('updated_at', { ascending: false })
  if (projects.error) fail(projects.error, 'טעינת הפרויקטים')
  const rows = projects.data as ProjectRow[]
  if (!rows.length) return []
  const versions = await supabase
    .from('mathcreator_recipe_versions')
    .select(VERSION_COLUMNS)
    .in(
      'project_id',
      rows.map((p) => p.id),
    )
    .order('created_at', { ascending: false })
  if (versions.error) fail(versions.error, 'טעינת הגרסאות')
  const vs = versions.data as VersionRow[]
  const snaps = vs.length
    ? await supabase
        .from('mathcreator_snapshots')
        .select('id,version_id,image_path,level,created_at')
        .in(
          'version_id',
          vs.map((v) => v.id),
        )
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (snaps.error) fail(snaps.error, 'טעינת הצילומים')
  const byVersion = new Map<string, SnapshotRow>()
  for (const s of snaps.data as SnapshotRow[]) if (!byVersion.has(s.version_id)) byVersion.set(s.version_id, s)

  const latestPath = new Map<string, string>()
  for (const p of rows) {
    const v = vs.find((x) => x.project_id === p.id && byVersion.has(x.id))
    if (v) latestPath.set(p.id, byVersion.get(v.id)!.image_path)
  }
  const urls = new Map<string, string>()
  if (latestPath.size) {
    const signed = await supabase.storage.from(SNAPSHOT_BUCKET).createSignedUrls([...latestPath.values()], 3600)
    for (const s of signed.data ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl)
  }
  return rows.map((p) => ({
    ...p,
    versions: vs.filter((v) => v.project_id === p.id),
    thumbnail: latestPath.has(p.id) ? (urls.get(latestPath.get(p.id)!) ?? null) : null,
  }))
}

export async function getVersion(id: string): Promise<VersionRow & { recipe: Record<string, unknown>; project: ProjectRow }> {
  const v = await supabase.from('mathcreator_recipe_versions').select('*').eq('id', id).single()
  if (v.error) fail(v.error, 'טעינת הגרסה')
  const p = await supabase.from('mathcreator_projects').select('id,concept,title_he,created_at,updated_at').eq('id', (v.data as VersionRow).project_id).single()
  if (p.error) fail(p.error, 'טעינת הפרויקט')
  return { ...(v.data as VersionRow & { recipe: Record<string, unknown> }), project: p.data as ProjectRow }
}

export interface SaveInput {
  project: { id: string; concept: string; title_he: string }
  versionId: string
  parentId: string | null
  recipe: Record<string, unknown>
  view: View
  note: string | null
  /** PNG of the 1:1 view, as a data URL so it survives in the offline queue. */
  snapshot: string | null
  visualPrompt: string | null
}

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob()

/** Writes a version and its snapshot. Safe to repeat with the same input. */
export async function saveVersion(input: SaveInput): Promise<void> {
  const uid = await userId()
  const project = await supabase
    .from('mathcreator_projects')
    .upsert({ id: input.project.id, concept: input.project.concept.slice(0, 120), title_he: input.project.title_he.slice(0, 80) }, { onConflict: 'id', ignoreDuplicates: true })
  if (project.error) fail(project.error, 'שמירת הפרויקט')

  // The version records its parent inside the recipe too, so an exported JSON still knows where it came from.
  const recipe = { ...input.recipe, meta: { ...(input.recipe.meta as object), parent_id: input.parentId } }
  const version = await supabase.from('mathcreator_recipe_versions').upsert(
    {
      id: input.versionId,
      project_id: input.project.id,
      parent_id: input.parentId,
      recipe,
      schema_version: String(input.recipe.schema_version ?? '1.0'),
      note: input.note?.slice(0, 280) || null,
      view: input.view,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (version.error) fail(version.error, 'שמירת הגרסה')

  if (input.snapshot) {
    const path = `${uid}/${input.versionId}.png`
    const up = await supabase.storage.from(SNAPSHOT_BUCKET).upload(path, await dataUrlToBlob(input.snapshot), { contentType: 'image/png', upsert: false })
    // A retry finds the file already there; that is the same snapshot.
    if (up.error && !/exists|duplicate/i.test(up.error.message)) fail(up.error, 'העלאת הצילום')
    const snap = await supabase.from('mathcreator_snapshots').upsert(
      { id: input.versionId, version_id: input.versionId, image_path: path, visual_prompt: input.visualPrompt, level: input.view.level },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (snap.error) fail(snap.error, 'שמירת הצילום')
  }

  // Moves the project to the top of the list: the update trigger stamps updated_at.
  const touch = await supabase.from('mathcreator_projects').update({ title_he: input.project.title_he.slice(0, 80) }).eq('id', input.project.id)
  if (touch.error) fail(touch.error, 'עדכון הפרויקט')
}
