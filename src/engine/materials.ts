/**
 * Material densities from LEVELS.md 2.3, in tonnes per cubic meter. Approximate values for order-of-magnitude
 * weight checks, not for structural design.
 */
import type { MATERIALS } from '../recipe/schema'

export const DENSITY: Record<(typeof MATERIALS)[number], number> = {
  polished_concrete_light: 2.4,
  concrete_matte: 2.4,
  polished_concrete_grey: 2.4,
  jerusalem_stone: 2.4,
  corten_steel: 7.85,
  timber_oak: 0.7,
  rammed_earth: 2.0,
  glass_clear: 2.5,
}

/** Starting PBR values from LEVELS.md 2.3, for export and the realistic level. Tuned by eye later. */
export const MATERIAL_LOOK: Record<keyof typeof DENSITY, { name_he: string; color: string; roughness: number; metalness: number }> = {
  polished_concrete_light: { name_he: 'בטון בהיר מלוטש', color: '#D8D2C6', roughness: 0.38, metalness: 0 },
  concrete_matte: { name_he: 'בטון מט', color: '#CFC8BB', roughness: 0.6, metalness: 0 },
  polished_concrete_grey: { name_he: 'בטון אפור מלוטש', color: '#B9B2A5', roughness: 0.3, metalness: 0 },
  jerusalem_stone: { name_he: 'אבן ירושלמית', color: '#E3D5B8', roughness: 0.7, metalness: 0 },
  corten_steel: { name_he: 'פלדת קורטן', color: '#7A4A2E', roughness: 0.55, metalness: 0.6 },
  timber_oak: { name_he: 'עץ אלון', color: '#A27B52', roughness: 0.65, metalness: 0 },
  rammed_earth: { name_he: 'אדמה דחוסה', color: '#B88E66', roughness: 0.9, metalness: 0 },
  glass_clear: { name_he: 'זכוכית', color: '#E8F2F2', roughness: 0.05, metalness: 0 },
}
