/**
 * Images for the document: each one fetched once, scaled to a size a page needs (frozen views are 3600 px wide),
 * and kept twice: as a data URL for the page, so the PDF capture never meets a cross-origin image, and as JPEG
 * bytes for the Word file.
 */
import type { ImageBytes } from './docx'

export interface LoadedImage extends ImageBytes {
  dataUrl: string
}

/** Long side of an image in the document. Enough for A4 at about 200 dpi. */
const MAX_SIDE = 1800

export async function loadImage(url: string, maxSide = MAX_SIDE): Promise<LoadedImage> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`התמונה לא נטענה (${res.status})`)
  const bitmap = await createImageBitmap(await res.blob())
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * k)
  const height = Math.round(bitmap.height * k)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('הקידוד של התמונה נכשל'))), 'image/jpeg', 0.88))
  const data = new Uint8Array(await blob.arrayBuffer())
  const dataUrl = await new Promise<string>((ok) => {
    const fr = new FileReader()
    fr.onload = () => ok(fr.result as string)
    fr.readAsDataURL(blob)
  })
  return { data, width, height, dataUrl }
}

/** Loads all images, a few at a time. An image that fails is left out; the document still comes out. */
export async function loadImages(items: { id: string; src: string }[], onProgress?: (done: number) => void): Promise<Map<string, LoadedImage>> {
  const out = new Map<string, LoadedImage>()
  let done = 0
  const queue = [...items]
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        out.set(it.id, await loadImage(it.src))
      } catch {
        // left out on purpose: the page shows the caption without the picture
      }
      onProgress?.(++done)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}
