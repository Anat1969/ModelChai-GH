/**
 * Binary STL for 3D printing (ARCHITECTURE.md 6): the welded closed mesh, Z up, meters.
 * Y-up to Z-up maps (x, y, z) to (x, −z, y), which keeps the handedness, as in umbilic_torus.py.
 */
import type { SolidMesh } from '../types'

export function writeStl(m: SolidMesh, title: string): Uint8Array {
  const tris = m.indices.length / 3
  const buf = new ArrayBuffer(84 + 50 * tris)
  const view = new DataView(buf)
  const header = new TextEncoder().encode(title.replace(/[^\x20-\x7e]/g, '').slice(0, 80))
  new Uint8Array(buf, 0, 80).set(header)
  view.setUint32(80, tris, true)
  const P = m.positions
  const at = (i: number): [number, number, number] => [P[3 * i]!, -P[3 * i + 2]!, P[3 * i + 1]!]
  let o = 84
  for (let t = 0; t < tris; t++) {
    const a = at(m.indices[3 * t]!), b = at(m.indices[3 * t + 1]!), c = at(m.indices[3 * t + 2]!)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= L
    ny /= L
    nz /= L
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) {
      view.setFloat32(o, v, true)
      o += 4
    }
    view.setUint16(o, 0, true)
    o += 2
  }
  return new Uint8Array(buf)
}
