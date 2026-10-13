/** Positive and negative, checked against hand arithmetic. */
import { describe, expect, it } from 'vitest'
import type { Metrics } from '../src/engine/metrics'
import { figureGround } from '../src/prompt/figureGround'

const base: Metrics = {
  sectionArea: 0, pathLength: 0, solidVolume: 1000, shellVolume: 250, volume: 250, envelopeArea: 0, density: 2.4, weight: 0,
  outerDiameter: 50, courtyardDiameter: 20, floorWidth: null, clearHeight: null, floorContinuous: null, floorCoverage: null,
  cuspBurial: 0, edgeCount: 1, edgeLength: 0, openingFraction: 0.2, innerScale: 0.8, wallAtCorners: null,
}

describe('figureGround', () => {
  it('plan: the ring against the courtyard it closes', () => {
    const plan = figureGround(base, true).find((r) => r.key === 'plan')!
    // disc 625π, courtyard 100π: built share 525 / 625 = 0.84
    expect(plan.share).toBeCloseTo(0.84, 6)
  })
  it('volume: material against the void it holds', () => {
    expect(figureGround(base, true).find((r) => r.key === 'volume')!.share).toBeCloseTo(0.25, 6)
  })
  it('envelope: closed against open', () => {
    expect(figureGround(base, true).find((r) => r.key === 'envelope')!.share).toBeCloseTo(0.8, 6)
  })
  it('a solid has no volume or envelope rows, and an open path no plan row', () => {
    const solid = figureGround({ ...base, shellVolume: null, outerDiameter: null, courtyardDiameter: null }, false)
    expect(solid.map((r) => r.key)).toEqual(['edge'])
  })
})
