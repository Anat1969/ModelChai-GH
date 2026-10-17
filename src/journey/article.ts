/**
 * The exhibition article (DECISIONS.md 97): the project's story from the idea to the built model, composed only
 * from what the project holds. Nothing is invented. A part that is missing becomes a marked gap that names the
 * step where it is filled in; it shows on screen and never goes into an exported file. Every section's text can
 * be edited; the edit is kept on the project and replaces the text composed from the materials.
 */
import { visualPrompt } from '../prompt/visualPrompt'
import { siteWords } from '../scene/sun'
import type { StageId, WorkImage, WorkState } from './stages'

export interface Gap {
  text: string
  stage: StageId
}

export interface ArticleSection {
  key: SectionKey
  num: string
  heading: string
  /** The text composed from the materials, or the owner's edit. Paragraphs. */
  paras: string[]
  /** The composed text, kept so an edit can be undone. */
  composed: string[]
  edited: boolean
  quote?: string
  figures: (WorkImage & { note?: string })[]
  facts: { label: string; value: string }[]
  gaps: Gap[]
}

export type SectionKey = 'idea' | 'context' | 'concept' | 'prompt' | 'illustration' | 'form' | 'physical' | 'documentation' | 'closing'

export interface Article {
  title: string
  subtitle: string | null
  byline: string | null
  /** The opening sentence under the title. */
  lead: string | null
  cover: WorkImage | null
  sections: ArticleSection[]
  colophon: string[]
  /** Gaps in the whole article, including the head. */
  gaps: Gap[]
}

/** The owner's edits, as kept in `mathcreator_projects.article`. */
export interface ArticleEdits {
  sections?: Partial<Record<SectionKey, string>>
}

const t = (s?: string | null) => (s ?? '').trim()
const paras = (s?: string | null) =>
  t(s)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
const dateHe = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
const newest = (xs: WorkImage[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))

export function buildArticle(w: WorkState, edits: ArticleEdits = {}): Article {
  const j = w.journey
  const r = w.recipe
  const n = r?.narrative
  const vp = r ? visualPrompt(r) : null
  const part = (slot: string) => vp?.parts.find((p) => p.slot === slot)?.text
  const illustrations = w.prompts.flatMap((p) => p.images)
  const sections: ArticleSection[] = []

  const add = (
    key: SectionKey,
    heading: string,
    s: { paras?: string[]; quote?: string; figures?: ArticleSection['figures']; facts?: ArticleSection['facts']; gaps: (Gap & { text_only?: boolean })[] },
  ) => {
    const composed = s.paras ?? []
    const edit = edits.sections?.[key]
    // A key that is present is an edit, even an empty one: the owner chose to clear the section.
    const edited = edit !== undefined
    sections.push({
      key,
      num: String(sections.length + 1).padStart(2, '0'),
      heading,
      paras: edited ? paras(edit) : composed,
      composed,
      edited,
      quote: s.quote,
      figures: s.figures ?? [],
      facts: s.facts ?? [],
      // An edit answers the gaps in the words; missing images stay missing.
      gaps: s.gaps.filter((g) => !(edited && g.text_only)).map(({ text, stage }) => ({ text, stage })),
    })
  }

  // ---------- 1. the idea ----------
  add('idea', 'הרעיון', {
    paras: [...paras(j.idea?.idea), ...(t(j.idea?.intent) ? [`הכוונה: ${t(j.idea?.intent)}`] : []), ...(t(j.idea?.question) ? [`השאלה: ${t(j.idea?.question)}`] : [])],
    gaps: [
      ...(t(j.idea?.idea) ? [] : [{ text: 'הרעיון במילים', stage: 'idea' as const, text_only: true }]),
      ...(t(j.idea?.intent) ? [] : [{ text: 'הכוונה', stage: 'idea' as const, text_only: true }]),
    ],
  })

  // ---------- 2. place and inspiration ----------
  const place = t(j.context?.place) || (r ? (siteWords(r.realistic.site)?.replace(/^ב-?/, '') ?? '') : '')
  const use = t(j.context?.use) || t(r?.concept.use)
  const where = [use ? `השימוש: ${use}` : null, place ? `המקום: ${place}` : null, t(j.context?.audience) ? `הקהל: ${t(j.context?.audience)}` : null].filter(Boolean).join('. ')
  add('context', 'המקום וההשראה', {
    paras: [...(where ? [`${where}.`] : []), ...paras(j.context?.inspiration)],
    figures: newest(w.references).slice(0, 3),
    gaps: [
      ...(where ? [] : [{ text: 'מקום או שימוש', stage: 'context' as const, text_only: true }]),
      ...(t(j.context?.inspiration) || w.references.length ? [] : [{ text: 'השראה, בטקסט או בתמונה', stage: 'context' as const }]),
    ],
  })

  // ---------- 3. the concept ----------
  const mathName = r ? `${r.concept.name_he} (${r.concept.name})` : t(j.concept?.math)
  add('concept', 'המושג המתמטי', {
    paras: [
      ...(mathName ? [`המושג: ${mathName}.`] : []),
      ...paras(j.concept?.why),
      ...(n ? [n.insight] : []),
      ...(w.reading ? [w.reading.logic, w.reading.space] : []),
      ...(n?.fit_note ? [`מה אבד בתרגום: ${n.fit_note}`] : []),
    ],
    quote: n?.maxim,
    gaps: [...(r ? [] : [{ text: 'מתכון שנבנה מהמושג', stage: 'concept' as const }]), ...(t(j.concept?.why) ? [] : [{ text: 'למה המושג הזה', stage: 'concept' as const, text_only: true }])],
  })

  // ---------- 4. the prompt ----------
  const prompt = w.prompts.find((p) => p.images.length) ?? w.prompts[0]
  add('prompt', 'מהמילים לתמונה', {
    paras: [...(prompt ? [prompt.distill] : []), ...paras(j.prompt?.note)],
    quote: prompt?.body || undefined,
    gaps: prompt ? [] : [{ text: 'פרומפט שמור', stage: 'prompt' }],
  })

  // ---------- 5. the illustration ----------
  add('illustration', 'ההמחשה', {
    paras: [...paras(j.illustration?.expresses), ...paras(j.illustration?.translates)],
    figures: newest(prompt?.images.length ? prompt.images : illustrations).slice(0, 2),
    gaps: [
      ...(illustrations.length ? [] : [{ text: 'תמונה שנוצרה מהפרומפט', stage: 'illustration' as const }]),
      ...(t(j.illustration?.expresses) ? [] : [{ text: 'איך התמונה מבטאת את הרעיון', stage: 'illustration' as const, text_only: true }]),
      ...(t(j.illustration?.translates) ? [] : [{ text: 'איך היא מתורגמת למבנה', stage: 'illustration' as const, text_only: true }]),
    ],
  })

  // ---------- 6. form and material ----------
  const views = [newest(w.stills.bare)[0], newest(w.stills.realistic)[0]].filter((x): x is WorkImage => !!x)
  add('form', 'הצורה והחומר', {
    paras: [
      ...paras(j.form?.decisions),
      ...[part('shape'), part('material'), part('context'), part('light')].filter((x): x is string => !!x).map((x) => `${x}.`),
      ...(w.reading ? [w.reading.figure_ground] : []),
    ],
    figures: views,
    facts: w.metrics.filter((m) => /^(קוטר חיצוני|גובה חופשי|מספר קצוות|משקל משוער|שטח מעטפת)/.test(m.label)),
    gaps: [
      ...(views.length ? [] : [{ text: 'מבט קפוא, ערום או ריאליסטי', stage: 'form' as const }]),
      ...(t(j.form?.decisions) ? [] : [{ text: 'ההחלטות בפיתוח', stage: 'form' as const, text_only: true }]),
    ],
  })

  // ---------- 7. the physical model ----------
  const scale = t(j.physical?.scale) || w.print
  add('physical', 'המבנה הפיזי', {
    paras: [...(scale ? [`קנה מידה וגודל: ${scale}.`] : []), ...(t(j.physical?.material) ? [`חומר וייצור: ${t(j.physical?.material)}.`] : []), ...paras(j.physical?.notes)],
    gaps: [...(w.print ? [] : [{ text: 'קובץ הדפסה', stage: 'physical' as const }]), ...(t(j.physical?.notes) ? [] : [{ text: 'מה למדנו מהמעבר לפיזי', stage: 'physical' as const, text_only: true }])],
  })

  // ---------- 8. the result ----------
  const resultFigures = (w.photos.length ? newest(w.photos) : newest(w.stills.render)).slice(0, 2)
  add('documentation', 'התוצאה', {
    paras: [...paras(j.documentation?.result), ...paras(j.documentation?.lessons)],
    figures: resultFigures,
    gaps: [
      ...(resultFigures.length ? [] : [{ text: 'צילום או הדמיה של התוצאה', stage: 'documentation' as const }]),
      ...(t(j.documentation?.result) ? [] : [{ text: 'תיאור התוצאה', stage: 'documentation' as const, text_only: true }]),
    ],
  })

  // ---------- 9. one sentence ----------
  const closing = w.reading?.synthesis ?? w.post?.short ?? null
  add('closing', 'במשפט אחד', {
    paras: closing ? [closing] : [],
    gaps: closing ? [] : [{ text: 'משפט מסכם: פרשנות או פוסט, בסטודיו', stage: 'concept', text_only: true }],
  })

  const title = t(j.exhibition?.title) || n?.name_he || t(j.idea?.title) || w.project.title_he
  const subtitle = t(j.exhibition?.subtitle) || n?.maxim || null
  const byline = [t(j.exhibition?.author), t(j.exhibition?.venue)].filter(Boolean).join(' · ') || null
  const cover = newest(w.stills.render)[0] ?? newest(illustrations)[0] ?? newest(w.photos)[0] ?? newest(w.stills.realistic)[0] ?? newest(w.stills.bare)[0] ?? null
  const lead = t(j.idea?.question) ? null : t(j.idea?.idea).split(/(?<=[.!?])\s/)[0] || null
  const headGaps: Gap[] = [...(cover ? [] : [{ text: 'תמונת שער', stage: 'illustration' as const }]), ...(t(j.exhibition?.author) ? [] : [{ text: 'שם הכותבת', stage: 'exhibition' as const }])]

  return {
    title,
    subtitle,
    byline,
    lead: lead && lead !== sections[0]?.paras[0] ? lead : null,
    cover,
    sections,
    colophon: [
      `${w.versions.length ? `${w.versions.length === 1 ? 'גרסה אחת' : `${w.versions.length} גרסאות`}, מ-${dateHe(w.versions[0]!.created_at)} עד ${dateHe(w.versions.at(-1)!.created_at)}.` : `הפרויקט נפתח ב-${dateHe(w.project.created_at)}.`}`,
      'נוצר ב"יוצר: מתמטיקה", https://math-creator.vercel.app. המאמר מורכב מחומרי העבודה של הפרויקט.',
    ],
    gaps: [...headGaps, ...sections.flatMap((s) => s.gaps)],
  }
}

/** A file name that survives every browser: Chrome drops a Hebrew download name. */
export function articleFileName(w: WorkState, ext: 'pdf' | 'docx', at = new Date()): string {
  const latin =
    (w.recipe?.concept.name ?? w.project.concept)
      .normalize('NFKD')
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'project'
  return `${latin}-article-${at.toISOString().slice(0, 10)}.${ext}`
}
