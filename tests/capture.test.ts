import { describe, expect, it } from 'vitest'
import { fitToLimit, frameName, STILL } from '../src/capture/frame'
import { STAGES, stageOfView } from '../src/data/collection'

describe('frozen view size', () => {
  it('is 3:2 and prints 30 × 20 cm at 300 dpi', () => {
    expect(STILL.width / STILL.height).toBe(1.5)
    expect((STILL.width / 300) * 2.54).toBeCloseTo(30.48, 2)
    expect((STILL.height / 300) * 2.54).toBeCloseTo(20.32, 2)
  })
  it('keeps the size when the GPU can draw it', () => {
    expect(fitToLimit(3600, 2400, [16384, 16384])).toEqual({ width: 3600, height: 2400 })
  })
  it('shrinks to the GPU limit and stays exactly 3:2', () => {
    const f = fitToLimit(3600, 2400, [2048, 2048])
    expect(f.width).toBeLessThanOrEqual(2048)
    expect(f.height).toBeLessThanOrEqual(2048)
    expect(f.width * 2).toBe(f.height * 3)
    expect(f.width).toBe(2046)
  })
})

describe('frame names', () => {
  it('reads the concept, the level and the minute', () => {
    expect(frameName('umbilic-torus', 'realistic', new Date('2026-10-15T09:41:30Z'), 'jpg')).toBe('umbilic-torus-realistic-20261015-0941.jpg')
    expect(frameName('', 'bare', new Date('2026-01-02T03:04:00Z'), 'jpg')).toBe('model-bare-20260102-0304.jpg')
  })
})

describe('collection steps', () => {
  it('run in a fixed order from the concept to the print', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['concept', 'recipe', 'bare', 'realistic', 'render', 'print'])
    expect(STAGES.every((s) => s.label && s.why.endsWith('.'))).toBe(true)
  })
  it('put a frozen view on the step of its level', () => {
    const camera = { preset: 'aerial' as const, position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    expect(stageOfView({ level: 'bare', camera })).toBe('bare')
    expect(stageOfView({ level: 'realistic', camera })).toBe('realistic')
  })
})

describe('the 4-second clip', async () => {
  const { CLIP, FRAMES, angleAt, mixAt, needsBare, needsRealistic, orbit, timestampAt } = await import('../src/capture/clip')
  it('is 120 frames at 30 per second, 3:2', () => {
    expect(FRAMES).toBe(120)
    expect(CLIP.width / CLIP.height).toBe(1.5)
    expect(timestampAt(FRAMES)).toBe(4_000_000)
  })
  it('is bare for the first second, realistic for the last, and blends smoothly between', () => {
    for (let f = 0; f <= 30; f++) expect(mixAt(f)).toBe(0)
    for (let f = 90; f < 120; f++) expect(mixAt(f)).toBe(1)
    for (let f = 31; f < 90; f++) expect(mixAt(f)).toBeGreaterThan(mixAt(f - 1))
    expect(mixAt(60)).toBeCloseTo(0.5, 6)
  })
  it('draws each level only where it shows: 90 bare frames, 89 realistic', () => {
    const all = [...Array(FRAMES).keys()]
    expect(all.filter(needsBare).length).toBe(90)
    expect(all.filter(needsRealistic).length).toBe(89)
  })
  it('turns 90° at a steady pace, keeping height and distance', () => {
    expect(angleAt(0)).toBe(0)
    expect(angleAt(FRAMES - 1)).toBeCloseTo(Math.PI / 2, 9)
    const start = { position: [30, 12, 0] as [number, number, number], target: [0, 2, 0] as [number, number, number] }
    const end = orbit(start, angleAt(FRAMES - 1))
    expect(end.position[0]).toBeCloseTo(0, 9)
    expect(Math.abs(end.position[2])).toBeCloseTo(30, 9)
    expect(end.position[1]).toBe(12)
    expect(end.target).toEqual(start.target)
  })
})
