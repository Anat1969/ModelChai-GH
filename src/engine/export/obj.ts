/** OBJ for Rhino (ARCHITECTURE.md 6): every mesh as an object, and each edge curve as a separate polyline. */
import type { BuildSuccess } from '../build'

const f = (n: number) => (Math.abs(n) < 5e-6 ? '0' : n.toFixed(5))

export function writeObj(r: BuildSuccess, title: string): string {
  const out: string[] = [`# ${title}`, '# Units: meters. Y up.', 's off']
  let base = 1
  for (const [name, mesh] of Object.entries(r.meshes)) {
    if (!mesh || !mesh.indices.length) continue
    out.push(`o ${name}`)
    const p = mesh.positions, n = mesh.normals
    for (let v = 0; v < p.length; v += 3) out.push(`v ${f(p[v]!)} ${f(p[v + 1]!)} ${f(p[v + 2]!)}`)
    for (let v = 0; v < n.length; v += 3) out.push(`vn ${f(n[v]!)} ${f(n[v + 1]!)} ${f(n[v + 2]!)}`)
    const ix = mesh.indices
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! + base, b = ix[t + 1]! + base, c = ix[t + 2]! + base
      out.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`)
    }
    base += p.length / 3
  }
  r.curves.edges.forEach((e, k) => {
    out.push(`o edge_${k + 1}`)
    const count = e.length / 3
    for (let v = 0; v < e.length; v += 3) out.push(`v ${f(e[v]!)} ${f(e[v + 1]!)} ${f(e[v + 2]!)}`)
    const ids = Array.from({ length: count }, (_, i) => base + i)
    if (r.curves.edgesClosed) ids.push(base)
    out.push(`l ${ids.join(' ')}`)
    base += count
  })
  return out.join('\n') + '\n'
}
