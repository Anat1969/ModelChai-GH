/**
 * Material densities from LEVELS.md 2.3, in tonnes per cubic meter. Approximate values for order-of-magnitude
 * weight checks, not for structural design. The weight metric treats the whole shell as this one material.
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
  // Marble 2.56–2.80 t/m³ (Carrara about 2.7).
  white_marble: 2.7,
  // Solid fired-clay brick 1.8–2.0 t/m³, with mortar joints.
  red_brick: 1.9,
  // Fired-clay roof and wall tiles 1.8–2.0 t/m³.
  terracotta_tiles: 1.9,
  // Basalt 2.8–3.0 t/m³ (Golan basalt about 2.9).
  basalt: 2.9,
  // Copper 8.94 t/m³; the patina is a skin of microns and does not change it.
  copper_patina: 8.9,
  // Softwood for charred cladding (larch 0.55–0.60, cedar 0.35–0.40) after charring: about 0.5 t/m³.
  charred_timber: 0.5,
  // Cement-lime render 1.8–2.0 t/m³, as if the whole shell were rendered masonry of that weight.
  white_render: 1.8,
  // Aluminium 2.70 t/m³ with about 40% of the sheet punched away: 2.70 × 0.6 ≈ 1.6 t/m³.
  perforated_metal: 1.6,
}

export interface MaterialLook {
  name_he: string
  color: string
  roughness: number
  metalness: number
  /** Share of light that passes through: glass and perforated sheet. Zero for opaque materials. */
  transmission?: number
}

/** Starting PBR values from LEVELS.md 2.3, for export and the realistic level. Tuned by eye later. */
export const MATERIAL_LOOK: Record<keyof typeof DENSITY, MaterialLook> = {
  polished_concrete_light: { name_he: 'בטון בהיר מלוטש', color: '#D8D2C6', roughness: 0.38, metalness: 0 },
  concrete_matte: { name_he: 'בטון מט', color: '#CFC8BB', roughness: 0.6, metalness: 0 },
  polished_concrete_grey: { name_he: 'בטון אפור מלוטש', color: '#B9B2A5', roughness: 0.3, metalness: 0 },
  jerusalem_stone: { name_he: 'אבן ירושלמית', color: '#E3D5B8', roughness: 0.7, metalness: 0 },
  corten_steel: { name_he: 'פלדת קורטן', color: '#7A4A2E', roughness: 0.55, metalness: 0.6 },
  timber_oak: { name_he: 'עץ אלון', color: '#A27B52', roughness: 0.65, metalness: 0 },
  rammed_earth: { name_he: 'אדמה דחוסה', color: '#B88E66', roughness: 0.9, metalness: 0 },
  glass_clear: { name_he: 'זכוכית', color: '#E8F2F2', roughness: 0.05, metalness: 0, transmission: 0.85 },
  white_marble: { name_he: 'שיש לבן', color: '#ECEAE4', roughness: 0.22, metalness: 0 },
  red_brick: { name_he: 'לבני חרס אדומות', color: '#9E4E36', roughness: 0.85, metalness: 0 },
  terracotta_tiles: { name_he: 'אריחי טרקוטה', color: '#C0714A', roughness: 0.75, metalness: 0 },
  basalt: { name_he: 'בזלת', color: '#4A4846', roughness: 0.8, metalness: 0 },
  // The patina is a mineral layer (copper carbonates), so it reads as a dielectric, not as bare metal.
  copper_patina: { name_he: 'נחושת עם פטינה', color: '#6FA391', roughness: 0.65, metalness: 0.15 },
  charred_timber: { name_he: 'עץ חרוך בלוחות', color: '#2B2826', roughness: 0.9, metalness: 0 },
  white_render: { name_he: 'טיח לבן', color: '#EFEBE3', roughness: 0.92, metalness: 0 },
  // Without an environment map a fully metallic sheet renders near black; 0.5 keeps the aluminium light.
  perforated_metal: { name_he: 'פח מחורר', color: '#C4C7C8', roughness: 0.45, metalness: 0.5, transmission: 0.4 },
}
