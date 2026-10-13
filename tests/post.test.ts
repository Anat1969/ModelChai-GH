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
