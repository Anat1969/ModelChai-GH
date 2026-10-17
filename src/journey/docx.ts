/**
 * The exhibition article as a Word file, for editing (DECISIONS.md 97). Only the article: gaps are marks on the
 * screen, not text, so they never reach the file. Same RTL helpers as the project document.
 */
import { HeadingLevel, Packer, Document, type ParagraphChild } from 'docx'
import { FONT, FULL, GRAY, h2, image, note, pair, para, run, type ImageBytes } from '../dossier/docx'
import type { Article } from './article'

export function articleDocument(a: Article, bytes: Map<string, ImageBytes>): Document {
  const body = []
  if (a.byline) body.push(para([run(a.byline, { size: 10, color: GRAY })], { after: 60 }))
  body.push(para([run(a.title, { size: 30, bold: true })], { heading: HeadingLevel.TITLE, after: 60 }))
  if (a.subtitle) body.push(para([run(a.subtitle, { size: 16, bold: true, color: GRAY })], { after: 200 }))
  const cover = image(a.cover, bytes, FULL)
  if (cover) {
    body.push(para([cover], { after: 60 }))
    body.push(note(a.cover!.caption))
  }
  if (a.lead) body.push(para([run(a.lead, { size: 14 })], { after: 240 }))

  for (const s of a.sections) {
    if (!s.paras.length && !s.figures.length && !s.quote && !s.facts.length) continue
    body.push(h2(`${s.num} ${s.heading}`))
    for (const p of s.paras) body.push(para(p))
    if (s.quote) body.push(para([run(s.quote, { size: 11, color: GRAY, italics: true })], { after: 160 }))
    const pics = s.figures.map((f) => image(f, bytes, s.figures.length > 1 ? 312 : 470)).filter((x): x is ParagraphChild => !!x)
    if (pics.length) {
      body.push(
        para(
          pics.flatMap((p, i) => (i ? [run('  '), p] : [p])),
          { after: 60 },
        ),
      )
      body.push(note(s.figures.map((f) => f.caption).join(' | ')))
    }
    for (const f of s.facts) body.push(pair(f.label, f.value))
  }
  body.push(para('', { after: 240 }))
  for (const c of a.colophon) body.push(para([run(c, { size: 9, color: GRAY })], { after: 60 }))

  return new Document({
    creator: 'יוצר: מתמטיקה',
    title: a.title,
    description: a.subtitle ?? '',
    styles: { default: { document: { run: { font: FONT, size: 22, sizeComplexScript: 22, rightToLeft: true } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: body }],
  })
}

export const articleDocx = (a: Article, bytes: Map<string, ImageBytes>) => Packer.toBlob(articleDocument(a, bytes))
