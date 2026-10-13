/** Export entry point; runs in the Worker. The PNG snapshot is taken from the canvas on the main thread. */
import { build } from '../build'
import { buildClosedMesh } from '../sweep/closedMesh'
import { parseRecipe } from '../../recipe/schema'
import { writeGlb } from './glb'
import { writeObj } from './obj'
import { writeStl } from './stl'

export type ExportFormat = 'obj' | 'stl' | 'glb' | 'json'

export interface ExportFile {
  filename: string
  mime: string
  bytes: Uint8Array
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  obj: 'model/obj',
  stl: 'model/stl',
  glb: 'model/gltf-binary',
  json: 'application/json',
}

export function exportFile(input: unknown, format: ExportFormat): ExportFile | { error: string } {
  const parsed = parseRecipe(input)
  if (!parsed.ok) return { error: 'המתכון לא עומד בסכמה, ולכן אי אפשר לייצא אותו' }
  const recipe = parsed.recipe
  const filename = `${recipe.meta.id}.${format}`
  const title = `${recipe.narrative.name_he} | ${recipe.concept.name}`
  if (format === 'json') {
    return { filename, mime: EXPORT_MIME.json, bytes: new TextEncoder().encode(JSON.stringify(input, null, 2) + '\n') }
  }
  if (recipe.generator.type !== 'sweep') return { error: 'במוצר המינימלי אפשר לייצא רק מחולל סוויפ' }
  if (format === 'stl') {
    const mesh = buildClosedMesh(recipe, recipe.generator.params)
    return { filename, mime: EXPORT_MIME.stl, bytes: writeStl(mesh, `${recipe.concept.name}, meters, Z up`) }
  }
  // OBJ and glTF take the display meshes at export resolution: path samples doubled (GENERATORS.md 1.4).
  const res = recipe.generator.params.resolution
  const r = build(input, {
    pathSegments: (res?.path_segments ?? 360) * 2,
    sectionSegments: res?.section_segments ?? 144,
  })
  if (!r.ok) return { error: 'המודל לא נבנה, ולכן אין מה לייצא' }
  if (format === 'obj') return { filename, mime: EXPORT_MIME.obj, bytes: new TextEncoder().encode(writeObj(r, title)) }
  return { filename, mime: EXPORT_MIME.glb, bytes: writeGlb(r, recipe, title) }
}
