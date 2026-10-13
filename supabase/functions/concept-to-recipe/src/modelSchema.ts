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
  return out
}

export function modelSchema(recipeSchema: Json, generators: string[]): Json {
  const s = clean(recipeSchema) as Json
  const props = s.properties as Json
  const gen = props.generator as Json
  const genProps = gen.properties as Json
  genProps.type = { enum: generators }
  // Only the sweep generator exists in the MVP; its params are the sweep definition.
  genProps.params = { $ref: '#/$defs/sweep' }
  delete gen.allOf
  return s
}
