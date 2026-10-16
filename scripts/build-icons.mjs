/**
 * The app's icon (DECISIONS.md 95): the deltoid, the section of the reference model, computed from its curve
 * x = 2cos t + cos 2t, y = 2sin t − sin 2t, filled black on white. Writes public/icon.svg and the PNG sizes the
 * manifest and the browsers ask for. Run: node scripts/build-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))

/** The deltoid as an SVG path, a cusp pointing up, centered by its bounds in a square of side `size`. */
export function deltoidPath(size, fill) {
  const N = 720
  const raw = []
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N
    const x = 2 * Math.cos(t) + Math.cos(2 * t), y = 2 * Math.sin(t) - Math.sin(2 * t)
    raw.push([y, -x]) // a quarter turn: the cusp at t = 0 points up
  }
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = (size * fill) / Math.max(x1 - x0, y1 - y0)
  const ox = (size - (x1 - x0) * k) / 2 - x0 * k, oy = (size - (y1 - y0) * k) / 2 - y0 * k
  return 'M' + raw.map(([x, y]) => `${(x * k + ox).toFixed(2)} ${(y * k + oy).toFixed(2)}`).join('L') + 'Z'
}

const svg = (size, { fill = 0.74 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
  `<rect width="${size}" height="${size}" fill="#ffffff"/>` +
  `<path d="${deltoidPath(size, fill)}" fill="#111111"/>` +
  `</svg>\n`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(root + 'public/icons', { recursive: true })
  writeFileSync(root + 'public/icon.svg', svg(512))
  // Maskable: the mark inside the 80% safe zone, on a full white square.
  const files = [
    ['icons/icon-192.png', 192, {}],
    ['icons/icon-512.png', 512, {}],
    ['icons/icon-maskable-512.png', 512, { fill: 0.58 }],
    ['icons/apple-touch-icon-180.png', 180, { fill: 0.68 }],
    ['icons/favicon-32.png', 32, { fill: 0.9 }],
  ]
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const [name, size, opts] of files) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<html><body style="margin:0">${svg(size, opts)}</body></html>`)
    await page.locator('svg').screenshot({ path: root + 'public/' + name, omitBackground: false })
    console.log('wrote', name)
  }
  await browser.close()
}
