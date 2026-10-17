/**
 * The document as a PDF to share (DECISIONS.md 93). Each A4 page on the screen is drawn by the browser itself
 * (html-to-image renders through SVG, so Hebrew, right to left and the fonts come out exactly as on screen) and
 * placed on its own PDF page. A page taller than A4 is scaled down to fit, never cut. For selectable vector
 * text there is the browser's print, from the same pages.
 */
import { getFontEmbedCSS, toJpeg } from 'html-to-image'
import { jsPDF } from 'jspdf'

const SHEETS = { a4: { w: 210, h: 297 }, a3: { w: 297, h: 420 } }

/** `format` a3 draws the same page larger and sharper, for print at A3 (DECISIONS.md 127). */
export async function pagesToPdf(pages: HTMLElement[], meta: { title: string; subject?: string }, onProgress?: (done: number) => void, format: 'a4' | 'a3' = 'a4'): Promise<Blob> {
  const A4 = SHEETS[format]
  const pdf = new jsPDF({ unit: 'mm', format, orientation: 'portrait', compress: true })
  pdf.setProperties({ title: meta.title, subject: meta.subject ?? '', creator: 'יוצר: מתמטיקה' })
  const fontEmbedCSS = await getFontEmbedCSS(pages[0]!)
  for (const [i, page] of pages.entries()) {
    // The page's own ground: a dark flyer stays dark to its edges.
    const bg = getComputedStyle(page).backgroundColor
    const backgroundColor = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#ffffff'
    const url = await toJpeg(page, { quality: 0.9, pixelRatio: format === 'a3' ? 3 : 2, backgroundColor, fontEmbedCSS, cacheBust: false })
    const ratio = page.offsetHeight / page.offsetWidth
    const w = ratio > A4.h / A4.w ? A4.h / ratio : A4.w
    const h = w * ratio
    if (i) pdf.addPage(format, 'portrait')
    pdf.addImage(url, 'JPEG', (A4.w - w) / 2, 0, w, h, undefined, 'FAST')
    onProgress?.(i + 1)
  }
  return pdf.output('blob')
}
