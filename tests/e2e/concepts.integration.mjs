/**
 * AI_PROMPT.md 6, test 2, and the Stage 3 time-to-model test. Runs against the deployed Edge Function and spends
 * real API tokens, so it runs by hand: `npm run integration`. Needs network access to the Supabase project.
 *
 * 1. Five concepts through the function: at least four valid on the first try, and the hyperboloid and Pascal's
 *    triangle come back with a non-empty fit_note. The response never contains the API key.
 * 2. In the browser: a concept typed into the New concept screen reaches a bare model in under 60 seconds.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const URL_ = process.env.VITE_SUPABASE_URL ?? 'https://ktqmwpbzcnzkhjskqisy.supabase.co'
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_IkreG7naPa1h-d4kGp1gpA_sLU4tg5q'
const CONCEPTS = [
  { concept: 'Umbilic torus', use: 'ביתן ציבורי', context: 'חוף ים', needsFitNote: false },
  { concept: 'Möbius strip', use: 'גשר הולכי רגל', context: 'פארק עירוני', needsFitNote: false },
  { concept: 'Spiral', use: 'מגדל תצפית', context: 'גבעות לס', needsFitNote: false },
  { concept: 'Hyperboloid', use: 'מגדל מים', context: 'כיכר עירונית', needsFitNote: true },
  { concept: "Pascal's triangle", use: 'פביליון', context: 'חזית מים', needsFitNote: true },
]

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } })
const signIn = process.env.TEST_EMAIL
  ? await db.auth.signInWithPassword({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD })
  : await db.auth.signInAnonymously()
if (!signIn.data.session) {
  console.error('Sign-in failed:', signIn.error?.message, '\nEnable anonymous sign-ins, or set TEST_EMAIL and TEST_PASSWORD for a test user.')
  process.exit(2)
}
const token = signIn.data.session.access_token

const rows = []
for (const c of CONCEPTS) {
  const t0 = Date.now()
  const res = await fetch(`${URL_}/functions/v1/concept-to-recipe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ concept: c.concept, use: c.use, context: c.context }),
  })
  const text = await res.text()
  const result = JSON.parse(text.trim().split('\n').at(-1))
  const fit = result.ok ? result.recipe.narrative.fit_note : null
  rows.push({ concept: c.concept, ok: result.ok, attempts: result.attempts, seconds: (Date.now() - t0) / 1000, fit_note: fit, model: result.model, error: result.error })
  check(`no API key in the response for ${c.concept}`, !/sk-ant-/.test(text))
  if (c.needsFitNote) check(`${c.concept} returns a non-empty fit_note`, result.ok && typeof fit === 'string' && fit.trim().length > 0, fit ?? result.error)
}
console.table(rows)
const firstTry = rows.filter((r) => r.ok && r.attempts === 1).length
check('at least 4 of 5 concepts valid on the first try', firstTry >= 4, `${firstTry} of 5`)

// ---------- concept to bare model in the browser ----------
const port = 4176
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`http://localhost:${port}/#/new`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.fill('[data-testid=concept]', 'Umbilic torus')
  await page.fill('[data-testid=use]', 'ביתן ציבורי')
  await page.fill('[data-testid=context]', 'חוף ים')
  const t0 = Date.now()
  await page.click('[data-testid=submit]')
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 120000 })
  const seconds = (Date.now() - t0) / 1000
  check('concept to bare model in under 60 seconds', seconds < 60, `${seconds.toFixed(1)} s`)
  mkdirSync(root + 'docs/screenshots', { recursive: true })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: root + 'docs/screenshots/stage3-concept-to-studio.png', fullPage: true })
} finally {
  await browser.close()
  server.kill()
}

writeFileSync(root + 'node_modules/.tmp/integration.json', JSON.stringify(rows, null, 2))
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
