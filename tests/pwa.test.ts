/** The app's icon and install manifest (DECISIONS.md 95). */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types
import { deltoidPath } from '../scripts/build-icons.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const pngSize = (rel: string) => {
  const b = readFileSync(root + 'public' + rel)
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

describe('manifest', () => {
  const m = JSON.parse(readFileSync(root + 'public/manifest.webmanifest', 'utf8'))
  it('names the app in Hebrew, right to left, opening on the home page', () => {
    expect(m.name).toBe('יוצר: מתמטיקה')
    expect(m.short_name).toBeTruthy()
    expect([m.lang, m.dir, m.display, m.start_url]).toEqual(['he', 'rtl', 'standalone', '/#/home'])
  })
  it('lists icons that exist at the sizes it states, with a maskable one', () => {
    for (const icon of m.icons) {
      expect(statSync(root + 'public' + icon.src).size).toBeGreaterThan(0)
      if (icon.type === 'image/png') expect(pngSize(icon.src)).toBe(icon.sizes)
    }
    expect(m.icons.some((i: { purpose: string; sizes: string }) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true)
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true)
  })
  it('is linked from the page, with the favicon', () => {
    const html = readFileSync(root + 'index.html', 'utf8')
    expect(html).toMatch(/rel="manifest" href="\/manifest.webmanifest"/)
    expect(html).toMatch(/rel="icon" href="\/icon.svg"/)
    expect(html).toMatch(/rel="apple-touch-icon"/)
  })
})

describe('the icon is the deltoid', () => {
  it('has three cusps, 120° apart, one pointing up, inside the square', () => {
    const pts = (deltoidPath(512, 0.74) as string)
      .slice(1, -1)
      .split('L')
      .map((p) => p.split(' ').map(Number) as [number, number])
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
    const d = pts.map(([x, y]) => Math.hypot(x - cx, y - cy))
    // Cusps are the local maxima of the distance from the center.
    const cusps = d.map((v, i) => [v, i] as const).filter(([v, i]) => v > d[(i + 1) % d.length]! && v > d[(i - 1 + d.length) % d.length]!)
    expect(cusps.length).toBe(3)
    const angles = cusps.map(([, i]) => (Math.atan2(pts[i]![1] - cy, pts[i]![0] - cx) * 180) / Math.PI).sort((a, b) => a - b)
    expect(angles.some((a) => Math.abs(a + 90) < 1)).toBe(true)
    expect(Math.abs(angles[1]! - angles[0]! - 120)).toBeLessThan(1)
    expect(pts.every(([x, y]) => x > 0 && x < 512 && y > 0 && y < 512)).toBe(true)
  })
  it('is the file the page links', () => {
    expect(readFileSync(root + 'public/icon.svg', 'utf8')).toContain(deltoidPath(512, 0.74))
  })
})
