/**
 * Stage 4: the realistic level's pure parts. Sun against suncalc and against an independent solar formula,
 * the site clock, seasons, atmosphere, context placement, and the visual prompt's derivation from the recipe.
 */
import { getPosition } from 'suncalc'
import { describe, expect, it } from 'vitest'
import { parseRecipe, type Recipe } from '../src/recipe/schema'
import { PROMPT_TAIL, visualPrompt, type PromptPart } from '../src/prompt/visualPrompt'
import { atmosphere, kelvinToRgb, lightKelvin } from '../src/scene/atmosphere'
import { CONTEXTS, MARGIN, contextElements, groundHeight, scatterPlants, VEGETATION, type Footprint } from '../src/scene/contexts/layout'
import { SEASONS, seasonOf } from '../src/scene/seasons'
import { dayOfYear, isoAt, localTime, offsetMinutes, quickMoment, sunAt, withDayOfYear } from '../src/scene/sun'
import { setAt } from '../src/ui/recipePath'
import { fixture } from './helpers'

const ASHDOD = { lat: 31.8, lon: 34.65, name: 'Ashdod' }
const DEG = 180 / Math.PI

/** NOAA's simplified solar position, as an independent check on suncalc. */
function noaaAltitude(lat: number, lon: number, when: Date): number {
  const jd = when.getTime() / 86400000 + 2440587.5
  const n = jd - 2451545
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) / DEG
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) / DEG
  const eps = (23.439 - 0.0000004 * n) / DEG
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmst = (280.46061837 + 360.98564736629 * n) % 360
  const H = (gmst + lon) / DEG - ra
  const phi = lat / DEG
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) * DEG
}

describe('sun.ts', () => {
  const winter = new Date(isoAt({ year: 2026, month: 12, day: 21, hour: 12 }, ASHDOD))
  const summer = new Date(isoAt({ year: 2026, month: 6, day: 21, hour: 12 }, ASHDOD))

  it('acceptance 1: Ashdod at 12:00 on 21 December and 21 June matches suncalc within one degree', () => {
    for (const when of [winter, summer]) {
      const ours = sunAt(ASHDOD, when).altitude
      const ref = getPosition(when, ASHDOD.lat, ASHDOD.lon).altitude
      expect(Math.abs(ours - ref)).toBeLessThan(1)
    }
  })

  it('agrees with an independent solar formula within one degree', () => {
    for (const when of [winter, summer, new Date('2026-03-20T07:30:00Z'), new Date('2026-10-13T14:00:00Z')]) {
      expect(Math.abs(sunAt(ASHDOD, when).altitude - noaaAltitude(ASHDOD.lat, ASHDOD.lon, when))).toBeLessThan(1)
    }
  })

  it('winter noon is low and summer noon is high, as the latitude says', () => {
    // Solar noon altitude is 90° − latitude ± 23.44°. 12:00 on the clock is within half an hour of solar noon.
    expect(sunAt(ASHDOD, winter).altitude).toBeGreaterThan(90 - 31.8 - 23.44 - 1.5)
    expect(sunAt(ASHDOD, winter).altitude).toBeLessThan(90 - 31.8 - 23.44 + 0.2)
    expect(sunAt(ASHDOD, summer).altitude).toBeGreaterThan(90 - 31.8 + 23.44 - 6)
    // The shadow of a 1 m pole: about 1.4 m in winter, under 0.25 m in summer.
    expect(sunAt(ASHDOD, winter).shadowPerMeter).toBeGreaterThan(1.3)
    expect(sunAt(ASHDOD, summer).shadowPerMeter).toBeLessThan(0.25)
  })

  it('direction is a unit vector with y up, north −z and east +x', () => {
    const morning = sunAt(ASHDOD, new Date('2026-06-21T04:00:00Z'))
    const d = morning.direction
    expect(Math.hypot(...d)).toBeCloseTo(1, 9)
    expect(d[0]).toBeGreaterThan(0.5) // the morning sun is in the east
    const noon = sunAt(ASHDOD, winter).direction
    expect(noon[2]).toBeGreaterThan(0) // the winter noon sun is in the south, +z
  })

  it('the Israeli clock follows summer time', () => {
    expect(offsetMinutes(ASHDOD, new Date('2026-12-21T10:00:00Z'))).toBe(120)
    expect(offsetMinutes(ASHDOD, new Date('2026-06-21T10:00:00Z'))).toBe(180)
    expect(isoAt({ year: 2026, month: 12, day: 21, hour: 12 }, ASHDOD)).toBe('2026-12-21T12:00:00+02:00')
    expect(isoAt({ year: 2026, month: 6, day: 21, hour: 12.5 }, ASHDOD)).toBe('2026-06-21T12:30:00+03:00')
  })

  it('elsewhere the clock is the standard meridian of the longitude', () => {
    const lisbon = { lat: 38.7, lon: -9.14 }
    expect(offsetMinutes(lisbon, new Date('2026-06-21T10:00:00Z'))).toBe(-60)
    expect(isoAt({ year: 2026, month: 6, day: 21, hour: 12 }, lisbon)).toBe('2026-06-21T12:00:00-01:00')
  })

  it('localTime reads the site clock, whatever offset the recipe was written in', () => {
    // Claude may write +03:00 in December; the instant is what counts, shown on the site clock.
    const t = localTime('2026-12-21T13:00:00+03:00', ASHDOD)
    expect(t).toEqual({ year: 2026, month: 12, day: 21, hour: 12 })
  })

  it('day of year round-trips', () => {
    const t = localTime('2026-10-13T17:00:00+03:00', ASHDOD)
    expect(dayOfYear(t)).toBe(286)
    expect(withDayOfYear(t, 355)).toMatchObject({ month: 12, day: 21, hour: 17 })
    expect(withDayOfYear(t, 999)).toMatchObject({ month: 12, day: 31 })
  })

  it('quick buttons: solstices at noon, sunset 20 minutes before the sun touches the horizon', () => {
    const t = localTime('2026-10-13T17:00:00+03:00', ASHDOD)
    expect(quickMoment('winter_solstice', t, ASHDOD)).toEqual({ year: 2026, month: 12, day: 21, hour: 12 })
    expect(quickMoment('summer_solstice', t, ASHDOD)).toEqual({ year: 2026, month: 6, day: 21, hour: 12 })
    const s = quickMoment('sunset', t, ASHDOD)
    const alt = sunAt(ASHDOD, new Date(isoAt(s, ASHDOD))).altitude
    expect(alt).toBeGreaterThan(0)
    expect(alt).toBeLessThan(6)
  })
})

describe('seasons.ts', () => {
  it('every month belongs to exactly one season', () => {
    const months = SEASONS.flatMap((s) => s.months).sort((a, b) => a - b)
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('follows the LEVELS.md 2.1 table', () => {
    expect(seasonOf(12)).toMatchObject({ id: 'winter', noonKelvin: 5800, haze: 'low' })
    expect(seasonOf(4)).toMatchObject({ id: 'spring', noonKelvin: 5600, haze: 'medium' })
    expect(seasonOf(7)).toMatchObject({ id: 'summer', noonKelvin: 5400, haze: 'high' })
    expect(seasonOf(10)).toMatchObject({ id: 'autumn', noonKelvin: 5600, haze: 'medium' })
  })
})

describe('atmosphere.ts', () => {
  it('kelvin to color: warm below 5,000K, near white at 6,500K', () => {
    const [r, , b] = kelvinToRgb(3000)
    expect(r).toBeGreaterThan(b + 80)
    const w = kelvinToRgb(6500)
    expect(Math.max(...w) - Math.min(...w)).toBeLessThan(12)
  })
  it('the light warms as the sun drops', () => {
    expect(lightKelvin(60, 5800)).toBe(5800)
    expect(lightKelvin(5, 5800)).toBeLessThan(4000)
  })
  it('LEVELS.md 2.2: clear casts a sharp shadow, haze a soft one, overcast none', () => {
    const s = seasonOf(10)
    const clear = atmosphere(40, 'clear', s, 30), haze = atmosphere(40, 'haze', s, 30), over = atmosphere(40, 'overcast', s, 30)
    expect(clear.castShadow && haze.castShadow).toBe(true)
    expect(haze.shadowRadius).toBeGreaterThan(clear.shadowRadius)
    expect(over.castShadow).toBe(false)
    expect(over.sunIntensity).toBe(0)
    // Fog: far in clear weather, middle in haze, near under overcast.
    expect(clear.fogFar).toBeGreaterThan(haze.fogFar)
    expect(haze.fogFar).toBeGreaterThan(over.fogFar)
  })
  it('no direct sun and no shadow after sunset', () => {
    const a = atmosphere(-3, 'clear', seasonOf(6), 30)
    expect(a.sunIntensity).toBe(0)
    expect(a.castShadow).toBe(false)
  })
})

describe('contexts: the footprint stays clear', () => {
  const fp: Footprint = { x: 0, z: 0, radius: 26.6 }
  it.each(Object.values(CONTEXTS))('$id: no plant or element inside the footprint and its margin, ground flat there', (def) => {
    const plants = scatterPlants(VEGETATION[def.vegetation], fp, 7, def.id)
    const el = contextElements(def.id, fp, 7)
    const all = [...plants, ...Object.values(el).flat()]
    for (const p of all) expect(Math.hypot(p.x - fp.x, p.z - fp.z)).toBeGreaterThan(fp.radius + MARGIN)
    const h = groundHeight(def, fp)
    for (let a = 0; a < 6.28; a += 0.3) for (const r of [0, fp.radius * 0.5, fp.radius, fp.radius + MARGIN]) expect(h(r * Math.cos(a), r * Math.sin(a))).toBe(0)
  })
  it('placement is seeded: the same recipe gives the same landscape', () => {
    expect(scatterPlants(VEGETATION.olive_trees, fp, 3)).toEqual(scatterPlants(VEGETATION.olive_trees, fp, 3))
    expect(scatterPlants(VEGETATION.olive_trees, fp, 3)).not.toEqual(scatterPlants(VEGETATION.olive_trees, fp, 4))
  })
})

// ---------- visual prompt ----------

const umbilic = () => {
  const p = parseRecipe(fixture('umbilic-torus'))
  if (!p.ok) throw new Error('fixture')
  return p.recipe as Recipe & { generator: { type: 'sweep' } }
}
const promptOf = (raw: unknown) => {
  const p = parseRecipe(raw)
  if (!p.ok) throw new Error(JSON.stringify(p.errors))
  return visualPrompt(p.recipe as never)
}
const bySlot = (parts: PromptPart[]) => Object.fromEntries(parts.map((p) => [p.slot, p.text]))

describe('visual prompt (LEVELS.md 2.6)', () => {
  it('follows the template: eight slots in order, then the fixed tail', () => {
    const v = visualPrompt(umbilic() as never)
    expect(v.parts.map((p) => p.slot)).toEqual(['shape', 'material', 'context', 'light', 'season', 'weather', 'people', 'camera'])
    expect(v.prompt.endsWith(PROMPT_TAIL)).toBe(true)
    expect(v.prompt).toContain('Documentary realism, Professional architecture photography, 3:2')
    expect(v.prompt).toContain('--no text, words, writing, frame divisions')
    expect(v.distill.length).toBeGreaterThan(10)
  })

  it('reads the umbilic torus the way the screen shows it', () => {
    const t = bySlot(visualPrompt(umbilic() as never).parts)
    expect(t.shape).toContain('דלתואיד')
    expect(t.shape).toContain('שליש סיבוב')
    expect(t.shape).toContain('קליפה חלולה')
    expect(t.shape).toContain('3 מעברים')
    expect(t.material).toContain('בטון בהיר מלוטש')
    expect(t.context).toContain('חולות חוף')
    expect(t.context).toContain('Ashdod')
    expect(t.season).toContain('סתיו')
    expect(t.people).toBe('9 אנשים לקנה מידה')
  })

  // Acceptance 3: every detail is derived from a field. Each mutation must change exactly the parts that
  // declare the field as a source, and nothing else.
  const MUTATIONS: [path: string, value: unknown][] = [
    ['generator.params.path.R', 30],
    ['generator.params.section.a', 2.0],
    ['generator.params.twist.turns_per_lap', 2 / 3],
    ['bare.mode', 'solid'],
    ['bare.shell.thickness', 0.5],
    ['bare.openings.passages.count', 2],
    ['bare.section_center_height', 3],
    ['realistic.materials.outer', 'jerusalem_stone'],
    ['realistic.materials.floor', 'timber_oak'],
    ['realistic.context.preset', 'urban_plaza'],
    ['realistic.site.name', 'Tel Aviv'],
    ['realistic.datetime', '2026-06-21T12:00:00+03:00'],
    ['realistic.site.lat', 29.55],
    ['realistic.context.vegetation', 'olive_trees'],
    ['realistic.weather', 'haze'],
    ['realistic.weather', 'rain'],
    ['realistic.orientation_deg', 180],
    ['realistic.wind', { from_deg: 90, speed_ms: 12 }],
    ['realistic.materials.outer', 'basalt'],
    ['realistic.context.preset', 'river_bank'],
    ['realistic.context.people', 2],
    ['realistic.camera.preset', 'aerial'],
    ['realistic.camera.height', 3],
  ]

  it.each(MUTATIONS)('changing %s changes only the parts derived from it', (path, value) => {
    const base = fixture('umbilic-torus')
    const before = promptOf(base).parts
    const after = promptOf(setAt(base, path, value)).parts
    const declares = (p: PromptPart) => p.sources.some((s) => path === s || path.startsWith(s + '.'))
    const changed = before.filter((p, i) => after[i]?.text !== p.text).map((p) => p.slot)
    expect(changed.length).toBeGreaterThan(0)
    for (const slot of changed) expect(declares(before.find((p) => p.slot === slot)!)).toBe(true)
  })

  it.each([
    ['meta.notes', 'note'],
    ['concept.use', 'בית ספר'],
    ['bare.highlight', ['path']],
    ['generator.params.resolution', { path_segments: 120, section_segments: 48 }],
  ] as [string, unknown][])('a field the prompt does not show (%s) leaves it unchanged', (path, value) => {
    const base = fixture('umbilic-torus')
    expect(promptOf(setAt(base, path, value)).prompt).toBe(promptOf(base).prompt)
  })

  it('every declared source is a real recipe field', () => {
    const known = (path: string) => {
      const top = path.split('.').slice(0, 3).join('.')
      return /^(generator\.params|bare|realistic)\b/.test(top)
    }
    for (const p of visualPrompt(umbilic() as never).parts) for (const s of p.sources) expect(known(s)).toBe(true)
  })

  it('without people the slot is left out, not invented', () => {
    const v = promptOf(setAt(fixture('umbilic-torus'), 'realistic.context.people', 0))
    expect(v.parts.some((p) => p.slot === 'people')).toBe(false)
  })
})
