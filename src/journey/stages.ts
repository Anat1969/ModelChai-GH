/**
 * The work path (DECISIONS.md 97): nine steps from a first idea to the article that presents the built model.
 * Each step says what it is for, what to fill in, what it leans on, and what it yields. Its state is computed
 * from what the project holds, never stored, so old projects show what they already have and what is missing.
 * Pure: the workspace, the home page and the article read it, and tests check it.
 */
import type { Reading } from '../data/library'
import type { Recipe, SweepParams } from '../recipe/schema'

export type Sweep = Recipe & { generator: { type: 'sweep'; params: SweepParams } }

/** What the owner writes on the steps. Every field is optional: a project can start from anything. */
export interface Journey {
  idea?: { title?: string; idea?: string; intent?: string; question?: string }
  context?: { place?: string; use?: string; audience?: string; inspiration?: string }
  concept?: { math?: string; why?: string }
  prompt?: { note?: string }
  illustration?: { expresses?: string; translates?: string }
  form?: { decisions?: string }
  physical?: { scale?: string; material?: string; notes?: string }
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
  recipe: Sweep | null
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

export type StageId = 'idea' | 'context' | 'concept' | 'prompt' | 'illustration' | 'form' | 'physical' | 'documentation' | 'exhibition'

export interface Field {
  key: string
  label: string
  /** One sentence on what to write. */
  hint: string
  long?: boolean
}

export interface StageDef {
  id: StageId
  num: string
  title: string
  /** What the step is for. */
  goal: string
  /** How it leans on the steps before it. */
  leans: string
  /** What it yields. */
  yields: string
  fields: Field[]
}

export const STAGES: StageDef[] = [
  {
    id: 'idea',
    num: '01',
    title: 'רעיון וכוונה',
    goal: 'לנסח מה רוצים לבדוק ולמה, לפני שיש צורה.',
    leans: 'זו נקודת ההתחלה. אפשר לכתוב גם משפט אחד ולחזור לכאן מאוחר יותר.',
    yields: 'שם לפרויקט, הרעיון במילים, והשאלה שהמבנה צריך לענות עליה.',
    fields: [
      { key: 'title', label: 'שם הפרויקט', hint: 'שם עבודה קצר. אפשר לשנות בכל שלב.' },
      { key: 'idea', label: 'הרעיון', hint: 'מה רוצים ליצור, במשפט או בפסקה.', long: true },
      { key: 'intent', label: 'הכוונה', hint: 'מה המבנה צריך לעשות למי שעומד בו או עובר לידו.', long: true },
      { key: 'question', label: 'השאלה', hint: 'השאלה האדריכלית שהפרויקט בודק.' },
    ],
  },
  {
    id: 'context',
    num: '02',
    title: 'הקשר והשראה',
    goal: 'לקבוע איפה, בשביל מי, ומה מעורר את הרעיון.',
    leans: 'נשען על הרעיון והכוונה: המקום והשימוש הם התנאים שבהם הכוונה נבחנת.',
    yields: 'מקום, שימוש וקהל, טקסט השראה ותמונות השראה.',
    fields: [
      { key: 'place', label: 'מקום', hint: 'שם המקום בעברית ובלועזית, למשל "אשדוד (Ashdod, Israel)".' },
      { key: 'use', label: 'שימוש', hint: 'למשל ביתן ציבורי, שער, מקום מנוחה.' },
      { key: 'audience', label: 'קהל', hint: 'מי עומד במבנה, עובר בו או מסתכל עליו.' },
      { key: 'inspiration', label: 'השראה', hint: 'מה מעורר את הרעיון: מקום, יצירה, תופעה, זיכרון.', long: true },
    ],
  },
  {
    id: 'concept',
    num: '03',
    title: 'גיבוש קונספט',
    goal: 'לבחור את המושג המתמטי שהמבנה יהיה עשוי ממנו, ולתרגם אותו למתכון.',
    leans: 'נשען על הרעיון ועל ההקשר: השימוש והמקום עוברים אל Claude יחד עם המושג.',
    yields: 'מתכון שנבנה למודל, תובנה ופתגם, ופרשנות מהמתמטיקה אל האדריכלות.',
    fields: [
      { key: 'math', label: 'המושג המתמטי', hint: 'בעברית או באנגלית, למשל "Umbilic torus".' },
      { key: 'why', label: 'למה המושג הזה', hint: 'מה במושג עונה על הכוונה ועל השאלה.', long: true },
    ],
  },
  {
    id: 'prompt',
    num: '04',
    title: 'כתיבת פרומפט',
    goal: 'לתרגם את הקונספט למשפט שמייצר תמונה.',
    leans: 'נשען על המתכון ועל ההקשר: הפרומפט נגזר מהצורה, מהחומר, מהמקום ומהאור.',
    yields: 'פרומפט שמור, עם משפט זיקוק אחד.',
    fields: [{ key: 'note', label: 'מה הפרומפט מנסה להראות', hint: 'מה חשוב שהתמונה תתפוס.', long: true }],
  },
  {
    id: 'illustration',
    num: '05',
    title: 'יצירת תמונה והמחשה',
    goal: 'ליצור תמונה מהפרומפט ולבדוק אם היא מבטאת את הרעיון.',
    leans: 'נשען על הפרומפט: כל תמונה שייכת לפרומפט שממנו נוצרה.',
    yields: 'תמונה, הסבר איך היא מבטאת את הרעיון, ואיך היא מתורגמת למבנה.',
    fields: [
      { key: 'expresses', label: 'איך התמונה מבטאת את הרעיון', hint: 'מה רואים בה מהכוונה ומהמושג.', long: true },
      { key: 'translates', label: 'איך היא מתורגמת למבנה', hint: 'מה מהתמונה עובר לצורה, לחומר ולמידות, ומה לא.', long: true },
    ],
  },
  {
    id: 'form',
    num: '06',
    title: 'פיתוח צורני וחומרי',
    goal: 'לכייל את הצורה כמבנה ולהלביש אותה בחומר, באור ובמקום.',
    leans: 'נשען על המתכון ועל ההמחשה: התמונה היא היעד, והמודל הוא מה שאפשר למדוד.',
    yields: 'גרסה שמורה, מבט ערום ומבט ריאליסטי, ומדדים.',
    fields: [{ key: 'decisions', label: 'החלטות', hint: 'מה שונה ולמה: קנה מידה, עובי, פתחים, חומר, מקום ושעה.', long: true }],
  },
  {
    id: 'physical',
    num: '07',
    title: 'תרגום למבנה פיזי',
    goal: 'להפוך את המודל לגוף שאפשר להדפיס ולהחזיק.',
    leans: 'נשען על הגרסה האחרונה: קובץ ההדפסה נבנה ממנה, עם בדיקות אטימות ועובי דופן.',
    yields: 'קובץ הדפסה בקנה מידה, ותיאור של המודל הפיזי.',
    fields: [
      { key: 'scale', label: 'קנה מידה וגודל', hint: 'למשל 1:324, הצלע הארוכה 150 מ"מ.' },
      { key: 'material', label: 'חומר וייצור', hint: 'למשל PLA לבן, הדפסת FDM.' },
      { key: 'notes', label: 'מה למדנו מהמעבר לפיזי', hint: 'מה עבד, מה תוקן, מה הפתיע.', long: true },
    ],
  },
  {
    id: 'documentation',
    num: '08',
    title: 'תיעוד התוצאה',
    goal: 'לצלם ולתאר את התוצאה כפי שהיא, מודל מודפס או הדמיה.',
    leans: 'נשען על המודל הפיזי ועל ההדמיה: מתעדים את מה שנבנה, לא את מה שתוכנן.',
    yields: 'צילומים של התוצאה, תיאור, ומסקנות.',
    fields: [
      { key: 'result', label: 'התוצאה', hint: 'מה רואים ומה מרגישים מול המודל.', long: true },
      { key: 'lessons', label: 'מסקנות', hint: 'מה התשובה לשאלה מהשלב הראשון, ומה הלאה.', long: true },
    ],
  },
  {
    id: 'exhibition',
    num: '09',
    title: 'עריכה לתערוכה',
    goal: 'לערוך את החומרים למאמר אחד שמספר את הפרויקט מהרעיון ועד התוצאה.',
    leans: 'נשען על כל השלבים: כל טקסט ותמונה מהם נכנסים למאמר, וחלק חסר מסומן.',
    yields: 'מאמר ערוך, ייצוא ל-PDF ול-Word.',
    fields: [
      { key: 'title', label: 'כותרת המאמר', hint: 'ריק: שם המבנה מהמתכון, או שם הפרויקט.' },
      { key: 'subtitle', label: 'כותרת משנה', hint: 'ריק: הפתגם של המושג.' },
      { key: 'author', label: 'כתיבה ועיצוב', hint: 'השם שיופיע במאמר.' },
      { key: 'venue', label: 'התערוכה', hint: 'שם התערוכה, מקום ותאריך.' },
    ],
  },
]

export const stageById = (id: string) => STAGES.find((s) => s.id === id)

export type StageState = 'done' | 'partial' | 'empty'

export interface StageStatus {
  state: StageState
  have: string[]
  missing: string[]
}

const has = (s?: string) => !!s && s.trim().length > 0

/** What a step holds and what it still lacks. Missing never blocks: every step can be opened at any time. */
export function stageStatus(id: StageId, w: WorkState): StageStatus {
  const j = w.journey
  const have: string[] = []
  const missing: string[] = []
  const need = (ok: boolean, label: string) => (ok ? have : missing).push(label)
  switch (id) {
    case 'idea':
      need(has(j.idea?.idea), 'הרעיון')
      need(has(j.idea?.intent), 'הכוונה')
      if (has(j.idea?.question)) have.push('השאלה')
      break
    case 'context':
      need(has(j.context?.place) || has(j.context?.use) || !!w.recipe?.concept.use, 'מקום או שימוש')
      need(has(j.context?.inspiration) || w.references.length > 0, 'השראה, בטקסט או בתמונה')
      if (w.references.length) have.push(`${w.references.length} תמונות השראה`)
      break
    case 'concept':
      need(!!w.recipe, 'מתכון שמור')
      need(has(j.concept?.why), 'למה המושג הזה')
      if (w.reading) have.push('פרשנות')
      else if (w.recipe) missing.push('פרשנות (בסטודיו, לשונית "פרשנות")')
      break
    case 'prompt':
      need(w.prompts.length > 0, 'פרומפט שמור')
      if (w.prompts.some((p) => !p.body.trim())) missing.push('נוסח הפרומפט של תמונה שהועלתה בלי פרומפט')
      break
    case 'illustration': {
      const images = w.prompts.reduce((n, p) => n + p.images.length, 0)
      need(images > 0, 'תמונה מהפרומפט')
      need(has(j.illustration?.expresses), 'איך התמונה מבטאת את הרעיון')
      need(has(j.illustration?.translates), 'איך היא מתורגמת למבנה')
      break
    }
    case 'form':
      need(w.versions.length > 0, 'גרסה שמורה')
      need(w.stills.bare.length + w.stills.realistic.length > 0, 'מבט קפוא, ערום או ריאליסטי')
      need(has(j.form?.decisions), 'החלטות')
      break
    case 'physical':
      need(!!w.print, 'קובץ הדפסה')
      need(has(j.physical?.notes) || has(j.physical?.scale), 'תיאור המודל הפיזי')
      break
    case 'documentation':
      need(w.photos.length + w.stills.render.length > 0, 'צילום או הדמיה של התוצאה')
      need(has(j.documentation?.result), 'תיאור התוצאה')
      if (has(j.documentation?.lessons)) have.push('מסקנות')
      break
    case 'exhibition': {
      const gaps = STAGES.filter((s) => s.id !== 'exhibition').filter((s) => stageStatus(s.id, w).missing.length > 0)
      need(has(j.exhibition?.author), 'שם הכותבת')
      need(gaps.length === 0, gaps.length ? `השלמה ב${gaps.length === 1 ? 'שלב' : `-${gaps.length} שלבים`}: ${gaps.map((g) => g.num).join(', ')}` : 'כל השלבים מלאים')
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

/** How far the project is, as a count of finished steps. */
export const doneCount = (w: WorkState) => STAGES.filter((s) => stageStatus(s.id, w).state === 'done').length

/** The project's name: what the owner wrote, then the recipe's, then the row's. */
export const projectName = (w: WorkState) => w.journey.idea?.title?.trim() || w.recipe?.narrative.name_he || w.project.title_he
