/**
 * The project's documents in the collection (DECISIONS.md 94): each PDF or Word file made from the document is
 * kept as `kind = 'dossier'` in the library table and bucket, with the version it was made from. A share link
 * is a signed URL that works without an account, for a limited time.
 */
import { fail, LIBRARY_BUCKET, userId, type LibraryItem } from './library'
import { supabase } from './supabase'

export const DOSSIER_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const
export type DossierFormat = keyof typeof DOSSIER_MIME

/** How long a share link stays open. */
export const SHARE_DAYS = 30

export async function listDossiers(projectId: string): Promise<LibraryItem[]> {
  const res = await supabase.from('mathcreator_library').select('*').eq('project_id', projectId).eq('kind', 'dossier').order('created_at', { ascending: false })
  if (res.error) fail(res.error, 'טעינת המסמכים')
  return res.data as LibraryItem[]
}

/** Uploads the file and records it. `distill` keeps the file name a person sees. */
export async function saveDossier(input: { projectId: string; versionId: string | null; format: DossierFormat; blob: Blob; fileName: string }): Promise<LibraryItem> {
  const uid = await userId()
  const id = crypto.randomUUID()
  const path = `${uid}/${input.projectId}/${id}.${input.format}`
  const up = await supabase.storage.from(LIBRARY_BUCKET).upload(path, input.blob, { contentType: DOSSIER_MIME[input.format], upsert: false })
  if (up.error) fail(up.error, 'העלאת המסמך')
  const res = await supabase
    .from('mathcreator_library')
    .insert({ id, project_id: input.projectId, version_id: input.versionId, kind: 'dossier', image_path: path, distill: input.fileName })
    .select()
    .single()
  if (res.error) fail(res.error, 'שמירת המסמך בקולקציה')
  return res.data as LibraryItem
}

/** A link that opens the file without an account, for SHARE_DAYS days, and downloads it under its own name. */
export async function shareLink(item: LibraryItem): Promise<string> {
  const res = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrl(item.image_path!, SHARE_DAYS * 24 * 3600, { download: item.distill ?? true })
  if (res.error || !res.data) fail(res.error, 'יצירת קישור לשיתוף')
  return res.data.signedUrl
}
