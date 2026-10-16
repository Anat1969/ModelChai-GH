/**
 * The project's document as a Word file, for editing (DECISIONS.md 92). Same order as the screen: the flyer,
 * the forms of distillation, the way back, the method. Hebrew right to left in every paragraph and run, A4,
 * real headings so Word's navigation pane shows the structure. No DOM: it runs in the browser and in tests.
 */
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, TextRun, type ParagraphChild } from 'docx'
import type { Dossier, DossierImage } from './content'

export interface ImageBytes {
  data: Uint8Array
  width: number
  height: number
}

const FONT = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial', eastAsia: 'Arial' }
const GRAY = '4A4A4A'
/** Text width of A4 with 2 cm margins, in pixels at 96 dpi. */
const FULL = 642

/** Word has no isolates: a range "4.65–7.80" inside them is written in words, so it reads right in a Hebrew line. */
export const plain = (text: string) => text.replace(/\u2066([^\u2069]*)\u2069/g, (_, inner: string) => inner.replace(/^([\d.,]+)–([\d.,]+)$/, '$1 עד $2')).replace(/[\u2066-\u2069]/g, '')

function run(text: string, o: { size?: number; bold?: boolean; color?: string; italics?: boolean } = {}) {
  const size = (o.size ?? 11) * 2
  return new TextRun({
    text: plain(text),
    rightToLeft: true,
    font: FONT,
    size,
    sizeComplexScript: size,
    bold: o.bold,
    boldComplexScript: o.bold,
    italics: o.italics,
    italicsComplexScript: o.italics,
    color: o.color,
  })
}

function para(
  children: ParagraphChild[] | string,
  o: { size?: number; bold?: boolean; color?: string; after?: number; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; center?: boolean; pageBreak?: boolean } = {},
) {
  const kids = typeof children === 'string' ? [run(children, o)] : children
  return new Paragraph({
    bidirectional: true,
    alignment: o.center ? AlignmentType.CENTER : AlignmentType.START,
    heading: o.heading,
    spacing: { after: o.after ?? 160, line: 300 },
    children: o.pageBreak ? [new PageBreak(), ...kids] : kids,
  })
}

const h1 = (text: string, pageBreak = true) => para([run(text, { size: 22, bold: true })], { heading: HeadingLevel.HEADING_1, after: 240, pageBreak })
const h2 = (text: string) => para([run(text, { size: 15, bold: true })], { heading: HeadingLevel.HEADING_2, after: 80 })
const note = (text: string) => para([run(text, { size: 10, color: GRAY, italics: true })], { after: 120 })
const pair = (label: string, value: string) => para([run(`${label}: `, { bold: true }), run(value)], { after: 100 })

function image(img: DossierImage | null | undefined, bytes: Map<string, ImageBytes>, width: number): ParagraphChild | null {
  const b = img ? bytes.get(img.id) : undefined
  if (!b) return null
  return new ImageRun({ type: 'jpg', data: b.data, transformation: { width, height: Math.round((width * b.height) / b.width) } })
}

export function dossierDocument(d: Dossier, bytes: Map<string, ImageBytes>): Document {
  const body: Paragraph[] = []

  // ---------- the flyer ----------
  body.push(para([run(d.eyebrow, { size: 10, color: GRAY })], { after: 60 }))
  body.push(para([run(d.title, { size: 30, bold: true })], { heading: HeadingLevel.TITLE, after: 40 }))
  body.push(para([run(d.concept, { size: 12, color: GRAY })], { after: 200 }))
  const hero = image(d.cover.image, bytes, FULL)
  if (hero) body.push(para([hero], { after: 80 }))
  if (d.cover.image) body.push(note(d.cover.image.caption))
  body.push(para([run(d.cover.maxim, { size: 18, bold: true })], { after: 160 }))
  if (d.cover.synthesis) body.push(para([run(d.cover.synthesis, { size: 13 })], { after: 160 }))
  if (d.cover.short) body.push(para([run(d.cover.short, { size: 11, color: GRAY })], { after: 200 }))
  for (const f of d.cover.facts) body.push(pair(f.label, f.sub ? `${f.value} (${f.sub})` : f.value))

  // ---------- the forms of distillation ----------
  body.push(h1('צורות הזיקוק: מהשם אל הפרומפט'))
  body.push(note('אותו ידע בגדלים שונים, מהצורה המרוכזת ביותר אל המפורטת.'))
  for (const r of d.ladder) {
    body.push(h2(r.form))
    body.push(note(r.why))
    for (const t of r.text ?? []) body.push(para(t))
    for (const p of r.pairs ?? []) {
      body.push(pair(p.label, p.value))
      if (p.note) body.push(note(p.note))
    }
  }

  // ---------- the way back ----------
  body.push(h1('הדרך לאחור: מההדפסה אל המושג'))
  body.push(note('כל תחנה עונה על שאלה אחת בין המתמטיקה לאדריכלות. התמונות שייכות לגרסאות ולנקודות המבט שיצרו אותן.'))
  for (const s of d.journey) {
    body.push(h2(`${s.num} ${s.label}`))
    body.push(para([run(s.question, { bold: true, color: GRAY })], { after: 120 }))
    const pics = s.images.map((i) => image(i, bytes, s.images.length > 1 ? 312 : 470)).filter((x): x is ParagraphChild => !!x)
    if (pics.length) {
      const spaced = pics.flatMap((p, i) => (i ? [run('  '), p] : [p]))
      body.push(para(spaced, { after: 60 }))
      body.push(note(s.images.map((i) => i.caption).join(' | ')))
    }
    for (const x of s.decided) body.push(para([run('— ', { color: GRAY }), run(x)], { after: 60 }))
    for (const t of s.text) body.push(para(t))
  }

  // ---------- the method ----------
  body.push(h1('השיטה: מהרעיון לביצוע'))
  for (const m of d.method) {
    body.push(h2(m.title))
    for (const t of m.text ?? []) body.push(para(t))
    for (const p of m.pairs ?? []) body.push(pair(p.label, p.value))
  }
  body.push(para('', { after: 240 }))
  for (const c of d.colophon) body.push(para([run(c, { size: 9, color: GRAY })], { after: 60 }))

  return new Document({
    creator: 'יוצר: מתמטיקה',
    title: `${d.title} · מסמך פרויקט`,
    description: d.cover.maxim,
    styles: {
      default: { document: { run: { font: FONT, size: 22, sizeComplexScript: 22, rightToLeft: true } } },
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: body,
      },
    ],
  })
}

export async function dossierDocx(d: Dossier, bytes: Map<string, ImageBytes>): Promise<Blob> {
  return Packer.toBlob(dossierDocument(d, bytes))
}
