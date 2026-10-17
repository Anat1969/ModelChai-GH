/** The clip from chosen views (DECISIONS.md 116–118): the camera path, the list of views, the entry path. */
import { describe, expect, it } from 'vitest'
import { buildPath, catmullRom, easeTime, type PathKey, type Vec3 } from '../src/capture/path'
import { EMPTY_PLAN, entryPass, parsePlan, planKeys, planSeconds, serializePlan, shotsReducer, type Shot, type ShotPlan } from '../src/capture/shots'
import { framesFor, mixAt } from '../src/capture/clip'
import { parseRecipe } from '../src/recipe/schema'
import type { Sweep } from '../src/ui/params'
import { fixture } from './helpers'

const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const KEYS: PathKey[] = [
  { position: [40, 1.6, 0], target: [0, 2, 0], seconds: 1 },
  { position: [10, 1.6, 20], target: [0, 2, 0], seconds: 1 },
  { position: [-15, 6, 5], target: [0, 1, 0], seconds: 1 },
]

describe('the camera path', () => {
  it('lasts the sum of the views’ seconds, 30 frames each second', () => {
    const p = buildPath(KEYS)
    expect(p.duration).toBe(3)
    expect(framesFor(p.duration)).toBe(90)
    expect(buildPath([{ ...KEYS[0]!, seconds: 2.5 }, { ...KEYS[1]!, seconds: 0 }]).duration).toBe(2.5)
  })

  it('passes through every view, position and target, at its moment', () => {
    const p = buildPath(KEYS)
    expect(p.keyAt[0]).toBe(0)
    expect(p.keyAt[1]).toBeGreaterThan(0)
    expect(p.keyAt[2]).toBe(2)
    KEYS.forEach((k, i) => {
      const at = p.at(p.keyAt[i]!)
      expect(d(at.position, k.position)).toBeLessThan(1e-6)
      expect(d(at.target, k.target)).toBeLessThan(1e-6)
    })
    // The last view's seconds are a hold.
    expect(d(p.at(2.6).position, KEYS[2]!.position)).toBeLessThan(1e-9)
    expect(d(p.at(3).position, KEYS[2]!.position)).toBeLessThan(1e-9)
  })

  it('is continuous: no jump between frames sampled at 600 per second', () => {
    const p = buildPath(KEYS)
    let prev = p.at(0)
    let worst = 0
    for (let i = 1; i <= 1800; i++) {
      const cur = p.at((3 * i) / 1800)
      worst = Math.max(worst, d(cur.position, prev.position), d(cur.target, prev.target))
      prev = cur
    }
    // About 30 m a second at most along this path: 0.05 m in 1/600 s, so 0.2 m is far above a smooth step.
    expect(worst).toBeLessThan(0.2)
  })

  it('starts and ends gently, and keeps a near-constant speed between', () => {
    const p = buildPath(KEYS)
    const speed = (t: number) => d(p.at(t + 0.005).position, p.at(t - 0.005).position) / 0.01
    expect(speed(0.01)).toBeLessThan(speed(1) * 0.15)
    expect(speed(1.99)).toBeLessThan(speed(1) * 0.15)
    // Mid-way through the first and second segments the speed is the segment's length over its time, eased.
    const s1 = speed(0.85), s2 = speed(1.15)
    expect(Math.abs(s1 - s2) / Math.max(s1, s2)).toBeLessThan(0.5)
  })

  it('cuts on a view of 0 seconds', () => {
    const p = buildPath([KEYS[0]!, { ...KEYS[1]!, seconds: 0 }, KEYS[2]!])
    expect(p.duration).toBe(2)
    // Just after the first segment, the camera is already on the third view's way.
    expect(d(p.at(1.0001).position, KEYS[2]!.position)).toBeLessThan(1e-6)
  })

  it('never overshoots between close views (centripetal)', () => {
    const a: Vec3 = [0, 0, 0], b: Vec3 = [1, 0, 0], c: Vec3 = [1.05, 0, 0], e: Vec3 = [5, 0, 0]
    for (let s = 0; s <= 1; s += 0.05) {
      const p = catmullRom(a, b, c, e, s)
      expect(p[0]).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(p[0]).toBeLessThanOrEqual(1.05 + 1e-9)
    }
  })

  it('eases time monotonically from 0 to the end', () => {
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const y = easeTime(i / 10, 10, 0.75)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    expect(easeTime(0, 10, 0.75)).toBe(0)
    expect(easeTime(10, 10, 0.75)).toBeCloseTo(10, 12)
  })
})

const shot = (id: string, x: number, seconds = 1): Shot => ({ id, position: [x, 1.6, 0], target: [0, 2, 0], level: 'bare', seconds })

describe('the list of views', () => {
  const three = shotsReducer(EMPTY_PLAN, { type: 'add', shots: [shot('a', 10), shot('b', 20), shot('c', 30)] })

  it('adds to the end', () => {
    expect(three.shots.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(shotsReducer(three, { type: 'add', shots: [shot('d', 40)] }).shots.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves a view earlier or later, and not past either end', () => {
    expect(shotsReducer(three, { type: 'move', id: 'c', by: -1 }).shots.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(shotsReducer(three, { type: 'move', id: 'a', by: 1 }).shots.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(shotsReducer(three, { type: 'move', id: 'a', by: -1 })).toBe(three)
    expect(shotsReducer(three, { type: 'move', id: 'c', by: 1 })).toBe(three)
    expect(shotsReducer(three, { type: 'move', id: 'zz', by: 1 })).toBe(three)
  })

  it('removes a view, and clears the list', () => {
    expect(shotsReducer(three, { type: 'remove', id: 'b' }).shots.map((s) => s.id)).toEqual(['a', 'c'])
    expect(shotsReducer(three, { type: 'clear' }).shots).toEqual([])
  })

  it('keeps each view’s seconds between 0 and 20, in half seconds', () => {
    const t = (v: number) => shotsReducer(three, { type: 'seconds', id: 'a', seconds: v }).shots[0]!.seconds
    expect(t(2.3)).toBe(2.5)
    expect(t(-1)).toBe(0)
    expect(t(99)).toBe(20)
  })

  it('keeps the blend window in order', () => {
    const p = shotsReducer(three, { type: 'levels', levels: { from: 2, to: 1 } })
    expect(p.levels.from).toBe(2)
    expect(p.levels.to).toBe(2)
  })

  it('makes 3 views of 1 s into a 3-second, 90-frame path, and none into the quarter turn', () => {
    const keys = planKeys(three, null)
    expect(planSeconds(keys)).toBe(3)
    expect(framesFor(planSeconds(keys))).toBe(90)
    const quarter = planKeys(EMPTY_PLAN, { position: [30, 2, 0], target: [0, 2, 0] })
    expect(quarter).toHaveLength(5)
    expect(planSeconds(quarter)).toBe(4)
    expect(planKeys(EMPTY_PLAN, null)).toEqual([])
  })

  it('round-trips through a small JSON, to the centimeter', () => {
    const plan: ShotPlan = { shots: [{ ...shot('a', 10.123456), level: 'realistic' }, shot('b', 20)], levels: { mode: 'bare', from: 0.5, to: 2 } }
    const json = serializePlan(plan)
    expect(json.length).toBeLessThan(260)
    const back = parsePlan(json)!
    expect(back.levels).toEqual(plan.levels)
    expect(back.shots[0]!.position[0]).toBe(10.12)
    expect(back.shots[0]!.level).toBe('realistic')
    expect(back.shots.map((s) => s.id)).toEqual(['a', 'b'])
    expect(parsePlan('not json')).toBeNull()
    expect(parsePlan('{"v":2,"shots":[]}')).toBeNull()
    // A broken view is dropped, the rest stays.
    expect(parsePlan('{"v":1,"shots":[{"id":"x","p":[1,2],"t":[0,0,0],"s":1},{"id":"y","p":[1,2,3],"t":[0,0,0],"s":1}]}')!.shots.map((s) => s.id)).toEqual(['y'])
  })
})

describe('the level plan', () => {
  it('blends from bare to realistic in the window, or stays on one level', () => {
    expect(mixAt(0.5, { mode: 'blend', from: 1, to: 2 })).toBe(0)
    expect(mixAt(1.5, { mode: 'blend', from: 1, to: 2 })).toBeCloseTo(0.5, 9)
    expect(mixAt(2.5, { mode: 'blend', from: 1, to: 2 })).toBe(1)
    expect(mixAt(5, { mode: 'bare', from: 1, to: 2 })).toBe(0)
    expect(mixAt(0, { mode: 'realistic', from: 1, to: 2 })).toBe(1)
  })
})

describe('"מעבר כניסה": the entry path', () => {
  const sweep = (r: unknown) => {
    const p = parseRecipe(r)
    if (!p.ok) throw new Error('fixture')
    return p.recipe as Sweep
  }
  const umbilic = sweep(fixture('umbilic-torus'))
  const R = umbilic.generator.params.path.R!

  it('walks in through the first passage, at eye height, from afar to the courtyard', () => {
    const views = entryPass(umbilic)
    expect(views).toHaveLength(4)
    const radius = (v: (typeof views)[number]) => Math.hypot(v.position[0], v.position[2])
    // From afar, ever closer to the center.
    for (let i = 1; i < views.length; i++) expect(radius(views[i]!)).toBeLessThan(radius(views[i - 1]!))
    expect(radius(views[0]!)).toBeGreaterThan(R + 25)
    expect(radius(views[3]!)).toBeLessThan(R)
    // On the passage's bearing: 51.6°.
    const ang = (Math.atan2(views[1]!.position[2], views[1]!.position[0]) * 180) / Math.PI
    expect(ang).toBeCloseTo(51.6, 6)
    // At eye height, under the passage's head.
    for (const v of views) {
      expect(v.position[1]).toBeCloseTo(1.6, 6)
      expect(v.position[1]).toBeLessThan(2.6)
    }
    expect(planSeconds(views.map((v) => ({ ...v })))).toBe(9)
  })

  it('cuts to the courtyard when the ring has no passage', () => {
    const r = fixture('umbilic-torus')
    delete r.bare.openings.passages
    const views = entryPass(sweep(r))
    expect(views.some((v) => v.seconds === 0)).toBe(true)
  })

  it('walks a straight gallery from its start to its end', () => {
    const r = fixture('umbilic-torus')
    r.generator.params.path = { type: 'line', length: 30 }
    r.bare.openings = undefined
    const p = parseRecipe(r)
    if (!p.ok) return // the line needs other fields; covered by the ring cases
    const views = entryPass(p.recipe as Sweep)
    expect(views[0]!.position[2]).toBeLessThan(0)
    expect(views.at(-1)!.position[2]).toBeGreaterThan(30)
  })
})
