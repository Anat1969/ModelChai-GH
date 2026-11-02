/**
 * The print file of a tiling (DECISIONS.md 148). Same contract as the sweep's and the surface's: scaled so the
 * longest side has the chosen size, closed, with walls the printer can lay. The elements stand apart, so they
 * stand on a shared base plate, 2 mm thick, under their plan's bounding rectangle: the print is one piece.
 */
import type { Recipe, TilingParams } from '../../recipe/schema'
import { closedMeshVolume } from '../sweep/closedMesh'
import { prismsSolid } from '../tiling/build'
import { layout, type Element } from '../tiling/patterns'
import type { SolidMesh } from '../types'
import { PLA_DENSITY, bounds, fmt, openEdges, printOrientation, type PrintCheck, type PrintOptions, type PrintReport } from './print'

/** The base plate under the elements, mm. */
export const BASE_PLATE_MM = 2

/** The smallest plan side of an element, m: what the printer must lay as a wall. */
function thinnest(elements: Element[]): number {
  let t = Infinity
  for (const e of elements)
    for (let i = 0; i < e.poly.length; i++) {
      const [ax, az] = e.poly[i]!, [bx, bz] = e.poly[(i + 1) % e.poly.length]!
      if (e.poly.length <= 4) t = Math.min(t, Math.hypot(bx - ax, bz - az))
    }
  // Voronoi cells: their narrowest width is about √area; short sides of a cell are not its wall.
  for (const e of elements) if (e.poly.length > 4) t = Math.min(t, Math.sqrt(Math.abs(polyAreaOf(e.poly))))
  return t
}

const polyAreaOf = (p: [number, number][]) => p.reduce((a, [x1, z1], i) => a + x1 * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * z1, 0) / 2

export function prepareTilingPrint(recipe: Recipe, params: TilingParams, opts: PrintOptions): { mesh: SolidMesh; report: PrintReport } {
  const L = layout(params)
  if (!L.elements.length) throw new Error('בדפוס הזה אין אלמנטים, ולכן אין מה להדפיס')
  const y0 = recipe.bare.section_center_height
  const elements = prismsSolid(L.elements, y0)
  const b = bounds(elements.positions)
  const W = b.max[0] - b.min[0], D = b.max[2] - b.min[2], H = b.max[1] - b.min[1]
  // The plate adds height; the longest side is found with it, in a couple of steps.
  let mmPerM = opts.sizeMm / Math.max(W, D, H)
  for (let k = 0; k < 3; k++) mmPerM = opts.sizeMm / Math.max(W, D, H + BASE_PLATE_MM / mmPerM)
  const plateM = BASE_PLATE_MM / mmPerM
  const margin = Math.max(0.6, 0.02 * Math.max(W, D))
  const plate = prismsSolid([{ poly: [[b.min[0] - margin, b.min[2] - margin], [b.min[0] - margin, b.max[2] + margin], [b.max[0] + margin, b.max[2] + margin], [b.max[0] + margin, b.min[2] - margin]], height: plateM, tag: 0 }], y0 - plateM)

  // One mesh: the plate, then the elements standing on it. Both are closed; the slicer unites them.
  const nP = plate.positions.length / 3
  const positions = new Float64Array(plate.positions.length + elements.positions.length)
  positions.set(plate.positions, 0)
  positions.set(elements.positions, plate.positions.length)
  const indices = new Uint32Array(plate.indices.length + elements.indices.length)
  indices.set(plate.indices, 0)
  for (let i = 0; i < elements.indices.length; i++) indices[plate.indices.length + i] = elements.indices[i]! + nP

  const ab = bounds(positions)
  const cx = (ab.min[0] + ab.max[0]) / 2, cz = (ab.min[2] + ab.max[2]) / 2
  const P = new Float64Array(positions.length)
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (positions[i]! - cx) * mmPerM
    P[i + 1] = (positions[i + 1]! - ab.min[1]) * mmPerM
    P[i + 2] = (positions[i + 2]! - cz) * mmPerM
  }
  const mesh: SolidMesh = { positions: P, indices }
  const sizeM: [number, number, number] = [ab.max[0] - ab.min[0], ab.max[2] - ab.min[2], ab.max[1] - ab.min[1]]
  const sizeMm = sizeM.map((v) => v * mmPerM) as [number, number, number]
  const open = openEdges(mesh)
  const volumeCm3 = Math.abs(closedMeshVolume(mesh)) / 1000
  const fits = sizeMm[0] <= opts.bed[0] && sizeMm[1] <= opts.bed[1] && sizeMm[2] <= opts.bed[2]
  const thin = thinnest(L.elements)
  const wallMm = thin * mmPerM
  const maxFit = Math.floor(opts.sizeMm * Math.min(opts.bed[0] / sizeMm[0], opts.bed[1] / sizeMm[1], opts.bed[2] / sizeMm[2]))
  const minFit = Math.ceil((opts.minWallMm / thin) * Math.max(W, D, H))

  const checks: PrintCheck[] = [
    { id: 'closed', ok: open === 0, label: 'גוף אטום', value: open === 0 ? 'אין קצוות פתוחים' : `${open} קצוות פתוחים`, fix: open === 0 ? undefined : 'הסלייסר עלול לא לזהות פנים וחוץ.' },
    {
      id: 'wall',
      ok: wallMm >= opts.minWallMm * 0.999,
      label: 'האלמנט הדק ביותר',
      value: `${fmt(wallMm)} מ"מ (מינימום ${fmt(opts.minWallMm)})`,
      fix: wallMm >= opts.minWallMm * 0.999 ? undefined : `בגודל ${minFit} מ"מ האלמנט הדק מגיע ל-${fmt(opts.minWallMm)} מ"מ.`,
    },
    { id: 'bed', ok: fits, label: 'מידות מול שולחן ההדפסה', value: `${sizeMm.map((v) => fmt(v, 0)).join(' × ')} מ"מ, שולחן ${opts.bed.join(' × ')}`, fix: fits ? undefined : `המודל גדול מהשולחן. בגודל ${maxFit} מ"מ הוא נכנס.` },
  ]
  return {
    mesh,
    report: {
      scale: Math.round(1000 / mmPerM),
      sizeMm,
      sizeM,
      mmPerM,
      body: 'solid',
      recipeWallMm: wallMm,
      wallMm,
      thicknessM: null,
      openEdges: open,
      volumeCm3,
      grams: volumeCm3 * PLA_DENSITY,
      openingsCut: false,
      openingsNote: null,
      orientation: printOrientation(mesh, false),
      belowGroundM: 0,
      belowGroundM3: 0,
      belowGroundShare: 0,
      groundCut: false,
      sectionCenterM: y0,
      bodyNote: `${L.elements.length} האלמנטים עומדים על לוח בסיס משותף בעובי ${BASE_PLATE_MM} מ"מ, כך שהם נדפסים כחלק אחד.`,
      checks,
    },
  }
}
