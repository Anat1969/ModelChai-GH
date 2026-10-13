/**
 * Context presets (LEVELS.md 2.4) as data and placement. Every context receives the model's footprint and
 * leaves it clear: nothing is placed, and the ground is not raised, inside it. Pure and seeded, so the same
 * recipe always gives the same landscape and the placement is tested in node.
 */

export type ContextId = 'coastal_dunes' | 'urban_plaza' | 'desert_loess' | 'park_lawn' | 'waterfront'
export type VegetationId = 'none' | 'dune_shrubs_low' | 'olive_trees' | 'lawn_and_trees' | 'desert_acacia'

export interface Footprint {
  /** Center on the ground plane (x, z). */
  x: number
  z: number
  /** Radius of the clear zone around the model, in meters. */
  radius: number
}

export interface ContextDef {
  id: ContextId
  name_he: string
  /** Ground color before the season tint. */
  ground: string
  ground_he: string
  /** Elements beyond vegetation, in words, for the visual prompt. */
  elements_he: string
  vegetation: VegetationId
  /** Ground relief outside the clear zone, in meters. */
  relief: number
}

export const CONTEXTS: Record<ContextId, ContextDef> = {
  coastal_dunes: {
    id: 'coastal_dunes',
    name_he: 'חולות חוף',
    ground: '#dcc9a3',
    ground_he: 'חול עם דיונות, שטוח סביב המבנה',
    elements_he: 'קו ים באופק המערבי',
    vegetation: 'dune_shrubs_low',
    relief: 2.2,
  },
  urban_plaza: {
    id: 'urban_plaza',
    name_he: 'כיכר עירונית',
    ground: '#d6d0c4',
    ground_he: 'ריצוף אבן בהיר',
    elements_he: 'עצי פיקוס בעציצים, וחזיתות נמוכות בשולי הכיכר',
    vegetation: 'none',
    relief: 0,
  },
  desert_loess: {
    id: 'desert_loess',
    name_he: 'גבעות לס',
    ground: '#b89a74',
    ground_he: 'אדמת לס חומה וגלית',
    elements_he: 'גבעות באופק',
    vegetation: 'desert_acacia',
    relief: 4,
  },
  park_lawn: {
    id: 'park_lawn',
    name_he: 'פארק',
    ground: '#7f9a55',
    ground_he: 'דשא ושבילים',
    elements_he: 'ספסלים לאורך השבילים',
    vegetation: 'lawn_and_trees',
    relief: 0.6,
  },
  waterfront: {
    id: 'waterfront',
    name_he: 'חזית מים',
    ground: '#cfc7b6',
    ground_he: 'טיילת מרוצפת',
    elements_he: 'מים ומעקה לאורך הטיילת',
    vegetation: 'none',
    relief: 0,
  },
}

/** The four contexts of the minimum product, in the order of the selector. */
export const MVP_CONTEXTS: ContextId[] = ['coastal_dunes', 'urban_plaza', 'desert_loess', 'park_lawn']

export type PlantKind = 'shrub' | 'olive' | 'broadleaf' | 'acacia'

export interface VegetationDef {
  id: VegetationId
  name_he: string
  kind: PlantKind | null
  /** Plants per 1,000 m² of the scattered ring. */
  density: number
  /** Height range, in meters. */
  height: [number, number]
}

export const VEGETATION: Record<VegetationId, VegetationDef> = {
  none: { id: 'none', name_he: 'בלי צמחייה', kind: null, density: 0, height: [0, 0] },
  dune_shrubs_low: { id: 'dune_shrubs_low', name_he: 'שיחי דיונות נמוכים', kind: 'shrub', density: 14, height: [0.4, 1.1] },
  olive_trees: { id: 'olive_trees', name_he: 'עצי זית', kind: 'olive', density: 1.4, height: [3.5, 5.5] },
  lawn_and_trees: { id: 'lawn_and_trees', name_he: 'עצים רחבי צמרת', kind: 'broadleaf', density: 1.2, height: [6, 10] },
  desert_acacia: { id: 'desert_acacia', name_he: 'שיטים בודדות', kind: 'acacia', density: 0.5, height: [3, 5] },
}

/** mulberry32: a small seeded generator, so a recipe always gives the same landscape. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from text, e.g. the recipe id. */
export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Clear margin beyond the footprint, in meters: room to walk around the model. */
export const MARGIN = 4

/** Depth of the ground under the water plane, in meters. */
export const SEABED = -0.6

/**
 * Ground height of a context. Exactly zero inside the footprint and its margin, relief beyond, and a beach
 * that slopes under the water where the context has one.
 */
export function groundHeight(def: ContextDef, fp: Footprint): (x: number, z: number) => number {
  const r0 = fp.radius + MARGIN, r1 = r0 + Math.max(12, fp.radius * 0.6)
  const edge = waterEdge(def.id, fp)
  return (x, z) => {
    const d = Math.hypot(x - fp.x, z - fp.z)
    if (d <= r0 + 1e-9) return 0
    let h = 0
    if (def.relief) {
      const n = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.4) + 0.5 * Math.sin((x + z) * 0.09 + 2.1)
      h = smooth(r0, r1, d) * def.relief * (0.55 + 0.45 * n)
    }
    if (edge !== null) {
      // A promenade drops straight into the water; a beach slopes into it over 30 m.
      const run = def.relief ? 30 : 0.01
      const k = smooth(edge, edge + run, x)
      h = h * k + SEABED * (1 - k)
    }
    return h
  }
}

export interface Plant {
  kind: PlantKind
  x: number
  z: number
  height: number
  rotation: number
}

/**
 * The eye-level camera stands 16 m outside the footprint (cameras.ts). Trees and planters start beyond it,
 * so nothing tall stands between the camera and the model; low shrubs may grow closer.
 */
export const TALL_CLEARANCE = 20

/** Plants in a ring around the clear zone, from its edge out to the visible landscape. */
export function scatterPlants(veg: VegetationDef, fp: Footprint, seed: number): Plant[] {
  if (!veg.kind) return []
  const r0 = fp.radius + (veg.kind === 'shrub' ? MARGIN + 1 : TALL_CLEARANCE), r1 = Math.max(r0 + 40, fp.radius * 3.2)
  const area = Math.PI * (r1 * r1 - r0 * r0)
  const count = Math.min(900, Math.round((area / 1000) * veg.density))
  const rand = rng(seed)
  const out: Plant[] = []
  for (let i = 0; i < count; i++) {
    // Uniform in area: the square root spreads plants evenly instead of crowding the inner edge.
    const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0))
    const a = rand() * Math.PI * 2
    out.push({
      kind: veg.kind,
      x: fp.x + r * Math.cos(a),
      z: fp.z + r * Math.sin(a),
      height: veg.height[0] + rand() * (veg.height[1] - veg.height[0]),
      rotation: rand() * Math.PI * 2,
    })
  }
  return out
}

export interface Box {
  x: number
  z: number
  w: number
  d: number
  h: number
  /** Rotation about y, radians. */
  rotation: number
}

/** Built elements of each context: facades, planters, benches, hills. Water is a plane, drawn by the scene. */
export function contextElements(id: ContextId, fp: Footprint, seed: number): { facades: Box[]; planters: Box[]; benches: Box[]; hills: Box[] } {
  const rand = rng(seed ^ 0x9e3779b9)
  const facades: Box[] = [], planters: Box[] = [], benches: Box[] = [], hills: Box[] = []
  if (id === 'urban_plaza') {
    // Low facades around the plaza edge, with gaps for streets.
    const R = fp.radius + TALL_CLEARANCE + 16
    const n = Math.max(10, Math.round((2 * Math.PI * R) / 22))
    for (let i = 0; i < n; i++) {
      if (i % 5 === 2) continue
      const a = (i / n) * Math.PI * 2
      facades.push({ x: fp.x + R * Math.cos(a), z: fp.z + R * Math.sin(a), w: ((2 * Math.PI * R) / n) * 0.92, d: 10, h: 7 + rand() * 9, rotation: -a + Math.PI / 2 })
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3
      const r = fp.radius + TALL_CLEARANCE
      planters.push({ x: fp.x + r * Math.cos(a), z: fp.z + r * Math.sin(a), w: 1.6, d: 1.6, h: 0.6, rotation: a })
    }
  }
  if (id === 'park_lawn' || id === 'waterfront') {
    const r = fp.radius + TALL_CLEARANCE
    const n = id === 'park_lawn' ? 8 : 12
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.15
      benches.push({ x: fp.x + r * Math.cos(a), z: fp.z + r * Math.sin(a), w: 1.8, d: 0.5, h: 0.45, rotation: -a })
    }
  }
  if (id === 'desert_loess') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.5
      const r = fp.radius * 4 + 160 + rand() * 120
      hills.push({ x: fp.x + r * Math.cos(a), z: fp.z + r * Math.sin(a), w: 120 + rand() * 120, d: 80 + rand() * 60, h: 18 + rand() * 26, rotation: a })
    }
  }
  return { facades, planters, benches, hills }
}

/** Water edge for coastal and waterfront contexts: a line west of the model (−x), in meters from the center. */
export function waterEdge(id: ContextId, fp: Footprint): number | null {
  if (id === 'coastal_dunes') return fp.x - (fp.radius * 2.5 + 90)
  if (id === 'waterfront') return fp.x - (fp.radius + MARGIN + 6)
  return null
}
