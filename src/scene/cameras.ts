/**
 * Camera presets (LEVELS.md 2.5), as pure functions of the recipe. Positions follow the reference model
 * "הטבעת המשולשת" for ring paths, and fall back to framing the bounds for open paths.
 */
import { sectionCut } from '../engine/sectionCut'
import { surfaceBox } from '../engine/surface/build'
import { outerRadius } from '../recipe/rules'
import type { SurfaceRecipe } from '../recipe/schema'
import type { Built, Sweep } from '../ui/params'
import type { CameraPreset } from '../ui/store'

export type Vec3 = [number, number, number]
export type CameraPose = { position: Vec3; target: Vec3 } | { unavailable: string }

const TAU = Math.PI * 2

/** Center and radius of the model's footprint, plus its top. */
export function bounds(r: Built): { center: Vec3; extent: number; top: number } {
  if (r.generator.type === 'parametric_surface') {
    const b = surfaceBox(r, r.generator.params)
    return { center: b.center, extent: b.extent, top: b.top }
  }
  const p = r.generator.params
  const h0 = r.bare.section_center_height
  const rOut = outerRadius(p.section) * Math.max(1, p.path.type === 'circle' || p.path.type === 'ellipse' ? 1 : p.scale_along_path)
  switch (p.path.type) {
    case 'circle':
      return { center: [0, h0, 0], extent: p.path.R! + rOut, top: h0 + rOut }
    case 'ellipse':
      return { center: [0, h0, 0], extent: Math.max(p.path.R!, p.path.R2!) + rOut, top: h0 + rOut }
    case 'helix': {
      const rise = p.path.pitch! * p.path.turns!
      return { center: [0, h0 + rise / 2, 0], extent: Math.max(p.path.R! + rOut, rise / 2), top: h0 + rise + rOut }
    }
    case 'line':
      return { center: [0, h0, p.path.length! / 2], extent: p.path.length! / 2 + rOut, top: h0 + rOut }
  }
}

/** Presets for a parametric surface (DECISIONS.md 139): framed on its box, inside where there is an inside. */
function surfacePose(r: SurfaceRecipe, preset: CameraPreset): CameraPose {
  const p = r.generator.params
  const eye = r.realistic.camera.height
  const b = surfaceBox(r, p)
  const [cx, , cz] = b.center
  const E = b.extent
  switch (preset) {
    case 'eye_level_oblique': {
      // Far enough that the whole height fits the 42° view (a tower is framed by its height, a canopy by its plan),
      // but inside the ring the realistic contexts keep clear around the footprint, so no facade stands in between.
      const D = Math.min(Math.max(E * 2.2 + 10, b.top * 1.6 + 4), E + 28)
      return { position: [cx + D * 0.85, eye, cz + D * 0.5], target: [cx, Math.max(2.4, b.top * 0.5), cz] }
    }
    case 'aerial':
      return { position: [cx + E * 1.6, b.top + E * 1.4, cz + E * 1.9], target: b.center }
    case 'inside': {
      switch (p.family) {
        case 'hyperboloid':
        case 'catenoid': {
          // In the middle of the tower, looking up its wall.
          const w = p.waist_radius!
          return { position: [cx - w * 0.3, Math.max(0, b.bottom) + eye, cz], target: [cx + w, Math.max(0, b.bottom) + eye + (b.top - b.bottom) * 0.45, cz] }
        }
        case 'hyperbolic_paraboloid':
        case 'monkey_saddle': {
          const h = p.span! / 2
          return { position: [cx - h * 0.45, eye, cz + h * 0.35], target: [cx + h * 0.6, 2.4, cz - h * 0.3] }
        }
        case 'helicoid': {
          // On the ramp, half way out, looking up along it.
          const c = p.pitch! / (2 * Math.PI), rr = p.radius! * 0.6
          const at = (u: number, h: number): Vec3 => [rr * Math.cos(u), b.bottom + c * u + h, rr * Math.sin(u)]
          return { position: at(0.5, eye), target: at(1.6, 2.4) }
        }
        case 'klein_bottle':
          return { unavailable: 'לבקבוק קליין אין פנים: הוא משטח חד-צדדי, ולכן אין מקום לעמוד בתוכו.' }
      }
      break
    }
    case 'courtyard':
      return { unavailable: 'מבט מהחצר זמין רק בטבעת שסוגרת חצר.' }
  }
  return { position: [cx + E * 2, eye, cz + E], target: b.center }
}

export function cameraPose(r: Built, preset: CameraPreset): CameraPose {
  if (r.generator.type === 'parametric_surface') return surfacePose(r as SurfaceRecipe, preset)
  return sweepPose(r as Sweep, preset)
}

function sweepPose(r: Sweep, preset: CameraPreset): CameraPose {
  const p = r.generator.params
  const eye = r.realistic.camera.height
  const ring = p.path.type === 'circle' || p.path.type === 'ellipse'
  const b = bounds(r)
  const R = p.path.R ?? b.extent
  const rOut = outerRadius(p.section)

  switch (preset) {
    case 'eye_level_oblique': {
      if (ring) {
        const ang = 0.18, D = R + rOut + 16
        return {
          position: [Math.cos(ang) * D, eye, Math.sin(ang) * D],
          target: [Math.cos(0.75) * R * 0.6, Math.max(2.4, Math.min(r.bare.section_center_height, b.top)), Math.sin(0.75) * R * 0.6],
        }
      }
      const D = b.extent * 2.2 + 10
      return { position: [b.center[0] + D * 0.85, eye, b.center[2] + D * 0.5], target: [b.center[0], Math.max(2.4, b.center[1] * 0.8), b.center[2]] }
    }
    case 'aerial': {
      if (ring) return { position: [R * 1.35, R * 2.1, R * 1.9], target: [0, 0.5, 0] }
      const E = b.extent
      return { position: [b.center[0] + E * 1.6, b.top + E * 1.4, b.center[2] + E * 1.9], target: b.center }
    }
    case 'inside': {
      if (r.bare.mode !== 'shell') return { unavailable: 'מבט מבפנים זמין רק בקליפה. אפשר לעבור ל"קליפה חלולה" בפאנל הפרמטרים.' }
      const u = 0.2, u2 = u + 0.42
      const a = sectionCut(r, p, u / TAU)
      const c = sectionCut(r, p, u2 / TAU)
      if (!a.floor || !c.floor) return { unavailable: 'אין כאן רצפה פנימית לעמוד עליה. הורידו את גובה מרכז החתך או את מפלס הרצפה.' }
      const mid = (f: NonNullable<typeof a.floor>, h: number): Vec3 => [(f.a[0] + f.b[0]) / 2, f.a[1] + h, (f.a[2] + f.b[2]) / 2]
      return { position: mid(a.floor, eye), target: mid(c.floor, 2.4) }
    }
    case 'courtyard': {
      if (!ring) return { unavailable: 'מבט מהחצר זמין רק במסלול סגור, כשיש חצר.' }
      return { position: [-R * 0.35, eye, -R * 0.2], target: [R, 2.4, R * 0.25] }
    }
  }
}

/** Where to stand the 1.75 m figures: outside the ring, in the courtyard, and on the inner floor. */
export function peopleSpots(r: Built): { at: Vec3; h: number }[] {
  if (r.generator.type === 'parametric_surface') {
    // Around the footprint on the ground, and under the shell where there is room to stand.
    const p = r.generator.params
    const b = bounds(r)
    const D = b.extent + 2.5
    const spots: { at: Vec3; h: number }[] = []
    for (const [ang, h] of [[0.3, 1.75], [0.5, 1.68], [2.6, 1.72]] as const) spots.push({ at: [b.center[0] + Math.cos(ang) * D, 0, b.center[2] + Math.sin(ang) * D], h })
    if (p.family === 'hyperboloid' || p.family === 'catenoid' || p.family === 'hyperbolic_paraboloid' || p.family === 'monkey_saddle') {
      spots.push({ at: [b.center[0] + 0.8, 0, b.center[2] - 0.4], h: 1.72 }, { at: [b.center[0] - 0.9, 0, b.center[2] + 0.6], h: 1.66 })
    }
    return spots
  }
  const p = r.generator.params
  const rOut = outerRadius(p.section)
  const spots: { at: Vec3; h: number }[] = []
  if (p.path.type === 'circle' || p.path.type === 'ellipse') {
    const R = p.path.R!
    for (const [ang, side, h] of [[0.32, 1, 1.75], [0.46, 1, 1.68], [2.4, 1, 1.72], [4.3, 1, 1.7], [5.5, -1, 1.74]] as const) {
      const rad = R + side * (rOut + 0.7)
      if (rad > 1) spots.push({ at: [Math.cos(ang) * rad, 0, Math.sin(ang) * rad], h })
    }
    if (r.bare.mode === 'shell') {
      for (const [ang, h] of [[0.62, 1.72], [0.7, 1.66], [1.5, 1.78], [3.1, 1.7]] as const) {
        const c = sectionCut(r, p, ang / TAU)
        if (c.floor && c.floor.width >= 1.2) spots.push({ at: [(c.floor.a[0] + c.floor.b[0]) / 2, c.floor.a[1], (c.floor.a[2] + c.floor.b[2]) / 2], h })
      }
    }
  } else {
    const b = bounds(r)
    const D = b.extent + 2.5
    for (const [ang, h] of [[0.3, 1.75], [0.5, 1.68], [2.6, 1.72]] as const) {
      spots.push({ at: [b.center[0] + Math.cos(ang) * D, 0, b.center[2] + Math.sin(ang) * D], h })
    }
  }
  return spots
}
