/**
 * The project's document (DECISIONS.md 92): one concept told from the end to the beginning, from the focused
 * image to the detail. The flyer comes first (one image, one sentence, a few numbers), then the forms in which
 * the knowledge was distilled, from a name to a recipe, then the way back through the six steps, and last the
 * general method that every concept follows. Pure: the screen, the PDF and the Word file all read this.
 */
import type { Reading } from '../data/library'
import { visualPrompt } from '../prompt/visualPrompt'
import type { BuiltRecipe } from '../recipe/schema'
import { siteWords } from '../scene/sun'

/** A recipe the engine builds: a sweep or a parametric surface. */
type Built = BuiltRecipe

export type DossierStage = 'concept' | 'recipe' | 'bare' | 'realistic' | 'render' | 'print'

/** An image kept on a step of the collection, already loaded where the caller can reach it. */
export interface DossierImage {
  id: string
  stage: DossierStage
  /** A frozen view, an image made from a prompt, or a version's thumbnail. */
  source: 'still' | 'prompt-image' | 'version'
  src: string
  caption: string
  created_at: string
}

export interface DossierInput {
  recipe: Built
  projectTitle: string
  versions: { number: number; created_at: string; note: string | null }[]
  images: DossierImage[]
  reading: Reading | null
  post: { short: string; body: string } | null
  /** The newest saved visual prompt; without one, the prompt is computed from the recipe. */
  prompt: { distill: string; body: string } | null
  metrics: { label: string; value: string }[]
  figureGround: { label: string; value: string; why: string }[]
  /** The print file's line ("1:324, 150 מ"מ…"), when there is one. */
  print: string | null
  hasClip: boolean
  /** The image the owner chose for the cover, by id. */
  coverId?: string | null
}

export interface Rung {
  /** The form of the knowledge, e.g. "פתגם". */
  form: string
  /** What this form is for, in one sentence. */
  why: string
  /** Paragraphs, or label–value pairs. */
  text?: string[]
  pairs?: { label: string; value: string; note?: string }[]
}

export interface JourneyStep {
  num: string
  stage: DossierStage
  label: string
  /** The question this step answers, between mathematics and architecture. */
  question: string
  /** What was decided on this step, for this concept. */
  decided: string[]
  text: string[]
  images: DossierImage[]
}

export interface MethodSection {
  title: string
  text?: string[]
  pairs?: { label: string; value: string }[]
}

export interface Dossier {
  title: string
  concept: string
  /** The concept's Latin name, for file names: Chrome drops a Hebrew download name. */
  latin: string
  eyebrow: string
  cover: {
    image: DossierImage | null
    maxim: string
    synthesis: string | null
    short: string | null
    facts: { label: string; value: string; sub?: string }[]
    place: string | null
  }
  /** From the tightest form to the widest. */
  ladder: Rung[]
  /** From the end (print) to the beginning (concept). */
  journey: JourneyStep[]
  method: MethodSection[]
  colophon: string[]
}

const STEP_NAMES: Record<DossierStage, { label: string; question: string }> = {
  concept: { label: 'מושג', question: 'מה הרעיון המתמטי אומר, לפני שיש לו צורה?' },
  recipe: { label: 'מתכון', question: 'איזו גאומטריה נושאת את הרעיון, ובאילו מספרים?' },
  bare: { label: 'ערום', question: 'האם הצורה עובדת כמבנה: קנה מידה, עובי, רצפה, גובה?' },
  realistic: { label: 'ריאליסטי', question: 'איך היא נראית במקום, בחומר ובאור של שעה מסוימת?' },
  render: { label: 'הדמיה', question: 'איזה מבט אחד מספר את המושג הכי טוב?' },
  print: { label: 'הדפסה', question: 'האם הצורה מחזיקה כגוף שאפשר להחזיק ביד?' },
}
const ORDER: DossierStage[] = ['concept', 'recipe', 'bare', 'realistic', 'render', 'print']

const pad = (n: number) => String(n).padStart(2, '0')
const firstSentence = (s: string) => s.split(/(?<=[.!?])\s/)[0]!.trim()
const dateHe = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })

/** The cover image: a render first, then an image from a prompt, then a realistic view, a bare view, a thumbnail. */
export function coverImage(images: DossierImage[], coverId?: string | null): DossierImage | null {
  const chosen = coverId ? images.find((i) => i.id === coverId) : undefined
  if (chosen) return chosen
  const rank = (i: DossierImage) => (i.stage === 'render' && i.source === 'still' ? 0 : i.source === 'prompt-image' ? 1 : i.stage === 'realistic' ? 2 : i.stage === 'bare' ? 3 : 4)
  return [...images].sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at))[0] ?? null
}

/** Up to n images of a step, newest first, so the step shows where the work ended. */
const imagesOf = (images: DossierImage[], stage: DossierStage, n = 2) =>
  images
    .filter((i) => i.stage === stage)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n)

function pick(metrics: DossierInput['metrics'], ...labels: string[]) {
  return metrics.filter((m) => labels.some((l) => m.label.startsWith(l)))
}

export function buildDossier(input: DossierInput): Dossier {
  const r = input.recipe
  const n = r.narrative
  const vp = visualPrompt(r)
  const part = (slot: string) => vp.parts.find((p) => p.slot === slot)?.text ?? null
  const place = siteWords(r.realistic.site)
  const maxim = n.maxim?.trim() || firstSentence(n.insight)
  const concept = `${r.concept.name_he} · ${r.concept.name}`

  const cover: Dossier['cover'] = {
    image: coverImage(input.images, input.coverId),
    maxim,
    synthesis: input.reading?.synthesis ?? null,
    short: input.post?.short ?? null,
    facts: [...pick(input.metrics, 'קוטר חיצוני', 'גובה חופשי', 'מספר קצוות', 'משקל משוער').slice(0, 4), ...(place ? [placeFact(place)] : [])],
    place,
  }

  // ---------- the forms of distillation, tightest first ----------
  const ladder: Rung[] = []
  ladder.push({ form: 'שם', why: 'מילה אחת או שתיים שמחזיקות את כל השאר.', text: [`${n.name_he}`, `${r.concept.name_he} (${r.concept.name})`] })
  ladder.push({ form: 'פתגם', why: 'משפט אחד שהופך את המושג להתנסות.', text: [maxim] })
  if (input.reading) ladder.push({ form: 'סינתזה', why: 'המשפט שמחבר בין המתמטיקה לאדריכלות.', text: [input.reading.synthesis] })
  if (input.post) ladder.push({ form: 'פוסט קצר', why: 'הגרסה שעוברת ברשת בשורה אחת.', text: [input.post.short] })
  ladder.push({ form: 'תובנה', why: 'מה הצורה עושה במרחב, לא איך היא נראית.', text: [n.insight] })
  if (input.post) ladder.push({ form: 'פוסט', why: 'המושג כמבנה שעומד במקום ובשעה מסוימים, לקורא שלא היה בסטודיו.', text: input.post.body.split(/\n\s*\n/) })
  if (input.reading)
    ladder.push({
      form: 'פרשנות',
      why: 'שלוש קריאות: המושג הלוגי, המושג המרחבי, ומה שקורה בין הבנוי לסביבה.',
      pairs: [
        { label: 'המושג הלוגי', value: input.reading.logic },
        { label: 'המושג המרחבי', value: input.reading.space },
        { label: 'פוזיטיב ונגטיב', value: input.reading.figure_ground },
      ],
    })
  if (input.figureGround.length)
    ladder.push({ form: 'מספרים', why: 'הפוזיטיב והנגטיב נמדדים על המודל, כך שהפרשנות נשענת על עובדות.', pairs: input.figureGround.map((f) => ({ label: f.label, value: f.value, note: f.why })) })
  ladder.push({
    form: 'פרומפט',
    why: 'אותם ערכים שעל המסך, כמשפט שמייצר תמונה. התמונה והמודל מספרים אותו סיפור.',
    text: [input.prompt?.distill ?? vp.distill, input.prompt?.body ?? vp.prompt],
  })
  if (n.fit_note) ladder.push({ form: 'מה אבד בתרגום', why: 'מה שהמחולל לא יכול לבטא, כתוב בגלוי.', text: [n.fit_note] })

  // ---------- the six steps, from the end back to the beginning ----------
  const decided: Record<DossierStage, string[]> = {
    concept: [`המושג: ${r.concept.name_he} (${r.concept.name})`, ...(r.concept.use ? [`השימוש: ${r.concept.use}`] : []), ...(r.concept.context_hint ? [`ההקשר: ${r.concept.context_hint}`] : [])],
    recipe: [
      part('shape') ?? '',
      input.versions.length === 1 ? 'גרסה אחת' : `${input.versions.length} גרסאות, מ-${dateHe(input.versions[0]!.created_at)} עד ${dateHe(input.versions.at(-1)!.created_at)}`,
    ].filter(Boolean),
    bare: pick(input.metrics, 'קוטר חיצוני', 'קוטר החצר', 'גובה חופשי', 'רוחב רצפה', 'מספר קצוות', 'אורך הקצה', 'פתחים').map((m) => `${m.label}: ${m.value}`),
    realistic: [part('material'), part('context'), part('light'), part('season'), part('weather')].filter((s): s is string => !!s),
    render: [part('camera'), part('people')].filter((s): s is string => !!s),
    print: input.print ? [input.print] : [],
  }
  const text: Record<DossierStage, string[]> = {
    concept: [n.insight, ...(input.reading ? [input.reading.logic] : [])],
    recipe: [
      'Claude מתרגם את המושג למתכון: חתך, מסלול, סיבוב וקנה מידה. המתכון נבדק מול החוזה ומול כללי ההיגיון לפני שנבנה ממנו דבר. המנוע, לא המודל של השפה, בונה את הגאומטריה.',
      ...(n.fit_note ? [`מה אבד בתרגום: ${n.fit_note}`] : []),
    ],
    bare: ['הגאומטריה לבדה, בגוון אחד. כאן נקבעים קנה המידה, העובי, הרצפה והפתחים, וכל מדד נבדק מול חישוב אנליטי.', ...(input.reading ? [input.reading.space] : [])],
    realistic: ['אותה צורה בדיוק, בלי שינוי בגאומטריה: חומר, שמש לפי תאריך ומיקום, עונה, מזג אוויר והקשר.', ...(input.reading ? [input.reading.figure_ground] : [])],
    render: [
      'מבט אחד נבחר ונעשה מלא: צל ברזולוציה גבוהה, חסימת אור בפינות, וגודל להדפסה. תמונות שנוצרו מהפרומפט נשמרות לצדו.',
      ...(input.hasClip ? ['סרטון של ארבע שניות עובר מהערום לריאליסטי ומסתובב רבע סיבוב סביב המבנה.'] : []),
    ],
    print: input.print
      ? ['ההדפסה היא הבדיקה האמיתית: גוף סגור, עובי דופן של 2 מ"מ לפחות, ומידות שנכנסות לשולחן המדפסת.']
      : ['עוד לא הוכן קובץ הדפסה. ההדפסה היא הבדיקה האמיתית: גוף סגור, עובי דופן וקנה מידה.'],
  }
  const journey: JourneyStep[] = [...ORDER].reverse().map((stage) => ({
    num: pad(ORDER.indexOf(stage) + 1),
    stage,
    label: STEP_NAMES[stage].label,
    question: STEP_NAMES[stage].question,
    decided: decided[stage],
    text: text[stage],
    images: stage === 'recipe' ? recipeImages(input.images) : imagesOf(input.images, stage),
  }))

  return {
    title: n.name_he,
    concept,
    latin: r.concept.name,
    eyebrow: ['מתמטיקה הפוכה', r.concept.use, place?.replace(/^ב-?/, '')].filter(Boolean).join(' · '),
    cover,
    ladder,
    journey,
    method: METHOD,
    colophon: [
      `${input.projectTitle}. ${input.versions.length === 1 ? 'גרסה אחת' : `${input.versions.length} גרסאות`}${input.versions.length ? `, הגרסה האחרונה מ-${dateHe(input.versions.at(-1)!.created_at)}` : ''}.`,
      'נוצר ב"יוצר: מתמטיקה", https://math-creator.vercel.app. כל תמונה במסמך שייכת לגרסה ולנקודת מבט שאפשר לפתוח מחדש.',
    ],
  }
}

/** "באשדוד (Ashdod, Israel)" → אשדוד, with the full Latin name under it, so it can be searched. */
function placeFact(place: string): { label: string; value: string; sub?: string } {
  const m = place.match(/^ב-?(.*?)\s*\((.+)\)$/)
  return m ? { label: 'מקום', value: m[1]!, sub: m[2]! } : { label: 'מקום', value: place.replace(/^ב-?/, '') }
}

/** The first and the last version: where the recipe started and where it ended. */
function recipeImages(images: DossierImage[]): DossierImage[] {
  const v = images.filter((i) => i.stage === 'recipe').sort((a, b) => a.created_at.localeCompare(b.created_at))
  return v.length > 1 ? [v[0]!, v.at(-1)!] : v
}

/** The general method: the same for every concept. Fixed text, from DNA.md and PRODUCT.md. */
export const METHOD: MethodSection[] = [
  {
    title: 'מתמטיקה הפוכה',
    text: ['לא מסבירים מתמטיקה בעזרת מבנים, אלא בונים מבנים שהמתמטיקה היא הלוגיקה שלהם. המבנה אינו מטאפורה של המושג, אלא המושג עצמו בחומר.', 'מושג אחד הוא ניסוי. שלושה מושגים מודפסים הם שיטה.'],
  },
  {
    title: 'שש תחנות, מהרעיון לביצוע',
    pairs: ORDER.map((s, i) => ({ label: `${pad(i + 1)} ${STEP_NAMES[s].label}`, value: STEP_NAMES[s].question })),
  },
  {
    title: 'התרגום בין העולמות',
    pairs: [
      { label: 'חתך', value: 'הופך לחלל: הצורה שבה עומדים בפנים.' },
      { label: 'מסלול', value: 'הופך לתנועה: הדרך שבה עוברים במבנה.' },
      { label: 'סיבוב', value: 'הופך לרציפות: קו אחד שמחבר פנים וחוץ, ואור שמשתנה לאורך ההקפה.' },
      { label: 'קצה', value: 'הופך לגבול: המקום שבו הבנוי והסביבה נפגשים.' },
      { label: 'מדד', value: 'הופך להיתכנות: גובה חופשי, עובי, משקל ורצפה שאפשר ללכת עליה.' },
    ],
  },
  {
    title: 'צורות הזיקוק',
    text: [
      'אותו ידע נכתב בכמה גדלים: שם, פתגם, סינתזה, פוסט, תובנה, פרשנות, מספרים, פרומפט ומתכון. כל צורה משרתת קורא אחר ורגע אחר: מי שעובר ליד הפלייר, מי שקורא פוסט, ומי שרוצה לבנות.',
      'המסמך מסודר מהסוף להתחלה: קודם התמונה והמשפט, ואחר כך הדרך שהובילה אליהם, למי שמתעניין.',
    ],
  },
  {
    title: 'עקרונות',
    pairs: [
      { label: 'מודל הוא קוד, לא תמונה', value: 'Claude כותב מתכון, והמנוע לבדו בונה את הגאומטריה.' },
      { label: 'קודם בודקים, אחר כך בונים', value: 'כל מדד נבדק מול חישוב אנליטי, בסטייה של עד חצי אחוז.' },
      { label: 'הגאומטריה נקבעת פעם אחת', value: 'הרמה הריאליסטית מלבישה את הצורה ולא משנה אותה. מה שנמדד הוא מה שמוצג.' },
      { label: 'פורמט הוא החלטה תכנונית', value: 'לכל ייצוא כתוב למה הוא מיועד, מה הוא שומר ומה הוא מאבד.' },
      { label: 'ההדפסה היא הבדיקה האמיתית', value: 'גוף סגור, עובי דופן, קנה מידה וכיוון הדפסה.' },
    ],
  },
]

/**
 * A file name that survives every browser and mail client: the concept's Latin name and the date. Chrome replaces
 * a Hebrew download name with "download", so the Hebrew name stays inside the document.
 */
export function dossierFileName(d: Dossier, ext: 'pdf' | 'docx', at = new Date()): string {
  const safe =
    d.latin
      .normalize('NFKD')
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'concept'
  return `${safe}-dossier-${at.toISOString().slice(0, 10)}.${ext}`
}
