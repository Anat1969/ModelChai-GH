/**
 * Recipe contract in zod. Mirrors docs/schema/recipe.schema.json (JSON Schema 2020-12) field by field.
 * Any change here must land in the same commit as the JSON Schema, RECIPE_SCHEMA.md and the fixtures.
 * Parity with the JSON Schema is enforced by tests/schema-parity.test.ts.
 */
import { z } from 'zod'

const num = (min: number, max: number) => z.number().min(min).max(max)
const int = (min: number, max: number) => z.int().min(min).max(max)
const dateTime = z.iso.datetime({ offset: true })

export const MATERIALS = [
  'polished_concrete_light',
  'concrete_matte',
  'polished_concrete_grey',
  'jerusalem_stone',
  'corten_steel',
  'timber_oak',
  'rammed_earth',
  'glass_clear',
  'white_marble',
  'red_brick',
  'terracotta_tiles',
  'basalt',
  'copper_patina',
  'charred_timber',
  'white_render',
  'perforated_metal',
] as const
export const Material = z.enum(MATERIALS)

export const WEATHERS = ['clear', 'haze', 'overcast', 'rain', 'fog', 'snow'] as const
export const CONTEXT_PRESETS = [
  'coastal_dunes',
  'urban_plaza',
  'desert_loess',
  'park_lawn',
  'waterfront',
  'urban_gateway',
  'forest_edge',
  'rocky_slope',
  'snow_field',
  'river_bank',
] as const
export const VEGETATIONS = [
  'none',
  'dune_shrubs_low',
  'olive_trees',
  'lawn_and_trees',
  'desert_acacia',
  'pine_forest',
  'riverside_trees',
  'garrigue',
] as const
/** Wind when the recipe does not say: from the west at 5 m/s, the afternoon sea breeze on the Israeli coast. */
export const DEFAULT_WIND = { from_deg: 270, speed_ms: 5 } as const

// ---------- generator: sweep ----------

export const SECTION_CURVES = ['deltoid', 'hypocycloid', 'circle', 'polygon', 'superellipse'] as const
export const PATH_TYPES = ['circle', 'ellipse', 'helix', 'line', 'lemniscate', 'torus_knot', 'wave', 'arch'] as const
/** Closed paths meet themselves after one lap (rule 1). Rings are the closed paths around a courtyard. */
export const CLOSED_PATH_TYPES: readonly PathType[] = ['circle', 'ellipse', 'lemniscate', 'torus_knot']
export const RING_PATH_TYPES: readonly PathType[] = ['circle', 'ellipse']
export type PathType = (typeof PATH_TYPES)[number]
type PathField = 'R' | 'R2' | 'pitch' | 'turns' | 'length' | 'r' | 'p' | 'q' | 'cross_height' | 'amplitude' | 'wavelength' | 'span' | 'height'
/** Fields each path type requires; the JSON Schema says the same in its allOf. */
export const PATH_REQUIRED: Record<PathType, PathField[]> = {
  circle: ['R'],
  ellipse: ['R', 'R2'],
  helix: ['R', 'pitch', 'turns'],
  line: ['length'],
  lemniscate: ['R', 'cross_height'],
  torus_knot: ['R', 'r', 'p', 'q'],
  wave: ['length', 'amplitude', 'wavelength'],
  arch: ['span', 'height'],
}

export const SweepSection = z
  .strictObject({
    curve: z.enum(SECTION_CURVES),
    a: num(0.1, 20),
    cusps: int(3, 8).optional(),
    sides: int(3, 12).optional(),
    exponent: num(0.3, 8).optional(),
    aspect: num(0.03, 1).default(1),
  })
  .superRefine((s, ctx) => {
    const need = (field: 'cusps' | 'sides' | 'exponent') => {
      if (s[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when curve is "${s.curve}"` })
      }
    }
    if (s.curve === 'hypocycloid') need('cusps')
    if (s.curve === 'polygon') need('sides')
    if (s.curve === 'superellipse') need('exponent')
  })

export const SweepPath = z
  .strictObject({
    type: z.enum(PATH_TYPES),
    R: num(0.5, 300).optional(),
    R2: num(0.5, 300).optional(),
    pitch: num(0.5, 100).optional(),
    turns: num(0.25, 20).optional(),
    length: num(1, 1000).optional(),
    r: num(0.3, 100).optional(),
    p: int(1, 12).optional(),
    q: int(1, 12).optional(),
    cross_height: num(0, 40).optional(),
    amplitude: num(0.1, 100).optional(),
    wavelength: num(1, 1000).optional(),
    span: num(1, 300).optional(),
    height: num(0.5, 200).optional(),
  })
  .superRefine((p, ctx) => {
    for (const field of PATH_REQUIRED[p.type]) {
      if (p[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when path type is "${p.type}"` })
      }
    }
  })

export const SweepParams = z.strictObject({
  section: SweepSection,
  path: SweepPath,
  twist: z.strictObject({
    turns_per_lap: num(-4, 4),
    initial_angle_deg: num(-360, 360).default(0),
  }),
  scale_along_path: num(0.1, 5).default(1),
  resolution: z
    .strictObject({
      path_segments: int(24, 2048).default(360),
      section_segments: int(12, 512).default(144),
    })
    .optional(),
})

// ---------- generator: parametric_surface ----------

/**
 * A fixed library of named surfaces, each with its own few dimensions (DECISIONS.md 135). No formula strings:
 * every family is code the engine knows, so it is safe and testable.
 */
export const SURFACE_FAMILIES = ['hyperboloid', 'hyperbolic_paraboloid', 'catenoid', 'helicoid', 'klein_bottle', 'monkey_saddle'] as const
export type SurfaceFamily = (typeof SURFACE_FAMILIES)[number]
export type SurfaceField = 'waist_radius' | 'end_radius' | 'height' | 'span' | 'span2' | 'rise' | 'radius' | 'pitch' | 'turns' | 'tube'

/** The dimensions each family needs. `span2` is optional on the saddles: a square plan when it is missing. */
export const SURFACE_REQUIRED: Record<SurfaceFamily, SurfaceField[]> = {
  hyperboloid: ['waist_radius', 'end_radius', 'height'],
  hyperbolic_paraboloid: ['span', 'rise'],
  catenoid: ['waist_radius', 'height'],
  helicoid: ['radius', 'pitch', 'turns'],
  klein_bottle: ['radius', 'tube'],
  monkey_saddle: ['span', 'rise'],
}

export const SurfaceParams = z
  .strictObject({
    family: z.enum(SURFACE_FAMILIES),
    waist_radius: num(0.5, 100).optional(),
    end_radius: num(0.5, 150).optional(),
    height: num(1, 200).optional(),
    span: num(1, 200).optional(),
    span2: num(1, 200).optional(),
    rise: num(0.5, 100).optional(),
    radius: num(0.5, 150).optional(),
    pitch: num(0.5, 50).optional(),
    turns: num(0.25, 10).optional(),
    tube: num(0.2, 50).optional(),
    resolution: z
      .strictObject({
        u_segments: int(8, 1024).optional(),
        v_segments: int(4, 512).optional(),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    for (const field of SURFACE_REQUIRED[p.family]) {
      if (p[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when family is "${p.family}"` })
      }
    }
  })

// ---------- generator: tiling ----------

/**
 * Tiling and repetition (GENERATORS.md 4.2, DECISIONS.md 146): a fixed library of named patterns, each a base
 * element (a prism) repeated by a rule the engine knows. Like the surface families, no free formulas.
 */
export const TILING_PATTERNS = ['riemann_walls', 'ulam_grid', 'fibonacci_blocks', 'voronoi_cells', 'random_walk'] as const
export type TilingPattern = (typeof TILING_PATTERNS)[number]
export const TILING_PROFILES = ['arch', 'parabola', 'ramp'] as const
export type TilingField =
  | 'length' | 'depth' | 'width' | 'count' | 'side' | 'steps' | 'peak' | 'base_height' | 'profile' | 'thickness'
  | 'cell' | 'fill' | 'height' | 'height_min' | 'unit' | 'height_ratio' | 'joint' | 'seed' | 'invert'

/** The fields each pattern needs. `base_height` and `invert` are optional everywhere they apply. */
export const TILING_REQUIRED: Record<TilingPattern, TilingField[]> = {
  riemann_walls: ['length', 'count', 'peak', 'depth', 'thickness', 'profile'],
  ulam_grid: ['side', 'cell', 'fill', 'height'],
  fibonacci_blocks: ['count', 'unit', 'height_ratio', 'joint'],
  voronoi_cells: ['width', 'depth', 'count', 'seed', 'height_min', 'height', 'joint'],
  random_walk: ['steps', 'cell', 'height', 'seed'],
}

export const TilingParams = z
  .strictObject({
    pattern: z.enum(TILING_PATTERNS),
    length: num(4, 300).optional(),
    depth: num(1, 300).optional(),
    width: num(4, 300).optional(),
    count: int(2, 400).optional(),
    side: int(3, 61).optional(),
    steps: int(10, 4000).optional(),
    peak: num(1, 200).optional(),
    base_height: num(0, 100).optional(),
    profile: z.enum(TILING_PROFILES).optional(),
    thickness: num(0.1, 20).optional(),
    cell: num(0.5, 20).optional(),
    fill: num(0.2, 1).optional(),
    height: num(0.3, 200).optional(),
    height_min: num(0.3, 200).optional(),
    unit: num(0.5, 20).optional(),
    height_ratio: num(0.05, 3).optional(),
    joint: num(0, 5).optional(),
    seed: int(1, 9999).optional(),
    invert: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    for (const field of TILING_REQUIRED[p.pattern]) {
      if (p[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when pattern is "${p.pattern}"` })
      }
    }
  })

// The JSON Schema constrains params for "sweep", "parametric_surface" and "tiling". "sdf" arrives later in Stage 6.
export const Generator = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('sweep'), params: SweepParams }),
  z.strictObject({ type: z.literal('parametric_surface'), params: SurfaceParams }),
  z.strictObject({ type: z.literal('sdf'), params: z.record(z.string(), z.unknown()) }),
  z.strictObject({ type: z.literal('tiling'), params: TilingParams }),
])

// ---------- bare ----------

export const Bare = z
  .strictObject({
    mode: z.enum(['solid', 'shell']),
    section_center_height: num(-20, 60),
    shell: z
      .strictObject({
        thickness: num(0.08, 1.5),
        inner_method: z.enum(['scaled_section', 'normal_offset']).default('scaled_section'),
      })
      .optional(),
    openings: z
      .strictObject({
        passages: z
          .strictObject({
            count: int(0, 12),
            width: num(0.9, 12).default(3.2),
            height: num(2.1, 8).default(2.6),
            start_angle_deg: num(0, 360).default(0),
          })
          .optional(),
        slots: z
          .strictObject({
            count: int(0, 96),
            width_fraction: num(0.05, 0.8).default(0.28),
            duty: num(0.1, 0.9).default(0.42),
            position: z.enum(['face_center', 'near_edge']).default('face_center'),
          })
          .optional(),
      })
      .optional(),
    floor: z
      .strictObject({
        level: num(-10, 30).default(0),
        type: z.enum(['chord', 'none']).default('chord'),
      })
      .optional(),
    highlight: z
      .array(z.enum(['edges', 'section', 'path']))
      .refine((xs) => new Set(xs).size === xs.length, { message: 'highlight items must be unique' })
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.mode === 'shell' && b.shell === undefined) {
      ctx.addIssue({ code: 'custom', path: ['shell'], message: 'shell is required when mode is "shell"' })
    }
  })

// ---------- realistic ----------

export const Realistic = z.strictObject({
  site: z.strictObject({
    lat: num(-90, 90),
    lon: num(-180, 180),
    name: z.string().max(80).optional(),
  }),
  datetime: dateTime,
  weather: z.enum(WEATHERS),
  // Compass rotation of the model, clockwise from north. Its front (the bare level's −z side) faces this bearing.
  orientation_deg: int(0, 359).default(0),
  wind: z
    .strictObject({
      // Where the wind blows from, as a compass bearing (270 = from the west).
      from_deg: int(0, 359),
      speed_ms: num(0, 40),
    })
    .default({ ...DEFAULT_WIND }),
  materials: z.strictObject({
    outer: Material,
    inner: Material.optional(),
    floor: Material.optional(),
  }),
  context: z.strictObject({
    preset: z.enum(CONTEXT_PRESETS),
    vegetation: z.enum(VEGETATIONS).optional(),
    people: int(0, 40).optional(),
  }),
  camera: z.strictObject({
    preset: z.enum(['eye_level_oblique', 'aerial', 'inside', 'courtyard']),
    height: num(0.3, 300).default(1.6),
    fov_deg: num(20, 90).default(42),
    // 3:2 is the window since the studio redesign; 1:1 stays valid so versions saved before it still open.
    aspect: z.enum(['3:2', '1:1']).default('3:2'),
  }),
})

// ---------- recipe ----------

export const Recipe = z.strictObject({
  schema_version: z.literal('1.0'),
  meta: z.strictObject({
    id: z.string().regex(/^[a-z0-9-]{3,64}$/),
    created_at: dateTime,
    source: z.enum(['claude', 'manual', 'fork']),
    parent_id: z.string().nullable().optional(),
    notes: z.string().max(280).optional(),
  }),
  concept: z.strictObject({
    name: z.string().min(1).max(80),
    name_he: z.string().min(1).max(80),
    use: z.string().max(80).optional(),
    context_hint: z.string().max(120).optional(),
  }),
  generator: Generator,
  bare: Bare,
  realistic: Realistic,
  narrative: z.strictObject({
    name_he: z.string().min(1).max(60),
    insight: z.string().min(10).max(400),
    maxim: z.string().max(140).optional(),
    fit_note: z.string().max(300).nullable().optional(),
  }),
})

/** A recipe after parsing: schema defaults are filled in. */
export type Recipe = z.output<typeof Recipe>
/** A recipe as written by Claude or by hand, before defaults. */
export type RecipeInput = z.input<typeof Recipe>
export type SweepParams = z.output<typeof SweepParams>
export type SweepSection = z.output<typeof SweepSection>
export type SweepPath = z.output<typeof SweepPath>
export type SurfaceParams = z.output<typeof SurfaceParams>
export type TilingParams = z.output<typeof TilingParams>
/** A recipe whose generator the engine builds today: a sweep, a parametric surface or a tiling. */
export type SweepRecipe = Recipe & { generator: { type: 'sweep'; params: SweepParams } }
export type SurfaceRecipe = Recipe & { generator: { type: 'parametric_surface'; params: SurfaceParams } }
export type TilingRecipe = Recipe & { generator: { type: 'tiling'; params: TilingParams } }
export type BuiltRecipe = SweepRecipe | SurfaceRecipe | TilingRecipe
export const BUILT_GENERATORS = ['sweep', 'parametric_surface', 'tiling'] as const
export const isSweep = (r: Recipe): r is SweepRecipe => r.generator.type === 'sweep'
export const isSurface = (r: Recipe): r is SurfaceRecipe => r.generator.type === 'parametric_surface'
/** The recipe when the engine can build its generator, null otherwise. */
export const isTiling = (r: Recipe): r is TilingRecipe => r.generator.type === 'tiling'
export const asBuilt = (r: Recipe): BuiltRecipe | null => (isSweep(r) || isSurface(r) || isTiling(r) ? r : null)

export interface SchemaError {
  /** Dotted path, e.g. "generator.params.section.cusps". */
  path: string
  message: string
}

export type ParseResult = { ok: true; recipe: Recipe } | { ok: false; errors: SchemaError[] }

export function parseRecipe(input: unknown): ParseResult {
  const result = Recipe.safeParse(input)
  if (result.success) return { ok: true, recipe: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}
