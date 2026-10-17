/** The work path: each step's state from what the project holds, the article composed from it, and its pages. */
import { Packer } from 'docx'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { articleMaterials, buildArticle } from '../src/journey/article'
import { articleDocument } from '../src/journey/docx'
import { flow, paginate, type FlowItem } from '../src/journey/paginate'
import { isStale } from '../src/ui/freshness'
import { doneCount, fieldValue, nextStage, projectName, STAGES, stageById, stageStatus, withField, type WorkState } from '../src/journey/stages'
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
      discover: { saved: ['umbilic_torus', 'mobius'], learned: 'קצה אחד יכול להקיף שלוש פעמים.' },
      idea: { title: 'שער הים', idea: 'מבנה שמחבר את העיר לים.', intent: 'לעצור רגע לפני המים.', question: 'האם קו אחד יכול להיות גם פנים וגם חוץ?' },
      context: { place: 'אשדוד (Ashdod, Israel)', use: 'ביתן ציבורי', inspiration: 'הגלים שחוזרים אל עצמם.' },
      concept: { model: 'umbilic_torus', why: 'לטורוס הטבורי יש קצה אחד.', statement: 'שער שהוא קו אחד.' },
      environment: { decisions: 'אבן ירושלמית, צהרי חורף.' },
      production: { video: 'מעבר כניסה מהחוף.' },
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
    hasClip: true,
    photos: [pic('ph1')],
    metrics: [{ label: 'קוטר חיצוני', value: "50.4 מ'" }],
  }
}

describe('work path', () => {
  it('has nine steps in the order of the work, from learning to the exhibition', () => {
    expect(STAGES.map((s) => s.title)).toEqual(['למידה וגילוי', 'בחירת מושג והבנתו', 'חיבור להקשר ולשימוש', 'השראה וקונספט', 'פיתוח המודל', 'בחינת חומרים וסביבה', 'המחשה', 'הכנה לייצור ולהצגה', 'תיעוד לתערוכה'])
    for (const s of STAGES) expect(s.doing && s.learning && s.leans && s.yields && s.fields.length, s.id).toBeTruthy()
  })

  it('a new project shows what is missing on every step, and starts from learning', () => {
    const w = empty()
    expect(STAGES.map((s) => stageStatus(s.id, w).state).every((x) => x === 'empty')).toBe(true)
    expect(stageStatus('context', w).missing).toEqual(['הרעיון', 'הכוונה', 'מקום או שימוש'])
    expect(nextStage(w).id).toBe('discover')
    expect(doneCount(w)).toBe(0)
  })

  it('a filled project is done on every step', () => {
    const w = full()
    expect(STAGES.map((s) => [s.id, stageStatus(s.id, w).missing])).toEqual(STAGES.map((s) => [s.id, []]))
    expect(doneCount(w)).toBe(9)
  })

  it('an old project keeps its text and counts its recipe, views and print', () => {
    const w = { ...full(), journey: { idea: { idea: 'רעיון ישן', intent: 'כוונה' }, form: { decisions: 'החלטות' } } }
    expect(stageStatus('concept', w)).toMatchObject({ state: 'partial', have: ['מושג נבחר'] })
    expect(stageStatus('model', w).state).toBe('done')
    expect(stageStatus('production', w).have).toContain('קובץ הדפסה')
    expect(stageById('idea')!.id).toBe('context')
    expect(stageById('form')!.id).toBe('model')
    expect(projectName(w)).toBe(w.recipe!.narrative.name_he)
  })

  it('reads and writes fields by their place in the journey', () => {
    const j = withField({}, 'concept.statement', 'קונספט')
    expect(fieldValue(j, 'concept.statement')).toBe('קונספט')
    expect(fieldValue(j, 'idea.idea')).toBe('')
  })

  it('an image uploaded without its prompt marks the prompt as missing', () => {
    const w = { ...full(), prompts: [{ id: 'x', distill: 'תמונה שהועלתה בלי פרומפט', body: '', created_at: '2026-10-17T09:00:00Z', images: [pic('i2')] }] }
    expect(stageStatus('illustration', w).missing).toEqual(['נוסח הפרומפט של תמונה שהועלתה בלי פרומפט'])
  })
})

describe('exhibition article', () => {
  it('tells the development in order: concept, knowledge, context, inspiration, image, model, choices, production, result', () => {
    const a = buildArticle(full())
    expect(a.sections.map((s) => s.heading)).toEqual(['המושג המתמטי', 'הידע שנלמד', 'ההקשר והשימוש', 'ההשראה והקונספט', 'מהמילים לתמונה', 'המודל', 'חומר וסביבה', 'לייצור ולהצגה', 'התוצאה', 'במשפט אחד'])
    expect(a.gaps).toEqual([])
    expect(a.cover?.id).toBe('h1')
    expect(a.sections[0]!.paras[0]).toBe('המושג: טורוס טבורי (Umbilic torus).')
    expect(a.sections[0]!.paras.join(' ')).toContain('ה־DNA שלו')
    expect(a.sections.find((s) => s.key === 'context')!.paras.join(' ')).toContain('למה המושג מתאים לביתן')
    expect(a.sections.find((s) => s.key === 'image')!.figures.map((f) => f.id)).toEqual(['i1'])
    expect(a.sections.find((s) => s.key === 'result')!.figures.map((f) => f.id)).toEqual(['ph1'])
    expect(a.byline).toBe('ענת')
  })

  it('invents nothing: an empty project is gaps that name their steps', () => {
    const a = buildArticle(empty())
    expect(a.sections.every((s) => s.paras.length === 0 && s.figures.length === 0)).toBe(true)
    expect(a.title).toBe('שער הים')
    const stages = new Set(a.gaps.map((g) => g.stage))
    for (const id of STAGES.map((s) => s.id)) expect(stages.has(id), id).toBe(true)
  })

  it('an edit replaces the composed text and answers its text gaps, not its missing images', () => {
    const w = { ...full(), journey: { ...full().journey, illustration: {} }, prompts: [] }
    const s = buildArticle(w, { sections: { image: 'ההמחשה בעיניי.\n\nפסקה שנייה.' } }).sections.find((x) => x.key === 'image')!
    expect(s.edited).toBe(true)
    expect(s.paras).toEqual(['ההמחשה בעיניי.', 'פסקה שנייה.'])
    expect(s.gaps.map((g) => g.text)).toEqual(['פרומפט שמור', 'תמונה שנוצרה מהפרומפט'])
  })

  it('edits made under the earlier keys still land', () => {
    const a = buildArticle(full(), { sections: { idea: 'נוסח ישן', illustration: 'המחשה ישנה' } })
    expect(a.sections.find((s) => s.key === 'context')!.paras).toEqual(['נוסח ישן'])
    expect(a.sections.find((s) => s.key === 'image')!.paras).toEqual(['המחשה ישנה'])
  })

  it('gives Claude every section\'s materials, and nothing for an empty one', () => {
    const m = articleMaterials(buildArticle(empty()))
    expect(Object.values(m).every((v) => v === '')).toBe(true)
    expect(articleMaterials(buildArticle(full())).concept).toContain('טורוס טבורי')
  })

  it('becomes a right-to-left Word file without the gap marks', async () => {
    const a = buildArticle({ ...full(), journey: { ...full().journey, documentation: {} } })
    expect(a.gaps.length).toBeGreaterThan(0)
    const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(articleDocument(a, new Map()))))['word/document.xml']!)
    expect(xml).toContain('<w:bidi/>')
    expect(xml).toContain('01 המושג המתמטי')
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

describe('article flow (DECISIONS.md 126)', () => {
  // Every sentence is 100 px tall.
  const byLine = (_i: number, from: number, to: number) => (to - from) * 100
  const text = (n: number, group = 'a'): FlowItem => ({ h: n * 100, sentences: n, group })

  it('cuts a paragraph between sentences to fill the page to its foot', () => {
    const pages = flow([text(3), text(5)], 600, byLine)
    expect(pages).toEqual([[{ i: 0 }, { i: 1, from: 0, to: 3 }], [{ i: 1, from: 3, to: 5 }]])
  })

  it('shortens a figure that nearly fits, and moves one that does not while its text fills the room', () => {
    const fig: FlowItem = { h: 500, figure: { fixed: 40, img: 460 }, group: 'a' }
    // 400 left: the image shrinks to 360 px, more than 60% of 460.
    expect(flow([text(2), fig], 600, byLine)).toEqual([[{ i: 0 }, { i: 1, imgH: 360 }]])
    // 200 left: too short for the image; the text after it fills the page, and it opens the next one.
    expect(flow([text(4), fig, text(3)], 600, byLine)).toEqual([
      [{ i: 0 }, { i: 2, from: 0, to: 2 }],
      [{ i: 1 }, { i: 2, from: 2, to: 3 }],
    ])
  })

  it('never ends a page on a heading, and lets the first page differ', () => {
    const pages = flow([text(5), { h: 50, keep: true, group: 'b' }, text(3, 'b')], (n) => (n === 0 ? 560 : 900), byLine)
    expect(pages[0]).toEqual([{ i: 0 }])
    expect(pages[1]![0]).toEqual({ i: 1 })
  })
})

describe('fresh version', () => {
  it('is stale only when the deploy serves another build', () => {
    expect(isStale('a1', 'b2')).toBe(true)
    expect(isStale('a1', 'a1')).toBe(false)
    expect(isStale('a1', null)).toBe(false)
  })
})
