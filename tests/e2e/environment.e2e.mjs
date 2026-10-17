/**
 * Materials, landscapes, weather, orientation and wind in Chromium (DECISIONS.md 119–123). Run after `vite build`:
 *   node tests/e2e/environment.e2e.mjs
 * 1. Every new material, context and weather shows, and the weight follows the material's density.
 * 2. Orientation turns the model and the sun readout follows it; "צפון" and "חזית" are written in the model.
 * 3. Wind: Beaufort words, the "המחשה, לא סימולציה" label, animated lines that stop when hidden.
 * 4. None of it rebuilds the mesh: the build counter stays where it was.
 * Port 4304 only, so it can run beside the other browser suites.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4304

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

/** Software rendering draws about one frame a second here, so wait for a few frames after each change. */
const settle = (page, ms = 4000) => page.waitForTimeout(ms)
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  const box = await page.locator('[data-testid=stage]').boundingBox()
  await page.screenshot({ path: shots + name, clip: box, timeout: 120000 })
}
const attr = (page, sel, name) => page.$eval(sel, (el, n) => el.dataset[n], name)
const slide = (page, testId, value) =>
  page.$eval(
    `input[data-testid=${testId}]`,
    (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
/** Luminance of the rendered frame at 360 × 240, read from the WebGL canvas: fine enough for 1 px wind lines. */
const frame = (page) =>
  page.evaluate(() => {
    const src = document.querySelector('[data-testid=stage] canvas')
    const c = document.createElement('canvas')
    c.width = 360
    c.height = 240
    const g = c.getContext('2d')
    g.drawImage(src, 0, 0, 360, 240)
    const d = g.getImageData(0, 0, 360, 240).data
    const out = []
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    return out
  })
const changed = (a, b) => a.filter((v, i) => Math.abs(v - b[i]) > 4).length / a.length
/** Zooms the camera out with the wheel, to see the landscape around the model. */
const zoomOut = async (page, steps) => {
  const box = await page.locator('[data-testid=stage]').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(150)
  }
}

const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/#/studio`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await page.waitForTimeout(1500)
  const builds0 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
  const version0 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
  check('one build on opening', builds0 === 1, `build count ${builds0}`)

  await page.click('[data-testid=level-realistic]')
  await page.click('[data-testid=tab-scene]')
  await page.click('[data-testid=camera-eye_level_oblique]')
  await settle(page)

  // ---------- 0. What is computed and what is shown ----------
  const basis = await page.textContent('[data-testid=basis-box]')
  check(
    'the "מה מחושב ומה מומחש" box names every element and its basis',
    ['מיקום השמש וכיוון הצל', 'משקל', 'חומרים ומרקמים', 'רוח', 'מזג אוויר', 'אנשים וצמחייה'].every((w) => basis.includes(w)) &&
      ['מחושב', 'המחשה חזותית', 'המחשה, לא סימולציה', 'קנה מידה בלבד'].every((w) => basis.includes(w)),
  )

  // ---------- 1. Materials and the weight ----------
  const weightOf = async () => Number(await attr(page, '[data-metric=weight]', 'value'))
  const volume = Number(await attr(page, '[data-metric=volume]', 'value'))
  const DENS = { white_marble: 2.7, red_brick: 1.9, terracotta_tiles: 1.9, basalt: 2.9, copper_patina: 8.9, charred_timber: 0.5, white_render: 1.8, perforated_metal: 1.6 }
  const options = await page.$$eval('[data-testid=real-material-outer] option', (os) => os.map((o) => o.value))
  check('the material selector offers the eight new materials', Object.keys(DENS).every((m) => options.includes(m)), `${options.length} options`)
  for (const [m, rho] of Object.entries(DENS)) {
    await page.selectOption('[data-testid=real-material-outer]', m)
    await settle(page, 3500)
    const w = await weightOf()
    check(`${m}: weight = volume × ${rho}`, Math.abs(w - volume * rho) / (volume * rho) < 0.005, `${w.toFixed(1)} t`)
    await shot(page, `env-material-${m}.png`)
  }

  // ---------- 2. Contexts, from above ----------
  await page.selectOption('[data-testid=real-material-outer]', 'white_render')
  await page.click('[data-testid=camera-aerial]')
  await settle(page, 3000)
  const cam0 = JSON.parse(await attr(page, '[data-testid=stage]', 'camera'))
  await zoomOut(page, 18)
  await settle(page, 2000)
  const cam1 = JSON.parse(await attr(page, '[data-testid=stage]', 'camera'))
  const dist = (c) => Math.hypot(c[0] - c[3], c[1] - c[4], c[2] - c[5])
  check('the wheel zooms out to show the landscape', dist(cam1) > dist(cam0) * 1.5, `${dist(cam0).toFixed(0)} m → ${dist(cam1).toFixed(0)} m`)
  for (const c of ['urban_gateway', 'forest_edge', 'rocky_slope', 'snow_field', 'river_bank']) {
    await page.selectOption('[data-testid=real-context]', c)
    await settle(page, 5000)
    await shot(page, `env-context-${c}.png`)
  }
  const ctxPrompt = await page.textContent('[data-testid=visual-prompt]')
  check('the prompt names the last context', ctxPrompt.includes('גדת נחל'))

  // ---------- 3. Weather, at eye level in the urban gateway ----------
  await page.selectOption('[data-testid=real-context]', 'urban_gateway')
  await page.click('[data-testid=camera-eye_level_oblique]')
  for (const w of ['rain', 'fog', 'snow']) {
    await page.click(`[data-testid=real-weather-${w}]`)
    await settle(page, 5000)
    await shot(page, `env-weather-${w}.png`)
  }
  const weatherPrompt = await page.textContent('[data-testid=visual-prompt]')
  check('the prompt says it snows', weatherPrompt.includes('שלג יורד'))
  await page.click('[data-testid=real-weather-clear]')

  // ---------- 4. Orientation ----------
  await page.click('[data-testid=quick-winter_solstice]')
  await page.click('[data-testid=camera-aerial]')
  await settle(page)
  const rel0 = Number(await attr(page, '[data-testid=sun-path]', 'relative'))
  const north = await page.locator('[data-testid=north-label]').count()
  check('"צפון" and "חזית" are written in the model', north === 1 && (await page.locator('[data-testid=front-label]').count()) === 1)
  const before = await frame(page)
  await shot(page, 'env-orientation-0.png')
  await slide(page, 'real-orientation', 90)
  await settle(page)
  const rel90 = Number(await attr(page, '[data-testid=sun-path]', 'relative'))
  const turned = changed(before, await frame(page))
  check('turning the model 90° moves the sun 90° relative to the front', Math.abs(((rel0 - rel90 + 360) % 360) - 90) < 0.6, `${rel0}° → ${rel90}°`)
  check('the turned model looks different', turned > 0.01, `${(turned * 100).toFixed(1)}% of pixels changed`)
  await shot(page, 'env-orientation-90.png')
  const sunPath = await page.textContent('[data-testid=sun-path]')
  check('the sun-path line gives sunrise, sunset, noon altitude and the front', /זריחה \d\d:\d\d, שקיעה \d\d:\d\d/.test(sunPath) && /בצהריים/.test(sunPath) && /מכיוון החזית/.test(sunPath), sunPath)

  // ---------- 5. Wind ----------
  await slide(page, 'real-wind-from', 0)
  await slide(page, 'real-wind-speed', 12)
  await settle(page, 1500)
  const speedOut = await page.textContent('[data-testid=real-wind-speed-out]')
  check('12 m/s reads as Beaufort 6', speedOut.includes('בופור 6'), speedOut)
  const note = await page.textContent('[data-testid=wind-note]')
  check('the wind is labelled as an illustration', note.includes('המחשה, לא סימולציה') && note.includes('לא זרימה מחושבת סביב הצורה'))
  const reading = await page.textContent('[data-testid=wind-reading]')
  check('the wind reading says what can and cannot be inferred', reading.includes('מה אפשר להסיק') && reading.includes('מה אי אפשר להסיק') && reading.includes('הצד הצפוני') && reading.includes('הצד הדרומי'), reading.slice(0, 90))
  await page.check('[data-testid=wind-show]')
  await settle(page, 3000)
  const overlay = await page.locator('[data-testid=wind-overlay]').count()
  check('with the lines shown, the model window carries the illustration label', overlay === 1)
  // Not a whole number of dash periods: at 12 m/s the 6 m pattern repeats every 0.5 s, so wait 2.25 s.
  const w1 = await frame(page)
  await page.waitForTimeout(2250)
  const w2 = await frame(page)
  check('the wind lines move on their own', changed(w1, w2) > 0.0005, `${(changed(w1, w2) * 100).toFixed(2)}% of pixels changed in 2.25 s`)
  await shot(page, 'env-wind-aerial.png')
  await page.click('[data-testid=camera-eye_level_oblique]')
  await settle(page, 4000)
  await shot(page, 'env-wind-eye.png')
  await page.uncheck('[data-testid=wind-show]')
  await settle(page, 3000)
  const s1 = await frame(page)
  await page.waitForTimeout(2500)
  const s2 = await frame(page)
  check('hidden lines stop the animation (frames on demand)', changed(s1, s2) < 0.0005, `${(changed(s1, s2) * 100).toFixed(2)}%`)
  const prompt = await page.textContent('[data-testid=visual-prompt]')
  check('the prompt carries orientation and wind', prompt.includes('החזית פונה למזרח') && prompt.includes('רוח חזקה מהצפון'), prompt.slice(0, 80) + '…')

  // ---------- 6. No rebuild ----------
  await page.click('[data-testid=level-bare]')
  await page.waitForTimeout(1500)
  await page.click('[data-testid=level-realistic]')
  await page.waitForTimeout(1500)
  const builds1 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
  const version1 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
  check('materials, contexts, weather, orientation and wind never rebuild', builds1 === builds0 && version1 === version0, `builds ${builds0} → ${builds1}, model version ${version0} → ${version1}`)
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
  await page.close()

  // ---------- RTL at 400 px ----------
  const narrow = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
  await narrow.goto(`http://localhost:${PORT}/#/studio`)
  await narrow.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await narrow.click('[data-testid=level-realistic]')
  await narrow.click('[data-testid=tab-scene]')
  await narrow.waitForTimeout(2000)
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('400 px: no horizontal scroll with the new controls', overflow <= 0, `${overflow}px`)
  const dir = await narrow.$eval('[data-testid=basis-box]', (el) => getComputedStyle(el).direction)
  check('the new box is right to left', dir === 'rtl')
  await narrow.close()
} catch (e) {
  failed++
  console.log('FAIL  crashed:', e.message)
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
