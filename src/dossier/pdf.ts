/**
 * The document as a PDF to share (DECISIONS.md 93). Each A4 page on the screen is drawn by the browser itself
 * (html-to-image renders through SVG, so Hebrew, right to left and the fonts come out exactly as on screen) and
 * placed on its own PDF page. A page taller than A4 is scaled down to fit, never cut. For selectable vector
 * text there is the browser's print, from the same pages.
 */
import { getFontEmbedCSS, toJpeg } from 'html-to-image'
import { jsPDF } from 'jspdf'

const A4 = { w: 210, h: 297 }

export async function pagesToPdf(pages: HTMLElement[], meta: { title: string; subject?: string }, onProgress?: (done: number) => void): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  pdf.setProperties({ title: meta.title, subject: meta.subject ?? '', creator: 'יוצר: מתמטיקה' })
  const fontEmbedCSS = await getFontEmbedCSS(pages[0]!)
  for (const [i, page] of pages.entries()) {
    const url = await toJpeg(page, { quality: 0.9, pixelRatio: 2, backgroundColor: '#ffffff', fontEmbedCSS, cacheBust: false })
    const ratio = page.offsetHeight / page.offsetWidth
    const w = ratio > A4.h / A4.w ? A4.h / ratio : A4.w
    const h = w * ratio
    if (i) pdf.addPage('a4', 'portrait')
    pdf.addImage(url, 'JPEG', (A4.w - w) / 2, 0, w, h, undefined, 'FAST')
    onProgress?.(i + 1)
  }
  return pdf.output('blob')
}
