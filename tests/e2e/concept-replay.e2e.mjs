/**
 * Stage 3, acceptance test 2 in the browser: concept to bare model in under 60 seconds.
 * Replays a real Edge Function answer (tests/e2e/recorded/hyperboloid.json) at its measured server delay,
 * with Supabase auth mocked, and times everything the browser adds: request, parse, Worker build, first frame.
 * The server side is measured live in concepts.integration.mjs; this test covers the rest of the path.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 4175
const LIMIT_MS = 60000
const recorded = JSON.parse(readFileSync(root + 'tests/e2e/recorded/hyperboloid.json', 'utf8'))

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

const now = Math.floor(Date.now() / 1000)
const session = {
  access_token: 'replay-token',
  refresh_token: 'replay-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: now + 3600,
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  let sentAuth = null
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }))
  await page.route('**/functions/v1/concept-to-recipe', async (route) => {
    sentAuth = route.request().headers()['authorization']
    await new Promise((r) => setTimeout(r, recorded.durationMs))
    const lines = [
      { type: 'progress', stage: 'calling', attempt: 1 },
      { type: 'progress', stage: 'validating', attempt: 1 },
      { type: 'result', ok: true, recipe: recorded.recipe, attempts: recorded.attempts, issues: [], model: 'recorded', durationMs: recorded.durationMs },
    ]
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })

  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/#/new`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.waitForSelector('[data-testid=concept]')
  await page.fill('[data-testid=concept]', 'היפרבולואיד')
  await page.waitForFunction(() => !document.querySelector('[data-testid=submit]').disabled)

  // Measured inside the page: from the click event to the frame that shows the skeleton.
  await page.evaluate(() => {
    const w = window
    document.querySelector('[data-testid=submit]').addEventListener('click', () => (w.__clickAt = performance.now()), { capture: true })
    new MutationObserver((_, obs) => {
      if (document.querySelector('[data-testid=creating]')) {
        requestAnimationFrame(() => (w.__skeletonAt = performance.now()))
        obs.disconnect()
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  const t0 = Date.now()
  await page.click('[data-testid=submit]')
  await page.waitForFunction(() => window.__skeletonAt !== undefined, null, { timeout: 2000 })
  const skeletonMs = Math.round(await page.evaluate(() => window.__skeletonAt - window.__clickAt))
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: LIMIT_MS + 10000 })
  const totalMs = Date.now() - t0
  const browserMs = totalMs - recorded.durationMs
  const notice = await page.textContent('[data-testid=notice]').catch(() => '')

  check('the request carries the session token', sentAuth === 'Bearer replay-token', sentAuth)
  check('a skeleton appears within 100 ms of submit', skeletonMs <= 100, `${skeletonMs} ms`)
  check('concept to bare model under 60 s', totalMs < LIMIT_MS, `${(totalMs / 1000).toFixed(1)} s: server ${(recorded.durationMs / 1000).toFixed(1)} s, browser ${(browserMs / 1000).toFixed(1)} s`)
  check('the studio reports the time and the repair round', /תוך \d+ שניות/.test(notice) && /סבב תיקון אחד/.test(notice), notice)
  await page.close()
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
