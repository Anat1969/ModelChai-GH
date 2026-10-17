/**
 * Getting a model ready for a home FDM printer in PLA (DECISIONS.md 87). Export only: the recipe never changes.
 * The model is scaled so its longest side has the chosen size in millimeters. A shell whose wall would print
 * thinner than the minimum is thickened for the print, or printed solid when it cannot be. Openings are left
 * out until their reveals close them (stage 6). The ground is the recipe's level zero (the engine is Y up): what
 * lies below it is cut away and the cut is capped, so the print is the building as it stands (DECISIONS.md 113).
 */
import type { Recipe, SweepParams } from '../../recipe/schema'
import { closedMeshVolume, buildClosedMesh } from '../sweep/closedMesh'
import { cutBelow } from '../planeCut'
import { createSetup, innerScale, recipeResolution, surfaceGrid } from '../sweep/setup'
import type { SolidMesh } from '../types'

export interface PrintOptions {
  /** The model's longest side, in mm. */
  sizeMm: number
  /** Printer bed width, depth and height, in mm. */
  bed: [number, number, number]
  /** The thinnest wall the printer lays reliably, in mm. */
  minWallMm: number
  /** Cut away what lies below the ground (model Y = 0) and cap the cut. */
  groundCut: boolean
}

export const PRINT_DEFAULTS: PrintOptions = { sizeMm: 150, bed: [220, 220, 250], minWallMm: 2, groundCut: true }

/** The ground, in the engine's axes: Y up, level zero of the recipe. */
export const GROUND_Y = 0

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
  /** The same size in the building, in meters: width, depth, height above the ground. */
  sizeM: [number, number, number]
  /** Millimeters of print per meter of building. */
  mmPerM: number
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
  /** How far the model reaches below the ground, in meters. */
  belowGroundM: number
  /** Volume of the building as designed (without openings) below the ground, in m³; cut away when `groundCut`. */
  belowGroundM3: number
  /** The same as a share of the designed volume, 0–1. */
  belowGroundShare: number
  /** True when geometry below the ground was cut away and the cut capped. */
  groundCut: boolean
  /** Height of the section center above the ground, in meters (recipe `bare.section_center_height`). */
  sectionCenterM: number
  /** One sentence on what was done to the body, or null when it prints as designed. */
  bodyNote: string | null
  checks: PrintCheck[]
}

const fmt = (v: number, d = 1) => v.toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d })

/**
 * Thinnest wall of a shell, in meters: in each cross-section, the distance from every inner point to the outer
 * outline. The inner wall is the same section scaled about its center, so the two outlines share a plane.
 */
export function minWall(recipe: Recipe, params: SweepParams, aboveY = -Infinity): number | null {
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
      // Below the ground the wall is cut away, so it does not count.
      if (py < aboveY) continue
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
  return Number.isFinite(best) ? Math.sqrt(best) : null
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
  const ground = opts.groundCut ? GROUND_Y : -Infinity
  const cut = (m: SolidMesh): SolidMesh => {
    if (!opts.groundCut) return m
    const c = cutBelow(m, GROUND_Y)
    if (!c.mesh.indices.length) throw new Error('כל המודל מתחת למפלס הקרקע, ולכן אין מה להדפיס. אפשר להגביה את מרכז החתך')
    return c.mesh
  }
  const outerWhole = buildClosedMesh(solidOf(recipe), params, { withOpenings: false })
  const outer = cut(outerWhole)
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
    recipeWall = minWall(recipe, params, ground)
    wall = recipeWall
    // The wall does not grow in proportion to the thickness (a cusp narrows it), so search: the thinnest
    // shell whose thinnest wall reaches the minimum.
    if (wall !== null && wall < targetM) {
      const wallAt = (t: number) => minWall(withThickness(recipe, t), params, ground) ?? 0
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

  const whole = body === 'solid' ? outerWhole : buildClosedMesh(printed, params, { withOpenings: false })
  const solid = body === 'solid' ? outer : cut(whole)
  const wholeMin = bounds(whole.positions).min[1]
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
  const sizeM: [number, number, number] = [b.max[0] - b.min[0], b.max[2] - b.min[2], b.max[1] - b.min[1]]
  const sizeMm = sizeM.map((v) => v * mmPerM) as [number, number, number]
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

  const belowGroundM = Math.max(0, GROUND_Y - wholeMin)
  // What is buried, measured on the building as designed: the recipe's own body, not the thickened print.
  let belowGroundM3 = 0, belowGroundShare = 0
  if (opts.groundCut && belowGroundM > 0) {
    const design = recipe.bare.mode === 'solid' ? outerWhole : printed === recipe ? whole : buildClosedMesh(recipe, params, { withOpenings: false })
    const all = Math.abs(closedMeshVolume(design))
    belowGroundM3 = Math.max(0, all - Math.abs(closedMeshVolume(design === whole ? solid : cut(design))))
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
      recipeWallMm: recipeWall === null ? null : recipeWall * mmPerM,
      wallMm,
      thicknessM: thickness,
      openEdges: open,
      volumeCm3,
      grams: volumeCm3 * PLA_DENSITY,
      openingsDropped,
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
