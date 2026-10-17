/**
 * Light, sky and fog for the realistic level (LEVELS.md 2.1, 2.2), as plain numbers and hex colors.
 * Pure, so the scene only applies what is computed here.
 */
import type { WEATHERS } from '../recipe/schema'
import type { Season } from './seasons'
import { HAZE_DISTANCE } from './seasons'

export type Weather = (typeof WEATHERS)[number]

export interface Atmosphere {
  sunColor: string
  /** Direct light. Zero when the sun is down or under overcast. */
  sunIntensity: number
  castShadow: boolean
  /** Blur radius of the shadow map, in texels: sharp in clear weather, soft in haze. */
  shadowRadius: number
  skyTop: string
  skyHorizon: string
  ambientSky: string
  ambientGround: string
  ambientIntensity: number
  /** Fog start and end, in meters. */
  fogNear: number
  fogFar: number
  /** Light temperature that was used, in kelvin, for the readout and the prompt. */
  kelvin: number
  /** 0 dry, 1 soaked: darker ground and a sheen on the model. A visual cue, not a measure of rain. */
  wetness: number
  /** Snow lies on the ground and on the crowns. */
  snowCover: boolean
  /** What falls from the sky, drawn as streaks or flakes. */
  precipitation: 'rain' | 'snow' | null
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

/** Black-body color approximation (Tanner Helland), good to a few percent between 1,000K and 40,000K. */
export function kelvinToRgb(k: number): [number, number, number] {
  const t = k / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)].map(Math.round) as [number, number, number]
}

type RGB = [number, number, number]
const hex = (c: RGB) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
const parse = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const mix = (a: string, b: string, k: number) => hex(parse(a).map((v, i) => v + (parse(b)[i]! - v) * clamp(k)) as RGB)

/** The light warms as the sun drops: noon temperature from 40° up, 2,400K at the horizon. */
export function lightKelvin(altitude: number, noonKelvin: number): number {
  const k = clamp(altitude / 40)
  return Math.round(2400 + (noonKelvin - 2400) * Math.sqrt(k))
}

export function atmosphere(altitude: number, weather: Weather, season: Season, extent: number): Atmosphere {
  const day = clamp(altitude / 40)
  const up = altitude > 0
  const kelvin = lightKelvin(Math.max(0, altitude), season.noonKelvin)
  const sunColor = hex(kelvinToRgb(kelvin))
  // Visible distance grows with the model, so a large ring still sits in a readable landscape.
  const far = Math.max(420, extent * 9) * HAZE_DISTANCE[season.haze]
  // Twilight: the sky keeps some light for a few degrees below the horizon.
  const dusk = clamp((altitude + 6) / 8)

  const clearTop = mix('#1d2a44', mix('#4a6d99', '#3d7bb8', day), dusk)
  const clearHorizon = mix('#3a3f55', mix('#f0a56a', '#d4e3ec', day), dusk)

  const dry = { wetness: 0, snowCover: false, precipitation: null }
  switch (weather) {
    case 'clear':
      return {
        ...dry,
        sunColor,
        sunIntensity: up ? 2.6 + day * 0.6 : 0,
        castShadow: up,
        shadowRadius: 1,
        skyTop: clearTop,
        skyHorizon: clearHorizon,
        ambientSky: mix('#b4c2d6', '#c9d9ea', day),
        ambientGround: mix('#a39a8c', '#d9cfbd', day),
        ambientIntensity: 0.55 + 0.6 * dusk,
        fogNear: far * 0.3,
        fogFar: far,
        kelvin,
      }
    case 'haze':
      return {
        ...dry,
        sunColor: mix(sunColor, '#ffd9a8', 0.35),
        sunIntensity: up ? 1.7 + day * 0.5 : 0,
        castShadow: up,
        shadowRadius: 6,
        skyTop: mix(clearTop, '#d9c6a8', 0.45),
        skyHorizon: mix(clearHorizon, '#ead6b8', 0.6),
        ambientSky: mix('#c7b9a3', '#e2d7c4', day),
        ambientGround: mix('#8f7c62', '#cdb894', day),
        ambientIntensity: 0.75 + 0.6 * dusk,
        fogNear: far * 0.12,
        fogFar: far * 0.55,
        kelvin,
      }
    case 'overcast':
      return {
        ...dry,
        sunColor: '#e8e8e6',
        sunIntensity: 0,
        castShadow: false,
        shadowRadius: 0,
        skyTop: mix('#4b4f55', '#a9adb1', dusk),
        skyHorizon: mix('#5d6166', '#c9cbcc', dusk),
        ambientSky: mix('#7d8187', '#dfe1e2', dusk),
        ambientGround: mix('#55524c', '#a7a196', dusk),
        ambientIntensity: 0.5 + 1.3 * dusk,
        fogNear: far * 0.05,
        fogFar: far * 0.35,
        kelvin: 6500,
      }
    case 'rain':
      // Overcast and darker, no direct sun and so no cast shadow (DECISIONS.md 57), wet ground.
      return {
        wetness: 1,
        snowCover: false,
        precipitation: 'rain',
        sunColor: '#dfe2e4',
        sunIntensity: 0,
        castShadow: false,
        shadowRadius: 0,
        skyTop: mix('#33373d', '#7b8086', dusk),
        skyHorizon: mix('#454a50', '#a4a8ab', dusk),
        ambientSky: mix('#6a7077', '#c3c8cc', dusk),
        ambientGround: mix('#3f3d39', '#86817a', dusk),
        ambientIntensity: 0.45 + 1.05 * dusk,
        fogNear: far * 0.03,
        fogFar: far * 0.25,
        kelvin: 6800,
      }
    case 'fog':
      // The sun shows as a pale disc and casts a faint, very soft shadow. Visibility is a few model sizes.
      return {
        wetness: 0.4,
        snowCover: false,
        precipitation: null,
        sunColor: mix(sunColor, '#ffffff', 0.6),
        sunIntensity: up ? 0.5 + day * 0.5 : 0,
        castShadow: up,
        shadowRadius: 12,
        skyTop: mix('#6f7477', '#d2d5d6', dusk),
        skyHorizon: mix('#7f8487', '#e1e3e3', dusk),
        ambientSky: mix('#8a8f93', '#e6e8e9', dusk),
        ambientGround: mix('#5f5d58', '#b9b4ab', dusk),
        ambientIntensity: 0.6 + 1.1 * dusk,
        // The shortest visibility of all weathers, yet the far side of the model still shows through.
        fogNear: Math.max(8, extent * 0.3),
        fogFar: Math.max(far * 0.18, extent * 1.8 + 35),
        kelvin: 6200,
      }
    case 'snow':
      // Falling snow: no direct sun, a bright white ambient light reflected from the snow cover.
      return {
        wetness: 0,
        snowCover: true,
        precipitation: 'snow',
        sunColor: '#eef1f4',
        sunIntensity: 0,
        castShadow: false,
        shadowRadius: 0,
        skyTop: mix('#5d6267', '#bfc4c8', dusk),
        skyHorizon: mix('#6f747a', '#dde0e3', dusk),
        ambientSky: mix('#8b9096', '#eef1f4', dusk),
        ambientGround: mix('#8a8d90', '#e9ecee', dusk),
        ambientIntensity: 0.6 + 1.4 * dusk,
        fogNear: far * 0.04,
        fogFar: far * 0.3,
        kelvin: 7000,
      }
  }
}

/** Multiplies a hex color by a factor, for ground wetness and season tints. */
export function tone(h: string, k: number): string {
  return hex(parse(h).map((v) => v * k) as RGB)
}

export { mix as mixColor }
