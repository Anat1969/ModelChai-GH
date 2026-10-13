/**
 * Derived metrics (GENERATORS.md section 2). They are computed on every build and never stored in the recipe.
 * Volumes come from Pappus' theorem, so they are exact; the mesh is checked against them in tests.
 */
import type { Recipe, SweepParams } from '../recipe/schema'
import { outerRadius } from '../recipe/rules'
import { DENSITY } from './materials'
import { pathLength } from './paths'
import { sectionArea } from './sections'
import type { EdgeResult } from './sweep/edges'
import type { FloorResult } from './sweep/floor'
import type { Openings } from './sweep/openings'
import type { Range } from './types'

export interface Metrics {
  /** Outer section area, m². */
  sectionArea: number
  /** Centerline length, m. */
  pathLength: number
  /** Volume of the full solid, m³. */
  solidVolume: number
  /** Volume of the shell after openings, m³; null in solid mode. */
  shellVolume: number | null
  /** The volume that is actually built: shell volume in shell mode, solid volume otherwise. */
  volume: number
  /** Outer envelope area before openings, m², summed over the mesh triangles. */
  envelopeArea: number
  /** Density of the outer material, t/m³. */
  density: number
  /** Weight, tonnes. */
  weight: number
  /** 2(R + outer radius) on a circular path. */
  outerDiameter: number | null
  /** 2(R − outer radius) on a circular path. */
  courtyardDiameter: number | null
  floorWidth: Range | null
  clearHeight: Range | null
  floorContinuous: boolean | null
  /** Share of the path that has a floor, 0–1. */
  floorCoverage: number | null
  /** max(0, outer radius − section_center_height). */
  cuspBurial: number
  edgeCount: number
  edgeLength: number
  /** Removed outer area over total outer area, 0–1. */
  openingFraction: number
  /** Inner wall scale k = (a − t) / a; null in solid mode. */
  innerScale: number | null
  /** Wall thickness at the corners: the corner radius times t / a. A cusp becomes a rib (GENERATORS.md 1.5). */
  wallAtCorners: number | null
}

/** ∫ s(u)² dl for s(u) = S^(u / uMax): the length that multiplies the section area in Pappus' theorem. */
export function effectiveLength(length: number, closed: boolean, S: number): number {
  if (closed || Math.abs(S - 1) < 1e-12) return length
  return (length * (S * S - 1)) / (2 * Math.log(S))
}

export function computeMetrics(
  recipe: Recipe,
  params: SweepParams,
  parts: { closed: boolean; openings: Openings; floor: FloorResult | null; edges: EdgeResult; innerScale: number | null },
): Metrics {
  const { section, path } = params
  const area = sectionArea(section, 1)
  const length = pathLength(path)
  const Leff = effectiveLength(length, parts.closed, params.scale_along_path)
  const solidVolume = area * Leff
  const k = parts.innerScale
  const shellVolume = k === null ? null : (area - sectionArea(section, k)) * Leff * (1 - parts.openings.fraction)
  const volume = shellVolume ?? solidVolume
  const density = DENSITY[recipe.realistic.materials.outer]
  const rOut = outerRadius(section)
  const circle = path.type === 'circle'
  const t = recipe.bare.mode === 'shell' ? recipe.bare.shell?.thickness : undefined
  return {
    sectionArea: area,
    pathLength: length,
    solidVolume,
    shellVolume,
    volume,
    envelopeArea: parts.openings.envelopeArea,
    density,
    weight: volume * density,
    outerDiameter: circle ? 2 * (path.R! + rOut) : null,
    courtyardDiameter: circle ? 2 * (path.R! - rOut) : null,
    floorWidth: parts.floor?.width ?? null,
    clearHeight: parts.floor?.clearHeight ?? null,
    floorContinuous: parts.floor?.continuous ?? null,
    floorCoverage: parts.floor?.coverage ?? null,
    cuspBurial: Math.max(0, rOut - recipe.bare.section_center_height),
    edgeCount: parts.edges.count,
    edgeLength: parts.edges.length,
    openingFraction: parts.openings.fraction,
    innerScale: k,
    wallAtCorners: t === undefined ? null : (rOut * t) / section.a,
  }
}
