/**
 * Drawings of the models, computed from their equations, not drawn by hand. Each returns polylines fitted into
 * a 240×160 box; the first line is the model itself, the rest are guides. Pure: no DOM.
 */
export type Pt = [number, number]
export interface Figure {
  lines: { pts: Pt[]; role: 'main' | 'guide' | 'fill'; closed?: boolean }[]
}

const W = 240
const H = 160
const PAD = 14
const TAU = Math.PI * 2

export const sample = (f: (t: number) => Pt, t0: number, t1: number, n = 240): Pt[] => Array.from({ length: n + 1 }, (_, i) => f(t0 + ((t1 - t0) * i) / n))

/** A simple oblique projection for space curves: x right, y up, z into the page. */
export const project = ([x, y, z]: [number, number, number]): Pt => [x + 0.45 * z, -(y + 0.3 * z)]

/** Scales and centers every line together into the box, keeping proportions. */
export function fit(lines: Figure['lines']): Figure {
  const all = lines.flatMap((l) => l.pts)
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1))
  const ox = (W - k * (x1 - x0)) / 2 - k * x0
  const oy = (H - k * (y1 - y0)) / 2 - k * y0
  return { lines: lines.map((l) => ({ ...l, pts: l.pts.map(([x, y]) => [+(ox + k * x).toFixed(2), +(oy + k * y).toFixed(2)] as Pt) })) }
}

/** SVG path data for a polyline. */
export const pathOf = (pts: Pt[], closed = false) => `M${pts.map((p) => p.join(',')).join('L')}${closed ? 'Z' : ''}`

const main = (pts: Pt[], closed = false) => ({ pts, role: 'main' as const, closed })
const guide = (pts: Pt[], closed = false) => ({ pts, role: 'guide' as const, closed })
const circle = (r: number, cx = 0, cy = 0, n = 120): Pt[] => sample((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)], 0, TAU, n)

export const FIGURES: Record<string, () => Figure> = {
  umbilic_torus: () => {
    // The deltoid section, swept around a ring: three cusps that turn into one edge.
    const delt = (s: number, cx: number, cy: number, rot: number): Pt[] =>
      sample((t) => {
        const x = 2 * Math.cos(t) + Math.cos(2 * t),
          y = 2 * Math.sin(t) - Math.sin(2 * t)
        return [cx + s * (x * Math.cos(rot) - y * Math.sin(rot)), cy + s * 0.5 * (x * Math.sin(rot) + y * Math.cos(rot))]
      }, 0, TAU, 90)
    const ring = sample((t) => [10 * Math.cos(t), 4 * Math.sin(t)], 0, TAU, 160)
    return fit([guide(ring, true), ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * TAU
      return { pts: delt(0.9, 10 * Math.cos(a), 4 * Math.sin(a), a / 3), role: i === 0 ? ('main' as const) : ('guide' as const), closed: true }
    })])
  },
  mobius: () => {
    const edge = sample((t) => project([(3 + Math.cos(t / 2)) * Math.cos(t), Math.sin(t / 2) * 1.2, (3 + Math.cos(t / 2)) * Math.sin(t)]), 0, 2 * TAU, 400)
    const core = sample((t) => project([3 * Math.cos(t), 0, 3 * Math.sin(t)]), 0, TAU, 160)
    return fit([guide(core, true), main(edge)])
  },
  klein: () => {
    // The figure-eight immersion's profile: a bulb, a neck that passes through the wall, and the mouth.
    const f = (t: number): Pt => {
      const r = 4 * (1 - Math.cos(t) / 2)
      return t < Math.PI ? [6 * Math.cos(t) * (1 + Math.sin(t)) + r * Math.cos(t), -(16 * Math.sin(t) + r * Math.sin(t))] : [6 * Math.cos(t) * (1 + Math.sin(t)) - r * Math.cos(t), -16 * Math.sin(t)]
    }
    const outer = sample(f, 0, TAU, 300)
    return fit([main(outer), guide(sample((t) => [6 * Math.cos(t) * (1 + Math.sin(t)), -16 * Math.sin(t)], 0, TAU, 200))])
  },
  trefoil: () => fit([main(sample((t) => project([Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)]), 0, TAU, 360), true)]),
  torus_knot: () => {
    const p = 2,
      q = 5
    return fit([main(sample((t) => project([(3 + Math.cos(q * t)) * Math.cos(p * t), Math.sin(q * t), (3 + Math.cos(q * t)) * Math.sin(p * t)]), 0, TAU, 600), true), guide(sample((t) => project([3 * Math.cos(t), 0, 3 * Math.sin(t)]), 0, TAU, 120), true)])
  },
  helix: () => fit([main(sample((t) => project([2 * Math.cos(t), 0.5 * t, 2 * Math.sin(t)]), 0, 3 * TAU, 400)), guide([project([0, 0, 0]), project([0, 0.5 * 3 * TAU, 0])])]),
  golden_spiral: () => {
    const b = Math.log((1 + Math.sqrt(5)) / 2) / (Math.PI / 2)
    const spiral = sample((t) => [Math.exp(b * t) * Math.cos(t), -Math.exp(b * t) * Math.sin(t)], -2 * Math.PI, 2.5 * Math.PI, 300)
    return fit([main(spiral)])
  },
  fibonacci: () => {
    // Squares 1,1,2,3,5,8,13 placed in turn, with the quarter arcs through them.
    const sizes = [1, 1, 2, 3, 5, 8, 13]
    const lines: Figure['lines'] = []
    let [x0, y0, x1, y1] = [0, 0, 1, 1]
    const arcs: Pt[] = []
    sizes.forEach((s, i) => {
      let sq: [number, number, number, number]
      let c: Pt, a0: number
      if (i === 0) (sq = [0, 0, 1, 1]), (c = [1, 1]), (a0 = Math.PI)
      else if (i % 4 === 1) (sq = [x1, y0, x1 + s, y0 + s]), (c = [x1, y0 + s]), (a0 = -Math.PI / 2)
      else if (i % 4 === 2) (sq = [x1 - s, y1, x1, y1 + s]), (c = [x1 - s, y1]), (a0 = 0)
      else if (i % 4 === 3) (sq = [x0 - s, y1 - s, x0, y1]), (c = [x0, y1 - s]), (a0 = Math.PI / 2)
      else (sq = [x0, y0 - s, x0 + s, y0]), (c = [x0 + s, y0]), (a0 = Math.PI)
      lines.push(guide([[sq[0], sq[1]], [sq[2], sq[1]], [sq[2], sq[3]], [sq[0], sq[3]]], true))
      arcs.push(...sample((t) => [c[0] + s * Math.cos(t), c[1] + s * Math.sin(t)], a0, a0 + Math.PI / 2, 20))
      ;[x0, y0, x1, y1] = [Math.min(x0, sq[0]), Math.min(y0, sq[1]), Math.max(x1, sq[2]), Math.max(y1, sq[3])]
    })
    return fit([...lines, main(arcs)])
  },
  hyperboloid: () => {
    const lines: Figure['lines'] = []
    const top = sample((t) => project([3 * Math.cos(t), 4, 3 * Math.sin(t)]), 0, TAU, 100)
    const bot = sample((t) => project([3 * Math.cos(t), -4, 3 * Math.sin(t)]), 0, TAU, 100)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU
      lines.push(main([project([3 * Math.cos(a), -4, 3 * Math.sin(a)]), project([3 * Math.cos(a + 2), 4, 3 * Math.sin(a + 2)])]))
    }
    return fit([guide(top, true), guide(bot, true), ...lines])
  },
  hypar: () => {
    const lines: Figure['lines'] = []
    for (let i = -4; i <= 4; i++) {
      lines.push(main(sample((u) => project([u, (u * i) / 6, i]), -4, 4, 2)))
      lines.push(main(sample((v) => project([i, (i * v) / 6, v]), -4, 4, 2)))
    }
    return fit(lines)
  },
  catenary: () => {
    const arch = sample((x) => [x, -(4 - (Math.cosh(x / 2.2) - 1) * 2.2)], -4.6, 4.6, 120)
    return fit([main(arch), guide([[-5.4, 0.2], [5.4, 0.2]])])
  },
  sine: () => fit([main(sample((x) => [x, -Math.sin(x)], 0, 3 * TAU, 300)), guide([[0, 0], [3 * TAU, 0]])]),
  reuleaux: () => {
    const v: Pt[] = [0, 1, 2].map((i) => [Math.cos(Math.PI / 2 + (i * TAU) / 3), -Math.sin(Math.PI / 2 + (i * TAU) / 3)])
    const s = Math.sqrt(3)
    const arcs = v.flatMap((c, i) => {
      const a = v[(i + 1) % 3]!,
        b = v[(i + 2) % 3]!
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]),
        a1 = Math.atan2(b[1] - c[1], b[0] - c[0])
      let d = a1 - a0
      if (d > Math.PI) d -= TAU
      if (d < -Math.PI) d += TAU
      return sample((t) => [c[0] + s * Math.cos(t), c[1] + s * Math.sin(t)], a0, a0 + d, 40)
    })
    return fit([main(arcs, true), guide(v, true), guide(circle(0.866, 0, 0.0))])
  },
  lemniscate: () => fit([main(sample((t) => [Math.cos(t) / (1 + Math.sin(t) ** 2), -(Math.sin(t) * Math.cos(t)) / (1 + Math.sin(t) ** 2)], 0, TAU, 300), true)]),
  astroid: () => fit([main(sample((t) => [Math.cos(t) ** 3, Math.sin(t) ** 3], 0, TAU, 300), true), guide(circle(1))]),
  superellipse: () => {
    const n = 2.5
    const se = sample((t) => [Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** (2 / n) * 1.5, Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / n)], 0, TAU, 300)
    return fit([main(se, true), guide(sample((t) => [1.5 * Math.cos(t), Math.sin(t)], 0, TAU, 160), true)])
  },
  riemann: () => {
    const f = (x: number) => 1 + Math.sin(x / 1.6) * 0.8 + x / 8
    const bars: Figure['lines'] = []
    for (let i = 0; i < 12; i++) {
      const x = i * 0.8,
        h = f(x + 0.4)
      bars.push(guide([[x, 0], [x, -h], [x + 0.8, -h], [x + 0.8, 0]]))
    }
    return fit([...bars, main(sample((x) => [x, -f(x)], 0, 9.6, 200))])
  },
  voronoi: () => {
    // Cells of 9 fixed seeds, traced as the boundaries where the nearest seed changes (sampled on a grid).
    const seeds: Pt[] = [[1, 1], [3.5, 0.6], [6, 1.4], [8.4, 0.8], [2, 3.4], [4.6, 2.8], [7, 3.6], [1, 5.4], [4, 5.2], [6.6, 5.6], [8.6, 4.8]]
    const near = (x: number, y: number) => seeds.reduce((b, s, i) => ((x - s[0]) ** 2 + (y - s[1]) ** 2 < (x - seeds[b]![0]) ** 2 + (y - seeds[b]![1]) ** 2 ? i : b), 0)
    const lines: Figure['lines'] = []
    const st = 0.12
    for (let x = 0; x < 9.6; x += st)
      for (let y = 0; y < 6.4; y += st) {
        const a = near(x, y)
        if (near(x + st, y) !== a) lines.push(main([[x + st / 2, y - st / 2], [x + st / 2, y + st / 2]]))
        if (near(x, y + st) !== a) lines.push(main([[x - st / 2, y + st / 2], [x + st / 2, y + st / 2]]))
      }
    return fit([guide([[0, 0], [9.6, 0], [9.6, 6.4], [0, 6.4]], true), ...lines, ...seeds.map((s) => guide(circle(0.06, s[0], s[1], 12), true))])
  },
  koch: () => {
    let pts: Pt[] = [[0, 0], [1, 0], [0.5, -Math.sqrt(3) / 2], [0, 0]]
    for (let k = 0; k < 4; k++) {
      const next: Pt[] = []
      for (let i = 0; i < pts.length - 1; i++) {
        const [a, b] = [pts[i]!, pts[i + 1]!]
        const d: Pt = [(b[0] - a[0]) / 3, (b[1] - a[1]) / 3]
        const p1: Pt = [a[0] + d[0], a[1] + d[1]],
          p3: Pt = [a[0] + 2 * d[0], a[1] + 2 * d[1]]
        const ang = Math.PI / 3
        const p2: Pt = [p1[0] + d[0] * Math.cos(ang) - d[1] * Math.sin(ang), p1[1] + d[0] * Math.sin(ang) + d[1] * Math.cos(ang)]
        next.push(a, p1, p2, p3)
      }
      next.push(pts.at(-1)!)
      pts = next
    }
    return fit([main(pts, true)])
  },
  ellipse_foci: () => {
    const e = sample((t) => [2 * Math.cos(t), Math.sin(t)], 0, TAU, 160)
    const f = Math.sqrt(3)
    const p: Pt = [2 * Math.cos(1.1), Math.sin(1.1)]
    return fit([main(e, true), guide([[-f, 0], p, [f, 0]]), guide(circle(0.05, -f, 0, 12), true), guide(circle(0.05, f, 0, 12), true)])
  },
  cycloid: () => fit([main(sample((t) => [t - Math.sin(t), 1 - Math.cos(t)], 0, Math.PI, 120)), guide([[0, 0], [Math.PI, 2]]), guide(circle(1, 0, 1, 80), true)]),
  catenoid: () => {
    const lines: Figure['lines'] = []
    const prof = (y: number) => Math.cosh(y / 1.6) * 1.6
    for (const y of [-2.4, -1.2, 0, 1.2, 2.4]) lines.push(guide(sample((t) => project([prof(y) * Math.cos(t), y, prof(y) * Math.sin(t)]), 0, TAU, 100), true))
    lines.push(main(sample((y) => project([prof(y), y, 0]), -2.4, 2.4, 80)))
    lines.push(main(sample((y) => project([-prof(y), y, 0]), -2.4, 2.4, 80)))
    return fit(lines)
  },
}
