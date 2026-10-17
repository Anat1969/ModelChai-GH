/**
 * The print file of a parametric surface (DECISIONS.md 140). Same contract as the sweep's (print.ts): scaled so
 * the longest side has the chosen size, cut at the ground and capped, closed, with a wall the printer can lay.
 * The shell is a normal offset, so its wall is the same everywhere: the recipe's thickness at the print's scale.
 * When that is too thin, the print thickens the shell up to what the surface's tightest bend allows.
 */
import type { Recipe, SurfaceParams } from '../../recipe/schema'
import { cutBelow } from '../planeCut'
import { buildSurfaceClosedMesh } from '../surface/build'
import { family, minCurvatureRadius } from '../surface/families'
import type { SolidMesh } from '../types'
import { closedMeshVolume } from '../sweep/closedMesh'
import { GROUND_Y, PLA_DENSITY, bounds, fmt, openEdges, printOrientation, type Body, type PrintCheck, type PrintOptions, type PrintReport } from './print'

const withThickness = (recipe: Recipe, thickness: number): Recipe => {
  const r = structuredClone(recipe)
  if (r.bare.shell) r.bare.shell.thickness = thickness
  return r
}

export function prepareSurfacePrint(recipe: Recipe, params: SurfaceParams, opts: PrintOptions): { mesh: SolidMesh; report: PrintReport } {
  const cut = (m: SolidMesh): SolidMesh => {
    if (!opts.groundCut) return m
    // A shell standing on the ground touches it at its lowest vertex: there is nothing to cut, and a cut a hair
    // above would only shave its rim.
    if (bounds(m.positions).min[1] >= GROUND_Y - 1e-6) return m
    const c = cutBelow(m, GROUND_Y)
    if (!c.mesh.indices.length) throw new Error('כל המודל מתחת למפלס הקרקע, ולכן אין מה להדפיס. אפשר להגביה את הבסיס')
    return c.mesh
  }
  const longest = (m: SolidMesh) => {
    const b = bounds(m.positions)
    return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  }
  const designWhole = buildSurfaceClosedMesh(recipe, params)
  const design = cut(designWhole)
  let mmPerM = opts.sizeMm / longest(design)

  const recipeT = recipe.bare.shell?.thickness ?? 0.08
  let thickness = recipeT
  let body: Body = 'shell'
  let bodyNote: string | null = null
  let printed = recipe
  let whole = designWhole
  let solid = design
  // The offset folds where the surface bends tighter than half the wall (rule 17): the most it can thicken.
  const maxT = 2 * minCurvatureRadius(family(params)) * 0.95
  if (recipeT * mmPerM < opts.minWallMm) {
    // A thicker shell is also a little larger, so the thickness and the scale are found together.
    for (let k = 0; k < 4; k++) {
      const want = (opts.minWallMm / mmPerM) * 1.001
      if (want > maxT) {
        thickness = Math.max(recipeT, maxT)
        bodyNote = `בקנה המידה הזה הדופן דקה מ-${fmt(opts.minWallMm)} מ"מ, ולעבות אותה יותר יקפל את המשטח על עצמו. בגודל גדול יותר היא נדפסת שלמה.`
        printed = withThickness(recipe, thickness)
        whole = buildSurfaceClosedMesh(printed, params)
        solid = cut(whole)
        mmPerM = opts.sizeMm / longest(solid)
        break
      }
      thickness = want
      body = 'shell-thickened'
      printed = withThickness(recipe, thickness)
      whole = buildSurfaceClosedMesh(printed, params)
      solid = cut(whole)
      const next = opts.sizeMm / longest(solid)
      const settled = Math.abs(next - mmPerM) / mmPerM < 1e-5
      mmPerM = next
      if (settled) break
    }
    if (body === 'shell-thickened') {
      bodyNote = `הדופן עובתה להדפסה מ-${fmt(recipeT, 2)} מ' ל-${fmt(thickness, 2)} מ' של המבנה, כדי שתהיה לפחות ${fmt(opts.minWallMm)} מ"מ. המתכון לא השתנה.`
    }
  }
  const scale = Math.round(1000 / mmPerM)
  if (params.family === 'klein_bottle') {
    const knot = 'בקבוק קליין עובר דרך עצמו בטבעת אחת: הגוף סגור, והסלייסר מאחד את החפיפה בהדפסה.'
    bodyNote = bodyNote ? `${bodyNote} ${knot}` : knot
  }

  const b = bounds(solid.positions)
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
  const P = new Float64Array(solid.positions.length)
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (solid.positions[i]! - cx) * mmPerM
    P[i + 1] = (solid.positions[i + 1]! - b.min[1]) * mmPerM
    P[i + 2] = (solid.positions[i + 2]! - cz) * mmPerM
  }
  const mesh: SolidMesh = { positions: P, indices: solid.indices }
  const sizeM: [number, number, number] = [b.max[0] - b.min[0], b.max[2] - b.min[2], b.max[1] - b.min[1]]
  const sizeMm = sizeM.map((v) => v * mmPerM) as [number, number, number]
  const open = openEdges(mesh)
  const volumeCm3 = Math.abs(closedMeshVolume(mesh)) / 1000
  const fits = sizeMm[0] <= opts.bed[0] && sizeMm[1] <= opts.bed[1] && sizeMm[2] <= opts.bed[2]
  const wallMm = thickness * mmPerM
  const maxFit = Math.floor(opts.sizeMm * Math.min(opts.bed[0] / sizeMm[0], opts.bed[1] / sizeMm[1], opts.bed[2] / sizeMm[2]))
  const minFit = Math.ceil((opts.minWallMm / recipeT) * longest(design))

  const checks: PrintCheck[] = [
    {
      id: 'closed',
      ok: open === 0,
      label: 'גוף אטום',
      value: open === 0 ? 'אין קצוות פתוחים' : `${open} קצוות פתוחים`,
      fix: open === 0 ? undefined : 'הסלייסר עלול לא לזהות פנים וחוץ.',
    },
    {
      id: 'wall',
      ok: wallMm >= opts.minWallMm * 0.999,
      label: 'עובי דופן מינימלי',
      value: `${fmt(wallMm)} מ"מ (מינימום ${fmt(opts.minWallMm)})`,
      fix: wallMm >= opts.minWallMm * 0.999 ? undefined : `בגודל ${minFit} מ"מ הדופן מגיעה ל-${fmt(opts.minWallMm)} מ"מ בלי לעבות.`,
    },
    {
      id: 'bed',
      ok: fits,
      label: 'מידות מול שולחן ההדפסה',
      value: `${sizeMm.map((v) => fmt(v, 0)).join(' × ')} מ"מ, שולחן ${opts.bed.join(' × ')}`,
      fix: fits ? undefined : `המודל גדול מהשולחן. בגודל ${maxFit} מ"מ הוא נכנס.`,
    },
  ]

  const wholeMin = bounds(whole.positions).min[1]
  const belowGroundM = Math.max(0, GROUND_Y - wholeMin)
  let belowGroundM3 = 0, belowGroundShare = 0
  if (opts.groundCut && belowGroundM > 0) {
    const all = Math.abs(closedMeshVolume(designWhole))
    belowGroundM3 = Math.max(0, all - Math.abs(closedMeshVolume(design)))
    belowGroundShare = all > 0 ? belowGroundM3 / all : 0
  }
  return {
    mesh,
    report: {
      scale,
      sizeMm,
      sizeM,
      mmPerM,
      body,
      recipeWallMm: recipeT * mmPerM,
      wallMm,
      thicknessM: thickness,
      openEdges: open,
      volumeCm3,
      grams: volumeCm3 * PLA_DENSITY,
      // Openings are not built on a surface (DECISIONS.md 137), so there are none to cut.
      openingsCut: false,
      openingsNote: null,
      orientation: printOrientation(mesh, opts.groundCut && belowGroundM > 0),
      belowGroundM,
      belowGroundM3,
      belowGroundShare,
      groundCut: opts.groundCut && belowGroundM > 0,
      sectionCenterM: recipe.bare.section_center_height,
      bodyNote,
      checks,
    },
  }
}
