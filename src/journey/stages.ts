/**
 * The work path (DECISIONS.md 103, which replaces 97): nine steps, from learning about a mathematical idea to
 * the article that presents the built model. Each step says what is done, what is learned, what it yields and
 * what comes next. Its state is computed from what the project holds, never stored, so older projects show what
 * they already have. Pure: the workspace, the home page and the article read it, and tests check it.
 *
 * The data keeps its old keys (idea, context, concept, ...), so projects made on the earlier path keep their
 * text; a field names its place in the journey by a dotted path.
 */
import type { Reading } from '../data/library'
import { modelById } from '../learn/atlas'
import type { BuiltRecipe } from '../recipe/schema'

/** A recipe the engine builds: a sweep or a parametric surface. */
export type Built = BuiltRecipe

/** What the owner writes on the steps. Every field is optional: a project can start from anything. */
export interface Journey {
  discover?: { saved?: string[]; learned?: string }
  idea?: { title?: string; idea?: string; intent?: string; question?: string }
  context?: { place?: string; use?: string; audience?: string; inspiration?: string }
  concept?: { model?: string; math?: string; why?: string; statement?: string }
  prompt?: { note?: string }
  illustration?: { expresses?: string; translates?: string }
  form?: { decisions?: string }
  environment?: { decisions?: string }
  physical?: { scale?: string; material?: string; notes?: string }
  production?: { video?: string }
  documentation?: { result?: string; lessons?: string }
  exhibition?: { title?: string; subtitle?: string; author?: string; venue?: string }
}

export interface WorkImage {
  id: string
  src?: string
  caption: string
  created_at: string
}

export interface WorkPrompt {
  id: string
  distill: string
  body: string
  created_at: string
  images: WorkImage[]
}

/** Everything the project holds, as the path sees it. */
export interface WorkState {
  project: { id: string; title_he: string; concept: string; created_at: string }
  journey: Journey
  /** The newest version's recipe, when there is one. */
  recipe: Built | null
  versions: { id: string; number: number; created_at: string; note: string | null }[]
  reading: Reading | null
  post: { short: string; body: string } | null
  /** Newest first. */
  prompts: WorkPrompt[]
  references: WorkImage[]
  stills: { bare: WorkImage[]; realistic: WorkImage[]; render: WorkImage[] }
  print: string | null
  hasClip: boolean
  photos: WorkImage[]
  metrics: { label: string; value: string }[]
}

export type StageId = 'discover' | 'concept' | 'context' | 'inspiration' | 'model' | 'environment' | 'illustration' | 'production' | 'exhibition'

/** Step ids of the earlier path, so old links still land on the right step. */
export const OLD_STAGE: Record<string, StageId> = {
  idea: 'context',
  prompt: 'illustration',
  form: 'model',
  physical: 'production',
  documentation: 'exhibition',
}

export interface Field {
  /** Where the value lives in the journey, e.g. "idea.intent". */
  path: string
  label: string
  /** One sentence on what to write. */
  hint: string
  long?: boolean
}

export interface StageDef {
  id: StageId
  num: string
  title: string
  /** What is done here. */
  doing: string
  /** What is learned here. */
  learning: string
  /** How it leans on the steps before it. */
  leans: string
  /** What it yields. */
  yields: string
  fields: Field[]
}

export const STAGES: StageDef[] = [
  {
    id: 'discover',
    num: '01',
    title: 'למידה וגילוי',
    doing: 'מכירים מודלים מתמטיים ואת מה שהם פותחים: מהם, ה־DNA שלהם, ואילו שימושים מתאימים להם ולמה. אפשר גם להתחיל מצורך ולראות אילו מודלים משרתים אותו.',
    learning: 'איך תכונה מתמטית הופכת לתכונה מרחבית: קצה, לולאה, פיתול, צמיחה.',
    leans: 'זו נקודת ההתחלה. מה שנשמר כאן חוזר בשלב הבא ובמאמר, בחלק "הידע שנלמד".',
    yields: 'רשימת מודלים שנבחנו, ומה שלמדתי מהם.',
    fields: [{ path: 'discover.learned', label: 'מה למדתי', hint: 'רעיון, תכונה או קשר שלא הכרתי, במשפט או שניים.', long: true }],
  },
  {
    id: 'concept',
    num: '02',
    title: 'בחירת מושג והבנתו',
    doing: 'בוחרים מושג אחד, ומבינים מה בו יעבור למבנה. Claude יכול להציע חלופות ולהסביר.',
    learning: 'מה ה־DNA של המושג, ומה מתוכו המנוע יכול לבנות היום.',
    leans: 'נשען על הלמידה: הבחירה היא מתוך המודלים שנבחנו, או מושג חדש שהתגלה.',
    yields: 'מושג נבחר, והסבר למה הוא.',
    fields: [
      { path: 'concept.math', label: 'המושג המתמטי', hint: 'בעברית או באנגלית, למשל "Umbilic torus".' },
      { path: 'concept.why', label: 'למה המושג הזה', hint: 'איזו תכונה שלו חשובה לי, ומה היא תעשה במרחב.', long: true },
    ],
  },
  {
    id: 'context',
    num: '03',
    title: 'חיבור להקשר ולשימוש',
    doing: 'מחברים את המושג למקום, לשימוש ולאנשים: איפה הוא עומד, מה עושים בו, ולמה.',
    learning: 'אם התכונות של המושג משרתות את השימוש, ואיפה הן עובדות נגדו.',
    leans: 'נשען על המושג: ההתאמה בין התכונות שלו לשימוש מוצגת כאן, עם נימוקים.',
    yields: 'רעיון, כוונה, מקום, שימוש וקהל.',
    fields: [
      { path: 'idea.title', label: 'שם הפרויקט', hint: 'שם עבודה קצר. אפשר לשנות בכל שלב.' },
      { path: 'idea.idea', label: 'הרעיון', hint: 'מה רוצים ליצור, במשפט או בפסקה.', long: true },
      { path: 'idea.intent', label: 'הכוונה', hint: 'מה המבנה צריך לעשות למי שעומד בו או עובר לידו.', long: true },
      { path: 'context.place', label: 'מקום', hint: 'שם המקום בעברית ובלועזית, למשל "אשדוד (Ashdod, Israel)".' },
      { path: 'context.use', label: 'שימוש', hint: 'למשל ביתן ציבורי, כניסה לעיר, גשר.' },
      { path: 'context.audience', label: 'קהל', hint: 'מי עומד במבנה, עובר בו או מסתכל עליו.' },
    ],
  },
  {
    id: 'inspiration',
    num: '04',
    title: 'השראה וקונספט',
    doing: 'אוספים השראה, בתמונות ובמילים, ומנסחים קונספט אחד שמחבר את המושג, ההשראה, המקום והשימוש.',
    learning: 'מה בהשראה מתחבר למושג: קצב, חזרה, עקומה, אור, סף.',
    leans: 'נשען על המושג ועל ההקשר: Claude מקבל את שניהם יחד עם ההשראה ומציע קונספט.',
    yields: 'תמונות השראה, טקסט השראה, והצהרת קונספט.',
    fields: [
      { path: 'context.inspiration', label: 'השראה', hint: 'מה מעורר את הרעיון: מקום, יצירה, תופעה, זיכרון.', long: true },
      { path: 'concept.statement', label: 'הקונספט', hint: 'שניים או שלושה משפטים: איך המושג מבטא את הרעיון במקום הזה.', long: true },
      { path: 'idea.question', label: 'השאלה', hint: 'השאלה האדריכלית שהפרויקט בודק.' },
    ],
  },
  {
    id: 'model',
    num: '05',
    title: 'פיתוח המודל',
    doing: 'בונים את המתכון ומכיילים את הצורה כמבנה: קנה מידה, עובי, פתחים, רצפה.',
    learning: 'מה כל מדד אומר על המבנה, ומה משתנה כשמזיזים פרמטר.',
    leans: 'נשען על הקונספט: המתכון נבנה מהמושג, מהשימוש ומהמקום שנכתבו קודם.',
    yields: 'גרסה שמורה, מבט ערום ומדדים מוסברים.',
    fields: [{ path: 'form.decisions', label: 'החלטות בפיתוח', hint: 'מה שונה ולמה: קנה מידה, עובי, פתחים, רצפה.', long: true }],
  },
  {
    id: 'environment',
    num: '06',
    title: 'בחינת חומרים וסביבה',
    doing: 'מלבישים את הצורה בחומר, בוחנים אור וצל לפי שעה, עונה וכיוון, ואת הרוח והנוף.',
    learning: 'מה מחושב (שמש, צל, משקל) ומה רק מומחש (מרקם, רוח, מזג אוויר).',
    leans: 'נשען על המודל: הגאומטריה לא משתנה, רק מה שסביבה.',
    yields: 'מבט ריאליסטי ובחירות של חומר, מקום ושעה.',
    fields: [{ path: 'environment.decisions', label: 'בחירות', hint: 'איזה חומר, איזו שעה ועונה, ומה למדתי מהאור, מהצל ומהרוח.', long: true }],
  },
  {
    id: 'illustration',
    num: '07',
    title: 'המחשה',
    doing: 'כותבים פרומפט מהמודל או משלך, יוצרים או מעלים את התמונה, ומסבירים איך היא מבטאת את הרעיון.',
    learning: 'מה מהתמונה חוזר אל המבנה, ומה נשאר רק בתמונה.',
    leans: 'נשען על המודל ועל הסביבה: הפרומפט נגזר מהצורה, מהחומר, מהמקום ומהאור.',
    yields: 'פרומפט, תמונה, והסבר.',
    fields: [
      { path: 'prompt.note', label: 'מה הפרומפט מנסה להראות', hint: 'מה חשוב שהתמונה תתפוס.', long: true },
      { path: 'illustration.expresses', label: 'איך התמונה מבטאת את הרעיון', hint: 'מה רואים בה מהכוונה ומהמושג.', long: true },
      { path: 'illustration.translates', label: 'איך היא מתורגמת למבנה', hint: 'מה מהתמונה עובר לצורה, לחומר ולמידות, ומה לא.', long: true },
    ],
  },
  {
    id: 'production',
    num: '08',
    title: 'הכנה לייצור ולהצגה',
    doing: 'מכינים את הדגם להדפסה ואת הסרטון: מידות בסנטימטרים, מפלס קרקע, ומבטים לסרטון.',
    learning: 'כמה גדול יהיה הדגם ביד, ומה נחתך מתחת לקרקע.',
    leans: 'נשען על הגרסה האחרונה: קובץ ההדפסה והסרטון נבנים ממנה.',
    yields: 'קובץ הדפסה וסרטון.',
    fields: [
      { path: 'physical.scale', label: 'קנה מידה וגודל', hint: 'למשל 1:324, הצלע הארוכה 15 ס"מ.' },
      { path: 'physical.material', label: 'חומר וייצור', hint: 'למשל PLA לבן, הדפסת FDM.' },
      { path: 'physical.notes', label: 'מה למדנו מהמעבר לפיזי', hint: 'מה עבד, מה תוקן, מה הפתיע.', long: true },
      { path: 'production.video', label: 'הסרטון', hint: 'מה הסרטון מראה, ובאיזה סדר.', long: true },
    ],
  },
  {
    id: 'exhibition',
    num: '09',
    title: 'תיעוד לתערוכה',
    doing: 'מצלמים את התוצאה, כותבים מה התקבל, ועורכים את המאמר מכל חומרי הפרויקט.',
    learning: 'מה התשובה לשאלה מהשלב הרביעי, ומה הלאה.',
    leans: 'נשען על כל השלבים: כל טקסט ותמונה נכנסים למאמר, וחלק חסר מסומן.',
    yields: 'צילומים, תיאור התוצאה, ומאמר ערוך ב-PDF וב-Word.',
    fields: [
      { path: 'documentation.result', label: 'התוצאה', hint: 'מה רואים ומה מרגישים מול המודל.', long: true },
      { path: 'documentation.lessons', label: 'מסקנות', hint: 'מה התשובה לשאלה, ומה הלאה.', long: true },
      { path: 'exhibition.title', label: 'כותרת המאמר', hint: 'ריק: שם המבנה מהמתכון, או שם הפרויקט.' },
      { path: 'exhibition.subtitle', label: 'כותרת משנה', hint: 'ריק: הפתגם של המושג.' },
      { path: 'exhibition.author', label: 'כתיבה ועיצוב', hint: 'השם שיופיע במאמר.' },
      { path: 'exhibition.venue', label: 'התערוכה', hint: 'שם התערוכה, מקום ותאריך.' },
    ],
  },
]

export const stageById = (id: string): StageDef | undefined => STAGES.find((s) => s.id === (OLD_STAGE[id] ?? id))

/** A value of the journey by its dotted path. */
export const fieldValue = (j: Journey, path: string): string => {
  const [g, k] = path.split('.') as [keyof Journey, string]
  const v = (j[g] as Record<string, unknown> | undefined)?.[k]
  return typeof v === 'string' ? v : ''
}

/** The journey with one field set, by its dotted path. */
export const withField = (j: Journey, path: string, value: string): Journey => {
  const [g, k] = path.split('.') as [keyof Journey, string]
  return { ...j, [g]: { ...(j[g] as object | undefined), [k]: value } } as Journey
}

export type StageState = 'done' | 'partial' | 'empty'

export interface StageStatus {
  state: StageState
  have: string[]
  missing: string[]
}

const has = (s?: string) => !!s && s.trim().length > 0

/** The chosen concept's name, from the atlas, the field or the recipe. */
export function chosenConcept(w: WorkState): { name: string; name_he: string; modelId: string | null } | null {
  const m = w.journey.concept?.model ? modelById(w.journey.concept.model) : undefined
  if (m) return { name: m.name, name_he: m.name_he, modelId: m.id }
  if (has(w.journey.concept?.math)) return { name: w.journey.concept!.math!, name_he: w.journey.concept!.math!, modelId: null }
  if (w.recipe) return { name: w.recipe.concept.name, name_he: w.recipe.concept.name_he, modelId: null }
  return null
}

/** What a step holds and what it still lacks. Missing never blocks: every step opens at any time. */
export function stageStatus(id: StageId, w: WorkState): StageStatus {
  const j = w.journey
  const have: string[] = []
  const missing: string[] = []
  const need = (ok: boolean, label: string) => (ok ? have : missing).push(label)
  switch (id) {
    case 'discover':
      need((j.discover?.saved?.length ?? 0) > 0 || !!j.concept?.model, 'מודל אחד לפחות שנבחן')
      need(has(j.discover?.learned), 'מה למדתי')
      break
    case 'concept':
      need(!!chosenConcept(w), 'מושג נבחר')
      need(has(j.concept?.why), 'למה המושג הזה')
      break
    case 'context':
      need(has(j.idea?.idea), 'הרעיון')
      need(has(j.idea?.intent), 'הכוונה')
      need(has(j.context?.place) || has(j.context?.use) || !!w.recipe?.concept.use, 'מקום או שימוש')
      break
    case 'inspiration':
      need(has(j.context?.inspiration) || w.references.length > 0, 'השראה, בטקסט או בתמונה')
      need(has(j.concept?.statement), 'הקונספט')
      if (w.references.length) have.push(`${w.references.length} תמונות השראה`)
      break
    case 'model':
      need(!!w.recipe, 'מתכון שמור')
      need(w.stills.bare.length > 0, 'מבט ערום קפוא')
      need(has(j.form?.decisions), 'החלטות בפיתוח')
      if (w.reading) have.push('פרשנות')
      break
    case 'environment':
      need(w.stills.realistic.length > 0, 'מבט ריאליסטי קפוא')
      need(has(j.environment?.decisions), 'בחירות של חומר וסביבה')
      break
    case 'illustration': {
      const images = w.prompts.reduce((n, p) => n + p.images.length, 0)
      need(w.prompts.length > 0, 'פרומפט שמור')
      if (w.prompts.some((p) => !p.body.trim())) missing.push('נוסח הפרומפט של תמונה שהועלתה בלי פרומפט')
      need(images > 0, 'תמונה מהפרומפט')
      need(has(j.illustration?.expresses), 'איך התמונה מבטאת את הרעיון')
      need(has(j.illustration?.translates), 'איך היא מתורגמת למבנה')
      break
    }
    case 'production':
      need(!!w.print, 'קובץ הדפסה')
      need(w.hasClip, 'סרטון')
      need(has(j.physical?.notes) || has(j.physical?.scale), 'תיאור הדגם הפיזי')
      break
    case 'exhibition': {
      need(w.photos.length + w.stills.render.length > 0, 'צילום או הדמיה של התוצאה')
      need(has(j.documentation?.result), 'תיאור התוצאה')
      need(has(j.exhibition?.author), 'שם הכותבת')
      const gaps = STAGES.filter((s) => s.id !== 'exhibition').filter((s) => stageStatus(s.id, w).missing.length > 0)
      if (gaps.length) missing.push(`השלמה ב${gaps.length === 1 ? 'שלב' : `-${gaps.length} שלבים`}: ${gaps.map((g) => g.num).join(', ')}`)
      break
    }
  }
  const state: StageState = missing.length === 0 ? 'done' : have.length > 0 ? 'partial' : 'empty'
  return { state, have, missing }
}

/** The step to continue from: the first one that is not done. */
export function nextStage(w: WorkState): StageDef {
  return STAGES.find((s) => stageStatus(s.id, w).state !== 'done') ?? STAGES.at(-1)!
}

export const doneCount = (w: WorkState) => STAGES.filter((s) => stageStatus(s.id, w).state === 'done').length

/** The project's name: what the owner wrote, then the recipe's, then the row's. */
export const projectName = (w: WorkState) => w.journey.idea?.title?.trim() || w.recipe?.narrative.name_he || w.project.title_he
