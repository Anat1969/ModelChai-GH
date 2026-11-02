/**
 * The bridge to "מושג מתמטי" (DECISIONS.md 143), in Chromium against the production build. The other app's
 * bridge.json is served from a recorded copy (tests/e2e/recorded/musag-bridge.json). Run after `vite build`:
 * `node tests/e2e/bridge.e2e.mjs`. Port 4310 only.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 4310
const BASE = `http://localhost:${PORT}/`
const BRIDGE = readFileSync(root + 'tests/e2e/recorded/musag-bridge.json', 'utf8')

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})

async function open(hash, viewport = { width: 1280, height: 900 }, bridge = BRIDGE) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.route('**/appofapp-gh.vercel.app/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.route('**/musag-matemati-gh.vercel.app/bridge.json', (r) =>
    bridge ? r.fulfill({ status: 200, contentType: 'application/json', body: bridge }) : r.abort(),
  )
  await page.route('**/musag-matemati-gh.vercel.app/media/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }))
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(BASE + hash)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.waitForSelector('[data-testid=model-page]', { timeout: 30000 })
  return page
}

try {
  let page = await open('#/learn?m=mobius')
  await page.waitForSelector('[data-testid=musag-knowledge]', { timeout: 10000 })
  check('Möbius: knowledge from מושג מתמטי', (await page.locator('.musag-card').count()) === 1)
  const text = await page.locator('[data-testid=musag-knowledge]').innerText()
  check('Möbius: the precedent, with its Latin name', text.includes('בית מביוס') && text.includes('Möbius House'))
  check('Möbius: marked as the same concept', text.includes('אותו מושג'))
  check('Möbius: a source for the rule', (await page.locator('.musag-source').count()) >= 2)
  check('Möbius: link to the full article', (await page.locator('.musag-open').getAttribute('href')) === 'https://musag-matemati-gh.vercel.app/#/c/mobius')
  await page.close()

  page = await open('#/learn?m=klein')
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(BASE + '#/learn?m=mobius')
  await page.waitForSelector('[data-model=mobius][data-testid=model-page]', { timeout: 10000 })
  check('From model to model in the same tab: the page stays (DECISIONS.md 145)', errors.length === 0, errors.join(' | '))
  await page.close()

  page = await open('#/learn?m=riemann')
  await page.waitForSelector('[data-testid=musag-knowledge]', { timeout: 10000 })
  check('Riemann sum: the integral article', (await page.locator('.musag-card').getAttribute('data-concept')) === 'integral')
  await page.close()

  page = await open('#/learn?m=ulam_spiral')
  await page.waitForSelector('[data-testid=musag-knowledge]', { timeout: 10000 })
  check('Ulam spiral: new model, with the prime-number article', (await page.locator('.musag-card').getAttribute('data-concept')) === 'prime')
  check('Ulam spiral: drawn from its equation', (await page.locator('[data-testid=model-page] svg path').count()) > 20)
  await page.close()

  page = await open('#/learn?m=random_walk')
  await page.waitForSelector('[data-testid=musag-knowledge]', { timeout: 10000 })
  check('Random walk: the entropy article', (await page.locator('.musag-card').getAttribute('data-concept')) === 'entropy')
  await page.close()

  page = await open('#/learn?m=umbilic_torus')
  await page.waitForTimeout(1500)
  check('Umbilic torus: no section, not an empty box', (await page.locator('[data-testid=musag-knowledge]').count()) === 0)
  await page.close()

  page = await open('#/learn?m=klein', { width: 1280, height: 900 }, null)
  await page.waitForTimeout(1500)
  check('Without the other app: the page stands, no section', (await page.locator('[data-testid=musag-knowledge]').count()) === 0)
  await page.close()

  page = await open('#/learn?m=golden_spiral', { width: 390, height: 844 })
  await page.waitForSelector('[data-testid=musag-knowledge]', { timeout: 10000 })
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check('Phone: no horizontal scroll', !wide)
  await page.locator('[data-testid=musag-knowledge]').screenshot({ path: root + 'docs/screenshots/bridge-390px.png' })
  await page.close()
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
