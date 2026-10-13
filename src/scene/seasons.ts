/**
 * What the date implies (LEVELS.md 2.1). A design assumption for a coastal Mediterranean climate, not a
 * meteorological model, kept as data so it can be tuned without touching code.
 */

export type SeasonId = 'winter' | 'spring' | 'summer' | 'autumn'
export type HazeLevel = 'low' | 'medium' | 'high'

export interface Season {
  id: SeasonId
  name_he: string
  /** Months 1–12 that belong to the season. */
  months: number[]
  /** Foliage color, and its words for the visual prompt. */
  vegetation: string
  vegetation_he: string
  /** The foliage tone, worded to follow "בגוון" in the visual prompt. */
  foliage_he: string
  /** Ground: a multiplier on the context's ground color (below 1 is darker and wetter), and its words. */
  groundTone: number
  ground_he: string
  /** Color temperature of the midday light, in kelvin. */
  noonKelvin: number
  haze: HazeLevel
}

export const SEASONS: readonly Season[] = [
  {
    id: 'winter',
    name_he: 'חורף',
    months: [12, 1, 2, 3],
    vegetation: '#5f8a3e',
    vegetation_he: 'צמחייה ירוקה מלאה',
    foliage_he: 'ירוק מלא',
    groundTone: 0.82,
    ground_he: 'קרקע כהה ורטובה אחרי גשם',
    noonKelvin: 5800,
    haze: 'low',
  },
  {
    id: 'spring',
    name_he: 'אביב',
    months: [4, 5],
    vegetation: '#8a9a45',
    vegetation_he: 'צמחייה ירוקה-צהובה',
    foliage_he: 'ירוק-צהוב',
    groundTone: 0.92,
    ground_he: 'קרקע בגוון בינוני',
    noonKelvin: 5600,
    haze: 'medium',
  },
  {
    id: 'summer',
    name_he: 'קיץ',
    months: [6, 7, 8, 9],
    vegetation: '#a8935a',
    vegetation_he: 'צמחייה צהובה-חומה ויבשה',
    foliage_he: 'צהוב-חום יבש',
    groundTone: 1.06,
    ground_he: 'קרקע בהירה ויבשה',
    noonKelvin: 5400,
    haze: 'high',
  },
  {
    id: 'autumn',
    name_he: 'סתיו',
    months: [10, 11],
    vegetation: '#8c7a4c',
    vegetation_he: 'צמחייה חומה, עם ירוק ראשון אחרי הגשם',
    foliage_he: 'חום, עם ירוק ראשון אחרי הגשם',
    groundTone: 1.0,
    ground_he: 'קרקע בהירה',
    noonKelvin: 5600,
    haze: 'medium',
  },
]

export function seasonOf(month: number): Season {
  return SEASONS.find((s) => s.months.includes(month))!
}

/** Extra fog from the season's default haze, as a factor on the visible distance. */
export const HAZE_DISTANCE: Record<HazeLevel, number> = { low: 1, medium: 0.85, high: 0.7 }
