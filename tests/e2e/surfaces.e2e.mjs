/**
 * Stage 6, the parametric surface generator, in Chromium against the production build:
 * `npx vite build && node tests/e2e/surfaces.e2e.mjs`. Each surface example opens from the gallery in the studio,
 * builds, shows its own metrics (volume = thickness × area within 0.5%) and its own sliders, dresses in the
 * realistic level without a rebuild, writes a visual prompt in the family's words, moves with a slider, and
 * prepares a closed print file. Screenshots: docs/screenshots/surface-*.png.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
// Port 4312 only: other suites run beside this one on their own ports.
const PORT = 4312

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b)

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

/** Software rendering draws about one frame a second here, so wait for a few frames after each change. */
const settle = (page) => page.waitForTimeout(4500)
const shot = async (page, path) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  const box = await page.locator('[data-testid=stage]').boundingBox()
  await page.screenshot({ path, clip: box, timeout: 120000 })
}
const attr = (page, sel, name) => page.$eval(sel, (el, n) => el.dataset[n], name)
const metric = (page, key) => page.$eval(`[data-metric=${key}]`, (el) => ({ v: Number(el.dataset.value), max: Number(el.dataset.max), text: el.textContent }))
const hasMetric = (page, key) => page.$(`[data-metric=${key}]`).then((e) => !!e)

/** Example id, the slider that must be there, the edge count, words the prompt must carry, and the thickness. */
const CASES = [
  { id: 'hyperboloid-water-tower', slider: 'waist', edges: 2, words: 'היפרבולואיד', t: 0.18, absent: 'param-R' },
  { id: 'hypar-canopy', slider: 'rise', edges: 1, words: 'פרבולואיד היפרבולי', t: 0.12, clear: true },
  { id: 'catenoid-pavilion', slider: 'cat-waist', edges: 2, words: 'קטנואיד', t: 0.15 },
  { id: 'klein-bottle-pavilion', slider: 'tube', edges: 0, words: 'בקבוק קליין', t: 0.25 },
  { id: 'helicoid-spiral-ramp', slider: 'pitch', edges: 1, words: 'הליקואידית', t: 0.22, clear: true },
]

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('pageerror:', e.message)
  })
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/#/projects`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  for (const c of CASES) {
    console.log(`\n--- ${c.id} ---`)
    await page.goto(`http://localhost:${PORT}/#/projects`)
    await page.waitForSelector(`[data-testid=example-${c.id}]`, { timeout: 60000 })
    await page.click(`[data-testid=example-${c.id}]`)
    await page.waitForFunction(
      (id) => location.hash.startsWith('#/studio') && Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0 && document.querySelector('[data-metric=surfaceArea]') && document.querySelector('h1')?.textContent && !!id,
      c.id,
      { timeout: 90000 },
    )
    // The bare level, the shape tab.
    if ((await attr(page, '[data-testid=stage]', 'level')) !== 'bare') await page.click('[data-testid=level-bare]')
    await page.click('[data-testid=tab-shape]')
    await settle(page)

    // ---------- 1. It builds, with the metrics that apply to a surface ----------
    const area = await metric(page, 'surfaceArea')
    const volume = await metric(page, 'volume')
    const height = await metric(page, 'height')
    const edges = await metric(page, 'edgeCount')
    check(`${c.id}: builds and shows surface metrics`, area.v > 0 && volume.v > 0 && height.v > 0, `area ${area.v.toFixed(1)} m², volume ${volume.v.toFixed(2)} m³, height ${height.v.toFixed(2)} m`)
    check(`${c.id}: volume = thickness × area within 0.5%`, rel(volume.v, c.t * area.v) < 0.005, `${volume.v.toFixed(2)} / ${(c.t * area.v).toFixed(2)}`)
    check(`${c.id}: edge count`, edges.v === c.edges, `${edges.v} / ${c.edges}`)
    check(`${c.id}: sweep-only rows are not shown`, !(await hasMetric(page, 'floorWidth')) && !(await hasMetric(page, 'courtyardDiameter')) && !(await hasMetric(page, 'wallAtCorners')))
    if (c.clear) {
      const clear = await metric(page, 'clearHeight')
      check(`${c.id}: clear height at least 2.4 m`, clear.v >= 2.4, clear.text)
    }
    const whys = await page.$$eval('[data-metric]', (els) => els.map((e) => !!e.parentElement.querySelector('[data-testid=metric-why]')))
    check(`${c.id}: every metric explains itself`, whys.length > 0 && whys.every(Boolean), `${whys.filter(Boolean).length}/${whys.length}`)

    // ---------- 2. Its own sliders: value, unit, one sentence ----------
    const slider = await page.$(`[data-testid=param-${c.slider}]`)
    const out = slider ? await page.textContent(`[data-testid=param-${c.slider}-out]`) : ''
    check(`${c.id}: the family's slider is in the panel`, !!slider, `param-${c.slider} = ${out}`)
    check(`${c.id}: no sweep sliders`, !(await page.$('[data-testid=param-R]')) && !(await page.$('[data-testid=param-twist]')))
    const thick = await page.textContent('[data-testid=param-thickness-out]').catch(() => '')
    check(`${c.id}: thickness slider with its unit`, /מ'/.test(thick), thick)
    await shot(page, `${shots}surface-${c.id}-bare.png`)

    // ---------- 3. A slider rebuilds, and the previous model stays meanwhile ----------
    const v0 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
    await page.evaluate((sel) => {
      const input = document.querySelector(sel)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const step = Number(input.step) || 0.1
      const next = Math.min(Number(input.max), Number(input.value) + 4 * step)
      setter.call(input, String(next === Number(input.value) ? Number(input.value) - 4 * step : next))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, `[data-testid=param-${c.slider}]`)
    await page.waitForFunction((v) => Number(document.querySelector('[data-testid=stage]').dataset.modelVersion) > v, v0, { timeout: 30000 })
    const area2 = await metric(page, 'surfaceArea')
    check(`${c.id}: the slider rebuilds and the area moves`, area2.v !== area.v, `${area.v.toFixed(1)} → ${area2.v.toFixed(1)} m²`)
    await page.click('[data-testid=reset-shape]')
    await page.waitForFunction((v) => Number(document.querySelector('[data-testid=stage]').dataset.modelVersion) > v + 1, v0, { timeout: 30000 })

    // ---------- 4. The realistic level never rebuilds ----------
    await settle(page)
    const builds0 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
    const version0 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
    await page.click('[data-testid=level-realistic]')
    await settle(page)
    const prompt = await page.textContent('[data-testid=visual-prompt]')
    check(`${c.id}: the visual prompt names the surface`, prompt.includes(c.words) && /קליפה דקה בעובי/.test(prompt), prompt.slice(0, 140))
    await shot(page, `${shots}surface-${c.id}-realistic.png`)
    await page.click('[data-testid=camera-aerial]')
    await settle(page)
    await page.click('[data-testid=camera-inside]')
    await page.waitForTimeout(1500)
    await page.click('[data-testid=camera-eye_level_oblique]')
    await page.click('[data-testid=level-bare]')
    await page.waitForTimeout(1000)
    const builds1 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
    const version1 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
    check(`${c.id}: the realistic level and its cameras never rebuild`, builds1 === builds0 && version1 === version0, `builds ${builds0} → ${builds1}, version ${version0} → ${version1}`)

    // ---------- 5. The print file: closed, at size, with a printable wall ----------
    await page.click('[data-testid=tab-print]')
    const t0 = Date.now()
    await page.click('[data-testid=print-prepare]')
    await page.waitForSelector('[data-testid=print-report]', { timeout: 180000 })
    const checks = await page.$$eval('[data-testid=print-report] li[data-check]', (els) => els.map((e) => [e.dataset.check, e.dataset.ok]))
    const size = (await page.textContent('[data-testid=print-dimensions]')).replace(/\s+/g, ' ')
    check(`${c.id}: the print checks pass (closed, wall, bed)`, checks.length === 3 && checks.every(([, ok]) => ok === 'true'), `${JSON.stringify(checks)}, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${size.slice(0, 80)}`)
    const builds2 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
    check(`${c.id}: the print file does not rebuild the studio model`, builds2 === builds1, `${builds1} → ${builds2}`)
  }

  // ---------- 6. Phone width: the studio still opens a surface ----------
  const phone = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1 })
  await phone.goto(`http://localhost:${PORT}/#/projects`)
  await phone.waitForSelector('[data-testid=example-hypar-canopy]', { timeout: 60000 })
  await phone.click('[data-testid=example-hypar-canopy]')
  await phone.waitForFunction(() => document.querySelector('[data-metric=surfaceArea]'), null, { timeout: 90000 })
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: no horizontal scroll on a surface', overflow <= 0, `${overflow} px`)
  await phone.waitForTimeout(3000)
  await phone.screenshot({ path: `${shots}surface-400px.png`, timeout: 120000 })

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  failed++
  console.log('FAIL  unexpected error', e)
} finally {
  await browser.close()
  server.kill()
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
}
