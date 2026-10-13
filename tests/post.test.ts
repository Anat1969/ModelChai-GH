/** The pure core of concept-post: what Claude reads, and how its answer is accepted or refused. */
import { describe, expect, it } from 'vitest'
import { parsePost, postUserMessage } from '../supabase/functions/concept-post/src/core'
import { fixture } from './helpers'

describe('concept-post core', () => {
  it('sends only the fields a reader can see', () => {
    const r = fixture('umbilic-torus')
    r.generator.params.resolution = { path_segments: 999, section_segments: 77 }
    const msg = postUserMessage({ recipe: r, prompt: 'P', metrics: { 'קוטר חיצוני': "50.4 מ'" } })
    expect(msg).toContain('"name_he": "טורוס טבורי"')
    expect(msg).toContain('Ashdod')
    expect(msg).toContain("קוטר חיצוני: 50.4 מ'")
    expect(msg).toContain('Visual prompt on screen:\nP')
    expect(msg).not.toContain('path_segments')
    expect(msg).not.toContain(r.meta.id)
  })

  it('reads the JSON answer, with or without a code fence', () => {
    const a = parsePost('```json\n{"short": "שורה", "post": "פסקה.\\n\\nעוד."}\n```')
    expect(a).toEqual({ ok: true, post: { short: 'שורה', post: 'פסקה.\n\nעוד.' } })
  })

  it.each([
    ['no JSON', 'just text'],
    ['missing field', '{"short": "x"}'],
    ['empty', '{"short": " ", "post": "x"}'],
    ['emoji', '{"short": "x", "post": "שמש ☀ גבוהה"}'],
  ])('refuses %s', (_name, text) => {
    expect(parsePost(text).ok).toBe(false)
  })
})

import { parseReading, readingUserMessage } from '../supabase/functions/concept-post/src/core'

describe('concept-post reading mode', () => {
  it('sends the figure-ground numbers, and no post instruction', () => {
    const msg = readingUserMessage({ recipe: fixture('umbilic-torus'), figureGround: { 'בתוכנית: בנוי מול חצר': 'x' } })
    expect(msg).toContain('Figure-ground numbers:\n- בתוכנית: בנוי מול חצר: x')
    expect(msg).toContain('Write the reading now.')
    expect(msg).not.toContain('Write the post now')
  })
  it('reads all four parts, and refuses a missing one', () => {
    const ok = parseReading('{"logic":"a","space":"b","figure_ground":"c","synthesis":"d"}')
    expect(ok).toEqual({ ok: true, reading: { logic: 'a', space: 'b', figure_ground: 'c', synthesis: 'd' } })
    expect(parseReading('{"logic":"a","space":"b","synthesis":"d"}').ok).toBe(false)
  })
})
