/**
 * Getting a model ready for a home FDM printer in PLA (DECISIONS.md 87). Export only: the recipe never changes.
 * The model is scaled so its longest side has the chosen size in millimeters. A shell whose wall would print
 * thinner than the minimum is thickened for the print, or printed solid when it cannot be. Openings are left
 * out until their reveals close them (stage 6).
 */
import type { Recipe, SweepParams } from '../../recipe/schema'
import { closedMeshVolume, buildClosedMesh } from '../sweep/closedMesh'
import { createSetup, innerScale, recipeResolution, surfaceGrid } from '../sweep/setup'
import type { SolidMesh } from '../types'

export interface PrintOptions {
  /** The model's longest side, in mm. */
  sizeMm: number
  /** Printer bed width, depth and height, in mm. */
  bed: [number, number, number]
  /** The thinnest wall the printer lays reliably, in mm. */
  minWallMm: number
}

export const PRINT_DEFAULTS: PrintOptions = { sizeMm: 150, bed: [220, 220, 250], minWallMm: 2 }

/** g/cm³. */
export const PLA_DENSITY = 1.24

export type Body = 'solid' | 'shell' | 'shell-thickened' | 'solid-from-shell'

export interface PrintCheck {
  id: 'closed' | 'wall' | 'bed'
  ok: boolean
  label: string
  value: string
  /** A way out, when the check fails. */
  fix?: string
}

export interface PrintReport {
  /** The scale denominator: 412 means 1:412. */
  scale: number
  /** Printed size along the printer's X, Y and Z (Z up), in mm. */
  sizeMm: [number, number, number]
  body: Body
  /** Thinnest wall at the recipe's own thickness, in mm at this scale. Null for a solid. */
  recipeWallMm: number | null
  /** Thinnest wall as printed, in mm. Null for a solid. */
  wallMm: number | null
  /** Shell thickness used for the print, in meters of the building. */
  thicknessM: number | null
  openEdges: number
  volumeCm3: number
  grams: number
  openingsDropped: boolean
  /** How far the model reaches below the ground, in meters; it prints whole. */
  belowGroundM: number
  /** One sentence on what was done to the body, or null when it prints as designed. */
  bodyNote: string | null
  checks: PrintCheck[]
}

const fmt = (v: number, d = 1) => v.toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d })

/**
 * Thinnest wall of a shell, in meters: in each cross-section, the distance from every inner point to the outer
 * outline. The inner wall is the same section scaled about its center, so the two outlines share a plane.
 */
export function minWall(recipe: Recipe, params: SweepParams): number | null {
  const k = innerScale(recipe, params)
  if (k === null) return null
  const s = createSetup(recipe, params, recipeResolution(params))
  const outer = surfaceGrid(s, 1)
  const inner = surfaceGrid(s, k)
  const { rows, M } = s
  let best = Infinity
  for (let i = 0; i < rows; i++) {
    const base = 3 * i * M
    for (let j = 0; j < M; j++) {
      const px = inner[base + 3 * j]!, py = inner[base + 3 * j + 1]!, pz = inner[base + 3 * j + 2]!
      for (let m = 0; m < M; m++) {
        const a = base + 3 * m, b = base + 3 * ((m + 1) % M)
        const ax = outer[a]!, ay = outer[a + 1]!, az = outer[a + 2]!
        const ex = outer[b]! - ax, ey = outer[b + 1]! - ay, ez = outer[b + 2]! - az
        const L = ex * ex + ey * ey + ez * ez
        const t = L > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / L)) : 0
        const dx = ax + t * ex - px, dy = ay + t * ey - py, dz = az + t * ez - pz
        const d = dx * dx + dy * dy + dz * dz
        if (d < best) best = d
      }
    }
  }
  return Math.sqrt(best)
}

/** Edges that do not join exactly two triangles. Zero means the body is closed. */
export function openEdges(m: SolidMesh): number {
  const nv = m.positions.length / 3
  const count = new Map<number, number>()
  const I = m.indices
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!
      const key = a < b ? a * nv + b : b * nv + a
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const c of count.values()) if (c !== 2) open++
  return open
}

/** Axis-aligned bounds of a mesh in its own (Y up) axes. */
function bounds(p: Float64Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k]! < min[k]!) min[k] = p[i + k]!
      if (p[i + k]! > max[k]!) max[k] = p[i + k]!
    }
  return { min, max }
}

const withThickness = (recipe: Recipe, thickness: number): Recipe => {
  const r = structuredClone(recipe)
  if (r.bare.mode === 'shell' && r.bare.shell) r.bare.shell.thickness = thickness
  return r
}

const solidOf = (recipe: Recipe): Recipe => {
  const r = structuredClone(recipe)
  r.bare.mode = 'solid'
  return r
}

export function preparePrint(recipe: Recipe, opts: PrintOptions = PRINT_DEFAULTS): { mesh: SolidMesh; report: PrintReport } {
  if (recipe.generator.type !== 'sweep') throw new Error('אפשר להכין להדפסה רק מחולל סוויפ')
  const params = recipe.generator.params
  const outer = buildClosedMesh(solidOf(recipe), params, { withOpenings: false })
  const b0 = bounds(outer.positions)
  const longestM = Math.max(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2])
  const mmPerM = opts.sizeMm / longestM
  const scale = Math.round(1000 / mmPerM)
  const targetM = opts.minWallMm / mmPerM

  // The body: a shell thick enough to print, or a solid.
  let body: Body = recipe.bare.mode === 'shell' ? 'shell' : 'solid'
  let printed = recipe
  let recipeWall: number | null = null
  let wall: number | null = null
  let thickness: number | null = null
  let bodyNote: string | null = null
  if (body === 'shell') {
    const a = params.section.a
    thickness = recipe.bare.shell!.thickness
    recipeWall = minWall(recipe, params)
    wall = recipeWall
    // The wall does not grow in proportion to the thickness (a cusp narrows it), so search: the thinnest
    // shell whose thinnest wall reaches the minimum.
    if (wall !== null && wall < targetM) {
      const wallAt = (t: number) => minWall(withThickness(recipe, t), params) ?? 0
      let lo = thickness, hi = a * 0.9
      if (wallAt(hi) >= targetM) {
        for (let n = 0; n < 14; n++) {
          const mid = (lo + hi) / 2
          if (wallAt(mid) >= targetM) hi = mid
          else lo = mid
        }
        thickness = hi
        printed = withThickness(recipe, thickness)
        wall = wallAt(thickness)
        body = 'shell-thickened'
      }
    }
    if (wall === null || wall < targetM * 0.999) {
      body = 'solid-from-shell'
      printed = solidOf(recipe)
      bodyNote = `בקנה המידה הזה הקליפה הייתה דקה מ-${fmt(opts.minWallMm)} מ"מ גם בעובי המרבי, ולכן היא מודפסת כגוף מלא. בגודל גדול יותר אפשר לשמור על החלל.`
      wall = null
      thickness = null
    } else if (body === 'shell-thickened') {
      bodyNote = `הדופן עובתה להדפסה מ-${fmt(recipe.bare.shell!.thickness, 2)} מ' ל-${fmt(thickness!, 2)} מ' של המבנה, כדי שתהיה לפחות ${fmt(opts.minWallMm)} מ"מ. המתכון לא השתנה.`
    }
  }

  const solid = body === 'solid' ? outer : buildClosedMesh(printed, params, { withOpenings: false })
  const openingsDropped = recipe.bare.mode === 'shell' && !!recipe.bare.openings && ((recipe.bare.openings.passages?.count ?? 0) > 0 || (recipe.bare.openings.slots?.count ?? 0) > 0)

  // To millimeters, resting on the bed (Y up here; the writers turn it to Z up), centered.
  const b = bounds(solid.positions)
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
  const P = new Float64Array(solid.positions.length)
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (solid.positions[i]! - cx) * mmPerM
    P[i + 1] = (solid.positions[i + 1]! - b.min[1]) * mmPerM
    P[i + 2] = (solid.positions[i + 2]! - cz) * mmPerM
  }
  const mesh: SolidMesh = { positions: P, indices: solid.indices }
  // Printer axes: X, Y on the bed and Z up, from the model's X, Z and Y.
  const sizeMm: [number, number, number] = [(b.max[0] - b.min[0]) * mmPerM, (b.max[2] - b.min[2]) * mmPerM, (b.max[1] - b.min[1]) * mmPerM]
  const open = openEdges(mesh)
  const volumeCm3 = Math.abs(closedMeshVolume(mesh)) / 1000
  const fits = sizeMm[0] <= opts.bed[0] && sizeMm[1] <= opts.bed[1] && sizeMm[2] <= opts.bed[2]
  const wallMm = wall === null ? null : wall * mmPerM
  const maxFit = Math.floor(opts.sizeMm * Math.min(opts.bed[0] / sizeMm[0], opts.bed[1] / sizeMm[1], opts.bed[2] / sizeMm[2]))

  const checks: PrintCheck[] = [
    {
      id: 'closed',
      ok: open === 0,
      label: 'גוף אטום',
      value: open === 0 ? 'אין קצוות פתוחים' : `${open} קצוות פתוחים`,
      fix: open === 0 ? undefined : 'הסלייסר עלול לא לזהות פנים וחוץ. כדאי לייצא את המודל כגוף מלא.',
    },
    {
      id: 'wall',
      ok: wallMm === null || wallMm >= opts.minWallMm * 0.999,
      label: 'עובי דופן מינימלי',
      value: wallMm === null ? 'גוף מלא' : `${fmt(wallMm)} מ"מ (מינימום ${fmt(opts.minWallMm)})`,
    },
    {
      id: 'bed',
      ok: fits,
      label: 'מידות מול שולחן ההדפסה',
      value: `${sizeMm.map((v) => fmt(v, 0)).join(' × ')} מ"מ, שולחן ${opts.bed.join(' × ')}`,
      fix: fits ? undefined : `המודל גדול מהשולחן. בגודל ${maxFit} מ"מ הוא נכנס.`,
    },
  ]

  const belowGroundM = Math.max(0, -b.min[1])
  return {
    mesh,
    report: {
      scale,
      sizeMm,
      body,
      recipeWallMm: recipeWall === null ? null : recipeWall * mmPerM,
      wallMm,
      thicknessM: thickness,
      openEdges: open,
      volumeCm3,
      grams: volumeCm3 * PLA_DENSITY,
      openingsDropped,
      belowGroundM,
      bodyNote,
      checks,
    },
  }
}
