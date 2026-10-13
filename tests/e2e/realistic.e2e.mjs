/**
 * Stage 4 acceptance tests in Chromium (`npm run e2e`):
 * 1. Ashdod, 12:00 on 21 December and 21 June: the sun's altitude matches suncalc within one degree, and the
 *    shadow looks different (measured as the share of pixels that change between the two renders).
 * 2. Switching levels and editing every realistic field never rebuilds the mesh (build counter).
 * 3. The visual prompt on screen follows the fields (the derivation itself is unit-tested in realistic.test.ts).
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { getPosition } from 'suncalc'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4176

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

/** Software rendering draws about one frame a second here, so wait for a few frames after each change. */
const settle = (page) => page.waitForTimeout(4500)
const shot = async (page, path) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  const box = await page.locator('[data-testid=stage]').boundingBox()
  await page.screenshot({ path, clip: box, timeout: 120000 })
}
/** Luminance of the rendered frame at 160 × 160, read from the WebGL canvas. */
const frame = (page) =>
  page.evaluate(() => {
    const src = document.querySelector('[data-testid=stage] canvas')
    const c = document.createElement('canvas')
    c.width = c.height = 160
    const g = c.getContext('2d')
    g.drawImage(src, 0, 0, 160, 160)
    const d = g.getImageData(0, 0, 160, 160).data
    const out = []
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    return out
  })
const attr = (page, sel, name) => page.$eval(sel, (el, n) => el.dataset[n], name)

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
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

  await page.click('[data-testid=level-realistic]')
  await page.click('[data-testid=camera-aerial]')
  await settle(page)

  // ---------- 1. Sun against suncalc, and a different shadow ----------
  const frames = {}
  for (const [id, label] of [['winter_solstice', 'winter'], ['summer_solstice', 'summer']]) {
    await page.click(`[data-testid=quick-${id}]`)
    await settle(page)
    const shown = Number(await attr(page, '[data-testid=sun-altitude]', 'value'))
    const iso = await attr(page, '[data-testid=sun-altitude]', 'datetime')
    const ref = getPosition(new Date(iso), 31.8, 34.65).altitude
    check(`${label}: 12:00 in Ashdod`, /T12:00:00\+0[23]:00$/.test(iso), iso)
    check(`${label}: sun altitude matches suncalc within 1°`, Math.abs(shown - ref) < 1, `${shown.toFixed(2)}° / ${ref.toFixed(2)}°`)
    frames[label] = await frame(page)
    await shot(page, shots + `stage4-${label}-noon-aerial.png`)
  }
  // Shadow share: pixels darker than 55% of the frame's bright ground (its 80th percentile of luminance).
  const shadowShare = (f) => {
    const bright = [...f].sort((a, b) => a - b)[Math.floor(f.length * 0.8)]
    return f.filter((v) => v < bright * 0.55).length / f.length
  }
  const wShare = shadowShare(frames.winter), sShare = shadowShare(frames.summer)
  const wAlt = getPosition(new Date('2026-12-21T10:00:00Z'), 31.8, 34.65).altitude
  const sAlt = getPosition(new Date('2026-06-21T09:00:00Z'), 31.8, 34.65).altitude
  check(
    'the shadow looks different between the two dates',
    Math.abs(wShare - sShare) > 0.03,
    `shadow covers ${(wShare * 100).toFixed(1)}% of the frame in winter, ${(sShare * 100).toFixed(1)}% in summer; a 1 m pole casts ${(1 / Math.tan((wAlt * Math.PI) / 180)).toFixed(2)} m and ${(1 / Math.tan((sAlt * Math.PI) / 180)).toFixed(2)} m`,
  )

  await page.click('[data-testid=quick-sunset]')
  await settle(page)
  const sunset = Number(await attr(page, '[data-testid=sun-altitude]', 'value'))
  check('"שקיעה" sets a low sun that still lights the model', sunset > 0 && sunset < 6, `${sunset.toFixed(2)}°`)

  // ---------- 2. No rebuild for any realistic change ----------
  await page.click('[data-testid=camera-eye_level_oblique]')
  await page.selectOption('[data-testid=real-material-outer]', 'jerusalem_stone')
  await page.selectOption('[data-testid=real-context]', 'urban_plaza')
  await page.click('[data-testid=real-weather-haze]')
  await page.click('[data-testid=quick-winter_solstice]')
  await settle(page)
  await shot(page, shots + 'stage4-plaza-stone-haze.png')
  const prompt = await page.textContent('[data-testid=visual-prompt]')
  for (const c of ['park_lawn', 'desert_loess', 'coastal_dunes']) {
    await page.selectOption('[data-testid=real-context]', c)
    await settle(page)
    await shot(page, shots + `stage4-context-${c}.png`)
  }
  await page.click('[data-testid=level-bare]')
  await page.waitForTimeout(1500)
  await page.click('[data-testid=level-realistic]')
  await page.waitForTimeout(1500)
  await page.click('[data-testid=level-bare]')
  await page.waitForTimeout(1500)
  const builds1 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
  const version1 = Number(await attr(page, '[data-testid=stage]', 'modelVersion'))
  check('switching levels and editing realistic fields never rebuilds', builds1 === builds0 && version1 === version0, `builds ${builds0} → ${builds1}, model version ${version0} → ${version1}`)

  // ---------- 3. The prompt follows the screen ----------
  check('the prompt shows the chosen material, context, weather and date', /אבן ירושלמית/.test(prompt) && /כיכר עירונית/.test(prompt) && /אובך/.test(prompt) && /21 בדצמבר/.test(prompt), prompt.slice(0, 120) + '…')
  check('the prompt ends with the fixed parameters', prompt.endsWith('Documentary realism, Professional architecture photography, 1:1 --ar 1:1 --no text, words, writing, frame divisions'))

  // A geometry change still builds, so the counter is live.
  await page.$eval('[data-testid=param-R]', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, String(Number(el.value) + 1))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForFunction((v) => Number(document.querySelector('[data-testid=stage]').dataset.modelVersion) > v, version1, { timeout: 30000 })
  await page.click('[data-testid=level-realistic]')
  await page.waitForTimeout(500)
  const builds2 = Number(await attr(page, '[data-testid=stage]', 'buildCount'))
  check('a geometry change does build (the counter is live)', builds2 > builds1, `${builds1} → ${builds2}`)
  const kept = await page.$eval('[data-testid=real-material-outer]', (el) => el.value)
  check('realistic choices survive a geometry change', kept === 'jerusalem_stone', kept)
  await page.close()

  // ---------- RTL, no icons, 400 px ----------
  const narrow = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 })
  await narrow.goto(`http://localhost:${PORT}/#/studio`)
  await narrow.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await narrow.click('[data-testid=level-realistic]')
  await narrow.waitForTimeout(3000)
  const layout = await narrow.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    icons: document.querySelectorAll('svg, img, i[class*=icon], [class*=icon]').length,
    smallTargets: [...document.querySelectorAll('button, select')].filter((b) => b.getBoundingClientRect().height < 44).length,
  }))
  check('realistic tab: no horizontal scroll at 400 px', layout.scrollWidth <= layout.clientWidth, `${layout.scrollWidth} ≤ ${layout.clientWidth}`)
  check('realistic tab: no icons', layout.icons === 0, `${layout.icons}`)
  check('realistic tab: touch targets at least 44 px', layout.smallTargets === 0, `${layout.smallTargets} smaller`)
  await narrow.screenshot({ path: shots + 'stage4-400px.png', timeout: 120000 })
  await narrow.close()
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
