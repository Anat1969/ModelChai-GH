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
