/**
 * Binary glTF 2.0 (.glb) for Blender and the browser (ARCHITECTURE.md 6). Written by hand, without three.js,
 * so it runs in the Worker. Meshes carry PBR materials from LEVELS.md 2.3; edges are line strips.
 */
import type { BuildSuccess } from '../build'
import { MATERIAL_LOOK } from '../materials'
import type { Recipe } from '../../recipe/schema'

const FLOAT = 5126, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963
const TRIANGLES = 4, LINE_STRIP = 3, LINE_LOOP = 2

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function baseColor(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1]
}

export function writeGlb(r: BuildSuccess, recipe: Recipe, title: string): Uint8Array {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const bufferViews: object[] = []
  const accessors: object[] = []

  const addView = (data: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
    padded.set(bytes)
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target })
    chunks.push(padded)
    byteLength += padded.length
    return bufferViews.length - 1
  }
  const addVec3 = (data: Float32Array) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < data.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, data[i]!)
      max[i % 3] = Math.max(max[i % 3]!, data[i]!)
    }
    accessors.push({ bufferView: addView(data, ARRAY_BUFFER), componentType: FLOAT, count: data.length / 3, type: 'VEC3', min, max })
    return accessors.length - 1
  }
  const addIndices = (data: Uint32Array) => {
    accessors.push({ bufferView: addView(data, ELEMENT_ARRAY_BUFFER), componentType: UINT, count: data.length, type: 'SCALAR' })
    return accessors.length - 1
  }

  const m = recipe.realistic.materials
  const looks = {
    outer: MATERIAL_LOOK[m.outer],
    inner: MATERIAL_LOOK[m.inner ?? m.outer],
    floor: MATERIAL_LOOK[m.floor ?? m.inner ?? m.outer],
    caps: MATERIAL_LOOK[m.outer],
  }
  const materials: object[] = []
  const materialIndex = new Map<string, number>()
  const material = (name: string, look: { color: string; roughness: number; metalness: number }) => {
    const key = `${look.color}|${look.roughness}|${look.metalness}`
    if (!materialIndex.has(key)) {
      materials.push({
        name,
        pbrMetallicRoughness: { baseColorFactor: baseColor(look.color), roughnessFactor: look.roughness, metallicFactor: look.metalness },
        doubleSided: true,
      })
      materialIndex.set(key, materials.length - 1)
    }
    return materialIndex.get(key)!
  }

  const meshes: object[] = []
  const nodes: object[] = []
  for (const [name, mesh] of Object.entries(r.meshes) as [keyof typeof looks, BuildSuccess['meshes']['outer'] | null][]) {
    if (!mesh || !mesh.indices.length) continue
    meshes.push({
      name,
      primitives: [
        {
          attributes: { POSITION: addVec3(mesh.positions), NORMAL: addVec3(mesh.normals) },
          indices: addIndices(mesh.indices),
          material: material(name, looks[name]),
          mode: TRIANGLES,
        },
      ],
    })
    nodes.push({ name, mesh: meshes.length - 1 })
  }
  const edgeMaterial = material('edge', { color: '#1D6C75', roughness: 0.4, metalness: 0 })
  r.curves.edges.forEach((e, k) => {
    meshes.push({
      name: `edge_${k + 1}`,
      primitives: [{ attributes: { POSITION: addVec3(e) }, material: edgeMaterial, mode: r.curves.edgesClosed ? LINE_LOOP : LINE_STRIP }],
    })
    nodes.push({ name: `edge_${k + 1}`, mesh: meshes.length - 1 })
  })

  const gltf = {
    asset: { version: '2.0', generator: 'Math Creator' },
    extras: { title, units: 'meters', recipe_id: recipe.meta.id },
    scene: 0,
    scenes: [{ name: title, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  }

  const json = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPadded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20)
  jsonPadded.set(json)
  const total = 12 + 8 + jsonPadded.length + 8 + byteLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true) // "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonPadded.length, true)
  view.setUint32(16, 0x4e4f534a, true) // "JSON"
  out.set(jsonPadded, 20)
  let o = 20 + jsonPadded.length
  view.setUint32(o, byteLength, true)
  view.setUint32(o + 4, 0x004e4942, true) // "BIN\0"
  o += 8
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}
