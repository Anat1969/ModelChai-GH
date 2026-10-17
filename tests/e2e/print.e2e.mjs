/**
 * Getting the print ready (DECISIONS.md 113–115), in Chromium against the production build:
 * `npx vite build && node tests/e2e/print.e2e.mjs`. Size in centimeters and the scale, the ground level, a
 * preview of the file, and an STL that stands on Z = 0 with nothing below it and no open edge.
 * Port 4302, so it runs beside the other suites.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
const tmp = root + 'node_modules/.tmp/e2e-print/'
mkdirSync(shots, { recursive: true })
mkdirSync(tmp, { recursive: true })
const PORT = 4302
const URL_ = `http://localhost:${PORT}/#/studio`

const results = []
let failed = 0
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** Binary STL: triangle count, bounds, and edges that do not join exactly two triangles after welding. */
function readStl(buf) {
  const tris = buf.readUInt32LE(80)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  const ids = new Map()
  const id = (o) => {
    const k = `${buf.readFloatLE(o)},${buf.readFloatLE(o + 4)},${buf.readFloatLE(o + 8)}`
    let i = ids.get(k)
    if (i === undefined) ids.set(k, (i = ids.size))
    return i
  }
  const edges = new Map()
  for (let t = 0; t < tris; t++) {
    const o = 84 + 50 * t + 12
    const v = [0, 1, 2].map((k) => {
      for (let a = 0; a < 3; a++) {
        const x = buf.readFloatLE(o + 12 * k + 4 * a)
        if (x < min[a]) min[a] = x
        if (x > max[a]) max[a] = x
      }
      return id(o + 12 * k)
    })
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const c of edges.values()) if (c !== 2) open++
  return { tris, min, max, open, vertices: ids.size }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(URL_)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  const buildsBefore = Number(await page.$eval('[data-testid=stage]', (e) => e.dataset.buildCount))

  await page.click('[data-testid=tab-print]')
  const t0 = Date.now()
  await page.click('[data-testid=print-prepare]')
  await page.waitForSelector('[data-testid=print-report]', { timeout: 180000 })
  const seconds = (Date.now() - t0) / 1000

  const checks = await page.$$eval('[data-testid=print-report] li[data-check]', (els) => els.map((e) => [e.dataset.check, e.dataset.ok]))
  check('the three print checks pass on the cut body', checks.length === 3 && checks.every(([, ok]) => ok === 'true'), `${JSON.stringify(checks)}, ${seconds.toFixed(1)} s`)

  const cm = (await page.textContent('[data-testid=print-size-cm]')).replace(/\s+/g, ' ')
  const cmValues = [...cm.matchAll(/(\d+[.,]\d) ס"מ/g)].map((m) => Number(m[1].replace(',', '.')))
  check('the size is shown in centimeters, one decimal, width, depth and height', cmValues.length === 3 && /רוחב/.test(cm) && /עומק/.test(cm) && /גובה/.test(cm), cm)
  const ratio = (await page.textContent('[data-testid=print-scale-ratio]')).replace(/[⁦-⁩]/g, '')
  check('the scale reads 1:N', /^1:\d+$/.test(ratio), ratio)
  const size = (await page.textContent('[data-testid=print-dimensions]')).replace(/\s+/g, ' ')
  check('the building size is shown in meters', /מ' מעל הקרקע/.test(size), size.slice(-60))

  const ground = await page.$eval('[data-testid=print-ground]', (e) => ({ cut: e.dataset.cut, text: e.textContent.replace(/\s+/g, ' ') }))
  check('the ground level is stated, and what lies below it is not printed', ground.cut === 'true' && /מפלס הקרקע/.test(ground.text) && /לא מודפסת/.test(ground.text) && /מ"ק/.test(ground.text), ground.text)

  await page.waitForSelector('[data-testid=print-preview] canvas', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const preview = await page.$eval('[data-testid=print-preview] .print-preview-view', (e) => {
    const r = e.getBoundingClientRect()
    return { w: r.width, h: r.height, canvas: !!e.querySelector('canvas'), labels: [...e.querySelectorAll('.preview-label')].map((l) => l.textContent) }
  })
  check('the preview canvas is there, 3:2, with the dimensions labelled', preview.canvas && Math.abs(preview.w / preview.h - 1.5) < 0.01 && preview.labels.some((l) => /רוחב/.test(l)) && preview.labels.some((l) => /גובה/.test(l)), `${preview.w.toFixed(0)} × ${preview.h.toFixed(0)}, ${preview.labels.join(' | ')}`)

  // Rotate it with the mouse: the picture changes.
  await page.locator('[data-testid=print-preview] canvas').scrollIntoViewIfNeeded()
  const box = await page.locator('[data-testid=print-preview] canvas').boundingBox()
  const before = await page.locator('[data-testid=print-preview] canvas').screenshot()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const after = await page.locator('[data-testid=print-preview] canvas').screenshot()
  check('dragging rotates the preview', !before.equals(after))
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)

  const buildsAfter = Number(await page.$eval('[data-testid=stage]', (e) => e.dataset.buildCount))
  check('the print file and its preview do not rebuild the studio model', buildsAfter === buildsBefore, `build count ${buildsBefore} → ${buildsAfter}`)

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=print-stl]')])
  const path = tmp + dl.suggestedFilename()
  await dl.saveAs(path)
  const stl = readStl(readFileSync(path))
  const dims = [stl.max[0] - stl.min[0], stl.max[1] - stl.min[1], stl.max[2] - stl.min[2]]
  check('the STL stands on Z = 0 with nothing below the ground', Math.abs(stl.min[2]) < 1e-4, `min z ${stl.min[2].toFixed(6)} mm, max z ${stl.max[2].toFixed(2)} mm`)
  check('the STL is closed: every edge joins two triangles', stl.open === 0, `${stl.open} open edges, ${stl.tris} triangles, ${stl.vertices} vertices`)
  check(
    'the STL measures what the panel says, to a tenth of a centimeter',
    dims.every((d, i) => Math.abs(d / 10 - cmValues[i]) <= 0.051),
    `${dims.map((d) => (d / 10).toFixed(2)).join(' × ')} cm / ${cmValues.join(' × ')}`,
  )

  // Tall enough that the side panel shows the whole report without scrolling under the top bar.
  await page.setViewportSize({ width: 1360, height: 2200 })
  await page.waitForTimeout(1500)
  await page.locator('[data-testid=print-panel]').screenshot({ path: shots + 'print-preview.png' })
  await page.close()
} finally {
  await browser.close()
  server.kill()
}

writeFileSync(tmp + 'results.json', JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
