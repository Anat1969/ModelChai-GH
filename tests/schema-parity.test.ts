/**
 * zod must accept and reject exactly what the JSON Schema accepts and rejects.
 * Each case mutates a fixture; both validators must agree on the outcome.
 */
import { describe, expect, it } from 'vitest'
import { parseRecipe } from '../src/recipe/schema'
import { fixture, jsonSchemaValid, type FixtureName } from './helpers'

type Case = [label: string, base: FixtureName, mutate: (r: any) => void, valid: boolean] // eslint-disable-line @typescript-eslint/no-explicit-any

const cases: Case[] = [
  ['unchanged', 'umbilic-torus', () => {}, true],
  ['wrong schema_version', 'umbilic-torus', (r) => (r.schema_version = '2.0'), false],
  ['extra root field', 'umbilic-torus', (r) => (r.extra = 1), false],
  ['extra nested field', 'umbilic-torus', (r) => (r.bare.shell.color = 'red'), false],
  ['bad id pattern', 'umbilic-torus', (r) => (r.meta.id = 'Umbilic Torus'), false],
  ['id too short', 'umbilic-torus', (r) => (r.meta.id = 'ab'), false],
  ['bad date-time', 'umbilic-torus', (r) => (r.meta.created_at = 'yesterday'), false],
  ['UTC date-time', 'umbilic-torus', (r) => (r.meta.created_at = '2026-10-13T00:00:00Z'), true],
  ['null parent_id', 'umbilic-torus', (r) => (r.meta.parent_id = null), true],
  ['notes too long', 'umbilic-torus', (r) => (r.meta.notes = 'x'.repeat(281)), false],
  ['empty concept name', 'umbilic-torus', (r) => (r.concept.name = ''), false],
  ['unknown generator', 'umbilic-torus', (r) => (r.generator.type = 'fractal'), false],
  ['tiling with free params', 'umbilic-torus', (r) => (r.generator = { type: 'tiling', params: { n: 3 } }), true],
  ['a below range', 'umbilic-torus', (r) => (r.generator.params.section.a = 0.05), false],
  ['hypocycloid without cusps', 'umbilic-torus', (r) => (r.generator.params.section.curve = 'hypocycloid'), false],
  ['hypocycloid with cusps', 'umbilic-torus', (r) => Object.assign(r.generator.params.section, { curve: 'hypocycloid', cusps: 4 }), true],
  ['fractional cusps', 'umbilic-torus', (r) => Object.assign(r.generator.params.section, { curve: 'hypocycloid', cusps: 4.5 }), false],
  ['polygon without sides', 'umbilic-torus', (r) => (r.generator.params.section.curve = 'polygon'), false],
  ['superellipse without exponent', 'umbilic-torus', (r) => (r.generator.params.section.curve = 'superellipse'), false],
  ['ellipse without R2', 'umbilic-torus', (r) => (r.generator.params.path.type = 'ellipse'), false],
  ['helix without pitch', 'umbilic-torus', (r) => Object.assign(r.generator.params.path, { type: 'helix', turns: 2 }), false],
  ['line without length', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'line' }), false],
  ['twist out of range', 'umbilic-torus', (r) => (r.generator.params.twist.turns_per_lap = 4.5), false],
  ['missing twist', 'umbilic-torus', (r) => delete r.generator.params.twist, false],
  ['resolution too low', 'umbilic-torus', (r) => (r.generator.params.resolution.path_segments = 10), false],
  ['shell mode without shell', 'umbilic-torus', (r) => delete r.bare.shell, false],
  ['solid mode without shell', 'umbilic-torus', (r) => { r.bare.mode = 'solid'; delete r.bare.shell }, true],
  ['thickness too thin', 'umbilic-torus', (r) => (r.bare.shell.thickness = 0.05), false],
  ['passages without count', 'umbilic-torus', (r) => delete r.bare.openings.passages.count, false],
  ['duplicate highlight', 'umbilic-torus', (r) => (r.bare.highlight = ['edges', 'edges']), false],
  ['unknown material', 'umbilic-torus', (r) => (r.realistic.materials.outer = 'marble'), false],
  ['camera aspect 16:9', 'umbilic-torus', (r) => (r.realistic.camera.aspect = '16:9'), false],
  ['camera without aspect', 'umbilic-torus', (r) => delete r.realistic.camera.aspect, true],
  ['lat out of range', 'umbilic-torus', (r) => (r.realistic.site.lat = 91), false],
  ['people not integer', 'umbilic-torus', (r) => (r.realistic.context.people = 2.5), false],
  ['insight too short', 'umbilic-torus', (r) => (r.narrative.insight = 'קצר'), false],
  ['fit_note string', 'umbilic-torus', (r) => (r.narrative.fit_note = 'משהו אבד'), true],
  ['missing narrative', 'umbilic-torus', (r) => delete r.narrative, false],
  ['new material white_marble', 'umbilic-torus', (r) => (r.realistic.materials.outer = 'white_marble'), true],
  ['new material perforated_metal inside', 'umbilic-torus', (r) => (r.realistic.materials.inner = 'perforated_metal'), true],
  ['weather rain', 'umbilic-torus', (r) => (r.realistic.weather = 'rain'), true],
  ['weather snow', 'umbilic-torus', (r) => (r.realistic.weather = 'snow'), true],
  ['unknown weather hail', 'umbilic-torus', (r) => (r.realistic.weather = 'hail'), false],
  ['context urban_gateway', 'umbilic-torus', (r) => (r.realistic.context.preset = 'urban_gateway'), true],
  ['vegetation pine_forest', 'umbilic-torus', (r) => (r.realistic.context.vegetation = 'pine_forest'), true],
  ['unknown context', 'umbilic-torus', (r) => (r.realistic.context.preset = 'volcano'), false],
  ['orientation 90', 'umbilic-torus', (r) => (r.realistic.orientation_deg = 90), true],
  ['orientation 360', 'umbilic-torus', (r) => (r.realistic.orientation_deg = 360), false],
  ['orientation fractional', 'umbilic-torus', (r) => (r.realistic.orientation_deg = 12.5), false],
  ['wind complete', 'umbilic-torus', (r) => (r.realistic.wind = { from_deg: 315, speed_ms: 7.5 }), true],
  ['wind without speed', 'umbilic-torus', (r) => (r.realistic.wind = { from_deg: 315 }), false],
  ['wind too strong', 'umbilic-torus', (r) => (r.realistic.wind = { from_deg: 315, speed_ms: 41 }), false],
  ['wind from 360', 'umbilic-torus', (r) => (r.realistic.wind = { from_deg: 360, speed_ms: 3 }), false],
  ['wind extra field', 'umbilic-torus', (r) => (r.realistic.wind = { from_deg: 90, speed_ms: 3, gust_ms: 9 }), false],
  ['orientation and a calm wind', 'umbilic-torus', (r) => Object.assign(r.realistic, { orientation_deg: 200, wind: { from_deg: 270, speed_ms: 0 } }), true],
  ['mobius unchanged', 'mobius-strip', () => {}, true],
  ['mobius aspect too thin', 'mobius-strip', (r) => (r.generator.params.section.aspect = 0.01), false],
  ['golden unchanged', 'golden-ratio', () => {}, true],
  ['golden turns too low', 'golden-ratio', (r) => (r.generator.params.path.turns = 0.1), false],
  ['lemniscate complete', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'lemniscate', R: 24, cross_height: 3.2 }), true],
  ['lemniscate without cross_height', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'lemniscate', R: 24 }), false],
  ['lemniscate negative cross_height', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'lemniscate', R: 24, cross_height: -1 }), false],
  ['torus knot complete', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'torus_knot', R: 12, r: 5, p: 2, q: 3 }), true],
  ['torus knot without q', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'torus_knot', R: 12, r: 5, p: 2 }), false],
  ['torus knot fractional p', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'torus_knot', R: 12, r: 5, p: 2.5, q: 3 }), false],
  ['torus knot q 13', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'torus_knot', R: 12, r: 5, p: 2, q: 13 }), false],
  ['torus knot r too small', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'torus_knot', R: 12, r: 0.1, p: 2, q: 3 }), false],
  ['wave complete', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'wave', length: 120, amplitude: 4, wavelength: 40 }), true],
  ['wave without wavelength', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'wave', length: 120, amplitude: 4 }), false],
  ['wave without length', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'wave', amplitude: 4, wavelength: 40 }), false],
  ['arch complete', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'arch', span: 14, height: 10 }), true],
  ['arch without height', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'arch', span: 14 }), false],
  ['arch span too large', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'arch', span: 301, height: 10 }), false],
  ['unknown path type', 'umbilic-torus', (r) => (r.generator.params.path = { type: 'spiral', R: 10 }), false],
  // Parametric surface (stage 6): a fixed library of families, each with its own required dimensions.
  ['surface hyperboloid', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'hyperboloid', waist_radius: 3, end_radius: 6, height: 20 } }), true],
  ['surface hyperboloid without end_radius', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'hyperboloid', waist_radius: 3, height: 20 } }), false],
  ['surface hypar without span2', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'hyperbolic_paraboloid', span: 18, rise: 7 } }), true],
  ['surface hypar without rise', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'hyperbolic_paraboloid', span: 18 } }), false],
  ['surface catenoid', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'catenoid', waist_radius: 5, height: 7 } }), true],
  ['surface helicoid without turns', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'helicoid', radius: 6, pitch: 3.6 } }), false],
  ['surface klein', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'klein_bottle', radius: 8, tube: 3 } }), true],
  ['surface monkey saddle', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'monkey_saddle', span: 18, rise: 6 } }), true],
  ['surface unknown family', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'gyroid', span: 10 } }), false],
  ['surface formula string', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'catenoid', waist_radius: 5, height: 7, x: 'cos(u)' } }), false],
  ['surface height out of range', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'catenoid', waist_radius: 5, height: 300 } }), false],
  ['surface resolution', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'catenoid', waist_radius: 5, height: 7, resolution: { u_segments: 96 } } }), true],
  ['surface resolution too low', 'umbilic-torus', (r) => (r.generator = { type: 'parametric_surface', params: { family: 'catenoid', waist_radius: 5, height: 7, resolution: { v_segments: 2 } } }), false],
  ['surface with sweep params', 'umbilic-torus', (r) => (r.generator.type = 'parametric_surface'), false],
]

describe('zod ↔ JSON Schema parity', () => {
  it.each(cases)('%s', (_label, base, mutate, valid) => {
    const raw = fixture(base)
    mutate(raw)
    expect(jsonSchemaValid(raw).ok).toBe(valid)
    expect(parseRecipe(raw).ok).toBe(valid)
  })
})
