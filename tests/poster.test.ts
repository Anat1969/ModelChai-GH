/** The exhibition flyer (DECISIONS.md 127): composed only from the project and the atlas, every part rewritable. */
import { describe, expect, it } from 'vitest'
import { accentOf, buildPoster, posterImages } from '../src/journey/poster'
import { TRAITS } from '../src/learn/traits'
import type { WorkState } from '../src/journey/stages'

const pic = (id: string, at = '2026-10-17T09:00:00Z') => ({ id, src: `data:${id}`, caption: `תמונה ${id}`, created_at: at })

const base = (): WorkState => ({
  project: { id: 'p1234567890', title_he: 'שער הים', concept: 'שער הים', created_at: '2026-10-17T08:00:00Z' },
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

describe('flyer', () => {
  it('composes the page from the project and the atlas', () => {
    const w = base()
    w.journey = {
      idea: { title: 'שער הים', question: 'איפה נגמר הרחוב שלך?' },
      context: { place: 'אשדוד (Ashdod, Israel)' },
      concept: { model: 'umbilic_torus', statement: 'שער שהוא קו אחד. ועוד משפט.' },
      exhibition: { author: 'ענת' },
      production: { video: 'https://example.org/v.mp4' },
    }
    w.stills.render = [pic('h1')]
    const p = buildPoster(w)
    expect(p.kicker).toBe('אשדוד (Ashdod, Israel) · טורוס טבורי')
    expect(p.title1).toBe('שער הים')
    expect(p.title2).toBe('טורוס טבורי')
    expect(p.maxim).toBe('שער שהוא קו אחד.')
    expect(p.items).toHaveLength(4)
    expect(p.items[0]).toEqual({ head: TRAITS.single_edge.label, text: TRAITS.single_edge.space })
    expect(p.question).toBe('איפה נגמר הרחוב שלך?')
    expect(p.imageLabel).toBe('הדמיה')
    expect(p.video).toBe('https://example.org/v.mp4')
    expect(p.modelId).toBe('umbilic_torus')
    expect(p.gaps).toEqual([])
  })

  it('invents nothing: what is missing is listed and left off the page', () => {
    const p = buildPoster(base())
    expect(p.maxim).toBe('')
    expect(p.items).toEqual([])
    expect(p.verse).toEqual([])
    expect(p.image).toBeNull()
    expect(p.video).toBeNull()
    expect(p.gaps.length).toBeGreaterThanOrEqual(4)
  })

  it('lets every part be rewritten, and an empty edit clears it', () => {
    const w = base()
    w.journey.concept = { model: 'mobius' }
    const p = buildPoster(w, { title2: 'קו שמתהפך', verse: 'שורה\nשנייה\nשלישית\nרביעית', kicker: '' })
    expect(p.title2).toBe('קו שמתהפך')
    expect(p.verse).toEqual(['שורה', 'שנייה', 'שלישית'])
    expect(p.kicker).toBe('')
  })

  it('stands on a photo of the result first, and credits it', () => {
    const w = base()
    w.stills.render = [pic('h1', '2026-10-18T00:00:00Z')]
    w.photos = [pic('ph1')]
    expect(posterImages(w).map((i) => i.id)).toEqual(['ph1', 'h1'])
    const p = buildPoster(w)
    expect(p.imageLabel).toBe('צילום: להשלמת קרדיט')
    expect(buildPoster(w, { imageId: 'h1' }).image?.id).toBe('h1')
  })

  it('takes one accent from the light of the image', () => {
    // Half warm gold, half grey: the grey is ignored.
    const px = new Uint8ClampedArray(4 * 100)
    for (let i = 0; i < 100; i++) px.set(i < 50 ? [220, 170, 80, 255] : [128, 128, 128, 255], i * 4)
    const a = accentOf(px, 'dark')
    const hue = Number(/hsl\((\d+)/.exec(a)![1])
    expect(hue).toBeGreaterThan(30)
    expect(hue).toBeLessThan(45)
    expect(accentOf(new Uint8ClampedArray(400), 'light')).toBe('#9a6a1f')
  })
})
