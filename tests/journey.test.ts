/** The work path: each step's state from what the project holds, the article composed from it, and its pages. */
import { Packer } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildArticle } from '../src/journey/article'
import { articleDocument } from '../src/journey/docx'
import { paginate } from '../src/journey/paginate'
import { doneCount, nextStage, projectName, STAGES, stageStatus, type WorkState } from '../src/journey/stages'
import { parseRecipe } from '../src/recipe/schema'
import { fixture } from './helpers'

const empty = (): WorkState => ({
  project: { id: 'p', title_he: 'שער הים', concept: 'שער הים', created_at: '2026-10-17T08:00:00Z' },
  journey: { idea: { title: 'שער הים' } },
  recipe: null,
  versions: [],
  reading: null,
  post: null,
  prompts: [],
  references: [],
  stills: { bare: [], realistic: [], render: [] },
  print: null,
  hasClip: false,
  photos: [],
  metrics: [],
})

const pic = (id: string) => ({ id, src: `data:${id}`, caption: `תמונה ${id}`, created_at: '2026-10-17T09:00:00Z' })

function full(): WorkState {
  const p = parseRecipe(fixture('umbilic-torus'))
  if (!p.ok) throw new Error('fixture')
  return {
    ...empty(),
    journey: {
      idea: { title: 'שער הים', idea: 'מבנה שמחבר את העיר לים.', intent: 'לעצור רגע לפני המים.', question: 'האם קו אחד יכול להיות גם פנים וגם חוץ?' },
      context: { place: 'אשדוד (Ashdod, Israel)', use: 'ביתן ציבורי', inspiration: 'הגלים שחוזרים אל עצמם.' },
      concept: { why: 'לטורוס הטבורי יש קצה אחד.' },
      illustration: { expresses: 'הקצה האחד נראה כקו של אור.', translates: 'הקו הופך לשביל.' },
      form: { decisions: "עובי 1 מ', שלושה מעברים." },
      physical: { notes: 'החודים דרשו עיבוי.' },
      documentation: { result: 'המודל עומד על החוד.' },
      exhibition: { author: 'ענת' },
    },
    recipe: p.recipe as WorkState['recipe'],
    versions: [{ id: 'v1', number: 1, created_at: '2026-10-17T09:00:00Z', note: null }],
    reading: { logic: 'לוגי.', space: 'מרחבי.', figure_ground: 'פוזיטיב.', synthesis: 'משפט מחבר.' },
    prompts: [{ id: 'pr', distill: 'זיקוק.', body: 'פרומפט מלא', created_at: '2026-10-17T09:00:00Z', images: [pic('i1')] }],
    references: [pic('r1')],
    stills: { bare: [pic('b1')], realistic: [pic('re1')], render: [pic('h1')] },
    print: '1:324, 150 מ"מ',
    photos: [pic('ph1')],
    metrics: [{ label: 'קוטר חיצוני', value: "50.4 מ'" }],
  }
}

describe('work path', () => {
  it('has nine steps in the order of the work', () => {
    expect(STAGES.map((s) => s.title)).toEqual([
      'רעיון וכוונה',
      'הקשר והשראה',
      'גיבוש קונספט',
      'כתיבת פרומפט',
      'יצירת תמונה והמחשה',
      'פיתוח צורני וחומרי',
      'תרגום למבנה פיזי',
      'תיעוד התוצאה',
      'עריכה לתערוכה',
    ])
    for (const s of STAGES) expect(s.goal && s.leans && s.yields && s.fields.length).toBeTruthy()
  })

  it('a new project shows what is missing on every step, and starts from the first', () => {
    const w = empty()
    expect(STAGES.map((s) => stageStatus(s.id, w).state)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'])
    expect(stageStatus('idea', w).missing).toEqual(['הרעיון', 'הכוונה'])
    expect(nextStage(w).id).toBe('idea')
    expect(doneCount(w)).toBe(0)
  })

  it('a filled project is done on every step', () => {
    const w = full()
    expect(STAGES.map((s) => [s.id, stageStatus(s.id, w).missing])).toEqual(STAGES.map((s) => [s.id, []]))
    expect(doneCount(w)).toBe(9)
  })

  it('an old project made from a concept already counts its recipe, views and print', () => {
    const w = { ...full(), journey: {} }
    expect(stageStatus('concept', w)).toMatchObject({ state: 'partial', missing: ['למה המושג הזה'] })
    expect(stageStatus('form', w).have).toContain('מבט קפוא, ערום או ריאליסטי')
    expect(stageStatus('physical', w).have).toContain('קובץ הדפסה')
    expect(nextStage(w).id).toBe('idea')
    expect(projectName(w)).toBe(w.recipe!.narrative.name_he)
  })

  it('an image uploaded without its prompt marks the prompt as missing', () => {
    const w = { ...full(), prompts: [{ id: 'x', distill: 'תמונה שהועלתה בלי פרומפט', body: '', created_at: '2026-10-17T09:00:00Z', images: [pic('i2')] }] }
    expect(stageStatus('prompt', w).missing).toEqual(['נוסח הפרומפט של תמונה שהועלתה בלי פרומפט'])
    expect(stageStatus('illustration', w).state).toBe('done')
  })
})

describe('exhibition article', () => {
  it('tells the story in the order of the work, from the idea to the result', () => {
    const a = buildArticle(full())
    expect(a.sections.map((s) => s.heading)).toEqual(['הרעיון', 'המקום וההשראה', 'המושג המתמטי', 'מהמילים לתמונה', 'ההמחשה', 'הצורה והחומר', 'המבנה הפיזי', 'התוצאה', 'במשפט אחד'])
    expect(a.gaps).toEqual([])
    expect(a.cover?.id).toBe('h1')
    expect(a.sections[0]!.paras).toEqual(['מבנה שמחבר את העיר לים.', 'הכוונה: לעצור רגע לפני המים.', 'השאלה: האם קו אחד יכול להיות גם פנים וגם חוץ?'])
    expect(a.sections.find((s) => s.key === 'illustration')!.figures.map((f) => f.id)).toEqual(['i1'])
    expect(a.sections.find((s) => s.key === 'documentation')!.figures.map((f) => f.id)).toEqual(['ph1'])
    expect(a.byline).toBe('ענת')
  })

  it('invents nothing: an empty project is gaps that name their steps', () => {
    const a = buildArticle(empty())
    expect(a.sections.every((s) => s.paras.length === 0 && s.figures.length === 0)).toBe(true)
    expect(a.title).toBe('שער הים')
    const stages = new Set(a.gaps.map((g) => g.stage))
    for (const id of ['idea', 'context', 'concept', 'prompt', 'illustration', 'form', 'physical', 'documentation', 'exhibition']) expect(stages.has(id as never)).toBe(true)
  })

  it('an edit replaces the composed text and answers its text gaps, not its missing images', () => {
    const w = { ...full(), journey: { ...full().journey, illustration: {} } }
    w.prompts = []
    const a = buildArticle(w, { sections: { illustration: 'ההמחשה בעיניי.\n\nפסקה שנייה.' } })
    const s = a.sections.find((x) => x.key === 'illustration')!
    expect(s.edited).toBe(true)
    expect(s.paras).toEqual(['ההמחשה בעיניי.', 'פסקה שנייה.'])
    expect(s.gaps.map((g) => g.text)).toEqual(['תמונה שנוצרה מהפרומפט'])
  })

  it('an emptied section stays empty until the edit is undone', () => {
    const a = buildArticle(full(), { sections: { idea: '' } })
    expect(a.sections[0]).toMatchObject({ edited: true, paras: [] })
    expect(buildArticle(full(), {}).sections[0]!.edited).toBe(false)
  })

  it('becomes a right-to-left Word file without the gap marks', async () => {
    const a = buildArticle({ ...full(), journey: { ...full().journey, documentation: {} } })
    expect(a.gaps.length).toBeGreaterThan(0)
    const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(articleDocument(a, new Map()))))['word/document.xml']!)
    expect(xml).toContain('<w:bidi/>')
    expect(xml).toContain('01 הרעיון')
    expect(xml).toContain('מבנה שמחבר את העיר לים.')
    expect(xml).not.toContain('חסר')
  })
})

describe('article pages', () => {
  it('fills pages by height and never ends a page on a heading', () => {
    expect(paginate([400, 400, 400], [false, false, false], 900)).toEqual([[0, 1], [2]])
    // The heading at 2 would fit, but its paragraph would not: both move on.
    expect(paginate([400, 400, 50, 300], [false, false, true, false], 900)).toEqual([
      [0, 1],
      [2, 3],
    ])
    // A block taller than a page sits alone.
    expect(paginate([1200, 100], [false, false], 900)).toEqual([[0], [1]])
  })
})
