import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  STEP,
  between,
  boundingSphere,
  distance,
  ease,
  fitDistance,
  frame,
  keyStep,
  screenAxes,
  step,
  toSpherical,
  type Pose,
} from '../src/scene/navigation'

const pose: Pose = { position: [0, 10, 40], target: [0, 10, 0] }
const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)))

describe('orbit step', () => {
  it('turns the camera around the target by the step, keeping the distance', () => {
    const p = step(pose, { kind: 'orbit', azimuth: STEP.azimuth, polar: 0 }, 50)
    expect(distance(p)).toBeCloseTo(40, 9)
    const a = toSpherical([p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]])
    expect(a.theta).toBeCloseTo(STEP.azimuth, 9)
    expect(p.target).toEqual(pose.target)
  })
  it('a positive azimuth moves the camera toward its own right', () => {
    const { right } = screenAxes(pose)
    const p = step(pose, { kind: 'orbit', azimuth: 0.1, polar: 0 }, 50)
    const moved = [p.position[0] - pose.position[0], p.position[1] - pose.position[1], p.position[2] - pose.position[2]]
    expect(moved[0]! * right[0] + moved[1]! * right[1] + moved[2]! * right[2]).toBeGreaterThan(0)
  })
  it('a positive polar raises the camera, and stops short of the ground', () => {
    const up = step(pose, { kind: 'orbit', azimuth: 0, polar: STEP.polar }, 50)
    expect(up.position[1]).toBeGreaterThan(pose.position[1])
    expect(up.position[1] - up.target[1]).toBeCloseTo(40 * Math.sin(STEP.polar), 9)
    const down = step(pose, { kind: 'orbit', azimuth: 0, polar: -1 }, 50)
    expect(toSpherical([down.position[0], down.position[1] - 10, down.position[2]]).phi).toBeCloseTo(LIMITS.maxPolar, 9)
  })
  it('twenty-four steps make a full turn back to the start', () => {
    let p = pose
    for (let i = 0; i < 24; i++) p = step(p, { kind: 'orbit', azimuth: STEP.azimuth, polar: 0 }, 50)
    close(p.position, pose.position, 1e-6)
  })
})

describe('zoom and pan', () => {
  it('zoom divides the distance by the factor, within the limits', () => {
    expect(distance(step(pose, { kind: 'zoom', factor: 1.25 }, 50))).toBeCloseTo(32, 9)
    expect(distance(step(pose, { kind: 'zoom', factor: 0.8 }, 50))).toBeCloseTo(50, 9)
    expect(distance(step(pose, { kind: 'zoom', factor: 1000 }, 50))).toBeCloseTo(LIMITS.minDistance, 9)
    expect(distance(step(pose, { kind: 'zoom', factor: 0.001 }, 50))).toBeCloseTo(LIMITS.maxDistance, 9)
  })
  it('pan moves camera and target together by a share of the visible height', () => {
    const fov = 50
    const h = 2 * 40 * Math.tan((fov * Math.PI) / 360)
    const p = step(pose, { kind: 'pan', right: 0.15, up: 0 }, fov)
    // Looking down −z with y up, the camera's right is +x.
    close(p.position, [0.15 * h, 10, 40])
    close(p.target, [0.15 * h, 10, 0])
    const u = step(pose, { kind: 'pan', right: 0, up: 0.15 }, fov)
    close(u.target, [0, 10 + 0.15 * h, 0])
    expect(distance(u)).toBeCloseTo(40, 9)
  })
})

describe('framing', () => {
  it('fit distance matches the analytic sphere tangent, by the narrower field of view', () => {
    // Wide window: the vertical field of view is the narrower one.
    expect(fitDistance(10, 50, 1.5)).toBeCloseTo(10 / Math.sin((25 * Math.PI) / 180), 9)
    // Tall window: the horizontal one is.
    const halfH = Math.atan(Math.tan((25 * Math.PI) / 180) * 0.5)
    expect(fitDistance(10, 50, 0.5)).toBeCloseTo(10 / Math.sin(halfH), 9)
  })
  it('bounding sphere is the box center and the farthest vertex', () => {
    const a = new Float32Array([-2, 0, -2, 2, 4, 2])
    const b = new Float32Array([0, 0, 0])
    const s = boundingSphere([a, null, b])!
    close(s.center, [0, 2, 0])
    expect(s.radius).toBeCloseTo(Math.sqrt(12), 6)
    expect(boundingSphere([null, new Float32Array()])).toBeNull()
  })
  it('frame puts the target on the center and keeps the view direction', () => {
    const p = frame(pose, { center: [5, 3, -2], radius: 10 }, 50, 1.5)
    close(p.target, [5, 3, -2])
    expect(distance(p)).toBeCloseTo(fitDistance(10, 50, 1.5) * 1.05, 9)
    const dir = [(p.position[0] - 5) / distance(p), (p.position[1] - 3) / distance(p), (p.position[2] + 2) / distance(p)]
    close(dir, [0, 0, 1])
  })
})

describe('moving between poses', () => {
  it('starts and ends exactly, and orbits along an arc', () => {
    const b = step(pose, { kind: 'orbit', azimuth: Math.PI / 2, polar: 0 }, 50)
    close(between(pose, b, 0).position, pose.position)
    close(between(pose, b, 1).position, b.position)
    // Halfway the camera stays at the same distance from the target: it goes around, not through, the model.
    expect(distance(between(pose, b, 0.5))).toBeCloseTo(40, 9)
  })
  it('takes the short way around', () => {
    const a: Pose = { position: [Math.sin(3) * 10, 0, Math.cos(3) * 10], target: [0, 0, 0] }
    const b: Pose = { position: [Math.sin(-3) * 10, 0, Math.cos(-3) * 10], target: [0, 0, 0] }
    const mid = between(a, b, 0.5)
    close(mid.position, [0, 0, -10], 1e-6)
  })
  it('eases from 0 to 1 symmetrically', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.5, 12)
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 12)
  })
})

describe('keyboard', () => {
  it('arrows orbit, Shift with arrows pans, + and − zoom, 0 resets', () => {
    expect(keyStep('ArrowRight', false)).toEqual({ kind: 'orbit', azimuth: STEP.azimuth, polar: 0 })
    expect(keyStep('ArrowUp', false)).toEqual({ kind: 'orbit', azimuth: 0, polar: STEP.polar })
    expect(keyStep('ArrowLeft', true)).toEqual({ kind: 'pan', right: -STEP.pan, up: 0 })
    expect(keyStep('+', false)).toEqual({ kind: 'zoom', factor: STEP.zoom })
    expect(keyStep('-', false)).toEqual({ kind: 'zoom', factor: 1 / STEP.zoom })
    expect(keyStep('0', false)).toBe('reset')
    expect(keyStep('a', false)).toBeNull()
  })
})
