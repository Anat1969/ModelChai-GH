/**
 * The recipe JSON Schema reshaped for structured outputs. The API compiles a subset of JSON Schema: no
 * numeric or length constraints, no if/then, no uniqueItems, and every object closed. Those constraints are
 * not lost: the full schema and the semantic rules run on every answer, and failures go to the repair loop.
 * The generator is narrowed to the generators the app offers, so `params` is the sweep definition itself.
 */
const DROP = new Set([
  '$schema', '$id', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'default', 'uniqueItems', 'minItems', 'maxItems', 'if', 'then', 'else',
])

type Json = Record<string, unknown>

function inferType(values: unknown[]): string {
  if (values.every((v) => typeof v === 'string')) return 'string'
  if (values.every((v) => Number.isInteger(v))) return 'integer'
  if (values.every((v) => typeof v === 'number')) return 'number'
  if (values.every((v) => typeof v === 'boolean')) return 'boolean'
  throw new Error(`mixed enum types: ${JSON.stringify(values)}`)
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean)
  if (!node || typeof node !== 'object') return node
  const { type, ...rest } = node as Json
  // ["string", "null"] becomes anyOf, which the compiler accepts.
  if (Array.isArray(type)) return clean({ ...rest, anyOf: type.map((t) => ({ type: t })) })
  const out: Json = {}
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP.has(k)) continue
    if (k === 'allOf') {
      // Every allOf in the recipe schema is a conditional (if/then); without them nothing remains.
      const kept = (v as unknown[]).filter((s) => !(s && typeof s === 'object' && 'if' in (s as Json))).map(clean)
      if (kept.length) out.allOf = kept
      continue
    }
    out[k] = clean(v)
  }
  if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false
  // The compiler wants an explicit type on every node that is not anyOf, allOf or $ref; enum and const get one.
  if (out.type === undefined && !out.anyOf && !out.allOf && !out.$ref) {
    const values = Array.isArray(out.enum) ? out.enum : 'const' in out ? [out.const] : []
    if (values.length) out.type = inferType(values)
  }
  return out
}

/**
 * The compiler accepts at most 24 optional fields (API error: "Schemas contains too many optional parameters").
 * These fields are always meaningful, so the model must fill them; the app's contract keeps them optional.
 */
export const MAX_OPTIONAL = 24
const ALWAYS_FILL: [path: string[], fields: string[]][] = [
  [['properties', 'concept'], ['use', 'context_hint']],
  [['properties', 'narrative'], ['maxim', 'fit_note']],
  [['properties', 'realistic', 'properties', 'site'], ['name']],
  [['properties', 'realistic', 'properties', 'context'], ['vegetation', 'people']],
  [['properties', 'realistic', 'properties', 'camera'], ['height', 'fov_deg', 'aspect']],
  [['$defs', 'sweep'], ['scale_along_path']],
  [['$defs', 'sweep', 'properties', 'twist'], ['initial_angle_deg']],
  [['$defs', 'sweep', 'properties', 'section'], ['aspect']],
  [['properties', 'meta'], ['notes']],
  [['properties', 'bare'], ['highlight']],
  [['properties', 'bare', 'properties', 'shell'], ['inner_method']],
  [['properties', 'bare', 'properties', 'floor'], ['level', 'type']],
  [['properties', 'bare', 'properties', 'openings', 'properties', 'passages'], ['width', 'height', 'start_angle_deg']],
  [['properties', 'bare', 'properties', 'openings', 'properties', 'slots'], ['width_fraction', 'duty', 'position']],
]

/** Fields the model never needs to write: engine resolution, and the parent of a brand-new recipe. */
const NOT_FOR_MODEL: [path: string[], field: string][] = [
  [['$defs', 'sweep'], 'resolution'],
  [['properties', 'meta'], 'parent_id'],
]

/** Optional properties across the schema, counting each $defs entry once, as the API does. */
export function countOptional(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countOptional(x), 0)
  if (!node || typeof node !== 'object') return 0
  const o = node as Json
  let n = 0
  if (o.properties && typeof o.properties === 'object') {
    const req = new Set((o.required as string[] | undefined) ?? [])
    n += Object.keys(o.properties as Json).filter((k) => !req.has(k)).length
  }
  for (const v of Object.values(o)) n += countOptional(v)
  return n
}

export function modelSchema(recipeSchema: Json, generators: string[]): Json {
  const s = clean(recipeSchema) as Json
  for (const [path, field] of NOT_FOR_MODEL) {
    delete (path.reduce<Json>((o, k) => o[k] as Json, s).properties as Json)[field]
  }
  for (const [path, fields] of ALWAYS_FILL) {
    const node = path.reduce<Json>((o, k) => o[k] as Json, s)
    node.required = [...new Set([...((node.required as string[]) ?? []), ...fields])]
  }
  const props = s.properties as Json
  const gen = props.generator as Json
  const genProps = gen.properties as Json
  genProps.type = { type: 'string', enum: generators }
  // Only the sweep generator exists in the MVP; its params are the sweep definition.
  genProps.params = { $ref: '#/$defs/sweep' }
  delete gen.allOf
  return s
}
