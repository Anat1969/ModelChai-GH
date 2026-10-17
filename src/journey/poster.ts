/**
 * The exhibition flyer (DECISIONS.md 127), in the magazine-page format: one large image, a two-line title on the
 * border between image and ground, the model's own line drawn over the picture, and two columns below: the
 * idea in one sentence beside the model's DNA, and four numbered properties of the model with what each does
 * in space. A closing question, the author and the place.
 *
 * Nothing is invented: every word comes from the project or from the atlas, and every part the owner may
 * rewrite. What is missing is listed, and stays off the page. Pure, so the composition is tested.
 */
import { MODELS, modelById, type Model } from '../learn/atlas'
import { TRAITS } from '../learn/traits'
import { chosenConcept, projectName, type WorkImage, type WorkState } from './stages'

export type PosterFormat = 'a4' | 'a3'

/** What the owner rewrote or chose on the flyer. Kept on the project, with the article's edits. */
export interface PosterEdits {
  kicker?: string
  title1?: string
  title2?: string
  maxim?: string
  /** Three short lines, in place of the skill's haiku. Only the owner writes them. */
  verse?: string
  question?: string
  imageId?: string
  /** Tone of the page: dark ground with light text, or light ground with dark text. */
  tone?: 'dark' | 'light'
}

export interface PosterImage extends WorkImage {
  /** A render or a frozen view is an illustration; a photo is credited. */
  kind: 'render' | 'photo' | 'reference'
}

export interface PosterItem {
  head: string
  text: string
}

export interface Poster {
  kicker: string
  title1: string
  title2: string
  maxim: string
  dna: string
  /** How the model moves people, from the atlas. */
  flow: string
  verse: string[]
  listHead: string
  items: PosterItem[]
  question: string
  author: string
  place: string
  modelId: string | null
  modelName: string
  images: PosterImage[]
  image: PosterImage | null
  /** "הדמיה" on an illustration; a photo carries its credit, or asks for one. */
  imageLabel: string
  video: string | null
  tone: 'dark' | 'light'
  gaps: string[]
}

const t = (s?: string | null) => (s ?? '').trim()
const firstSentence = (s: string) => t(s.split(/(?<=[.!?])\s/)[0])

/** The atlas model behind the project: the one chosen on the path, or the one the recipe names. */
export function posterModel(w: WorkState): Model | null {
  const c = chosenConcept(w)
  if (c?.modelId) return modelById(c.modelId) ?? null
  const name = t(w.recipe?.concept.name).toLowerCase()
  return name ? (MODELS.find((m) => m.name.toLowerCase() === name || m.ask.toLowerCase() === name) ?? null) : null
}

/** The images a flyer can stand on, the strongest first: a photo of the result, a render, a realistic view. */
export function posterImages(w: WorkState): PosterImage[] {
  const newest = <T extends WorkImage>(xs: T[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return [
    ...newest(w.photos).map((i) => ({ ...i, kind: 'photo' as const })),
    ...newest(w.prompts.flatMap((p) => p.images)).map((i) => ({ ...i, kind: 'render' as const })),
    ...newest(w.stills.render).map((i) => ({ ...i, kind: 'render' as const })),
    ...newest(w.stills.realistic).map((i) => ({ ...i, kind: 'render' as const })),
    ...newest(w.stills.bare).map((i) => ({ ...i, kind: 'render' as const })),
    ...newest(w.references).map((i) => ({ ...i, kind: 'reference' as const })),
  ].filter((i) => i.src)
}

export function buildPoster(w: WorkState, e: PosterEdits = {}): Poster {
  const j = w.journey
  const model = posterModel(w)
  const concept = chosenConcept(w)
  const gaps: string[] = []
  const pick = (edit: string | undefined, ...from: (string | undefined | null)[]) => (edit !== undefined ? t(edit) : (from.map(t).find(Boolean) ?? ''))

  const place = t(j.context?.place)
  const kicker = pick(e.kicker, [place, concept?.name_he].filter(Boolean).join(' · '))
  const title1 = pick(e.title1, j.exhibition?.title, projectName(w))
  const title2 = pick(e.title2, j.exhibition?.subtitle, concept ? concept.name_he : '')
  const maxim = pick(e.maxim, j.concept?.statement && firstSentence(j.concept.statement), j.concept?.why && firstSentence(j.concept.why), j.idea?.idea && firstSentence(j.idea.idea))
  const verse = t(e.verse)
    .split('\n')
    .map(t)
    .filter(Boolean)
    .slice(0, 3)

  // Four properties of the model and what each does in space; without an atlas model, the owner's decisions.
  let items: PosterItem[] = []
  let listHead = ''
  if (model) {
    listHead = `מה ה${model.name_he} עושה למרחב`
    items = model.traits.slice(0, 4).map((id) => ({ head: TRAITS[id].label, text: TRAITS[id].space }))
  } else {
    const decisions = [j.form?.decisions, j.environment?.decisions]
      .flatMap((d) => t(d).split(/\n+|(?<=[.!?])\s+/))
      .map(t)
      .filter(Boolean)
    if (decisions.length) {
      listHead = 'ההחלטות בפיתוח'
      items = decisions.slice(0, 4).map((d) => ({ head: '', text: d }))
    }
  }

  const images = posterImages(w)
  const image = images.find((i) => i.id === e.imageId) ?? images[0] ?? null
  const video = /^https?:\/\//.test(t(j.production?.video)) ? t(j.production?.video) : null

  if (!image) gaps.push('תמונה: צילום של התוצאה, הדמיה או מבט ריאליסטי מהסטודיו')
  if (!maxim) gaps.push('משפט אחד שמסכם את הרעיון: בשלב 2, או כאן')
  if (!items.length) gaps.push('מושג מהאטלס, או ההחלטות בפיתוח המודל')
  if (!t(j.exhibition?.author)) gaps.push('שם היוצר או היוצרת: בשלב 9')
  if (!place) gaps.push('המקום, בעברית ובלועזית מלאה: בשלב 3')
  if (image?.kind === 'photo') gaps.push('קרדיט לצילום')

  return {
    kicker,
    title1,
    title2,
    maxim,
    dna: model?.dna[0] ?? '',
    flow: model ? firstSentence(model.flow) : '',
    verse,
    listHead,
    items,
    question: pick(e.question, j.idea?.question),
    author: t(j.exhibition?.author),
    place,
    modelId: model?.id ?? null,
    modelName: model ? `${model.name_he} (${model.name})` : concept ? concept.name_he : '',
    images,
    image,
    imageLabel: image ? (image.kind === 'photo' ? 'צילום: להשלמת קרדיט' : image.kind === 'reference' ? 'השראה' : 'הדמיה') : '',
    video,
    tone: e.tone ?? 'dark',
    gaps,
  }
}

/** The one accent color, taken from the light in the image: the mean of its bright, saturated pixels. */
export function accentOf(rgba: Uint8ClampedArray, tone: 'dark' | 'light' = 'dark'): string {
  let r = 0,
    g = 0,
    b = 0,
    wsum = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const R = rgba[i]!,
      G = rgba[i + 1]!,
      B = rgba[i + 2]!
    const max = Math.max(R, G, B),
      min = Math.min(R, G, B)
    const sat = max ? (max - min) / max : 0
    if (max < 90 || sat < 0.25) continue
    const w = sat * sat * (max / 255)
    r += R * w
    g += G * w
    b += B * w
    wsum += w
  }
  if (wsum === 0) return tone === 'dark' ? '#d9b26a' : '#9a6a1f'
  // Push it toward the brightness the ground needs: light on dark, deep on light.
  let [h, s, l] = hsl(r / wsum, g / wsum, b / wsum)
  s = Math.max(s, 0.45)
  l = tone === 'dark' ? Math.min(Math.max(l, 0.62), 0.74) : Math.min(Math.max(l, 0.3), 0.4)
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

export const posterFileName = (w: WorkState, format: PosterFormat, ext: 'pdf' | 'png') => `flyer-${format}-${w.project.id.slice(0, 8)}.${ext}`
