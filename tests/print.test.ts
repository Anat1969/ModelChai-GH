/** Getting a model ready for FDM printing in PLA (DECISIONS.md 87): closed, to scale, with a printable wall. */
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { closedMeshVolume, buildClosedMesh } from '../src/engine/sweep/closedMesh'
import { minWall, openEdges, preparePrint, PRINT_DEFAULTS } from '../src/engine/export/print'
import { crc32 } from '../src/engine/export/threeMf'
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

  it('is closed: every edge joins two triangles, openings left out', () => {
    expect(openEdges(buildClosedMesh(torus, sweep(torus), { withOpenings: true }))).toBeGreaterThan(0)
    expect(report.openEdges).toBe(0)
    expect(report.openingsDropped).toBe(true)
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

  it('has a volume in mm³ equal to the meters volume times the scale cubed, within 0.5%', () => {
    const thick = structuredClone(torus)
    thick.bare.shell!.thickness = report.thicknessM!
    const m = buildClosedMesh(thick, sweep(thick), { withOpenings: false })
    const mmPerM = Math.max(...report.sizeMm) / (Math.max(...report.sizeMm) * report.scale / 1000)
    const expected = Math.abs(closedMeshVolume(m)) * (1000 / report.scale) ** 3 / 1000
    expect(Math.abs(report.volumeCm3 - expected) / expected).toBeLessThan(0.005)
    expect(report.grams).toBeCloseTo(report.volumeCm3 * 1.24, 6)
    expect(mmPerM).toBeGreaterThan(0)
  })

  it('fits a 220 mm bed at 150 mm, and says how large it may grow when it does not', () => {
    expect(report.checks.find((c) => c.id === 'bed')!.ok).toBe(true)
    const big = preparePrint(torus, { ...PRINT_DEFAULTS, sizeMm: 400 }).report
    const bed = big.checks.find((c) => c.id === 'bed')!
    expect(bed.ok).toBe(false)
    expect(bed.fix).toMatch(/נכנס/)
  })

  it('prints a shell too thin to thicken as a solid, and says why', () => {
    const tiny = preparePrint(torus, { ...PRINT_DEFAULTS, sizeMm: 20 }).report
    expect(tiny.body).toBe('solid-from-shell')
    expect(tiny.bodyNote).toMatch(/גוף מלא/)
    expect(tiny.openEdges).toBe(0)
  })

  it('prints a solid as a solid', () => {
    const r = preparePrint(recipeOf(fixture('mobius-strip'))).report
    expect(r.body).toBe('solid')
    expect(r.wallMm).toBeNull()
    expect(r.openEdges).toBe(0)
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
