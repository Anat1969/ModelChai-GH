/**
 * The moving section plane (LEVELS.md 1.1): the outer and inner outlines at a chosen point of the path, with the
 * floor chord and clear height there. Cheap enough for the main thread; pure, like the rest of the engine.
 */
import type { Recipe, SweepParams } from '../recipe/schema'
import { TAU } from './math'
import { sectionPoint } from './sections'
import { chordAtRow, floorSamples } from './sweep/floor'
import { createSetup, innerScale, type SweepSetup } from './sweep/setup'

export interface SectionCut {
  /** Closed outlines in world coordinates, xyz triples. */
  outer: Float32Array
  inner: Float32Array | null
  center: [number, number, number]
  /** Section axes in world space. */
  N: [number, number, number]
  B: [number, number, number]
  /** Floor chord ends in world space, when there is a floor here. */
  floor: { a: [number, number, number]; b: [number, number, number]; width: number } | null
  clearHeight: number | null
  /** Position along the path, 0–1. */
  t: number
}

const OUTLINE = 240

/** Rows sampled for the cut; one degree per row on a circle. */
export function cutSetup(recipe: Recipe, params: SweepParams): SweepSetup {
  return createSetup(recipe, params, { pathSegments: 360, sectionSegments: 12 })
}

export function sectionCut(recipe: Recipe, params: SweepParams, t: number, s: SweepSetup = cutSetup(recipe, params)): SectionCut {
  const last = s.frames.closed ? s.rows : s.rows - 1
  const i = Math.min(s.rows - 1, Math.max(0, Math.round(t * last) % s.rows))
  const o = 3 * i
  const C: [number, number, number] = [s.frames.C[o]!, s.frames.C[o + 1]!, s.frames.C[o + 2]!]
  const N: [number, number, number] = [s.frames.N[o]!, s.frames.N[o + 1]!, s.frames.N[o + 2]!]
  const B: [number, number, number] = [s.frames.B[o]!, s.frames.B[o + 1]!, s.frames.B[o + 2]!]
  const c = Math.cos(s.theta[i]!) * s.scale[i]!, sn = Math.sin(s.theta[i]!) * s.scale[i]!
  const loop = (k: number) => {
    const out = new Float32Array(3 * OUTLINE)
    for (let j = 0; j < OUTLINE; j++) {
      const [x, y] = sectionPoint(params.section, (TAU * j) / OUTLINE, k)
      const X = x * c - y * sn, Y = x * sn + y * c
      out[3 * j] = C[0] + X * N[0] + Y * B[0]
      out[3 * j + 1] = C[1] + X * N[1] + Y * B[1]
      out[3 * j + 2] = C[2] + X * N[2] + Y * B[2]
    }
    return out
  }
  const k = innerScale(recipe, params)
  const floorSpec = recipe.bare.floor ?? { level: 0, type: 'chord' as const }
  let floor: SectionCut['floor'] = null
  let clearHeight: number | null = null
  if (k !== null && floorSpec.type === 'chord' && s.frames.horizontalFrames) {
    const r = chordAtRow(s, floorSamples(s, k), floorSpec.level, i)
    clearHeight = r.clear
    if (r.ok) {
      const at = (x: number): [number, number, number] => [C[0] + x * N[0], floorSpec.level, C[2] + x * N[2]]
      floor = { a: at(r.x0), b: at(r.x1), width: r.x1 - r.x0 }
    }
  }
  return { outer: loop(1), inner: k === null ? null : loop(k), center: C, N, B, floor, clearHeight, t: i / last }
}
