/**
 * The parametric surface library (GENERATORS.md 4.1). Each family is a point function S(u, v) in local axes
 * (Y up, centered on the Y axis) with its parameter domain and how the domain closes on itself. No formula strings:
 * a family is code, so it is safe and testable (DECISIONS.md 135). Pure: no three.js, no DOM.
 */
import type { SurfaceFamily, SurfaceParams } from '../../recipe/schema'
import { TAU } from '../math'

export type Vec3 = [number, number, number]

/**
 * How a parameter direction closes. 'open': two boundary edges. 'wrap': the last sample joins the first.
 * 'flip': the last sample of u joins the first with v mirrored (v → −v), the seam of a Klein bottle.
 */
export type Closure = 'open' | 'wrap' | 'flip'

/** Which side of the surface counts as the outside: away from the vertical axis, up, or none (one-sided). */
export type Outward = 'axis' | 'up' | 'none'

export interface Family {
  family: SurfaceFamily
  point: (u: number, v: number) => Vec3
  u: [number, number]
  v: [number, number]
  uClosure: Closure
  vClosure: 'open' | 'wrap'
  outward: Outward
  /** Default display segments along u and v. Export doubles both. */
  segments: [number, number]
  /** Surface area in closed form or by an independent 1D/2D integral with exact derivatives, m². */
  referenceArea: () => number
  /** Area-preserving description, for the metrics panel and the visual prompt. */
  revolution: boolean
}

/** c in x²/a² − y²/c² = 1 for a waist a that widens to e at half-height h. */
export function hyperboloidC(a: number, e: number, h: number): number {
  return h / Math.sqrt(Math.max(1e-12, (e * e) / (a * a) - 1))
}

/** Composite Simpson rule on [a, b] with n (even) intervals. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

export function family(p: SurfaceParams): Family {
  switch (p.family) {
    case 'hyperboloid': {
      // One sheet, ruled: r(y) = a·√(1 + y²/c²). Height is sampled evenly, so the courses are level.
      const a = p.waist_radius!, e = p.end_radius!, H = p.height!
      const c = hyperboloidC(a, e, H / 2)
      const r = (y: number) => a * Math.sqrt(1 + (y * y) / (c * c))
      const dr = (y: number) => (a * y) / (c * c * Math.sqrt(1 + (y * y) / (c * c)))
      return {
        family: p.family,
        point: (u, v) => [r(v) * Math.cos(u), v, r(v) * Math.sin(u)],
        u: [0, TAU],
        v: [-H / 2, H / 2],
        uClosure: 'wrap',
        vClosure: 'open',
        outward: 'axis',
        segments: [192, 64],
        referenceArea: () => TAU * simpson((y) => r(y) * Math.sqrt(1 + dr(y) ** 2), -H / 2, H / 2, 4000),
        revolution: true,
      }
    }
    case 'catenoid': {
      // r(y) = c·cosh(y/c): the minimal surface between two rings. Area πc(H + c·sinh(H/c)) in closed form.
      const c = p.waist_radius!, H = p.height!
      const r = (y: number) => c * Math.cosh(y / c)
      return {
        family: p.family,
        point: (u, v) => [r(v) * Math.cos(u), v, r(v) * Math.sin(u)],
        u: [0, TAU],
        v: [-H / 2, H / 2],
        uClosure: 'wrap',
        vClosure: 'open',
        outward: 'axis',
        segments: [192, 64],
        referenceArea: () => Math.PI * c * (H + c * Math.sinh(H / c)),
        revolution: true,
      }
    }
    case 'hyperbolic_paraboloid': {
      // y = (rise/2)·(x/hx)·(z/hz) on a rectangular plan: two corners up, two down, every edge a straight line.
      const hx = p.span! / 2, hz = (p.span2 ?? p.span!) / 2, k = p.rise! / 2 / (hx * hz)
      return {
        family: p.family,
        point: (u, v) => [u, k * u * v, v],
        u: [-hx, hx],
        v: [-hz, hz],
        uClosure: 'open',
        vClosure: 'open',
        outward: 'up',
        segments: [96, 96],
        // |S_u × S_v| = √(1 + k²(u² + v²)); the inner integral is done exactly in x for each z.
        referenceArea: () => simpson((z) => simpson((x) => Math.sqrt(1 + k * k * (x * x + z * z)), -hx, hx, 600), -hz, hz, 600),
        revolution: false,
      }
    }
    case 'monkey_saddle': {
      // y = (rise/4)·(x³ − 3xz²)/h³ on a square plan: three valleys and three ridges meet at a flat center.
      const h = p.span! / 2, hz = (p.span2 ?? p.span!) / 2, k = p.rise! / 4 / (h * h * h)
      return {
        family: p.family,
        point: (u, v) => [u, k * (u * u * u - 3 * u * v * v), v],
        u: [-h, h],
        v: [-hz, hz],
        uClosure: 'open',
        vClosure: 'open',
        outward: 'up',
        segments: [96, 96],
        referenceArea: () =>
          simpson((z) => simpson((x) => Math.sqrt(1 + (k * (3 * x * x - 3 * z * z)) ** 2 + (k * 6 * x * z) ** 2), -h, h, 600), -hz, hz, 600),
        revolution: false,
      }
    }
    case 'helicoid': {
      // (v·cos u, c·u, v·sin u), c = pitch / 2π: a ramp that climbs one pitch per turn, from the axis to the radius.
      const R = p.radius!, c = p.pitch! / TAU, U = TAU * p.turns!
      return {
        family: p.family,
        point: (u, v) => [v * Math.cos(u), c * u, v * Math.sin(u)],
        u: [0, U],
        v: [0, R],
        uClosure: 'open',
        vClosure: 'open',
        outward: 'up',
        segments: [Math.max(48, Math.round(96 * p.turns!)), 32],
        // ∫∫ √(v² + c²) dv du in closed form.
        referenceArea: () => U * ((R / 2) * Math.sqrt(R * R + c * c) + ((c * c) / 2) * Math.asinh(R / c)),
        revolution: false,
      }
    }
    case 'klein_bottle': {
      // The figure-8 immersion: a figure-8 section that turns half a turn around a ring. One-sided, no edge.
      const R = p.radius!, a = p.tube!
      return {
        family: p.family,
        point: (u, v) => {
          const c = Math.cos(u / 2), s = Math.sin(u / 2)
          const rho = R + a * (c * Math.sin(v) - s * Math.sin(2 * v))
          return [rho * Math.cos(u), a * (s * Math.sin(v) + c * Math.sin(2 * v)), rho * Math.sin(u)]
        },
        u: [0, TAU],
        v: [0, TAU],
        uClosure: 'flip',
        vClosure: 'wrap',
        outward: 'none',
        segments: [192, 64],
        referenceArea: () => integrateArea(family(p), 1600, 800),
        revolution: true,
      }
    }
  }
}

/** Partial derivatives by central differences, scaled to the domain. */
export function derivatives(f: Family, u: number, v: number): { Su: Vec3; Sv: Vec3 } {
  const hu = (f.u[1] - f.u[0]) * 1e-6, hv = (f.v[1] - f.v[0]) * 1e-6
  const a = f.point(u + hu, v), b = f.point(u - hu, v), c = f.point(u, v + hv), d = f.point(u, v - hv)
  return {
    Su: [(a[0] - b[0]) / (2 * hu), (a[1] - b[1]) / (2 * hu), (a[2] - b[2]) / (2 * hu)],
    Sv: [(c[0] - d[0]) / (2 * hv), (c[1] - d[1]) / (2 * hv), (c[2] - d[2]) / (2 * hv)],
  }
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const len = (a: Vec3) => Math.sqrt(dot(a, a))

/** Unit normal S_u × S_v. */
export function normalAt(f: Family, u: number, v: number): Vec3 {
  const { Su, Sv } = derivatives(f, u, v)
  const n = cross(Su, Sv)
  const L = len(n) || 1
  return [n[0] / L, n[1] / L, n[2] / L]
}

/** ∫∫ |S_u × S_v| du dv by the midpoint rule: the area of the mid-surface, m². */
export function integrateArea(f: Family, nu = 400, nv = 200): number {
  const du = (f.u[1] - f.u[0]) / nu, dv = (f.v[1] - f.v[0]) / nv
  let A = 0
  for (let i = 0; i < nu; i++) {
    const u = f.u[0] + (i + 0.5) * du
    for (let j = 0; j < nv; j++) {
      const { Su, Sv } = derivatives(f, u, f.v[0] + (j + 0.5) * dv)
      A += len(cross(Su, Sv))
    }
  }
  return A * du * dv
}

/**
 * +1 when S_u × S_v already points outward, −1 when the outside is the other side. Tested at an interior point,
 * away from any seam. A one-sided surface has no outside: +1.
 */
export function orientation(f: Family): 1 | -1 {
  if (f.outward === 'none') return 1
  const u = f.u[0] + 0.37 * (f.u[1] - f.u[0]), v = f.v[0] + 0.61 * (f.v[1] - f.v[0])
  const n = normalAt(f, u, v)
  const p = f.point(u, v)
  const want: Vec3 = f.outward === 'up' ? [0, 1, 0] : [p[0], 0, p[2]]
  return dot(n, want) >= 0 ? 1 : -1
}

/**
 * Smallest principal radius of curvature over the surface, m: where the surface bends tightest. An offset of half
 * the thickness beyond it folds the shell over itself (rule 12). From the first and second fundamental forms,
 * sampled on a grid; second derivatives by central differences.
 */
export function minCurvatureRadius(f: Family, nu = 96, nv = 48): number {
  const hu = (f.u[1] - f.u[0]) * 1e-4, hv = (f.v[1] - f.v[0]) * 1e-4
  let kMax = 0
  for (let i = 0; i <= nu; i++) {
    const u = f.u[0] + ((f.u[1] - f.u[0]) * i) / nu
    for (let j = 0; j <= nv; j++) {
      const v = f.v[0] + ((f.v[1] - f.v[0]) * j) / nv
      const P = f.point(u, v)
      const pu = f.point(u + hu, v), mu = f.point(u - hu, v), pv = f.point(u, v + hv), mv = f.point(u, v - hv)
      const pp = f.point(u + hu, v + hv), pm = f.point(u + hu, v - hv), mp = f.point(u - hu, v + hv), mm = f.point(u - hu, v - hv)
      const Su: Vec3 = [0, 1, 2].map((k) => (pu[k]! - mu[k]!) / (2 * hu)) as Vec3
      const Sv: Vec3 = [0, 1, 2].map((k) => (pv[k]! - mv[k]!) / (2 * hv)) as Vec3
      const Suu: Vec3 = [0, 1, 2].map((k) => (pu[k]! - 2 * P[k]! + mu[k]!) / (hu * hu)) as Vec3
      const Svv: Vec3 = [0, 1, 2].map((k) => (pv[k]! - 2 * P[k]! + mv[k]!) / (hv * hv)) as Vec3
      const Suv: Vec3 = [0, 1, 2].map((k) => (pp[k]! - pm[k]! - mp[k]! + mm[k]!) / (4 * hu * hv)) as Vec3
      const nn = cross(Su, Sv)
      const L0 = len(nn)
      if (L0 < 1e-12) continue
      const n: Vec3 = [nn[0] / L0, nn[1] / L0, nn[2] / L0]
      const E = dot(Su, Su), F = dot(Su, Sv), G = dot(Sv, Sv)
      const L = dot(Suu, n), M = dot(Suv, n), N = dot(Svv, n)
      const det = E * G - F * F
      const K = (L * N - M * M) / det
      const H = (E * N - 2 * F * M + G * L) / (2 * det)
      const k = Math.abs(H) + Math.sqrt(Math.max(0, H * H - K))
      if (k > kMax) kMax = k
    }
  }
  return kMax > 0 ? 1 / kMax : Infinity
}

/** The largest plan dimension of the mid-surface, m: what a shell spans (rule 13). */
export function planSpan(p: SurfaceParams): number {
  switch (p.family) {
    case 'hyperboloid':
      return 2 * Math.max(p.waist_radius!, p.end_radius!)
    case 'catenoid':
      return 2 * p.waist_radius! * Math.cosh(p.height! / 2 / p.waist_radius!)
    case 'hyperbolic_paraboloid':
    case 'monkey_saddle':
      return Math.max(p.span!, p.span2 ?? p.span!)
    case 'helicoid':
      return 2 * p.radius!
    case 'klein_bottle':
      return 2 * (p.radius! + KLEIN_REACH * p.tube!)
  }
}

/** max |cos(u/2)·sin v − sin(u/2)·sin 2v| = √(25/16): how far the figure-8 reaches from the ring, per unit tube. */
export const KLEIN_REACH = 1.25

/**
 * Free height under the shell, m, after placement on the ground, where it means something:
 * under a saddle at the plan center (min) and at its highest point (max); between turns of a helicoid on its
 * walking line, half way out (min) and at the rim (max). Null for the towers and the Klein bottle.
 */
export function clearance(p: SurfaceParams, thickness: number, base: number): { min: number; max: number } | null {
  const f = family(p)
  switch (p.family) {
    case 'hyperbolic_paraboloid':
    case 'monkey_saddle': {
      const lift = base - placementLow(f, thickness)
      // Underside along the vertical: the shell is offset along its normal, so the vertical gap is (t/2)/n_y.
      const under = (u: number, v: number) => f.point(u, v)[1] - thickness / 2 / Math.abs(normalAt(f, u, v)[1]) + lift
      let max = -Infinity
      for (let i = 0; i <= 40; i++)
        for (let j = 0; j <= 40; j++) max = Math.max(max, under(f.u[0] + ((f.u[1] - f.u[0]) * i) / 40, f.v[0] + ((f.v[1] - f.v[0]) * j) / 40))
      return { min: under(0, 0), max }
    }
    case 'helicoid': {
      if (p.turns! <= 1) return null
      const c = p.pitch! / TAU
      const gap = (v: number) => p.pitch! - thickness / (v / Math.sqrt(v * v + c * c))
      return { min: gap(p.radius! / 2), max: gap(p.radius!) }
    }
    default:
      return null
  }
}

/**
 * Lowest Y of the shell before placement: the mid-surface offset by ±t/2 along the normal, sampled on a grid.
 * The engine lifts the shell so this point sits at `bare.section_center_height` (DECISIONS.md 136).
 */
export function placementLow(f: Family, thickness: number, nu = 96, nv = 48): number {
  let low = Infinity
  for (let i = 0; i <= nu; i++) {
    const u = f.u[0] + ((f.u[1] - f.u[0]) * i) / nu
    for (let j = 0; j <= nv; j++) {
      const v = f.v[0] + ((f.v[1] - f.v[0]) * j) / nv
      const y = f.point(u, v)[1]
      const n = normalAt(f, u, v)
      low = Math.min(low, y - (Math.abs(n[1]) * thickness) / 2)
    }
  }
  return low
}
