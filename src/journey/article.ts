/**
 * The exhibition article (DECISIONS.md 99, 104): the project's development told in order: the mathematical
 * concept, the knowledge learned, the context, the inspiration and concept, the prompt and the image made from
 * it, the model, the material and environment choices, the preparation for print and video, and the result.
 * Composed only from what the project holds, plus the atlas's own description of the chosen concept. Nothing is
 * invented: a missing part is a marked gap that names the step where it is filled in; it shows on screen and
 * never goes into an exported file. Every section can be edited, or drafted by Claude from the same materials;
 * the text is kept on the project and replaces the composed one.
 */
import { modelById } from '../learn/atlas'
import { fitUse, USES } from '../learn/traits'
import { visualPrompt } from '../prompt/visualPrompt'
import { siteWords } from '../scene/sun'
import { chosenConcept, type StageId, type WorkImage, type WorkState } from './stages'

export interface Gap {
  text: string
  stage: StageId
}

export type SectionKey = 'concept' | 'knowledge' | 'context' | 'inspiration' | 'image' | 'model' | 'environment' | 'production' | 'result' | 'closing'
export const SECTION_KEYS: SectionKey[] = ['concept', 'knowledge', 'context', 'inspiration', 'image', 'model', 'environment', 'production', 'result', 'closing']

/** Section keys of the earlier article, so edits made then still land. */
const OLD_KEY: Record<string, SectionKey> = { idea: 'context', illustration: 'image', prompt: 'image', form: 'model', physical: 'production', documentation: 'result' }

export interface ArticleSection {
  key: SectionKey
  num: string
  heading: string
  /** The text composed from the materials, or the owner's (or Claude's) edit. Paragraphs. */
  paras: string[]
  /** The composed text, kept so an edit can be undone, and sent to Claude as the section's materials. */
  composed: string[]
  edited: boolean
  quote?: string
  figures: WorkImage[]
  facts: { label: string; value: string }[]
  gaps: Gap[]
}

export interface Article {
  title: string
  subtitle: string | null
  byline: string | null
  lead: string | null
  cover: WorkImage | null
  sections: ArticleSection[]
  colophon: string[]
  gaps: Gap[]
}

/** The owner's edits, as kept in `mathcreator_projects.article`. */
export interface ArticleEdits {
  sections?: Partial<Record<string, string>>
  /** Where the current text came from: the owner, or a Claude draft she can edit. */
  drafted?: string
}

const t = (s?: string | null) => (s ?? '').trim()
const paras = (s?: string | null) =>
  t(s)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
const dateHe = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
const newest = (xs: WorkImage[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))

/** Reads the edits under the current keys, old keys included. */
export function editsByKey(edits: ArticleEdits): Partial<Record<SectionKey, string>> {
  const out: Partial<Record<SectionKey, string>> = {}
  for (const [k, v] of Object.entries(edits.sections ?? {})) {
    if (v === undefined) continue
    const key = (SECTION_KEYS as string[]).includes(k) ? (k as SectionKey) : OLD_KEY[k]
    if (key && out[key] === undefined) out[key] = v
  }
  return out
}

type GapIn = Gap & { text_only?: boolean }

export function buildArticle(w: WorkState, edits: ArticleEdits = {}): Article {
  const j = w.journey
  const r = w.recipe
  const n = r?.narrative
  const vp = r ? visualPrompt(r) : null
  const part = (slot: string) => vp?.parts.find((p) => p.slot === slot)?.text
  const chosen = chosenConcept(w)
  const model = chosen?.modelId ? modelById(chosen.modelId) : undefined
  const ed = editsByKey(edits)
  const illustrations = w.prompts.flatMap((p) => p.images)
  const sections: ArticleSection[] = []

  const add = (key: SectionKey, heading: string, s: { paras?: string[]; quote?: string; figures?: WorkImage[]; facts?: ArticleSection['facts']; gaps: GapIn[] }) => {
    const composed = s.paras ?? []
    const edit = ed[key]
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
      // An edit answers the gaps in words; missing images stay missing.
      gaps: s.gaps.filter((g) => !(edited && g.text_only)).map(({ text, stage }) => ({ text, stage })),
    })
  }

  // ---------- 1. the concept ----------
  add('concept', 'המושג המתמטי', {
    paras: [
      ...(chosen ? [`המושג: ${chosen.name_he}${chosen.name !== chosen.name_he ? ` (${chosen.name})` : ''}.`] : []),
      ...(model ? [model.plain] : []),
      ...(model ? [`ה־DNA שלו: ${model.dna.join(' ')}`] : []),
      ...paras(j.concept?.why),
      ...(n ? [n.insight] : []),
      ...(w.reading ? [w.reading.logic] : []),
    ],
    quote: n?.maxim,
    gaps: [
      ...(chosen ? [] : [{ text: 'מושג נבחר', stage: 'concept' as const }]),
      ...(t(j.concept?.why) ? [] : [{ text: 'למה המושג הזה', stage: 'concept' as const, text_only: true }]),
    ],
  })

  // ---------- 2. the knowledge learned ----------
  const saved = (j.discover?.saved ?? []).map(modelById).filter((m): m is NonNullable<typeof m> => !!m && m.id !== model?.id)
  add('knowledge', 'הידע שנלמד', {
    paras: [
      ...paras(j.discover?.learned),
      ...(saved.length ? [`בדרך נבחנו גם: ${saved.map((m) => `${m.name_he} (${m.name}), ${m.plain.split(/(?<=\.)\s/)[0]!.replace(/\.$/, '')}`).join('; ')}.`] : []),
    ],
    gaps: t(j.discover?.learned) ? [] : [{ text: 'מה למדתי', stage: 'discover', text_only: true }],
  })

  // ---------- 3. context and use ----------
  const place = t(j.context?.place) || (r ? (siteWords(r.realistic.site)?.replace(/^ב-?/, '') ?? '') : '')
  const use = t(j.context?.use) || t(r?.concept.use)
  const where = [use ? `השימוש: ${use}` : null, place ? `המקום: ${place}` : null, t(j.context?.audience) ? `הקהל: ${t(j.context?.audience)}` : null].filter(Boolean).join('. ')
  const useDef = Object.values(USES).find((u) => use && (use.includes(u.label) || u.label.includes(use)))
  const fit = model && useDef ? fitUse(model.traits, useDef) : null
  add('context', 'ההקשר והשימוש', {
    paras: [
      ...paras(j.idea?.idea),
      ...(t(j.idea?.intent) ? [`הכוונה: ${t(j.idea?.intent)}`] : []),
      ...(where ? [`${where}.`] : []),
      ...(fit && fit.reasons.length ? [`למה המושג מתאים ל${useDef!.label}: ${fit.reasons.map((x) => x.why).join(' ')}`] : []),
      ...(fit && fit.against.length ? [`ומה עובד נגדו: ${fit.against.map((x) => x.why).join(' ')}`] : []),
    ],
    gaps: [
      ...(t(j.idea?.idea) ? [] : [{ text: 'הרעיון', stage: 'context' as const, text_only: true }]),
      ...(t(j.idea?.intent) ? [] : [{ text: 'הכוונה', stage: 'context' as const, text_only: true }]),
      ...(where ? [] : [{ text: 'מקום או שימוש', stage: 'context' as const, text_only: true }]),
    ],
  })

  // ---------- 4. inspiration and concept ----------
  add('inspiration', 'ההשראה והקונספט', {
    paras: [...paras(j.context?.inspiration), ...paras(j.concept?.statement), ...(t(j.idea?.question) ? [`השאלה: ${t(j.idea?.question)}`] : [])],
    figures: newest(w.references).slice(0, 3),
    gaps: [
      ...(t(j.context?.inspiration) || w.references.length ? [] : [{ text: 'השראה, בטקסט או בתמונה', stage: 'inspiration' as const }]),
      ...(t(j.concept?.statement) ? [] : [{ text: 'הקונספט', stage: 'inspiration' as const, text_only: true }]),
    ],
  })

  // ---------- 5. the prompt and the image ----------
  const prompt = w.prompts.find((p) => p.images.length) ?? w.prompts[0]
  add('image', 'מהמילים לתמונה', {
    paras: [...(prompt ? [prompt.distill] : []), ...paras(j.prompt?.note), ...paras(j.illustration?.expresses), ...paras(j.illustration?.translates)],
    quote: prompt?.body || undefined,
    figures: newest(prompt?.images.length ? prompt.images : illustrations).slice(0, 2),
    gaps: [
      ...(prompt ? [] : [{ text: 'פרומפט שמור', stage: 'illustration' as const }]),
      ...(illustrations.length ? [] : [{ text: 'תמונה שנוצרה מהפרומפט', stage: 'illustration' as const }]),
      ...(t(j.illustration?.expresses) ? [] : [{ text: 'איך התמונה מבטאת את הרעיון', stage: 'illustration' as const, text_only: true }]),
      ...(t(j.illustration?.translates) ? [] : [{ text: 'איך היא מתורגמת למבנה', stage: 'illustration' as const, text_only: true }]),
    ],
  })

  // ---------- 6. the model ----------
  const bare = newest(w.stills.bare)[0]
  add('model', 'המודל', {
    paras: [...paras(j.form?.decisions), ...(part('shape') ? [`${part('shape')}.`] : []), ...(w.reading ? [w.reading.space] : []), ...(n?.fit_note ? [`מה אבד בתרגום: ${n.fit_note}`] : [])],
    figures: bare ? [bare] : [],
    facts: w.metrics.filter((m) => /^(קוטר חיצוני|גובה חופשי|מספר קצוות|משקל משוער|שטח מעטפת)/.test(m.label)),
    gaps: [
      ...(r ? [] : [{ text: 'מתכון שמור', stage: 'model' as const }]),
      ...(bare ? [] : [{ text: 'מבט ערום קפוא', stage: 'model' as const }]),
      ...(t(j.form?.decisions) ? [] : [{ text: 'ההחלטות בפיתוח', stage: 'model' as const, text_only: true }]),
    ],
  })

  // ---------- 7. material and environment ----------
  const real = newest(w.stills.realistic)[0]
  add('environment', 'חומר וסביבה', {
    paras: [...paras(j.environment?.decisions), ...[part('material'), part('context'), part('light')].filter((x): x is string => !!x).map((x) => `${x}.`), ...(w.reading ? [w.reading.figure_ground] : [])],
    figures: real ? [real] : [],
    gaps: [
      ...(real ? [] : [{ text: 'מבט ריאליסטי קפוא', stage: 'environment' as const }]),
      ...(t(j.environment?.decisions) ? [] : [{ text: 'הבחירות של חומר וסביבה', stage: 'environment' as const, text_only: true }]),
    ],
  })

  // ---------- 8. production and presentation ----------
  const scale = t(j.physical?.scale) || w.print
  add('production', 'לייצור ולהצגה', {
    paras: [
      ...(scale ? [`קנה מידה וגודל: ${scale}.`] : []),
      ...(t(j.physical?.material) ? [`חומר וייצור: ${t(j.physical?.material)}.`] : []),
      ...paras(j.physical?.notes),
      ...paras(j.production?.video),
    ],
    gaps: [
      ...(w.print ? [] : [{ text: 'קובץ הדפסה', stage: 'production' as const }]),
      ...(w.hasClip ? [] : [{ text: 'סרטון', stage: 'production' as const }]),
      ...(t(j.physical?.notes) ? [] : [{ text: 'מה למדנו מהמעבר לפיזי', stage: 'production' as const, text_only: true }]),
    ],
  })

  // ---------- 9. the result ----------
  const resultFigures = (w.photos.length ? newest(w.photos) : newest(w.stills.render)).slice(0, 2)
  add('result', 'התוצאה', {
    paras: [...paras(j.documentation?.result), ...paras(j.documentation?.lessons)],
    figures: resultFigures,
    gaps: [
      ...(resultFigures.length ? [] : [{ text: 'צילום או הדמיה של התוצאה', stage: 'exhibition' as const }]),
      ...(t(j.documentation?.result) ? [] : [{ text: 'תיאור התוצאה', stage: 'exhibition' as const, text_only: true }]),
    ],
  })

  // ---------- one sentence ----------
  const closing = w.reading?.synthesis ?? w.post?.short ?? null
  add('closing', 'במשפט אחד', {
    paras: closing ? [closing] : [],
    gaps: closing ? [] : [{ text: 'משפט מסכם: פרשנות בסטודיו, או טיוטה של Claude', stage: 'model', text_only: true }],
  })

  const title = t(j.exhibition?.title) || n?.name_he || t(j.idea?.title) || w.project.title_he
  const subtitle = t(j.exhibition?.subtitle) || n?.maxim || null
  const byline = [t(j.exhibition?.author), t(j.exhibition?.venue)].filter(Boolean).join(' · ') || null
  const cover = newest(w.stills.render)[0] ?? newest(illustrations)[0] ?? newest(w.photos)[0] ?? real ?? bare ?? null
  const lead = t(j.concept?.statement).split(/(?<=[.!?])\s/)[0] || null
  const headGaps: Gap[] = [...(cover ? [] : [{ text: 'תמונת שער', stage: 'illustration' as const }]), ...(t(j.exhibition?.author) ? [] : [{ text: 'שם הכותבת', stage: 'exhibition' as const }])]

  return {
    title,
    subtitle,
    byline,
    lead,
    cover,
    sections,
    colophon: [
      `${w.versions.length ? `${w.versions.length === 1 ? 'גרסה אחת' : `${w.versions.length} גרסאות`}, מ-${dateHe(w.versions[0]!.created_at)} עד ${dateHe(w.versions.at(-1)!.created_at)}.` : `הפרויקט נפתח ב-${dateHe(w.project.created_at)}.`}`,
      `נוצר ב"יוצר: מתמטיקה", https://math-creator.vercel.app. המאמר מורכב מחומרי העבודה של הפרויקט${edits.drafted ? ', בניסוח ראשון של Claude שנערך' : ''}.`,
    ],
    gaps: [...headGaps, ...sections.flatMap((s) => s.gaps)],
  }
}

/** The materials of every section, as Claude reads them to draft the article. */
export const articleMaterials = (a: Article): Partial<Record<SectionKey, string>> => Object.fromEntries(a.sections.map((s) => [s.key, [...s.composed, ...(s.quote ? [`פרומפט: ${s.quote}`] : []), ...s.facts.map((f) => `${f.label}: ${f.value}`)].join('\n\n')]))

/** A file name that survives every browser: Chrome drops a Hebrew download name. */
export function articleFileName(w: WorkState, ext: 'pdf' | 'docx', at = new Date()): string {
  const latin = (w.recipe?.concept.name ?? chosenConcept(w)?.name ?? w.project.concept).normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-') || 'project'
  return `${latin}-article-${at.toISOString().slice(0, 10)}.${ext}`
}
