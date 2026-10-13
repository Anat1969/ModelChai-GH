/**
 * Exports open cleanly: glTF passes the Khronos validator with zero errors, OBJ and STL parse with the three.js
 * loaders. Blender is not available in CI, so these stand in for the Stage 2 "opens in Blender" check.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error gltf-validator ships without types
import { validateBytes } from 'gltf-validator'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { build } from '../src/engine/build'
import { exportFile, type ExportFile } from '../src/engine/export'
import { FIXTURE_NAMES, fixture } from './helpers'

const file = (name: (typeof FIXTURE_NAMES)[number], fmt: 'obj' | 'stl' | 'glb' | 'json'): ExportFile => {
  const f = exportFile(fixture(name), fmt)
  if ('error' in f) throw new Error(f.error)
  return f
}

describe('exports', () => {
  it.each(FIXTURE_NAMES)('%s: glTF binary has zero validator errors', { timeout: 30000 }, async (name) => {
    const f = file(name, 'glb')
    expect(f.filename).toMatch(/\.glb$/)
    const report = await validateBytes(f.bytes, { maxIssues: 50 })
    const { numErrors, numWarnings } = report.issues
    if (numErrors) console.error(JSON.stringify(report.issues.messages.slice(0, 5), null, 2))
    console.info(`[glb] ${name}: ${(f.bytes.length / 1e6).toFixed(1)} MB, errors ${numErrors}, warnings ${numWarnings}`)
    expect(numErrors).toBe(0)
  })

  it('OBJ parses into the meshes plus one polyline per edge', { timeout: 60000 }, () => {
    const f = file('umbilic-torus', 'obj')
    const group = new OBJLoader().parse(new TextDecoder().decode(f.bytes))
    const names = group.children.map((c) => c.name)
    expect(names).toEqual(['outer', 'inner', 'floor', 'edge_1'])
    expect(group.children.find((c) => c.name === 'edge_1')!.type).toBe('LineSegments')
  })

  it('STL parses with the triangle count of the closed mesh, Z up', () => {
    const raw = fixture('umbilic-torus')
    raw.bare = { mode: 'solid', section_center_height: 1.5 }
    const f = exportFile(raw, 'stl')
    if ('error' in f) throw new Error(f.error)
    const g = new STLLoader().parse(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer)
    expect(g.attributes.position!.count / 3).toBe(720 * 144 * 2)
    // Z up: the ring lies in XY, so the farthest point from the Z axis is the outer radius R + 3a = 25.2 m,
    // and the height runs along Z (section center 1.5, cusps at most 3a = 7.2 m above it).
    const p = g.attributes.position!
    let rMax = 0, zMax = -Infinity
    for (let i = 0; i < p.count; i++) {
      rMax = Math.max(rMax, Math.hypot(p.getX(i), p.getY(i)))
      zMax = Math.max(zMax, p.getZ(i))
    }
    expect(rMax).toBeCloseTo(25.2, 1)
    expect(zMax).toBeLessThanOrEqual(1.5 + 7.2 + 1e-3)
  })

  it('JSON is the recipe itself and round-trips through the build', () => {
    const f = file('mobius-strip', 'json')
    const back = JSON.parse(new TextDecoder().decode(f.bytes))
    expect(back).toEqual(fixture('mobius-strip'))
    expect(build(back).ok).toBe(true)
  })

  it('a recipe that fails the schema exports nothing, with a Hebrew reason', () => {
    const raw = fixture('umbilic-torus')
    delete raw.narrative
    const f = exportFile(raw, 'glb')
    expect('error' in f && f.error).toMatch(/[֐-׿]/)
  })
})
