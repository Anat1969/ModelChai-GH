/**
 * Cutting a closed mesh with a horizontal plane and capping the cut (DECISIONS.md 113). Used by the print file
 * to remove what lies below the ground. Pure: typed arrays in, typed arrays out.
 *
 * The cut keeps the part above the plane. Each triangle that crosses the plane is clipped; a crossing point is
 * made once per mesh edge, so the two triangles that share an edge share the point and the clipped surface stays
 * welded. The clipped boundary is a set of closed loops in the plane. Loops are nested by containment: a loop
 * inside an even number of others is an outline, inside an odd number a hole (even-odd), so the cap of a shell
 * is a ring. Each outline with its holes is joined into one polygon by bridges and triangulated by ear clipping.
 * The cap runs every boundary edge the other way from the clipped surface, so every edge joins two triangles.
 */
import type { SolidMesh } from './types'

export interface PlaneCut {
  mesh: SolidMesh
  /** The height the cut was made at: the requested level, nudged off any vertex by a hair. */
  level: number
  /** Closed loops in the cap: outlines and holes. */
  loops: number
  holes: number
  capTriangles: number
  /** False when the whole mesh is above the plane and nothing was cut. */
  cut: boolean
}

/** Keeps the part of a closed mesh above `level` along `axis` (1 = Y, up in the engine) and caps it. */
export function cutBelow(m: SolidMesh, level: number, axis: 0 | 1 | 2 = 1): PlaneCut {
  const P = m.positions, I = m.indices
  const nv = P.length / 3
  const iu = (axis + 1) % 3, iv = (axis + 2) % 3

  // Move the plane off the vertices, so no vertex lies on it and every crossing is a proper one.
  let lo = Infinity, hi = -Infinity, ext = 0
  for (let k = 0; k < 3; k++) {
    let a = Infinity, b = -Infinity
    for (let i = k; i < P.length; i += 3) (a = Math.min(a, P[i]!)), (b = Math.max(b, P[i]!))
    if (k === axis) (lo = a), (hi = b)
    ext = Math.max(ext, b - a)
  }
  const eps = Math.max(1e-12, ext * 1e-9)
  let h = level
  for (let tries = 0; tries < 64; tries++) {
    let near = false
    for (let i: number = axis; i < P.length && !near; i += 3) if (Math.abs(P[i]! - h) < eps) near = true
    if (!near) break
    h += 2.5 * eps
  }
  if (lo > h) return { mesh: m, level: h, loops: 0, holes: 0, capTriangles: 0, cut: false }
  if (hi < h) return { mesh: { positions: new Float64Array(0), indices: new Uint32Array(0) }, level: h, loops: 0, holes: 0, capTriangles: 0, cut: true }

  // Kept vertices first, then one crossing point per crossed edge.
  const map = new Int32Array(nv).fill(-1)
  const pos: number[] = []
  let n = 0
  for (let i = 0; i < nv; i++) {
    if (P[3 * i + axis]! > h) {
      map[i] = n++
      pos.push(P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!)
    }
  }
  const crossing = new Map<number, number>()
  const cross = (a: number, b: number): number => {
    const key = a < b ? a * nv + b : b * nv + a
    let k = crossing.get(key)
    if (k === undefined) {
      const ya = P[3 * a + axis]!, yb = P[3 * b + axis]!
      const t = (h - ya) / (yb - ya)
      for (let c = 0; c < 3; c++) pos.push(c === axis ? h : P[3 * a + c]! + t * (P[3 * b + c]! - P[3 * a + c]!))
      k = n++
      crossing.set(key, k)
    }
    return k
  }

  const out: number[] = []
  // The cap's edges, in the direction the cap runs them: from → to.
  const next = new Map<number, number>()
  const capEdge = (from: number, to: number) => {
    if (next.has(from)) throw new Error('החיתוך לא נסגר: הגוף אינו אטום')
    next.set(from, to)
  }
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t]!, I[t + 1]!, I[t + 2]!]
    const up = v.map((i) => P[3 * i + axis]! > h)
    const count = +up[0]! + +up[1]! + +up[2]!
    if (count === 3) out.push(map[v[0]!]!, map[v[1]!]!, map[v[2]!]!)
    if (count === 0 || count === 3) continue
    if (count === 1) {
      // a above, b and c below: keep a, ab, ca.
      const r = up.indexOf(true)
      const a = v[r]!, b = v[(r + 1) % 3]!, c = v[(r + 2) % 3]!
      const ab = cross(a, b), ca = cross(c, a)
      out.push(map[a]!, ab, ca)
      capEdge(ca, ab)
    } else {
      // a and b above, c below: keep a, b, bc, ca.
      const r = up.indexOf(false)
      const c = v[r]!, a = v[(r + 1) % 3]!, b = v[(r + 2) % 3]!
      const bc = cross(b, c), ca = cross(c, a)
      out.push(map[a]!, map[b]!, bc, map[a]!, bc, ca)
      capEdge(ca, bc)
    }
  }

  // Chain the cap edges into loops.
  const loops: number[][] = []
  const seen = new Set<number>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let k = start
    while (!seen.has(k)) {
      seen.add(k)
      loop.push(k)
      const nk = next.get(k)
      if (nk === undefined) throw new Error('החיתוך לא נסגר: הגוף אינו אטום')
      k = nk
    }
    if (k !== start) throw new Error('החיתוך לא נסגר: הגוף אינו אטום')
    loops.push(loop)
  }

  const X = new Float64Array(n), Y = new Float64Array(n)
  for (let i = 0; i < n; i++) (X[i] = pos[3 * i + iu]!), (Y[i] = pos[3 * i + iv]!)
  const cap = capLoops(loops, X, Y)
  for (const v of cap.triangles) out.push(v)
  return {
    mesh: { positions: Float64Array.from(pos), indices: Uint32Array.from(out) },
    level: h,
    loops: loops.length,
    holes: cap.holes,
    capTriangles: cap.triangles.length / 3,
    cut: true,
  }
}

// ---------- the cap: nesting and ear clipping, in the plane's own 2D coordinates ----------

const signedArea = (loop: number[], X: Float64Array, Y: Float64Array) => {
  let s = 0
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += X[loop[j]!]! * Y[loop[i]!]! - X[loop[i]!]! * Y[loop[j]!]!
  return s / 2
}

function inside(x: number, y: number, loop: number[], X: Float64Array, Y: Float64Array): boolean {
  let c = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = X[loop[i]!]!, yi = Y[loop[i]!]!, xj = X[loop[j]!]!, yj = Y[loop[j]!]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/**
 * Triangles for a set of closed, non-crossing loops. Each triangle winds the way its region's outline was given,
 * so a loop handed over in the cap's direction comes out in the cap's direction.
 */
export function capLoops(loops: number[][], X: Float64Array, Y: Float64Array): { triangles: number[]; holes: number } {
  const L = loops.length
  const area = loops.map((l) => signedArea(l, X, Y))
  const depth = new Array<number>(L).fill(0)
  const parent = new Array<number>(L).fill(-1)
  for (let i = 0; i < L; i++) {
    const p = loops[i]![0]!
    for (let j = 0; j < L; j++) {
      if (i === j || Math.abs(area[j]!) <= Math.abs(area[i]!)) continue
      if (!inside(X[p]!, Y[p]!, loops[j]!, X, Y)) continue
      depth[i]!++
      if (parent[i] === -1 || Math.abs(area[j]!) < Math.abs(area[parent[i]!]!)) parent[i] = j
    }
  }
  const triangles: number[] = []
  let holes = 0
  for (let i = 0; i < L; i++) {
    if (depth[i]! % 2 === 1) continue
    const ccw = (l: number[], want: boolean) => ((signedArea(l, X, Y) > 0) === want ? l : [...l].reverse())
    const own = loops.flatMap((l, j) => (depth[j]! % 2 === 1 && parent[j] === i ? [ccw(l, false)] : []))
    holes += own.length
    const tris = earClip(ccw(loops[i]!, true), own, X, Y)
    if (area[i]! < 0) for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2]!, tris[t + 1]!]
    for (const v of tris) triangles.push(v)
  }
  return { triangles, holes }
}

/** Ear clipping of a counterclockwise outline with clockwise holes; returns counterclockwise triangles. */
export function earClip(outer: number[], holes: number[][], X: Float64Array, Y: Float64Array): number[] {
  // A ring of nodes; a node is a mesh vertex, and a bridge visits a vertex twice.
  const vert: number[] = [], prev: number[] = [], nxt: number[] = []
  const ring = (loop: number[]) => {
    const first = vert.length
    loop.forEach((v, k) => {
      vert.push(v)
      prev.push(first + ((k - 1 + loop.length) % loop.length))
      nxt.push(first + ((k + 1) % loop.length))
    })
    return first
  }
  const x = (a: number) => X[vert[a]!]!, y = (a: number) => Y[vert[a]!]!
  const crossOf = (a: number, b: number, c: number) => (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a))
  const same = (a: number, b: number) => x(a) === x(b) && y(a) === y(b)
  const start = ring(outer)
  let size = outer.length

  // Holes, rightmost first: bridge each hole's rightmost vertex to the nearest visible vertex to its right.
  const order = holes.map((h) => ring(h)).map((first) => {
    let best = first
    for (let a = nxt[first]!; a !== first; a = nxt[a]!) if (x(a) > x(best) || (x(a) === x(best) && y(a) < y(best))) best = a
    return best
  })
  order.sort((a, b) => x(b) - x(a))
  const segHit = (p1: number, p2: number, q1: number, q2: number) => {
    if (same(p1, q1) || same(p1, q2) || same(p2, q1) || same(p2, q2)) return false
    const d1 = crossOf(p1, p2, q1), d2 = crossOf(p1, p2, q2), d3 = crossOf(q1, q2, p1), d4 = crossOf(q1, q2, p2)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }
  const locallyInside = (a: number, b: number) => {
    const p = prev[a]!, n = nxt[a]!
    return crossOf(p, a, n) >= 0 ? crossOf(p, a, b) >= 0 && crossOf(a, n, b) >= 0 : crossOf(p, a, b) >= 0 || crossOf(a, n, b) >= 0
  }
  let head = start
  for (const m of order) {
    const holeLen = (() => {
      let k = 1
      for (let a = nxt[m]!; a !== m; a = nxt[a]!) k++
      return k
    })()
    const candidates: number[] = []
    let a = head
    do {
      if (x(a) >= x(m)) candidates.push(a)
      a = nxt[a]!
    } while (a !== head)
    const d2 = (a: number) => (x(a) - x(m)) ** 2 + (y(a) - y(m)) ** 2
    candidates.sort((p, q) => d2(p) - d2(q))
    let bridge = -1
    for (const c of candidates) {
      if (!locallyInside(c, m)) continue
      let blocked = false
      let e = head
      do {
        if (segHit(m, c, e, nxt[e]!)) (blocked = true), (e = head)
        else e = nxt[e]!
      } while (e !== head)
      if (!blocked) {
        for (let f = nxt[m]!, g = m; ; g = f, f = nxt[f]!) {
          if (segHit(m, c, g, f)) {
            blocked = true
            break
          }
          if (f === m) break
        }
      }
      if (!blocked) {
        bridge = c
        break
      }
    }
    if (bridge === -1) bridge = candidates[0] ?? head
    // c → m → (hole) → m' → c' → c.next
    const m2 = vert.length, c2 = m2 + 1
    vert.push(vert[m]!, vert[bridge]!)
    prev.push(0, 0)
    nxt.push(0, 0)
    const cNext = nxt[bridge]!, mPrev = prev[m]!
    nxt[bridge] = m
    prev[m] = bridge
    nxt[mPrev] = m2
    prev[m2] = mPrev
    nxt[m2] = c2
    prev[c2] = m2
    nxt[c2] = cNext
    prev[cNext] = c2
    size += holeLen + 2
    head = bridge
  }

  const tris: number[] = []
  const pointIn = (a: number, b: number, c: number, p: number) =>
    crossOf(a, b, p) >= 0 && crossOf(b, c, p) >= 0 && crossOf(c, a, p) >= 0
  const isEar = (e: number) => {
    const a = prev[e]!, c = nxt[e]!
    if (crossOf(a, e, c) <= 0) return false
    for (let p = nxt[c]!; p !== a; p = nxt[p]!) {
      if (same(p, a) || same(p, e) || same(p, c)) continue
      if (crossOf(prev[p]!, p, nxt[p]!) <= 0 && pointIn(a, e, c, p)) return false
    }
    return true
  }
  const clip = (e: number) => {
    const a = prev[e]!, c = nxt[e]!
    tris.push(vert[a]!, vert[e]!, vert[c]!)
    nxt[a] = c
    prev[c] = a
    size--
    return c
  }
  let e = head
  // Pass 0 takes true ears. When a full turn finds none (a degenerate ring), pass 1 takes any convex vertex and
  // pass 2 any vertex, so the ring always closes and every boundary edge still lands in one triangle.
  let pass = 0, stop = e
  while (size > 3) {
    const ok = pass === 0 ? isEar(e) : pass === 1 ? crossOf(prev[e]!, e, nxt[e]!) > 0 : true
    if (ok) {
      e = clip(e)
      stop = e
      pass = 0
      continue
    }
    e = nxt[e]!
    if (e === stop) pass = Math.min(2, pass + 1)
  }
  tris.push(vert[prev[e]!]!, vert[e]!, vert[nxt[e]!]!)
  return tris
}
