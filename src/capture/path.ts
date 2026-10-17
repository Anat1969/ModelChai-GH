/**
 * The camera path of a clip made from chosen views (DECISIONS.md 116–117). Pure math, no DOM.
 *
 * The camera passes through every key in order. Positions and targets each follow a centripetal Catmull-Rom
 * curve, which never loops or overshoots between close keys. Within a segment the camera moves at a steady
 * speed along the curve (arc length), and the whole move eases in at the start and out at the end, so the
 * speed is nearly constant and the clip neither jerks nor stops at each key.
 *
 * A key's `seconds` is the time from that key to the next one; on the last key it is a hold at the end.
 * A key of 0 seconds is a cut: the camera jumps to the next key.
 */
export type Vec3 = [number, number, number]
export interface Pose {
  position: Vec3
  target: Vec3
}
export interface PathKey extends Pose {
  seconds: number
}

export interface CameraPath {
  /** Sum of the keys' seconds. */
  duration: number
  /** The time, in seconds, at which the camera is exactly on each key. */
  keyAt: number[]
  /** The pose at a time in seconds; times outside the clip hold the first or last key. */
  at(t: number): Pose
}

const ALPHA = 0.5 // centripetal
const SAMPLES = 48

const lerp = (a: Vec3, b: Vec3, wa: number, wb: number): Vec3 => [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The point at s ∈ [0, 1] between p1 and p2 on the centripetal Catmull-Rom curve through p0…p3 (Barry–Goldman). */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, s: number): Vec3 {
  if (dist(p1, p2) < 1e-9) return [...p1]
  const knot = (a: Vec3, b: Vec3) => Math.max(Math.pow(dist(a, b), ALPHA), 1e-4)
  const t0 = 0
  const t1 = t0 + knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const t = t1 + s * (t2 - t1)
  const A1 = lerp(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0))
  const A2 = lerp(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1))
  const A3 = lerp(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2))
  const B1 = lerp(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0))
  const B2 = lerp(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1))
  return lerp(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1))
}

/**
 * Real time → path time over [0, T]: a trapezoid of speed, rising over `ramp` seconds at the start and falling
 * over the same at the end, steady between. Monotonic, with τ(0) = 0 and τ(T) = T.
 */
export function easeTime(t: number, T: number, ramp: number): number {
  if (T <= 0) return 0
  const x = Math.min(1, Math.max(0, t / T))
  const a = Math.min(0.5, Math.max(1e-6, ramp / T))
  const v = 1 / (1 - a)
  const y = x < a ? (v * x * x) / (2 * a) : x > 1 - a ? 1 - (v * (1 - x) * (1 - x)) / (2 * a) : v * (x - a / 2)
  return y * T
}

/** The ease ramp: three quarters of a second, or a quarter of a short move. */
export const rampFor = (moving: number) => Math.min(0.75, moving / 4)

export function buildPath(keys: PathKey[]): CameraPath {
  if (!keys.length) throw new Error('A camera path needs at least one key')
  const n = keys.length
  const sec = keys.map((k) => Math.max(0, Number.isFinite(k.seconds) ? k.seconds : 0))
  const duration = sec.reduce((a, b) => a + b, 0)
  // Path time at each key.
  const start: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    start.push(acc)
    if (i < n - 1) acc += sec[i]!
  }
  const moving = acc
  const ramp = rampFor(moving)

  // Beyond the ends, an extra point continues the curve: through the last three views when there are three
  // (so an arc stays an arc), along the last two otherwise.
  const extend = (a: Vec3, b: Vec3, c: Vec3 | undefined): Vec3 =>
    c ? [3 * a[0] - 3 * b[0] + c[0], 3 * a[1] - 3 * b[1] + c[1], 3 * a[2] - 3 * b[2] + c[2]] : lerp(a, b, 2, -1)
  const pick = (which: 'position' | 'target', i: number): Vec3 => {
    if (i < 0) return n > 1 ? extend(keys[0]![which], keys[1]![which], keys[2]?.[which]) : keys[0]![which]
    if (i >= n) return n > 1 ? extend(keys[n - 1]![which], keys[n - 2]![which], n > 2 ? keys[n - 3]![which] : undefined) : keys[n - 1]![which]
    return keys[i]![which]
  }
  const curve = (which: 'position' | 'target', i: number, s: number) => catmullRom(pick(which, i - 1), pick(which, i), pick(which, i + 1), pick(which, i + 2), s)

  // Arc-length tables, one per segment: the curve parameter at evenly spaced fractions of the length.
  const tables: Float64Array[] = []
  for (let i = 0; i < n - 1; i++) {
    const which = dist(keys[i]!.position, keys[i + 1]!.position) > 1e-6 ? 'position' : 'target'
    const cum = new Float64Array(SAMPLES + 1)
    let prev = curve(which, i, 0)
    for (let j = 1; j <= SAMPLES; j++) {
      const p = curve(which, i, j / SAMPLES)
      cum[j] = cum[j - 1]! + dist(prev, p)
      prev = p
    }
    tables.push(cum)
  }
  /** The curve parameter at a fraction φ of segment i's length. */
  const param = (i: number, phi: number) => {
    const cum = tables[i]!
    const L = cum[SAMPLES]!
    if (L < 1e-9) return phi
    const goal = phi * L
    let lo = 0, hi = SAMPLES
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid]! < goal) lo = mid
      else hi = mid
    }
    const span = cum[hi]! - cum[lo]!
    return (lo + (span > 0 ? (goal - cum[lo]!) / span : 0)) / SAMPLES
  }

  // Real time at which path time reaches u: bisection on the monotonic ease.
  const inverse = (u: number) => {
    let lo = 0, hi = moving
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (easeTime(mid, moving, ramp) < u) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const keyAt = start.map((u, i) => (i === 0 ? 0 : i === n - 1 ? moving : inverse(u)))

  return {
    duration,
    keyAt,
    at(t) {
      if (n === 1 || t >= moving) return { position: [...keys[n - 1]!.position], target: [...keys[n - 1]!.target] }
      if (t <= 0) return { position: [...keys[0]!.position], target: [...keys[0]!.target] }
      const u = easeTime(t, moving, ramp)
      // The segment holding u; a cut (0 seconds) is never chosen, so the camera lands on the key after it.
      let i = 0
      while (i < n - 2 && u >= start[i + 1]!) i++
      if (sec[i] === 0) return { position: [...keys[i + 1]!.position], target: [...keys[i + 1]!.target] }
      const s = param(i, Math.min(1, (u - start[i]!) / sec[i]!))
      return { position: curve('position', i, s), target: curve('target', i, s) }
    },
  }
}
