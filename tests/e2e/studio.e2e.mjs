/**
 * Stage 2 acceptance tests in Chromium, against the production build (`npm run e2e`).
 * Prints every measured number and writes screenshots to docs/screenshots.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import validator from 'gltf-validator'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
const tmp = root + 'node_modules/.tmp/e2e/'
mkdirSync(shots, { recursive: true })
mkdirSync(tmp, { recursive: true })
const PORT = 4174
const URL_ = `http://localhost:${PORT}/#/studio`
const NEW_URL = `http://localhost:${PORT}/#/new`

const results = []
let failed = 0
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b)

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, acceptDownloads: true, ...extra })
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
  return page
}
const metric = (page, key) =>
  page.$eval(`[data-metric=${key}]`, (el) => ({ v: Number(el.dataset.value), max: Number(el.dataset.max), text: el.textContent }))

try {
  // ---------- 1. Same metrics as the reference model "הטבעת המשולשת" ----------
  const page = await open({ width: 1360, height: 1000 })
  await page.waitForTimeout(2000)
  const ref = JSON.parse(readFileSync(root + 'tests/e2e/reference-metrics.json', 'utf8'))
  const m = {}
  for (const k of ['outerDiameter', 'courtyardDiameter', 'edgeCount', 'edgeLength', 'floorWidth', 'clearHeight', 'floorContinuous', 'wallAtCorners', 'openingFraction', 'volume', 'weight', 'cuspBurial']) {
    m[k] = await metric(page, k)
  }
  check('outer diameter = reference', m.outerDiameter.v === ref.outer_diameter, `${m.outerDiameter.v} / ${ref.outer_diameter}`)
  check('edge count = reference', m.edgeCount.v === ref.edges, `${m.edgeCount.v} / ${ref.edges}`)
  check('edge length within 0.5%', rel(m.edgeLength.v, ref.edge_length) < 0.005, `${m.edgeLength.v.toFixed(1)} / ${ref.edge_length}`)
  check(
    'floor width range = reference (2 decimals)',
    m.floorWidth.v.toFixed(2) === ref.floor_width_range[0].toFixed(2) && m.floorWidth.max.toFixed(2) === ref.floor_width_range[1].toFixed(2),
    `${m.floorWidth.v.toFixed(2)}–${m.floorWidth.max.toFixed(2)} / ${ref.floor_width_range.join('–')}`,
  )
  check(
    'clear height range = reference (2 decimals)',
    m.clearHeight.v.toFixed(2) === ref.clear_height_range[0].toFixed(2) && m.clearHeight.max.toFixed(2) === ref.clear_height_range[1].toFixed(2),
    `${m.clearHeight.v.toFixed(2)}–${m.clearHeight.max.toFixed(2)} / ${ref.clear_height_range.join('–')}`,
  )
  check('floor continuous = reference', (m.floorContinuous.v === 1) === ref.floor_continuous)
  check('rib at cusps = reference', m.wallAtCorners.v.toFixed(2) === ref.wall_thickness_cusps.toFixed(2), `${m.wallAtCorners.v.toFixed(2)} / ${ref.wall_thickness_cusps}`)
  check('concrete volume within 0.5%', rel(m.volume.v, ref.concrete_volume_m3) < 0.005, `${m.volume.v.toFixed(1)} / ${ref.concrete_volume_m3} m³, ${(rel(m.volume.v, ref.concrete_volume_m3) * 100).toFixed(2)}%`)
  check('weight within 0.5%', rel(m.weight.v, ref.concrete_tonnes) < 0.005, `${m.weight.v.toFixed(0)} / ${ref.concrete_tonnes} t`)
  // The fixture rounds the passage angle to 51.6°; the reference uses 0.9 rad = 51.57°, so allow half a point.
  check('opening fraction within 0.5 percentage points', Math.abs(m.openingFraction.v - ref.opening_fraction) < 0.005, `${m.openingFraction.v.toFixed(4)} / ${ref.opening_fraction}`)
  check('cusp burial = reference', m.cuspBurial.v.toFixed(2) === '5.70', m.cuspBurial.text)

  await page.locator('[data-testid=stage]').screenshot({ path: shots + 'stage2-umbilic-eye-level.png' })

  // ---------- 2. Response within 100 ms; the previous model stays until the new one is ready ----------
  const timing = await page.evaluate(async () => {
    const input = document.querySelector('[data-testid=param-R]')
    const out = document.querySelector('[data-testid=param-R-out]')
    const stage = document.querySelector('[data-testid=stage]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const feedback = [], rebuild = []
    let blank = 0
    for (let i = 0; i < 12; i++) {
      const before = out.textContent
      const version = Number(stage.dataset.modelVersion)
      const t0 = performance.now()
      setter.call(input, String(18 + (i + 1) * 0.5))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const deadline = t0 + 3000
      await new Promise((resolve) => {
        const tick = () => (out.textContent !== before || performance.now() > deadline ? resolve() : requestAnimationFrame(tick))
        tick()
      })
      feedback.push(performance.now() - t0)
      await new Promise((resolve) => {
        const tick = () => {
          if (!document.querySelector('.stage canvas') || Number(stage.dataset.modelVersion) < 1) blank++
          Number(stage.dataset.modelVersion) > version || performance.now() > t0 + 10000 ? resolve() : setTimeout(tick, 4)
        }
        tick()
      })
      rebuild.push(performance.now() - t0)
    }
    return { feedback, rebuild, blank }
  })
  const sorted = (a) => [...a].sort((x, y) => x - y)
  const p95 = (a) => sorted(a)[Math.ceil(a.length * 0.95) - 1]
  const median = (a) => sorted(a)[Math.floor(a.length / 2)]
  check('slider feedback within 100 ms (p95)', p95(timing.feedback) < 100, `median ${median(timing.feedback).toFixed(0)} ms, p95 ${p95(timing.feedback).toFixed(0)} ms`)
  check('previous model stays on screen while building', timing.blank === 0, `blank samples ${timing.blank}; new model after median ${median(timing.rebuild).toFixed(0)} ms, p95 ${p95(timing.rebuild).toFixed(0)} ms`)

  // ---------- invalid input: the slider returns to the last valid value, the model stays ----------
  // Files, saving and export live in the "שמירה" tab of the side panel.
  await page.click('[data-testid=tab-save]')
  const fixture = JSON.parse(readFileSync(root + 'docs/fixtures/umbilic-torus.recipe.json', 'utf8'))
  const bad = structuredClone(fixture)
  bad.generator.params.twist.turns_per_lap = 0.25
  const versionBefore = Number(await page.$eval('[data-testid=stage]', (e) => e.dataset.modelVersion))
  const badPath = tmp + 'bad-rule.json'
  writeFileSync(badPath, JSON.stringify(bad))
  await page.setInputFiles('[data-testid=file]', badPath)
  await page.waitForSelector('[data-testid=notice]', { timeout: 15000 })
  const ruleNotice = await page.textContent('[data-testid=notice]')
  const versionAfter = Number(await page.$eval('[data-testid=stage]', (e) => e.dataset.modelVersion))
  check('a recipe that breaks rule 1 shows the rule and keeps the model', /כלל 1/.test(ruleNotice) && versionAfter === versionBefore, ruleNotice.slice(0, 80))
  await page.click('[data-testid=notice] button')

  const broken = structuredClone(fixture)
  delete broken.bare.shell
  const brokenPath = tmp + 'bad-schema.json'
  writeFileSync(brokenPath, JSON.stringify(broken))
  await page.setInputFiles('[data-testid=file]', brokenPath)
  await page.waitForSelector('[data-testid=notice]')
  const schemaNotice = await page.textContent('[data-testid=notice]')
  check('a recipe that fails the schema names the field and offers a way out', /bare\.shell/.test(schemaNotice) && /בחירת קובץ אחר/.test(schemaNotice), schemaNotice.slice(0, 90))
  await page.click('[data-testid=notice] button')

  // ---------- exports ----------
  await page.selectOption('[data-testid=fixture]', 'umbilic-torus')
  await page.waitForTimeout(1500)
  for (const fmt of ['glb', 'obj', 'stl', 'json', 'png']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-testid=export-${fmt}]`)])
    const path = tmp + dl.suggestedFilename()
    await dl.saveAs(path)
    const bytes = readFileSync(path)
    let detail = `${dl.suggestedFilename()}, ${(bytes.length / 1e6).toFixed(2)} MB`
    let ok = bytes.length > 0
    if (fmt === 'glb') {
      const report = await validator.validateBytes(new Uint8Array(bytes))
      ok = ok && report.issues.numErrors === 0
      detail += `, validator errors ${report.issues.numErrors}`
    }
    if (fmt === 'png') {
      const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20)
      ok = ok && Math.abs(w / h - 1.5) < 0.01
      detail += `, ${w} × ${h}`
    }
    if (fmt === 'json') ok = ok && JSON.parse(bytes.toString('utf8')).meta.id === 'umbilic-torus-pavilion'
    check(`export ${fmt.toUpperCase()}`, ok, detail)
  }

  // ---------- all four cameras ----------
  for (const c of ['aerial', 'inside', 'courtyard', 'eye_level_oblique']) {
    await page.click(`[data-testid=camera-${c}]`)
    await page.waitForTimeout(800)
    const notice = await page.$('[data-testid=notice]')
    check(`camera ${c} applies without a notice`, !notice)
  }
  // ---------- edge tracer and moving section plane ----------
  await page.click('text=מעקב אחרי הקצה')
  await page.waitForSelector('.stage-status', { timeout: 10000 })
  const trace = await page.textContent('.stage-status')
  check('edge tracer reports the lap', /הקפה 1 מתוך 3/.test(trace), trace)
  await page.click('text=עצירת המעקב')
  await page.click('[data-testid=camera-aerial]')
  // The moving section lives in the "צורה" tab, beside the shape it cuts.
  await page.click('[data-testid=tab-shape]')
  await page.check('[data-testid=section-toggle]')
  await page.waitForTimeout(1200)
  const readout = await page.textContent('[data-testid=section-readout]')
  check('section plane reads floor width and clear height', /רוחב רצפה/.test(readout) && /גובה חופשי/.test(readout), readout)
  await page.locator('[data-testid=stage]').screenshot({ path: shots + 'stage2-section-aerial.png' })
  await page.uncheck('[data-testid=section-toggle]')
  await page.close()

  // ---------- 3. RTL, no icons, works at 400 px ----------
  const narrow = await open({ width: 400, height: 900 }, { hasTouch: true, isMobile: true })
  await narrow.waitForTimeout(1500)
  const layout = await narrow.evaluate(() => {
    const stage = document.querySelector('[data-testid=stage]').getBoundingClientRect()
    return {
      dir: getComputedStyle(document.body).direction,
      htmlDir: document.documentElement.dir,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      icons: document.querySelectorAll('svg, img:not(.brand-mark), i[class*=icon], [class*=icon]').length,
      stage: [stage.width, stage.height],
      smallTargets: [...document.querySelectorAll('button, select, .filebtn')].filter((b) => b.getBoundingClientRect().height < 44).length,
    }
  })
  check('RTL', layout.dir === 'rtl' && layout.htmlDir === 'rtl')
  check('no horizontal scroll at 400 px', layout.scrollWidth <= layout.clientWidth, `${layout.scrollWidth} ≤ ${layout.clientWidth}`)
  check('no icons', layout.icons === 0, `${layout.icons} icon elements`)
  check('model window is 3:2 at 400 px', Math.abs(layout.stage[0] / layout.stage[1] - 1.5) < 0.01, `${layout.stage[0].toFixed(0)} × ${layout.stage[1].toFixed(0)}`)
  check('touch targets at least 44 px', layout.smallTargets === 0, `${layout.smallTargets} smaller`)
  await narrow.screenshot({ path: shots + 'stage2-400px.png', fullPage: true })

  // ---------- Stage 3 screen: New concept (offline checks; the live path is in concepts.integration.mjs) ----------
  await narrow.goto(NEW_URL)
  await narrow.waitForSelector('[data-testid=concept]')
  const form = await narrow.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    icons: document.querySelectorAll('svg, img:not(.brand-mark), [class*=icon]').length,
    crumbs: document.querySelector('.crumbs')?.textContent,
    title: document.querySelector('h1')?.textContent,
    submitDisabled: document.querySelector('[data-testid=submit]').disabled,
  }))
  check('New concept: breadcrumbs and screen name', /מושג חדש/.test(form.crumbs) && form.title === 'מושג חדש', form.crumbs)
  check('New concept: no horizontal scroll and no icons at 400 px', form.scrollWidth <= form.clientWidth && form.icons === 0, `${form.scrollWidth} ≤ ${form.clientWidth}, icons ${form.icons}`)
  check('New concept: submit waits for a concept', form.submitDisabled === true)
  await narrow.click('text=היפרבולואיד')
  const filled = await narrow.$eval('[data-testid=concept]', (el) => el.value)
  check('New concept: an example fills the form', filled === 'Hyperboloid', filled)
  await narrow.screenshot({ path: shots + 'stage3-new-concept-400px.png', fullPage: true })
  await narrow.close()
} finally {
  await browser.close()
  server.kill()
}

writeFileSync(tmp + 'results.json', JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
