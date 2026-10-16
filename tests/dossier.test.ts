/** The project's document: its order (end to beginning, focused to detailed) and the Word file it makes. */
import { Packer } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildDossier, coverImage, dossierFileName, type DossierImage, type DossierInput } from '../src/dossier/content'
import { dossierDocument } from '../src/dossier/docx'
import { parseRecipe } from '../src/recipe/schema'
import { fixture } from './helpers'

const img = (id: string, stage: DossierImage['stage'], source: DossierImage['source'], at: string): DossierImage => ({
  id,
  stage,
  source,
  src: `https://x/${id}`,
  caption: `תמונה ${id}`,
  created_at: at,
})

function input(extra: Partial<DossierInput> = {}): DossierInput {
  const p = parseRecipe(fixture('umbilic-torus'))
  if (!p.ok) throw new Error('fixture')
  return {
    recipe: p.recipe as DossierInput['recipe'],
    projectTitle: 'הטבעת המשולשת',
    versions: [
      { number: 1, created_at: '2026-10-13T10:00:00Z', note: null },
      { number: 2, created_at: '2026-10-15T10:00:00Z', note: 'עובי' },
    ],
    images: [
      img('b1', 'bare', 'still', '2026-10-14T10:00:00Z'),
      img('r1', 'realistic', 'still', '2026-10-14T11:00:00Z'),
      img('h1', 'render', 'still', '2026-10-15T09:00:00Z'),
      img('h2', 'render', 'still', '2026-10-15T12:00:00Z'),
      img('v1', 'recipe', 'version', '2026-10-13T10:00:00Z'),
      img('v2', 'recipe', 'version', '2026-10-15T10:00:00Z'),
    ],
    reading: { logic: 'לוגי.', space: 'מרחבי.', figure_ground: 'פוזיטיב.', synthesis: 'משפט מחבר.' },
    post: { short: 'שורה אחת.', body: 'פסקה ראשונה.\n\nפסקה שנייה.' },
    prompt: null,
    metrics: [
      { label: 'קוטר חיצוני', value: "50.4 מ'" },
      { label: 'מספר קצוות', value: '1 רציף' },
      { label: 'גובה חופשי', value: "4.65–6.3 מ'" },
    ],
    figureGround: [{ label: 'הגבול', value: 'קצה אחד רציף', why: 'הקו שמפריד.' }],
    print: '1:324, הצלע הארוכה 150 מ"מ',
    hasClip: true,
    ...extra,
  }
}

describe('dossier content', () => {
  it('walks the way back: from the print to the concept', () => {
    const d = buildDossier(input())
    expect(d.journey.map((s) => s.stage)).toEqual(['print', 'render', 'realistic', 'bare', 'recipe', 'concept'])
    expect(d.journey.map((s) => s.num)).toEqual(['06', '05', '04', '03', '02', '01'])
  })

  it('orders the forms of distillation from the tightest to the widest', () => {
    const forms = buildDossier(input()).ladder.map((r) => r.form)
    expect(forms.slice(0, 6)).toEqual(['שם', 'פתגם', 'סינתזה', 'פוסט קצר', 'תובנה', 'פוסט'])
    expect(forms).toContain('פרשנות')
    expect(forms.indexOf('מספרים')).toBeLessThan(forms.indexOf('פרומפט'))
  })

  it('leaves out forms that were never written', () => {
    const forms = buildDossier(input({ reading: null, post: null, figureGround: [] })).ladder.map((r) => r.form)
    expect(forms).not.toContain('סינתזה')
    expect(forms).not.toContain('פוסט')
    expect(forms).not.toContain('מספרים')
    expect(forms).toContain('פרומפט')
  })

  it('puts the newest render on the cover, and an owner choice wins', () => {
    const i = input()
    expect(coverImage(i.images)?.id).toBe('h2')
    expect(coverImage(i.images.filter((x) => x.stage !== 'render'))?.id).toBe('r1')
    expect(coverImage(i.images, 'b1')?.id).toBe('b1')
    expect(coverImage([])).toBeNull()
  })

  it('shows where the recipe started and where it ended', () => {
    const recipe = buildDossier(input()).journey.find((s) => s.stage === 'recipe')!
    expect(recipe.images.map((x) => x.id)).toEqual(['v1', 'v2'])
    expect(recipe.decided.join(' ')).toContain('2 גרסאות')
  })

  it('carries the numbers onto the cover and the print onto its step', () => {
    const d = buildDossier(input())
    expect(d.cover.facts.map((f) => f.label)).toEqual(['קוטר חיצוני', 'מספר קצוות', 'גובה חופשי', 'מקום'])
    expect(d.cover.facts.at(-1)).toEqual({ label: 'מקום', value: 'אשדוד', sub: 'Ashdod, Israel' })
    expect(d.journey[0]!.decided[0]).toContain('150 מ"מ')
  })

  it('names the file by the concept and the date', () => {
    expect(dossierFileName(buildDossier(input()), 'pdf', new Date('2026-10-16T08:00:00Z'))).toBe('Umbilic-torus-dossier-2026-10-16.pdf')
  })
})

describe('dossier Word file', () => {
  it('is a right-to-left A4 document with every section and image', async () => {
    const d = buildDossier(input())
    // A 1×1 white JPEG is enough for the image parts.
    const jpeg = Uint8Array.from(
      atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='),
      (c) => c.charCodeAt(0),
    )
    const bytes = new Map(['h2', 'r1', 'b1', 'v1', 'v2'].map((id) => [id, { data: jpeg, width: 3, height: 2 }]))
    const buf = await Packer.toBuffer(dossierDocument(d, bytes))
    const files = unzipSync(new Uint8Array(buf))
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('<w:bidi/>')
    expect(xml).toContain('<w:rtl/>')
    expect(xml).toContain('w:w="11906"')
    for (const t of [d.title, 'צורות הזיקוק', 'הדרך לאחור', 'השיטה', 'משפט מחבר.', '06 הדפסה', '01 מושג']) expect(xml).toContain(t)
    // Cover, render (h1 has no bytes, so only h2), realistic, bare, and the first and last version.
    expect(xml.match(/<w:drawing>/g)?.length).toBe(6)
  })
})

describe('dossier Word text', () => {
  it('writes a range in words, since Word has no isolates', async () => {
    const { plain } = await import('../src/dossier/docx')
    expect(plain("⁦4.65–7.80⁩ מ'")).toBe("4.65 עד 7.80 מ'")
    expect(plain('בלי שינוי')).toBe('בלי שינוי')
  })
})
