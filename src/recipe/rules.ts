/**
 * Semantic rules from docs/RECIPE_SCHEMA.md ("כללים סמנטיים").
 * The schema checks structure and ranges. These rules check that a recipe builds a valid structure.
 * An error blocks the build. A warning builds and marks the related metric in orange.
 * Interpretations where the docs leave room are recorded in docs/DECISIONS.md.
 */
import { CURVE_PATHS, bendAxis, crossingClearance, lowestPoints, minCurvatureRadius, sectionExtent } from '../engine/paths/analysis'
import { gcd } from '../engine/math'
import { pathFrames } from '../engine/paths'
import type { Recipe, SurfaceParams, SweepParams, SweepSection, TilingParams } from './schema'
import { COUNT_RANGE, layout, polyArea } from '../engine/tiling/patterns'
import { KLEIN_REACH, clearance, family, minCurvatureRadius as surfaceMinCurvature, planSpan } from '../engine/surface/families'
import { CLOSED_PATH_TYPES, RING_PATH_TYPES, parseRecipe, type SchemaError } from './schema'

export type Severity = 'error' | 'warning'

export interface RuleDef {
  id: number
  severity: Severity
  /** Message shown to the user, in Hebrew. */
  message: string
  /** "recipe" rules run here. "system" rules are runtime invariants checked by the engine. */
  scope: 'recipe' | 'system'
}

export const RULES: readonly RuleDef[] = [
  { id: 1, severity: 'error', scope: 'recipe', message: 'החתך לא נסגר על עצמו בסוף ההקפה' },
  { id: 2, severity: 'error', scope: 'recipe', message: 'הטבעת חותכת את עצמה במרכז' },
  { id: 3, severity: 'error', scope: 'recipe', message: 'הדופן הפנימית נעלמת' },
  { id: 4, severity: 'warning', scope: 'recipe', message: 'הדופן עבה כמעט כמו החלל' },
  { id: 5, severity: 'warning', scope: 'recipe', message: 'הרצפה נקטעת לאורך ההקפה' },
  { id: 6, severity: 'warning', scope: 'recipe', message: 'יש קטע שבו לא עומדים בגובה מלא' },
  { id: 7, severity: 'error', scope: 'recipe', message: 'המעברים חופפים' },
  { id: 8, severity: 'warning', scope: 'recipe', message: 'החוד קבור עמוק, נדרש יסוד עמוק' },
  { id: 9, severity: 'error', scope: 'system', message: 'הגאומטריה ברמה הריאליסטית שונה מהרמה הערומה' },
  { id: 10, severity: 'error', scope: 'recipe', message: 'המסלול מתעקל חד מדי לעובי החתך' },
  { id: 11, severity: 'error', scope: 'recipe', message: 'המסלול פוגש את עצמו בהצטלבות' },
  { id: 12, severity: 'warning', scope: 'recipe', message: 'אין גובה מלא מתחת להצטלבות' },
  { id: 13, severity: 'error', scope: 'recipe', message: 'רגלי הקשת לא נוגעות בקרקע' },
  { id: 14, severity: 'error', scope: 'recipe', message: 'הקשר מתפרק לכמה לולאות נפרדות' },
  // Parametric surfaces (GENERATORS.md 4.1, DECISIONS.md 138).
  { id: 15, severity: 'error', scope: 'recipe', message: 'משטח נבנה רק כקליפה' },
  { id: 16, severity: 'error', scope: 'recipe', message: 'מידות המשטח סותרות זו את זו' },
  { id: 17, severity: 'error', scope: 'recipe', message: 'הדופן עבה מהעיקול של המשטח, והקליפה מתקפלת על עצמה' },
  { id: 18, severity: 'warning', scope: 'recipe', message: 'הקליפה דקה מאוד ביחס למפתח שלה' },
  { id: 19, severity: 'warning', scope: 'recipe', message: 'אין גובה לעמידה מתחת לקליפה' },
  // Tiling (GENERATORS.md 4.2, DECISIONS.md 146).
  { id: 20, severity: 'error', scope: 'recipe', message: 'ריצוף נבנה מגופים מלאים' },
  { id: 21, severity: 'error', scope: 'recipe', message: 'האלמנטים נוגעים זה בזה או נעלמים' },
  { id: 22, severity: 'warning', scope: 'recipe', message: 'אלמנט דק וגבוה מדי לעמוד לבד' },
  { id: 23, severity: 'warning', scope: 'recipe', message: 'אין מעבר בין האלמנטים' },
  { id: 24, severity: 'warning', scope: 'recipe', message: 'יותר מ-1,500 אלמנטים: המודל כבד' },
]

export interface RuleIssue {
  rule: number
  severity: Severity
  message: string
  /** Recipe field the issue points at, for highlighting in manual edit. */
  path: string
  /** Measured value, rounded for display and for the repair message to Claude. */
  value: number
  /** The condition that must hold, in plain math. */
  required: string
}

/** Tolerance for "is an integer" in rule 1. 0.3333 × 3 = 0.9999 must pass. */
export const INTEGER_TOLERANCE = 1e-3
/** Minimum clear height for an enterable space, in meters (AI_PROMPT.md). */
export const MIN_CLEAR_HEIGHT = 2.4
/** Maximum cusp burial before a warning, in meters. */
export const MAX_CUSP_BURIAL = 3

/** Floating-point slack for boundary comparisons: 3 × 2.4 is 7.1999…, and R = 7.2 must still fail rule 2. */
const EPS = 1e-9

const CLOSED_PATHS = new Set<string>(CLOSED_PATH_TYPES)
const RING_PATHS = new Set<string>(RING_PATH_TYPES)

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits

/**
 * Rotational symmetry order of the section: the number of in-plane rotations that map it onto itself.
 * Infinity for an undistorted circle. A non-unit aspect drops the order to 2 at most, and to 1 for odd counts.
 */
export function symmetryOrder(s: SweepSection): number {
  const base = (() => {
    switch (s.curve) {
      case 'deltoid':
        return 3
      case 'hypocycloid':
        return s.cusps ?? 3
      case 'polygon':
        return s.sides ?? 3
      case 'circle':
        return Infinity
      case 'superellipse':
        return 4
    }
  })()
  if (s.aspect === 1) return base
  if (!Number.isFinite(base)) return 2
  return base % 2 === 0 ? 2 : 1
}

/** Largest distance from the section center to the section curve, before scale along path. */
export function outerRadius(s: SweepSection): number {
  switch (s.curve) {
    case 'deltoid':
      return 3 * s.a
    case 'hypocycloid':
      return (s.cusps ?? 3) * s.a
    case 'polygon':
    case 'circle':
      return s.a
    case 'superellipse':
      // Point at 45 degrees lies at a·2^(1/2 − 1/p): outside the unit circle for p > 2.
      return s.a * Math.max(1, 2 ** (0.5 - 1 / (s.exponent ?? 2)))
  }
}

/** Ramanujan's approximation; exact for a circle. */
function ellipsePerimeter(r1: number, r2: number): number {
  const h = ((r1 - r2) / (r1 + r2)) ** 2
  return Math.PI * (r1 + r2) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

function issue(rule: number, path: string, value: number, required: string): RuleIssue {
  const def = RULES.find((r) => r.id === rule)!
  return { rule, severity: def.severity, message: def.message, path, value: round(value), required }
}

const P = 'generator.params'

function sweepIssues(recipe: Recipe, g: SweepParams): RuleIssue[] {
  const out: RuleIssue[] = []
  const { section, path, twist } = g
  const bare = recipe.bare
  const h0 = bare.section_center_height
  const maxScale = Math.max(1, g.scale_along_path)
  const rOut = outerRadius(section) * maxScale
  const closed = CLOSED_PATHS.has(path.type)

  // 1. Closed path: turns_per_lap × symmetry order must be an integer.
  const order = symmetryOrder(section)
  if (closed && Number.isFinite(order)) {
    const k = twist.turns_per_lap * order
    if (Math.abs(k - Math.round(k)) > INTEGER_TOLERANCE) {
      out.push(issue(1, `${P}.twist.turns_per_lap`, k, `turns_per_lap × ${order} is an integer`))
    }
  }

  // 2. The path radius must exceed the section's outer radius. On a torus knot the strand passes R − r from
  // the axis, so that is the radius that must clear it.
  if (RING_PATHS.has(path.type) || path.type === 'helix') {
    const R = path.type === 'ellipse' ? Math.min(path.R!, path.R2!) : path.R!
    if (!(R > rOut + EPS)) out.push(issue(2, `${P}.path.R`, R, `R > ${round(rOut)}`))
  }
  if (path.type === 'torus_knot' && !(path.R! - path.r! > rOut + EPS)) {
    out.push(issue(2, `${P}.path.R`, path.R! - path.r!, `R − r > ${round(rOut)}`))
  }

  // 3–6. Shell. The inner wall is the section scaled by k = (a − t) / a (GENERATORS.md 1.5).
  if (bare.mode === 'shell' && bare.shell) {
    const t = bare.shell.thickness
    const a = section.a
    if (!(t < a - EPS)) {
      out.push(issue(3, 'bare.shell.thickness', t, `thickness < ${round(a)}`))
    } else {
      if (t > 0.4 * a + EPS) out.push(issue(4, 'bare.shell.thickness', t, `thickness ≤ ${round(0.4 * a)}`))

      // 5–6 use the deltoid's closed form: with the cusp down the inner top sits at 1.5(a − t).
      const floor = bare.floor ?? { level: 0, type: 'chord' as const }
      // Paths whose section tilts (lemniscate, knot, arch) have no floor plane, so no floor rule either.
      const flat = !CURVE_PATHS.has(path.type) || path.type === 'wave'
      if (section.curve === 'deltoid' && floor.type === 'chord' && flat) {
        const half = 1.5 * (a - t)
        const level = floor.level
        const gap = h0 - level
        if (!(gap < half - EPS)) {
          out.push(issue(5, 'bare.floor.level', gap, `section_center_height − level < ${round(half)}`))
        }
        const clear = h0 + half - level
        if (!(clear >= MIN_CLEAR_HEIGHT - EPS)) {
          out.push(issue(6, 'bare.floor.level', clear, `clear height ≥ ${MIN_CLEAR_HEIGHT}`))
        }
      }
    }
  }

  // 7. Passages must not overlap. Passages open a ring to its courtyard, so they exist on rings only.
  const passages = bare.openings?.passages
  if (passages && passages.count > 0 && RING_PATHS.has(path.type)) {
    const perimeter = path.type === 'ellipse' ? ellipsePerimeter(path.R!, path.R2!) : 2 * Math.PI * path.R!
    const used = passages.count * passages.width
    if (!(used < 0.8 * perimeter - EPS)) {
      out.push(issue(7, 'bare.openings.passages.count', used, `count × width < ${round(0.8 * perimeter)}`))
    }
  }

  // 8. Cusp burial depth. The new paths rise and fall, so their depth is measured on the surface itself.
  if (CURVE_PATHS.has(path.type)) {
    out.push(...curvePathIssues(g, h0, rOut))
  } else {
    const burial = rOut - h0
    if (burial > MAX_CUSP_BURIAL + EPS) {
      out.push(issue(8, 'bare.section_center_height', burial, `outer radius − section_center_height ≤ ${MAX_CUSP_BURIAL}`))
    }
  }

  return out
}

/** A shell thinner than its span over this ratio is a warning (rule 18). Thin concrete shells reach about 1:500. */
export const MAX_SPAN_RATIO = 600

/** Rules for a parametric surface (RECIPE_SCHEMA.md, rules 15–19). */
function surfaceIssues(recipe: Recipe, p: SurfaceParams): RuleIssue[] {
  const out: RuleIssue[] = []
  const bare = recipe.bare
  // 15. A surface has no inside to fill: it is built as a shell of a given thickness.
  if (bare.mode !== 'shell' || !bare.shell) {
    out.push(issue(15, 'bare.mode', 0, 'mode = "shell"'))
    return out
  }
  const t = bare.shell.thickness
  // 16. Dimensions that cannot make the family.
  if (p.family === 'hyperboloid' && !(p.end_radius! > p.waist_radius! + 0.05 - EPS)) {
    out.push(issue(16, `${P}.end_radius`, p.end_radius!, `end_radius > waist_radius + 0.05 = ${round(p.waist_radius! + 0.05)}`))
  }
  if (p.family === 'klein_bottle' && !(p.radius! > KLEIN_REACH * p.tube! + t + EPS)) {
    out.push(issue(16, `${P}.radius`, p.radius!, `radius > ${KLEIN_REACH} × tube + thickness = ${round(KLEIN_REACH * p.tube! + t)}`))
  }
  if (out.length) return out
  // 17. The offset folds over itself where the surface bends tighter than half the thickness.
  const rMin = surfaceMinCurvature(family(p))
  if (!(t / 2 < rMin - EPS)) out.push(issue(17, 'bare.shell.thickness', t, `thickness < 2 × smallest radius of curvature = ${round(2 * rMin)}`))
  // 18. A shell much thinner than its span cannot carry itself.
  const span = planSpan(p)
  if (span / t > MAX_SPAN_RATIO + EPS) out.push(issue(18, 'bare.shell.thickness', t, `thickness ≥ span / ${MAX_SPAN_RATIO} = ${round(span / MAX_SPAN_RATIO)}`))
  // 19. Where people walk under the shell, they must be able to stand.
  const clear = clearance(p, t, bare.section_center_height)
  if (clear && !(clear.min >= MIN_CLEAR_HEIGHT - EPS)) out.push(issue(19, p.family === 'helicoid' ? `${P}.pitch` : `${P}.rise`, clear.min, `clear height ≥ ${MIN_CLEAR_HEIGHT}`))
  return out
}

/**
 * Rules of the paths written as curves (DECISIONS.md 130–134). Rule 14 first: a knot that falls apart into
 * separate loops has no single curve to measure.
 */
function curvePathIssues(g: SweepParams, h0: number, rOut: number): RuleIssue[] {
  const out: RuleIssue[] = []
  const path = g.path
  if (path.type === 'torus_knot' && gcd(path.p!, path.q!) !== 1) {
    out.push(issue(14, `${P}.path.q`, gcd(path.p!, path.q!), 'gcd(p, q) = 1'))
    return out
  }

  // 10. The path must not bend tighter than the section reaches on the inside of the bend.
  const bend = sectionExtent(g, bendAxis(path), rOut)
  const rho = minCurvatureRadius(pathFrames(path, h0, 720))
  if (!(rho > bend + EPS)) {
    const field = path.type === 'wave' ? 'path.wavelength' : path.type === 'arch' ? 'path.height' : 'path.R'
    out.push(issue(10, `${P}.${field}`, rho, `smallest radius of curvature > ${round(bend)}`))
  }

  // 11–12. Where the path crosses itself, one branch passes over the other with room to stand under it.
  const gap = crossingClearance(g, h0, rOut)
  if (gap !== null) {
    const field = path.type === 'lemniscate' ? 'path.cross_height' : 'path.r'
    if (!(gap > EPS)) out.push(issue(11, `${P}.${field}`, gap, 'clearance between the branches > 0'))
    else if (gap < MIN_CLEAR_HEIGHT - EPS) out.push(issue(12, `${P}.${field}`, gap, `clearance between the branches ≥ ${MIN_CLEAR_HEIGHT}`))
  }

  // 13 and 8: the arch stands on its feet; nothing goes deeper than a foundation.
  const low = lowestPoints(g, h0)
  if (path.type === 'arch' && low.ends > 1e-6) out.push(issue(13, 'bare.section_center_height', low.ends, 'lowest point of the feet ≤ 0'))
  const burial = -low.surface
  if (burial > MAX_CUSP_BURIAL + EPS) out.push(issue(8, 'bare.section_center_height', burial, `depth below the ground ≤ ${MAX_CUSP_BURIAL}`))
  return out
}

/** A walkable passage between walls or columns, m (rule 23). */
export const MIN_PASSAGE = 0.9
/** An element taller than this many times its smallest plan dimension is a warning (rule 22). */
export const MAX_SLENDERNESS = 30
/** More elements than this is a warning (rule 24). */
export const MAX_ELEMENTS = 1500

/** Rules for a tiling (RECIPE_SCHEMA.md, rules 20–24). */
function tilingIssues(recipe: Recipe, p: TilingParams): RuleIssue[] {
  const out: RuleIssue[] = []
  // 20. Every element is a solid prism.
  if (recipe.bare.mode !== 'solid') return [issue(20, 'bare.mode', 0, 'mode = "solid"')]
  // 21. Elements that touch share faces, and the closed solid breaks; elements that vanish leave a hole in the rule.
  const range = COUNT_RANGE[p.pattern]
  if (range && (p.count! < range[0] || p.count! > range[1])) out.push(issue(21, `${P}.count`, p.count!, `${range[0]} ≤ count ≤ ${range[1]}`))
  if (p.pattern === 'riemann_walls' && !(p.thickness! < p.length! / p.count! - EPS)) out.push(issue(21, `${P}.thickness`, p.thickness!, `thickness < length / count = ${round(p.length! / p.count!)}`))
  if (p.pattern === 'ulam_grid' && !(p.fill! < 1 - EPS)) out.push(issue(21, `${P}.fill`, p.fill!, 'fill < 1'))
  if (p.pattern === 'fibonacci_blocks' && !(p.joint! < p.unit! - EPS)) out.push(issue(21, `${P}.joint`, p.joint!, `joint < unit = ${round(p.unit!)}`))
  if (out.length) return out
  const L = layout(p)
  if ((p.pattern === 'voronoi_cells' || p.pattern === 'koch_snowflake') && L.facts.vanished! > 0) out.push(issue(21, `${P}.joint`, p.joint!, `every element keeps an area after the joint (${L.facts.vanished} vanished)`))
  if (out.length) return out
  // 22. Slender elements: height over the smallest side of the plan.
  let worst = 0
  for (const e of L.elements) {
    let minSide = Infinity
    for (let i = 0; i < e.poly.length; i++) {
      const [ax, az] = e.poly[i]!, [bx, bz] = e.poly[(i + 1) % e.poly.length]!
      minSide = Math.min(minSide, Math.hypot(bx - ax, bz - az))
    }
    // A sliver cell has a short side but a fat body: measure by area over the longest chord instead.
    const thick = e.poly.length > 4 ? Math.sqrt(Math.abs(polyArea(e.poly))) : minSide
    worst = Math.max(worst, e.height / thick)
  }
  if (worst > MAX_SLENDERNESS + EPS) out.push(issue(22, p.pattern === 'riemann_walls' ? `${P}.thickness` : `${P}.height`, round(worst, 1), `height ≤ ${MAX_SLENDERNESS} × smallest plan side`))
  // 23. Walls and columns are walked between.
  if ((p.pattern === 'riemann_walls' || p.pattern === 'ulam_grid') && L.facts.gap! < MIN_PASSAGE - EPS) {
    out.push(issue(23, p.pattern === 'riemann_walls' ? `${P}.thickness` : `${P}.fill`, round(L.facts.gap!), `passage ≥ ${MIN_PASSAGE}`))
  }
  // 24. A heavy model.
  if (L.elements.length > MAX_ELEMENTS) out.push(issue(24, p.pattern === 'random_walk' ? `${P}.steps` : `${P}.side`, L.elements.length, `elements ≤ ${MAX_ELEMENTS}`))
  return out
}

/** Runs every recipe-scope rule. Assumes the recipe already passed the schema. */
export function checkRules(recipe: Recipe): RuleIssue[] {
  if (recipe.generator.type === 'tiling') return tilingIssues(recipe, recipe.generator.params)
  if (recipe.generator.type === 'parametric_surface') return surfaceIssues(recipe, recipe.generator.params)
  if (recipe.generator.type !== 'sweep') return []
  return sweepIssues(recipe, recipe.generator.params)
}

export type ValidationResult =
  | { stage: 'schema'; ok: false; schemaErrors: SchemaError[]; issues: [] }
  | { stage: 'rules'; ok: boolean; recipe: Recipe; schemaErrors: []; issues: RuleIssue[] }

/**
 * Full check in the order of the repair flow (RECIPE_SCHEMA.md "זרימת התיקון"):
 * schema first, then semantic rules. ok is false when anything blocks the build.
 */
export function validateRecipe(input: unknown): ValidationResult {
  const parsed = parseRecipe(input)
  if (!parsed.ok) return { stage: 'schema', ok: false, schemaErrors: parsed.errors, issues: [] }
  const issues = checkRules(parsed.recipe)
  return {
    stage: 'rules',
    ok: !issues.some((i) => i.severity === 'error'),
    recipe: parsed.recipe,
    schemaErrors: [],
    issues,
  }
}

/** Repair message for Claude, in the exact format of AI_PROMPT.md section 4. */
export function repairMessage(schemaErrors: SchemaError[], issues: RuleIssue[]): string {
  const lines = [
    ...schemaErrors.map((e) => `- ${e.path || '(root)'}: ${e.message}`),
    ...issues
      .filter((i) => i.severity === 'error')
      .map((i) => `- ${i.rule}: ${i.message} (current value ${i.value}, required ${i.required})`),
  ]
  return [
    'The recipe failed validation. Fix only these problems and answer again with the full recipe:',
    ...lines,
    'Keep every other field unchanged.',
  ].join('\n')
}
