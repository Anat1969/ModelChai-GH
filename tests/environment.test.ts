/**
 * Materials, landscapes, weather, orientation and wind (DECISIONS.md 119–123): defaults, the density table,
 * placement rules of the new contexts, the weather's light and shadow, the sun path against suncalc, the wind
 * reading and its illustration lines, and the words they put in the visual prompt.
 */
import { getPosition, getTimes } from 'suncalc'
import { describe, expect, it } from 'vitest'
import { build } from '../src/engine/build'
import { DENSITY, MATERIAL_LOOK } from '../src/engine/materials'
import { visualPrompt } from '../src/prompt/visualPrompt'
import { CONTEXT_PRESETS, MATERIALS, VEGETATIONS, WEATHERS, parseRecipe } from '../src/recipe/schema'
import { atmosphere } from '../src/scene/atmosphere'
import {
  CONTEXTS,
  MARGIN,
  SELECTOR_CONTEXTS,
  TALL_CLEARANCE,
  VEGETATION,
  contextElements,
  groundHeight,
  riverWidth,
  scatterPlants,
  waterEdge,
  type Footprint,
} from '../src/scene/contexts/layout'
import { MVP_MATERIALS, SELECTOR_MATERIALS, TILE } from '../src/scene/materials/textures'
import { seasonOf } from '../src/scene/seasons'
import { localTime, sunAt, sunPath } from '../src/scene/sun'
import { angleDiff, beaufort, passageBearings, readWind, sideOfFront, solveStream, streamlines, sunOnFront } from '../src/scene/wind'
import { metricRows } from '../src/ui/panels/MetricsPanel'
import { setAt } from '../src/ui/recipePath'
import { fixture } from './helpers'

const parsed = (raw: unknown) => {
  const p = parseRecipe(raw)
  if (!p.ok) throw new Error(JSON.stringify(p.errors))
  return p.recipe as never
}
const NEW_MATERIALS = ['white_marble', 'red_brick', 'terracotta_tiles', 'basalt', 'copper_patina', 'charred_timber', 'white_render', 'perforated_metal'] as const

describe('recipe defaults', () => {
  it('a recipe without orientation or wind opens facing north, with a 5 m/s west wind', () => {
    const raw = fixture('umbilic-torus')
    expect(raw.realistic.orientation_deg).toBeUndefined()
    expect(raw.realistic.wind).toBeUndefined()
    const r = parsed(raw) as { realistic: { orientation_deg: number; wind: { from_deg: number; speed_ms: number } } }
    expect(r.realistic.orientation_deg).toBe(0)
    expect(r.realistic.wind).toEqual({ from_deg: 270, speed_ms: 5 })
  })
  it('the schema lists six weathers, ten contexts and eight vegetation types', () => {
    expect(WEATHERS).toEqual(['clear', 'haze', 'overcast', 'rain', 'fog', 'snow'])
    expect(CONTEXT_PRESETS).toHaveLength(10)
    expect(VEGETATIONS).toHaveLength(8)
    expect(Object.keys(CONTEXTS).sort()).toEqual([...CONTEXT_PRESETS].sort())
    expect(Object.keys(VEGETATION).sort()).toEqual([...VEGETATIONS].sort())
  })
})

describe('materials: names, densities and textures', () => {
  it('every material has a Hebrew name, a density, a texture tile and PBR values in range', () => {
    for (const id of MATERIALS) {
      expect(MATERIAL_LOOK[id].name_he).toMatch(/^[֐-׿]/)
      expect(DENSITY[id]).toBeGreaterThan(0.3)
      expect(DENSITY[id]).toBeLessThan(9.5)
      expect(TILE[id]).toBeGreaterThan(0)
      expect(MATERIAL_LOOK[id].roughness).toBeGreaterThanOrEqual(0)
      expect(MATERIAL_LOOK[id].roughness).toBeLessThanOrEqual(1)
      expect(MATERIAL_LOOK[id].color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
  it('densities follow the cited typical values', () => {
    expect(DENSITY.white_marble).toBe(2.7)
    expect(DENSITY.red_brick).toBe(1.9)
    expect(DENSITY.terracotta_tiles).toBe(1.9)
    expect(DENSITY.basalt).toBe(2.9)
    expect(DENSITY.copper_patina).toBe(8.9)
    expect(DENSITY.charred_timber).toBe(0.5)
    expect(DENSITY.white_render).toBe(1.8)
    // Aluminium 2.70 with 40% punched away.
    expect(DENSITY.perforated_metal).toBeCloseTo(2.7 * 0.6, 1)
  })
  it('the selector offers the minimum product and the eight new materials, without clear glass', () => {
    for (const id of [...MVP_MATERIALS, ...NEW_MATERIALS]) expect(SELECTOR_MATERIALS).toContain(id)
    expect(SELECTOR_MATERIALS).not.toContain('glass_clear')
    expect(new Set(SELECTOR_MATERIALS).size).toBe(SELECTOR_MATERIALS.length)
  })
  it('the weight follows the material on screen, without a rebuild', () => {
    const raw = fixture('umbilic-torus')
    const b = build(raw)
    if (!b.ok) throw new Error('build')
    const weight = (material: string) => metricRows(b.metrics, parsed(setAt(raw, 'realistic.materials.outer', material))).find((m) => m.key === 'weight')!.raw!
    const concrete = weight('polished_concrete_light')
    expect(concrete).toBeCloseTo(b.metrics.volume * 2.4, 6)
    expect(weight('basalt') / concrete).toBeCloseTo(2.9 / 2.4, 9)
    expect(weight('charred_timber') / concrete).toBeCloseTo(0.5 / 2.4, 9)
  })
})

describe('new contexts', () => {
  const fp: Footprint = { x: 0, z: 0, radius: 26.6 }
  it('the selector shows every context', () => {
    expect([...SELECTOR_CONTEXTS].sort()).toEqual([...CONTEXT_PRESETS].sort())
  })
  it.each(['urban_gateway', 'forest_edge', 'rocky_slope', 'snow_field', 'river_bank'] as const)('%s: anything taller than a person stands 20 m out (DECISIONS.md 55)', (id) => {
    const el = contextElements(id, fp, 11)
    const tall = [...el.facades, ...el.lamps, ...el.rocks.filter((r) => r.h > 1.6)]
    for (const b of tall) {
      // The nearest corner of the box, not only its center.
      const near = Math.hypot(b.x - fp.x, b.z - fp.z) - Math.hypot(b.w, b.d) / 2
      expect(near).toBeGreaterThanOrEqual(fp.radius + TALL_CLEARANCE - 1e-9)
    }
    for (const p of scatterPlants(VEGETATION[CONTEXTS[id].vegetation], fp, 11, id)) {
      if (p.kind !== 'shrub') expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(fp.radius + TALL_CLEARANCE - 1e-9)
    }
  })
  it('urban gateway: a road with two sidewalks south of the model, its near edge beyond the clear zone', () => {
    const el = contextElements('urban_gateway', fp, 1)
    expect(el.roads).toHaveLength(1)
    expect(el.sidewalks).toHaveLength(2)
    expect(el.lamps.length).toBeGreaterThan(10)
    const near = Math.min(...el.sidewalks.map((s) => s.z - s.d / 2))
    expect(near).toBeGreaterThanOrEqual(fp.radius + TALL_CLEARANCE)
    expect(el.roads[0]!.z).toBeGreaterThan(near)
  })
  it('forest edge: the forest stands on the north side only (north is −z)', () => {
    const plants = scatterPlants(VEGETATION.pine_forest, fp, 5, 'forest_edge')
    expect(plants.length).toBeGreaterThan(50)
    for (const p of plants) expect(p.z).toBeLessThan(0)
  })
  it('rocky slope: the ground climbs toward the north and stays flat in the clear zone', () => {
    const h = groundHeight(CONTEXTS.rocky_slope, fp)
    expect(h(0, -120)).toBeGreaterThan(h(0, 120) + 10)
    for (let a = 0; a < 6.28; a += 0.4) expect(h((fp.radius + MARGIN) * Math.cos(a), (fp.radius + MARGIN) * Math.sin(a))).toBe(0)
  })
  it('river bank: a band of water 30 m wide west of the model, with banks on both sides and no tree in it', () => {
    const edge = waterEdge('river_bank', fp)!
    const w = riverWidth('river_bank')!
    expect(w).toBe(30)
    const h = groundHeight(CONTEXTS.river_bank, fp)
    expect(h(edge - w / 2, 0)).toBeLessThan(-0.5)
    expect(h(edge - w - 20, 0)).toBeGreaterThan(-0.05)
    for (const p of scatterPlants(VEGETATION.riverside_trees, fp, 9, 'river_bank')) expect(p.x > edge + 2 || p.x < edge - w - 2).toBe(true)
  })
})

describe('weather: sky, light and shadow (DECISIONS.md 57)', () => {
  const s = seasonOf(1)
  const at = (w: (typeof WEATHERS)[number]) => atmosphere(35, w, s, 30)
  it('rain and snow have no direct sun and no cast shadow; fog keeps a faint, very soft one', () => {
    for (const w of ['rain', 'snow'] as const) {
      expect(at(w).castShadow).toBe(false)
      expect(at(w).sunIntensity).toBe(0)
    }
    expect(at('fog').castShadow).toBe(true)
    expect(at('fog').shadowRadius).toBeGreaterThan(at('haze').shadowRadius)
    expect(at('fog').sunIntensity).toBeLessThan(at('haze').sunIntensity)
  })
  it('fog sees the shortest distance; rain and snow are closer than overcast is far', () => {
    expect(at('fog').fogFar).toBeLessThan(at('rain').fogFar)
    expect(at('rain').fogFar).toBeLessThan(at('clear').fogFar)
    expect(at('snow').fogFar).toBeLessThan(at('clear').fogFar)
  })
  it('rain wets the ground, snow covers it, and each brings its precipitation', () => {
    expect(at('rain')).toMatchObject({ wetness: 1, snowCover: false, precipitation: 'rain' })
    expect(at('snow')).toMatchObject({ wetness: 0, snowCover: true, precipitation: 'snow' })
    expect(at('clear')).toMatchObject({ wetness: 0, snowCover: false, precipitation: null })
  })
})

describe('sun path and orientation', () => {
  const ASHDOD = { lat: 31.8, lon: 34.65, name: 'Ashdod' }
  it('sunrise, sunset and noon altitude match suncalc on the site clock', () => {
    const when = new Date('2026-06-21T12:00:00+03:00')
    const p = sunPath(ASHDOD, when)
    const t = getTimes(when, 31.8, 34.65, 0, 180)
    expect(p.sunrise).toBeCloseTo(localTime(t.sunrise!.toISOString(), ASHDOD).hour, 6)
    expect(p.sunset).toBeCloseTo(localTime(t.sunset!.toISOString(), ASHDOD).hour, 6)
    expect(p.noonAltitude).toBeCloseTo(getPosition(t.solarNoon, 31.8, 34.65).altitude, 6)
    // Analytic check: noon altitude is 90° − latitude + declination (23.44° at the June solstice), within 0.5%.
    expect(Math.abs(p.noonAltitude - (90 - 31.8 + 23.44)) / p.noonAltitude).toBeLessThan(0.005)
    expect(p.sunrise!).toBeGreaterThan(5)
    expect(p.sunrise!).toBeLessThan(6)
    expect(p.sunset!).toBeGreaterThan(19.5)
  })
  it('the sun relative to the front: 0° lights the façade, 180° is behind the model', () => {
    // Front facing south (180°) and the sun due south: it lights the façade.
    expect(sunOnFront(180, 180).rel).toBe(0)
    expect(sunOnFront(180, 180).words).toBe('השמש מאירה את החזית')
    expect(sunOnFront(180, 0).words).toContain('בצל')
    expect(sideOfFront(90)).toBe('left')
    expect(sideOfFront(-90)).toBe('right')
    expect(angleDiff(10, 350)).toBe(20)
  })
  it('noon in winter in Ashdod: the sun stands due south, so a front turned south is lit', () => {
    const sun = sunAt(ASHDOD, new Date('2026-12-21T11:40:00+02:00'))
    expect(Math.abs(angleDiff(sun.bearing, 180))).toBeLessThan(5)
    expect(sunOnFront(sun.bearing, 180).words).toBe('השמש מאירה את החזית')
  })
})

describe('wind', () => {
  it('Beaufort force from the WMO thresholds', () => {
    expect(beaufort(0).force).toBe(0)
    expect(beaufort(1).force).toBe(1)
    expect(beaufort(5).force).toBe(3)
    expect(beaufort(5.5).force).toBe(4)
    expect(beaufort(12).force).toBe(6)
    expect(beaufort(40).force).toBe(12)
    expect(beaufort(5).name_he).toBe('רוח חלשה')
  })
  it('the umbilic torus in a west wind: two passages face the wind, one is sheltered', () => {
    // Passages at path angles 0°, 120°, 240° (from east toward south): bearings 90°, 210°, 330°.
    expect(passageBearings(3, 0, 0)).toEqual([90, 210, 330])
    const r = readWind({ from_deg: 270, speed_ms: 5 }, passageBearings(3, 0, 0))
    expect(r.passages).toEqual({ into: 2, across: 0, sheltered: 1 })
    expect(r.windward_he).toBe('מערבי')
    expect(r.leeward_he).toBe('מזרחי')
    expect(readWind({ from_deg: 315, speed_ms: 5 }, []).windward_he).toBe('צפון-מערבי')
    // Turned 90° clockwise, the passages face 180°, 300° and 60°.
    expect(readWind({ from_deg: 270, speed_ms: 5 }, passageBearings(3, 0, 90)).passages).toEqual({ into: 1, across: 1, sheltered: 1 })
  })
  it('the illustration lines flow downwind, stay outside the circle and keep their offset far away', () => {
    const R = 20
    const lines = streamlines([0, 0], R, { from_deg: 270, speed_ms: 5 }, [1, 6])
    expect(lines.length).toBeGreaterThan(10)
    for (const l of lines) {
      const n = l.points.length / 3
      // From the west: they run toward +x (east).
      expect(l.points[3 * (n - 1)]!).toBeGreaterThan(l.points[0]! + 100)
      for (let i = 0; i < n; i++) expect(Math.hypot(l.points[3 * i]!, l.points[3 * i + 2]!)).toBeGreaterThanOrEqual(R - 1e-6)
      expect(l.dist[n - 1]!).toBeGreaterThan(0)
    }
    // Ideal flow: the streamline v(1 − R²/r²) = v₀ is exact, and far upstream v → v₀.
    const v = solveStream(5, 3, R)
    expect(v * (1 - (R * R) / (25 + v * v))).toBeCloseTo(3, 9)
    expect(solveStream(-1e5, 3, R)).toBeCloseTo(3, 3)
    expect(streamlines([0, 0], R, { from_deg: 0, speed_ms: 0 }, [1])).toEqual([])
  })
})

describe('visual prompt words', () => {
  const words = (path: string, value: unknown) => visualPrompt(parsed(setAt(fixture('umbilic-torus'), path, value))).prompt
  it.each([
    ['realistic.materials.outer', 'white_marble', 'שיש לבן'],
    ['realistic.materials.outer', 'perforated_metal', 'פח מחורר'],
    ['realistic.materials.outer', 'charred_timber', 'עץ חרוך'],
    ['realistic.weather', 'rain', 'גשם יורד'],
    ['realistic.weather', 'fog', 'ערפל סמיך'],
    ['realistic.weather', 'snow', 'שלג יורד'],
    ['realistic.context.preset', 'urban_gateway', 'שער עירוני'],
    ['realistic.context.preset', 'forest_edge', 'שולי יער'],
    ['realistic.orientation_deg', 180, 'החזית פונה לדרום'],
    ['realistic.wind', { from_deg: 90, speed_ms: 12 }, 'רוח חזקה מהמזרח'],
  ] as [string, unknown, string][])('%s = %j says "%s"', (path, value, expected) => {
    expect(words(path, value)).toContain(expected)
  })
  it('the default wind is worded with its Beaufort force', () => {
    expect(visualPrompt(parsed(fixture('umbilic-torus'))).prompt).toContain("רוח חלשה מהמערב, 5 מ' לשנייה (בופור 3)")
  })
  it('a calm says so and invents no direction', () => {
    const p = words('realistic.wind', { from_deg: 90, speed_ms: 0 })
    expect(p).toContain('בלי רוח')
    expect(p).not.toContain('בופור')
  })
})
