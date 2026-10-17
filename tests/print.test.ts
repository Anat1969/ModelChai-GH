/** Getting a model ready for FDM printing in PLA (DECISIONS.md 87): closed, to scale, with a printable wall. */
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { closedMeshVolume, buildClosedMesh } from '../src/engine/sweep/closedMesh'
import { minWall, openEdges, preparePrint, printOrientation, PRINT_DEFAULTS, weldAsStored } from '../src/engine/export/print'
import { crc32 } from '../src/engine/export/threeMf'
import { cutBelow } from '../src/engine/planeCut'
import { printFiles } from '../src/engine/export'
import { parseRecipe, type Recipe } from '../src/recipe/schema'
import { fixture } from './helpers'

const recipeOf = (raw: unknown): Recipe => {
  const p = parseRecipe(raw)
  if (!p.ok) throw new Error('fixture does not parse')
  return p.recipe
}
const sweep = (r: Recipe) => {
  if (r.generator.type !== 'sweep') throw new Error('not a sweep')
  return r.generator.params
}
/** A ring with a round section: its wall is the shell thickness everywhere. */
const roundRing = (thickness: number) => {
  const raw = fixture('umbilic-torus')
  raw.generator.params.section = { curve: 'circle', a: 2.4 }
  raw.generator.params.twist.turns_per_lap = 0
  raw.bare.shell.thickness = thickness
  delete raw.bare.openings
  return recipeOf(raw)
}

describe('wall thickness', () => {
  it('equals the shell thickness for a round section, within 0.5%', () => {
    const r = roundRing(0.3)
    expect(Math.abs(minWall(r, sweep(r))! - 0.3) / 0.3).toBeLessThan(0.005)
  })
  it('is null for a solid', () => {
    const r = recipeOf(fixture('mobius-strip'))
    expect(minWall(r, sweep(r))).toBeNull()
  })
})

describe('a print-ready body', () => {
  const torus = recipeOf(fixture('umbilic-torus'))
  const { mesh, report } = preparePrint(torus)

  it('is closed: every edge joins two triangles, with the openings cut through and closed by reveals', () => {
    expect(openEdges(buildClosedMesh(torus, sweep(torus), { withOpenings: true }))).toBeGreaterThan(0)
    expect(report.openEdges).toBe(0)
    expect(report.openingsCut).toBe(true)
    expect(report.openingsNote).toMatch(/3 מעברים ו-24 פסי אור/)
    expect(report.checks.find((c) => c.id === 'closed')!.ok).toBe(true)
  })

  it('has its longest side at the chosen size, within 0.5%', () => {
    expect(Math.abs(Math.max(...report.sizeMm) - PRINT_DEFAULTS.sizeMm) / PRINT_DEFAULTS.sizeMm).toBeLessThan(0.005)
    console.info(`[print] umbilic torus at ${PRINT_DEFAULTS.sizeMm} mm: 1:${report.scale}, ${report.sizeMm.map((v) => v.toFixed(1)).join(' × ')} mm`)
  })

  it('rests on the bed and is centered on it', () => {
    let minY = Infinity, minX = Infinity, maxX = -Infinity
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minY = Math.min(minY, mesh.positions[i + 1]!)
      minX = Math.min(minX, mesh.positions[i]!)
      maxX = Math.max(maxX, mesh.positions[i]!)
    }
    expect(minY).toBeCloseTo(0, 6)
    expect(minX + maxX).toBeCloseTo(0, 6)
  })

  it('thickens a wall that would print thinner than 2 mm, and measures at least 2 mm', () => {
    expect(report.recipeWallMm!).toBeLessThan(2)
    expect(report.body).toBe('shell-thickened')
    expect(report.wallMm!).toBeGreaterThanOrEqual(2 * 0.999)
    expect(report.thicknessM!).toBeGreaterThan(0.3)
    expect(report.bodyNote).toMatch(/המתכון לא השתנה/)
    console.info(`[print] wall ${report.recipeWallMm!.toFixed(2)} mm at 0.3 m → ${report.wallMm!.toFixed(2)} mm at ${report.thicknessM!.toFixed(3)} m`)
  })

  it('keeps the recipe as it was', () => {
    expect(torus.bare.shell!.thickness).toBe(0.3)
  })

  // The printed body is cut at the ground (DECISIONS.md 113), so the meters volume is measured on the cut body too.
  it('has a volume in mm³ equal to the meters volume times the scale cubed, within 0.5%', () => {
    const thick = structuredClone(torus)
    thick.bare.shell!.thickness = report.thicknessM!
    const m = cutBelow(buildClosedMesh(thick, sweep(thick), { reveals: true }), 0).mesh
    const mmPerM = Math.max(...report.sizeMm) / (Math.max(...report.sizeMm) * report.scale / 1000)
    const expected = Math.abs(closedMeshVolume(m)) * (1000 / report.scale) ** 3 / 1000
    expect(Math.abs(report.volumeCm3 - expected) / expected).toBeLessThan(0.005)
    expect(report.grams).toBeCloseTo(report.volumeCm3 * 1.24, 6)
    expect(mmPerM).toBeGreaterThan(0)
  })

  it('fits a 220 mm bed at 150 mm, and says how large it may grow when it does not', { timeout: 60000 }, () => {
    expect(report.checks.find((c) => c.id === 'bed')!.ok).toBe(true)
    const big = preparePrint(torus, { ...PRINT_DEFAULTS, sizeMm: 400 }).report
    const bed = big.checks.find((c) => c.id === 'bed')!
    expect(bed.ok).toBe(false)
    expect(bed.fix).toMatch(/נכנס/)
  })

  it('prints a shell too thin to thicken as a solid, and says why', { timeout: 60000 }, () => {
    const tiny = preparePrint(torus, { ...PRINT_DEFAULTS, sizeMm: 20 }).report
    expect(tiny.body).toBe('solid-from-shell')
    expect(tiny.bodyNote).toMatch(/גוף מלא/)
    expect(tiny.openEdges).toBe(0)
  })

  it('cuts at the ground: nothing below it, the cap closed, the buried part measured', () => {
    let minY = Infinity, maxY = -Infinity
    for (let i = 1; i < mesh.positions.length; i += 3) (minY = Math.min(minY, mesh.positions[i]!)), (maxY = Math.max(maxY, mesh.positions[i]!))
    expect(report.groundCut).toBe(true)
    expect(report.belowGroundM).toBeCloseTo(5.7, 6)
    expect(report.sectionCenterM).toBe(1.5)
    // Above the ground: the section center 1.5 m plus the outer radius 3 × 2.4 m.
    expect(Math.abs(report.sizeM[2] - 8.7) / 8.7).toBeLessThan(0.005)
    expect(Math.abs(maxY - minY - report.sizeMm[2])).toBeLessThan(1e-6)
    expect(minY).toBeCloseTo(0, 9)
    for (let k = 0; k < 3; k++) expect(report.sizeMm[k]).toBeCloseTo(report.sizeM[k]! * report.mmPerM, 6)
    expect(report.belowGroundM3).toBeGreaterThan(0)
    expect(report.belowGroundShare).toBeGreaterThan(0.2)
    expect(report.belowGroundShare).toBeLessThan(0.5)
    const whole = preparePrint(torus, { ...PRINT_DEFAULTS, groundCut: false }).report
    expect(whole.groundCut).toBe(false)
    expect(whole.sizeM[2]).toBeCloseTo(14.4, 4)
    expect(report.volumeCm3).toBeLessThan(whole.volumeCm3)
    console.info(
      `[print] ground cut: height ${whole.sizeM[2].toFixed(2)} → ${report.sizeM[2].toFixed(2)} m, ${whole.sizeMm.map((v) => v.toFixed(1)).join(' × ')} → ${report.sizeMm.map((v) => v.toFixed(1)).join(' × ')} mm, 1:${whole.scale} → 1:${report.scale}, ${whole.volumeCm3.toFixed(1)} → ${report.volumeCm3.toFixed(1)} cm³, buried ${report.belowGroundM3.toFixed(1)} m³ (${(report.belowGroundShare * 100).toFixed(1)}%)`,
    )
  })

  it('leaves a model that stands above the ground whole', () => {
    const r = preparePrint(recipeOf(fixture('mobius-strip'))).report
    expect(r.belowGroundM).toBe(0)
    expect(r.groundCut).toBe(false)
  })

  it('prints a solid as a solid', () => {
    const r = preparePrint(recipeOf(fixture('mobius-strip'))).report
    expect(r.body).toBe('solid')
    expect(r.wallMm).toBeNull()
    expect(r.openEdges).toBe(0)
  })
})

/** Every edge is used by exactly two triangles, once in each direction: closed and consistently oriented. */
function directedClosed(m: { indices: Uint32Array }): { open: number; same: number } {
  const use = new Map<string, number>()
  const I = m.indices
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = `${I[t + e]}>${I[t + ((e + 1) % 3)]}`
      use.set(k, (use.get(k) ?? 0) + 1)
    }
  let open = 0, same = 0
  for (const [k, n] of use) {
    const [a, b] = k.split('>')
    if (n > 1) same++
    if (!use.has(`${b}>${a}`)) open++
  }
  return { open, same }
}

describe('openings in the print (DECISIONS.md 133)', () => {
  const torus = recipeOf(fixture('umbilic-torus'))
  const params = sweep(torus)
  const plain = buildClosedMesh(torus, params, { withOpenings: false })
  const open = buildClosedMesh(torus, params, { withOpenings: true })
  const revealed = buildClosedMesh(torus, params, { reveals: true })

  it('closes every opening with a reveal: watertight and consistently oriented', () => {
    expect(openEdges(open)).toBeGreaterThan(0)
    expect(openEdges(revealed)).toBe(0)
    expect(directedClosed(revealed)).toEqual({ open: 0, same: 0 })
  })

  it('removes material: the volume drops by about the opening fraction of the shell', () => {
    const v0 = Math.abs(closedMeshVolume(plain)), v1 = Math.abs(closedMeshVolume(revealed))
    expect(v1).toBeLessThan(v0)
    const fraction = 1 - v1 / v0
    console.info(`[print] openings remove ${(fraction * 100).toFixed(2)}% of the shell volume (${v0.toFixed(1)} → ${v1.toFixed(1)} m³)`)
    expect(fraction).toBeGreaterThan(0.05)
    expect(fraction).toBeLessThan(0.4)
  })

  it('stays watertight after the ground cut, which opens the passages at the ground like doors', () => {
    const cut = cutBelow(revealed, 0).mesh
    expect(openEdges(cut)).toBe(0)
    expect(directedClosed(cut)).toEqual({ open: 0, same: 0 })
  })

  it('carries the openings on an open path too, keeping a row of wall at each cap', { timeout: 60000 }, () => {
    const raw = fixture('golden-ratio')
    raw.bare = { mode: 'shell', section_center_height: 6, shell: { thickness: 0.3 }, openings: { slots: { count: 12 } } }
    const r = recipeOf(raw)
    const m = buildClosedMesh(r, sweep(r), { reveals: true })
    expect(openEdges(buildClosedMesh(r, sweep(r), { withOpenings: true }))).toBeGreaterThan(0)
    expect(directedClosed(m)).toEqual({ open: 0, same: 0 })
    expect(Math.abs(closedMeshVolume(m))).toBeLessThan(Math.abs(closedMeshVolume(buildClosedMesh(r, sweep(r), { withOpenings: false }))))
  })

  it('leaves the openings out of a body printed solid, and says so', { timeout: 60000 }, () => {
    const tiny = preparePrint(torus, { ...PRINT_DEFAULTS, sizeMm: 20 }).report
    expect(tiny.openingsCut).toBe(false)
    expect(tiny.openingsNote).toMatch(/לא נכנסים לגוף המלא/)
  })
})

describe('the mesh as the file stores it', () => {
  it('welds vertices that differ only below float32 precision, and drops the triangles that collapse', () => {
    // A tetrahedron 70 mm from the origin, with one extra vertex 1e-9 mm from vertex 0 (one float32 value at
    // 70 mm), and a sliver that uses both.
    const P = new Float64Array([70, 0, 0, 80, 0, 0, 70, 10, 0, 70, 0, 10, 70 + 1e-9, 0, 0])
    const I = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 4, 3, 2, 0, 4, 2])
    const w = weldAsStored({ positions: P, indices: I })
    expect(w.positions.length / 3).toBe(4)
    expect(w.indices.length / 3).toBe(4)
    expect(openEdges(w)).toBe(0)
  })
})

describe('recommended orientation (DECISIONS.md 134)', () => {
  it('lays a ring cut at the ground on its cut, and says why in numbers', { timeout: 60000 }, () => {
    const { report } = preparePrint(recipeOf(fixture('umbilic-torus')))
    const o = report.orientation
    console.info(`[print] orientation ${o.down}: support ${(o.supportMm2 / 100).toFixed(0)} cm², bed ${(o.bedMm2 / 100).toFixed(0)} cm²; all ${JSON.stringify(Object.fromEntries(Object.entries(o.all).map(([k, v]) => [k, Math.round(v / 100)])))}`)
    expect(o.down).toBe('-y')
    expect(o.supportMm2).toBe(o.all['-y'])
    expect(o.supportMm2).toBeLessThan(o.all['+y'])
    // On its rim the ring would need less support, but it would stand on a line: no footing, not a candidate.
    expect(o.all['-z']).toBeLessThan(o.supportMm2)
    expect(o.bedMm2).toBeGreaterThan(0)
    expect(o.reason).toMatch(/סמ"ר/)
    expect(o.reason).toMatch(/מפלס הקרקע/)
    console.info(`[print] orientation ${o.down}: support ${(o.supportMm2 / 100).toFixed(0)} cm², bed ${(o.bedMm2 / 100).toFixed(0)} cm²; all ${JSON.stringify(Object.fromEntries(Object.entries(o.all).map(([k, v]) => [k, Math.round(v / 100)])))}`)
  })

  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({
    P: [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
    I: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3],
  })

  it('counts a cube: no support on any face, the whole face on the bed', () => {
    const b = box(0, 0, 0, 10, 10, 10)
    const m = { positions: new Float64Array(b.P), indices: new Uint32Array(b.I) }
    expect(Math.abs(closedMeshVolume(m))).toBeCloseTo(1000, 9)
    const o = printOrientation(m, false)
    expect(Object.values(o.all).every((v) => v === 0)).toBe(true)
    expect(o.down).toBe('-y')
    expect(o.bedMm2).toBeCloseTo(100, 9)
  })

  it('lays a T on its face, where nothing overhangs', () => {
    // A T: a 30 × 10 × 10 bar on a 10 × 20 × 10 stem, as two boxes. Standing, the bar's underside hangs in the air
    // (300 mm²); upside down the stem's top does (100 mm²); on its face nothing hangs and 500 mm² lie on the bed.
    const a = box(10, 0, 0, 20, 20, 10), b = box(0, 20, 0, 30, 30, 10)
    const m = { positions: new Float64Array([...a.P, ...b.P]), indices: new Uint32Array([...a.I, ...b.I.map((i) => i + 8)]) }
    const o = printOrientation(m, false)
    expect(o.all['-y']).toBeCloseTo(300, 6)
    expect(o.all['+y']).toBeCloseTo(100, 6)
    expect(o.all['-x']).toBeCloseTo(200, 6)
    expect(o.all['-z']).toBeCloseTo(0, 6)
    expect(o.down).toBe('-z')
    expect(o.bedMm2).toBeCloseTo(500, 6)
    expect(o.label).toBe('שוכב על החזית')
    expect(o.reason).toMatch(/מסובבים אותו בסלייסר/)
  })
})

describe('print files', () => {
  it('writes an STL in millimeters and a 3MF that declares millimeters', { timeout: 60000 }, async () => {
    const out = await printFiles(fixture('umbilic-torus'), PRINT_DEFAULTS)
    if ('error' in out) throw new Error(out.error)
    expect(out.stl.filename).toMatch(/^umbilic-torus-pavilion-150mm-1to\d+\.stl$/)
    expect(out.threeMf.filename).toMatch(/\.3mf$/)

    const geo = new STLLoader().parse(out.stl.bytes.buffer.slice(out.stl.bytes.byteOffset, out.stl.bytes.byteOffset + out.stl.bytes.byteLength) as ArrayBuffer)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.min.z).toBeCloseTo(0, 3)
    expect(Math.abs(bb.max.x - bb.min.x - out.report.sizeMm[0])).toBeLessThan(0.01)
    expect(Math.abs(bb.max.z - bb.min.z - out.report.sizeMm[2])).toBeLessThan(0.01)

    // Read the zip by hand: three parts, each with a matching checksum.
    const z = out.threeMf.bytes
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    const parts: Record<string, string> = {}
    for (let o = 0; dv.getUint32(o, true) === 0x04034b50; ) {
      const method = dv.getUint16(o + 8, true), crc = dv.getUint32(o + 14, true), size = dv.getUint32(o + 18, true)
      const nameLen = dv.getUint16(o + 26, true)
      const name = new TextDecoder().decode(z.subarray(o + 30, o + 30 + nameLen))
      const body = z.subarray(o + 30 + nameLen, o + 30 + nameLen + size)
      const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body
      expect(crc32(data)).toBe(crc)
      parts[name] = new TextDecoder().decode(data)
      o += 30 + nameLen + size
    }
    expect(Object.keys(parts).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const model = parts['3D/3dmodel.model']!
    expect(model).toMatch(/<model unit="millimeter"/)
    expect((model.match(/<triangle /g) ?? []).length).toBe(geo.attributes.position!.count / 3)
    console.info(`[print] STL ${(out.stl.bytes.length / 1e6).toFixed(1)} MB, 3MF ${(z.length / 1e6).toFixed(1)} MB`)
  })
})
