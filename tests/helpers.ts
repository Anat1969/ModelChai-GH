import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

const root = fileURLToPath(new URL('..', import.meta.url))
const readJson = (rel: string): unknown => JSON.parse(readFileSync(root + rel, 'utf8'))

export const FIXTURE_NAMES = ['umbilic-torus', 'mobius-strip', 'golden-ratio'] as const
export type FixtureName = (typeof FIXTURE_NAMES)[number]

/** A fresh deep copy each call, so tests can mutate it freely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixture = (name: FixtureName): any => readJson(`docs/fixtures/${name}.recipe.json`)

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(readJson('docs/schema/recipe.schema.json') as object)

export function jsonSchemaValid(recipe: unknown): { ok: boolean; errors: string[] } {
  const ok = validate(recipe) as boolean
  return { ok, errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) }
}
