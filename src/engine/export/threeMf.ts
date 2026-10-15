/**
 * 3MF: a zip with the mesh as XML, in millimeters by declaration, so a slicer never guesses the units
 * (DECISIONS.md 87). Written here without a library: three small XML parts, deflated where the runtime can.
 * Y-up to Z-up maps (x, y, z) to (x, −z, y), as in the STL.
 */
import type { SolidMesh } from '../types'

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4
  return Object.is(r, -0) ? '0' : String(r)
}

/** The model part. The mesh is in millimeters, Y up. */
export function modelXml(m: SolidMesh, title: string): string {
  const P = m.positions, I = m.indices
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Title">${esc(title)}</metadata>\n<metadata name="Application">math-creator</metadata>\n<resources>\n<object id="1" type="model"><mesh><vertices>\n`,
  ]
  let chunk = ''
  for (let i = 0; i < P.length; i += 3) {
    chunk += `<vertex x="${n(P[i]!)}" y="${n(-P[i + 2]!)}" z="${n(P[i + 1]!)}"/>\n`
    if (chunk.length > 1 << 16) (parts.push(chunk), (chunk = ''))
  }
  chunk += '</vertices><triangles>\n'
  for (let t = 0; t < I.length; t += 3) {
    chunk += `<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>\n`
    if (chunk.length > 1 << 16) (parts.push(chunk), (chunk = ''))
  }
  parts.push(chunk, '</triangles></mesh></object>\n</resources>\n<build><item objectid="1"/></build>\n</model>\n')
  return parts.join('')
}

// ---------- zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflate(b: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A zip of the given files; deflated when the runtime has CompressionStream, stored otherwise. */
export async function zip(files: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const packed = await deflate(f.data)
    const method = packed ? 8 : 0
    const body = packed ?? f.data
    const crc = crc32(f.data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(8, method, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, body.length, true)
    head.setUint32(22, f.data.length, true)
    head.setUint16(26, name.length, true)
    local.push(new Uint8Array(head.buffer), name, body)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(10, method, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, body.length, true)
    dir.setUint32(24, f.data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.length + body.length
  }
  const dirSize = central.reduce((s, b) => s + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dirSize, true)
  end.setUint32(16, offset, true)
  const parts = [...local, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}

export async function write3mf(m: SolidMesh, title: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(RELS) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml(m, title)) },
  ])
}
