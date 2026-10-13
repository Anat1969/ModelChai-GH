/**
 * Sun position and site clock (LEVELS.md 2.1). Pure: no three.js and no DOM, so it is tested in node.
 * Scene axes: y is up, north is −z, east is +x (the reference model uses the same convention).
 */
import { getPosition, getTimes } from 'suncalc'

export interface Site {
  lat: number
  lon: number
  name?: string
}

export interface SunState {
  /** Degrees above the horizon. Negative after sunset. */
  altitude: number
  /** Compass bearing in degrees: 0 north, 90 east, 180 south, 270 west. */
  bearing: number
  /** Unit vector from the scene toward the sun. */
  direction: [number, number, number]
  /** Length of the shadow of a 1 m pole, in meters. Infinity when the sun is down. */
  shadowPerMeter: number
}

const DEG = 180 / Math.PI

export function sunAt(site: Site, when: Date): SunState {
  // suncalc 2 works in degrees, with the azimuth measured clockwise from north and refraction included.
  const p = getPosition(when, site.lat, site.lon)
  const bearing = ((p.azimuth % 360) + 360) % 360
  const el = p.altitude / DEG, b = bearing / DEG
  return {
    altitude: p.altitude,
    bearing,
    direction: [Math.cos(el) * Math.sin(b), Math.sin(el), -Math.cos(el) * Math.cos(b)],
    shadowPerMeter: el > 0 ? 1 / Math.tan(el) : Infinity,
  }
}

export function sunsetAt(site: Site, when: Date): Date | null {
  return getTimes(when, site.lat, site.lon, 0, offsetMinutes(site, when)).sunset
}

/** Sites for the location selector. Each has its Hebrew name and the full Latin name, so it can be searched. */
export const SITES: readonly (Site & { name: string; name_he: string; full: string })[] = [
  { name: 'Ashdod', name_he: 'אשדוד', full: 'Ashdod, Israel', lat: 31.8, lon: 34.65 },
  { name: 'Tel Aviv', name_he: 'תל אביב', full: 'Tel Aviv-Yafo, Israel', lat: 32.08, lon: 34.78 },
  { name: 'Jerusalem', name_he: 'ירושלים', full: 'Jerusalem, Israel', lat: 31.78, lon: 35.22 },
  { name: 'Haifa', name_he: 'חיפה', full: 'Haifa, Israel', lat: 32.79, lon: 34.99 },
  { name: 'Beersheba', name_he: 'באר שבע', full: "Be'er Sheva, Israel", lat: 31.25, lon: 34.79 },
  { name: 'Mitzpe Ramon', name_he: 'מצפה רמון', full: 'Mitzpe Ramon, Israel', lat: 30.61, lon: 34.8 },
  { name: 'Eilat', name_he: 'אילת', full: 'Eilat, Israel', lat: 29.56, lon: 34.95 },
]

/** "באשדוד (Ashdod, Israel)" for a known site, "ב-Lisbon" for a name in Latin letters. */
export function siteWords(site: Site): string | null {
  if (!site.name) return null
  const known = SITES.find((s) => s.name.toLowerCase() === site.name!.toLowerCase() || s.name_he === site.name)
  if (known) return `ב${known.name_he} (${known.full})`
  return /^[\u0590-\u05FF]/.test(site.name) ? `ב${site.name}` : `ב-${site.name}`
}

// ---------- site clock ----------

/**
 * Israel follows Asia/Jerusalem, with summer time. Elsewhere there is no time-zone database in the app, so the
 * clock is the standard meridian of the longitude, without summer time (DECISIONS.md).
 */
export function zoneOf(site: Site): string | null {
  return site.lat > 29 && site.lat < 33.5 && site.lon > 34 && site.lon < 36 ? 'Asia/Jerusalem' : null
}

/** Offset of the site clock from UTC at a moment, in minutes. */
export function offsetMinutes(site: Site, at: Date): number {
  const zone = zoneOf(site)
  if (!zone) return Math.round(site.lon / 15) * 60
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((local - Math.floor(at.getTime() / 60000) * 60000) / 60000)
}

export interface LocalTime {
  year: number
  /** 1–12 */
  month: number
  day: number
  /** Hours since local midnight, e.g. 17.5 for 17:30. */
  hour: number
}

/** The site's local clock for an ISO date-time. */
export function localTime(iso: string, site: Site): LocalTime {
  const at = new Date(iso)
  const shifted = new Date(at.getTime() + offsetMinutes(site, at) * 60000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours() + shifted.getUTCMinutes() / 60,
  }
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')

/** ISO date-time with the site's offset, from a local clock reading. Minutes are rounded to whole minutes. */
export function isoAt(t: LocalTime, site: Site): string {
  const minutes = Math.round(t.hour * 60)
  const naive = Date.UTC(t.year, t.month - 1, t.day, 0, minutes)
  // The offset depends on the moment; one correction step settles it except inside the skipped DST hour.
  let off = offsetMinutes(site, new Date(naive))
  off = offsetMinutes(site, new Date(naive - off * 60000))
  const local = new Date(naive)
  const sign = off >= 0 ? '+' : '-'
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  )
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInYear = (y: number) => (isLeap(y) ? 366 : 365)

export function dayOfYear(t: LocalTime): number {
  return Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(t.year, 0, 1)) / 86400000) + 1
}

export function withDayOfYear(t: LocalTime, day: number): LocalTime {
  const d = new Date(Date.UTC(t.year, 0, Math.max(1, Math.min(daysInYear(t.year), Math.round(day)))))
  return { ...t, month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

export const dateLabel = (t: LocalTime) => `${t.day} ב${HE_MONTHS[t.month - 1]}`
export const clockLabel = (hour: number) => {
  const m = Math.round(hour * 60)
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}

/** Quick buttons (LEVELS.md 2.1). Sunset is set 20 minutes before the sun touches the horizon, while it still lights the model. */
export type QuickMoment = 'winter_solstice' | 'equinox' | 'summer_solstice' | 'sunset'

export function quickMoment(which: QuickMoment, current: LocalTime, site: Site): LocalTime {
  switch (which) {
    case 'winter_solstice':
      return { year: current.year, month: 12, day: 21, hour: 12 }
    case 'equinox':
      return { year: current.year, month: 3, day: 20, hour: 12 }
    case 'summer_solstice':
      return { year: current.year, month: 6, day: 21, hour: 12 }
    case 'sunset': {
      const noon = new Date(isoAt({ ...current, hour: 12 }, site))
      const set = sunsetAt(site, noon)
      if (!set) return current
      const local = localTime(new Date(set.getTime() - 20 * 60000).toISOString(), site)
      return { ...current, hour: Math.floor(local.hour * 6) / 6 }
    }
  }
}
