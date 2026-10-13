/**
 * Semantic rules from docs/RECIPE_SCHEMA.md ("כללים סמנטיים").
 * The schema checks structure and ranges. These rules check that a recipe builds a valid structure.
 * An error blocks the build. A warning builds and marks the related metric in orange.
 * Interpretations where the docs leave room are recorded in docs/DECISIONS.md.
 */
import type { Recipe, SweepParams, SweepSection } from './schema'
import { parseRecipe, type SchemaError } from './schema'

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

const CLOSED_PATHS = new Set(['circle', 'ellipse'])

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

  // 2. The path radius must exceed the section's outer radius.
  if (path.type !== 'line') {
    const R = path.type === 'ellipse' ? Math.min(path.R!, path.R2!) : path.R!
    if (!(R > rOut + EPS)) out.push(issue(2, `${P}.path.R`, R, `R > ${round(rOut)}`))
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
      if (section.curve === 'deltoid' && floor.type === 'chord') {
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

  // 7. Passages must not overlap.
  const passages = bare.openings?.passages
  if (passages && passages.count > 0 && closed) {
    const perimeter = path.type === 'ellipse' ? ellipsePerimeter(path.R!, path.R2!) : 2 * Math.PI * path.R!
    const used = passages.count * passages.width
    if (!(used < 0.8 * perimeter - EPS)) {
      out.push(issue(7, 'bare.openings.passages.count', used, `count × width < ${round(0.8 * perimeter)}`))
    }
  }

  // 8. Cusp burial depth.
  const burial = rOut - h0
  if (burial > MAX_CUSP_BURIAL + EPS) {
    out.push(issue(8, 'bare.section_center_height', burial, `outer radius − section_center_height ≤ ${MAX_CUSP_BURIAL}`))
  }

  return out
}

/** Runs every recipe-scope rule. Assumes the recipe already passed the schema. */
export function checkRules(recipe: Recipe): RuleIssue[] {
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
