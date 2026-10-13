/**
 * Stage 5 acceptance tests in Chromium (`npm run e2e`), against an in-memory Supabase: PostgREST, Storage
 * and Auth are answered here, so every request the app sends is checked.
 * 1. A project reopens exactly in the state it was saved, camera included.
 * 2. Comparison shows two versions with the same camera, and the metrics that changed are marked.
 * Also: versions are immutable and point to their parent, a save without a connection waits and syncs,
 * and an unsaved change survives a reload as a local draft.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4177
const BASE = `http://localhost:${PORT}/`

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ---------- in-memory Supabase ----------
const USER = '00000000-0000-4000-8000-0000000000aa'
const db = { mathcreator_projects: [], mathcreator_recipe_versions: [], mathcreator_snapshots: [] }
const files = new Map()
const log = []
let offline = false
let clock = Date.parse('2026-10-13T08:00:00Z')
const now = () => new Date((clock += 1000)).toISOString()

const session = () => ({
  access_token: 'mock-token',
  refresh_token: 'mock-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
})

function filterRows(rows, params) {
  let out = rows
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const val = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[key]) === val)
    if (op === 'in') {
      const set = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))
      out = out.filter((r) => set.includes(String(r[key])))
    }
  }
  const order = params.get('order')
  if (order) {
    const [col, dir] = order.split('.')
    out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
  }
  const select = params.get('select')
  if (select && select !== '*') {
    const cols = select.split(',')
    out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
  }
  return out
}

async function rest(route) {
  const req = route.request()
  const url = new URL(req.url())
  const table = url.pathname.split('/rest/v1/')[1]
  const rows = db[table]
  log.push(`${req.method()} ${table}`)
  if (!rows) return route.fulfill({ status: 404, body: '{}' })
  if (req.headers()['authorization'] !== 'Bearer mock-token') return route.fulfill({ status: 401, body: '{"message":"no session"}' })
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (req.method() === 'GET') {
    const out = filterRows(rows, url.searchParams)
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return out.length === 1 ? json(200, out[0]) : json(406, { message: 'not one row' })
    return json(200, out)
  }
  if (req.method() === 'POST') {
    const body = JSON.parse(req.postData() ?? '[]')
    const ignore = (req.headers()['prefer'] ?? '').includes('ignore-duplicates')
    for (const item of Array.isArray(body) ? body : [body]) {
      if (rows.some((r) => r.id === item.id)) {
        if (ignore) continue
        return json(409, { message: 'duplicate key' })
      }
      const t = now()
      rows.push({ created_at: t, ...(table === 'mathcreator_projects' ? { updated_at: t, owner: USER } : {}), ...item })
    }
    return route.fulfill({ status: 201, body: '' })
  }
  if (req.method() === 'PATCH') {
    // Versions have no update policy: they are immutable.
    if (table === 'mathcreator_recipe_versions') return json(403, { message: 'versions are immutable' })
    const body = JSON.parse(req.postData() ?? '{}')
    for (const r of filterRows(rows, url.searchParams)) Object.assign(rows.find((x) => x.id === r.id), body, { updated_at: now() })
    return route.fulfill({ status: 204, body: '' })
  }
  return json(405, {})
}

async function storage(route) {
  const req = route.request()
  const url = new URL(req.url())
  const path = decodeURIComponent(url.pathname.split('/storage/v1/')[1])
  if (req.method() === 'POST' && path.startsWith('object/sign/')) {
    const { paths } = JSON.parse(req.postData())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(paths.map((p) => ({ path: p, error: null, signedURL: `/object/sign/mathcreator-snapshots/${p}?token=t` }))) })
  }
  if (req.method() === 'GET' && path.startsWith('object/sign/')) {
    const key = path.replace('object/sign/mathcreator-snapshots/', '')
    const png = files.get(key)
    return png ? route.fulfill({ contentType: 'image/png', body: png }) : route.fulfill({ status: 404, body: '' })
  }
  if (req.method() === 'POST' && path.startsWith('object/mathcreator-snapshots/')) {
    const key = path.replace('object/mathcreator-snapshots/', '')
    log.push(`UPLOAD ${key}`)
    if (!key.startsWith(USER + '/')) return route.fulfill({ status: 403, body: '{"message":"not your folder"}' })
    if (files.has(key)) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' })
    const buf = req.postDataBuffer()
    const start = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const end = buf.lastIndexOf(Buffer.from('\r\n--'))
    files.set(key, buf.subarray(start, end > start ? end : buf.length))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Key: `mathcreator-snapshots/${key}`, Id: key }) })
  }
  return route.fulfill({ status: 404, body: '{}' })
}

async function mock(page) {
  await page.route('**/auth/v1/**', (r) => (offline ? r.abort('internetdisconnected') : r.fulfill({ contentType: 'application/json', body: JSON.stringify(session()) })))
  await page.route('**/rest/v1/**', (r) => (offline ? r.abort('internetdisconnected') : rest(r)))
  await page.route('**/storage/v1/**', (r) => (offline ? r.abort('internetdisconnected') : storage(r)))
}

// ---------- helpers ----------
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })

async function open(page, hash) {
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(BASE + hash)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}
const modelReady = (page, after = 0) =>
  page.waitForFunction((v) => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > v, after, { timeout: 90000 })
const version = (page) => page.$eval('[data-testid=stage]', (el) => Number(el.dataset.modelVersion))
async function nudgeR(page, delta) {
  const before = await version(page)
  await page.$eval(
    '[data-testid=param-R]',
    (el, d) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(Number(el.value) + d))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    delta,
  )
  await modelReady(page, before)
  return Number(await page.$eval('[data-testid=param-R]', (el) => el.value))
}
async function orbit(page, sel, dx, dy) {
  const b = await page.locator(sel).first().boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8)
  await page.mouse.up()
  await page.waitForTimeout(1500)
}
const recipeR = (v) => v.recipe.generator.params.path.R
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-3)

try {
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await mock(page)

  // ---------- empty projects screen ----------
  await open(page, '#/projects')
  await page.waitForSelector('[data-testid=empty]', { timeout: 30000 })
  check('projects is the home screen, empty at first', (await page.textContent('h1')) === 'פרויקטים')

  // ---------- version 1: edited geometry, realistic level, an orbited camera ----------
  await open(page, '#/studio')
  await modelReady(page)
  const r1 = await nudgeR(page, 1)
  await page.click('[data-testid=level-realistic]')
  await page.click('[data-testid=camera-aerial]')
  await page.waitForTimeout(1500)
  await orbit(page, '[data-testid=stage] canvas', 140, -40)
  await page.fill('[data-testid=version-note]', 'רדיוס גדול יותר')
  await page.click('[data-testid=save-version]')
  await page.waitForSelector('[data-testid=save-status][data-status=saved]', { timeout: 60000 })
  const v1 = db.mathcreator_recipe_versions[0]
  check('save writes a project, a version, a snapshot file and its row', db.mathcreator_projects.length === 1 && db.mathcreator_recipe_versions.length === 1 && files.size === 1 && db.mathcreator_snapshots.length === 1, log.filter((l) => !l.startsWith('GET')).join(', '))
  const png = [...files.values()][0]
  check('snapshot is a 1:1 PNG', png.readUInt32BE(16) === png.readUInt32BE(20) && png.readUInt32BE(16) === 768, `${png.readUInt32BE(16)} × ${png.readUInt32BE(20)}`)
  check('the first version has no parent, and keeps level and camera', v1.parent_id === null && v1.view.level === 'realistic' && v1.view.camera.position.length === 3, JSON.stringify(v1.view.camera.position))
  check('the snapshot row carries the visual prompt', /Documentary realism/.test(db.mathcreator_snapshots[0].visual_prompt ?? ''))

  // ---------- version 2: derived from version 1 ----------
  await page.click('[data-testid=level-bare]')
  const r2 = await nudgeR(page, 2)
  await page.fill('[data-testid=version-note]', 'חצר רחבה')
  await page.click('[data-testid=save-version]')
  await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.dataset.status === 'saved' && document.querySelector('[data-testid=save-version]').disabled, null, { timeout: 60000 })
  await page.waitForTimeout(300)
  const v2 = db.mathcreator_recipe_versions[1]
  check('a new save is a new version that points to its parent', db.mathcreator_recipe_versions.length === 2 && v2.parent_id === v1.id && v2.recipe.meta.parent_id === v1.id, `${v2?.parent_id?.slice(0, 8)} → ${v1.id.slice(0, 8)}`)
  check('the earlier version did not change', recipeR(v1) === r1 && recipeR(v2) === r2, `R ${recipeR(v1)} and ${recipeR(v2)}`)

  // ---------- 1. Reopen exactly as saved ----------
  const fresh = await context.newPage()
  fresh.on('pageerror', (e) => console.log('pageerror:', e.message))
  await mock(fresh)
  await open(fresh, '#/projects')
  await fresh.waitForSelector('[data-testid=project]', { timeout: 30000 })
  const thumb = await fresh.waitForFunction(() => document.querySelector('img.snapshot')?.naturalWidth || 0, null, { timeout: 30000 })
  check('the project shows its latest snapshot', (await thumb.jsonValue()) === 768)
  await fresh.click('[data-testid=toggle-versions]')
  const listed = await fresh.$$eval('[data-testid=version]', (els) => els.map((e) => e.textContent))
  check('both versions are listed, newest first, with their lineage', listed.length === 2 && /חצר רחבה/.test(listed[0]) && /נגזרה מגרסה 1/.test(listed[0]) && /הגרסה הראשונה/.test(listed[1]), listed.map((t) => t.slice(0, 40)).join(' | '))
  await fresh.screenshot({ path: shots + 'stage5-projects.png' })

  await fresh.click(`[data-version="${v1.id}"] button`)
  await modelReady(fresh)
  await fresh.waitForFunction(() => document.querySelector('[data-testid=stage]')?.dataset.camera, null, { timeout: 30000 })
  await fresh.waitForTimeout(800)
  const reopened = {
    R: Number(await fresh.$eval('[data-testid=param-R]', (el) => el.value).catch(() => NaN)),
    level: await fresh.$eval('[data-testid=stage]', (el) => el.dataset.level),
    camera: JSON.parse(await fresh.$eval('[data-testid=stage]', (el) => el.dataset.camera)),
    url: fresh.url(),
  }
  const saved = [...v1.view.camera.position, ...v1.view.camera.target]
  check('acceptance 1: reopens on the saved level', reopened.level === 'realistic', reopened.level)
  check('acceptance 1: reopens with the saved camera, to the millimeter', near(reopened.camera, saved), `${reopened.camera.slice(0, 3).join(', ')} / ${saved.slice(0, 3).map((v) => v.toFixed(3)).join(', ')}`)
  await fresh.click('[data-testid=level-bare]')
  const rShown = Number(await fresh.$eval('[data-testid=param-R]', (el) => el.value))
  check('acceptance 1: reopens with the saved recipe', rShown === r1, `R ${rShown} / ${r1}`)
  check('the address names the version', reopened.url.includes(`v=${v1.id}`))
  const saveDisabled = await fresh.$eval('[data-testid=save-version]', (el) => el.disabled)
  check('an unchanged version cannot be saved again', saveDisabled)

  // ---------- 2. Comparison ----------
  await open(fresh, '#/projects')
  await fresh.waitForSelector('[data-testid=project]')
  await fresh.click('[data-testid=toggle-versions]')
  const picks = await fresh.$$('[data-testid=pick-version]')
  for (const p of picks) await p.check()
  await fresh.click('[data-testid=compare]')
  await fresh.waitForFunction(() => [...document.querySelectorAll('[data-testid=compare-stage]')].filter((s) => s.dataset.camera).length === 2, null, { timeout: 120000 })
  const cams = async () => fresh.$$eval('[data-testid=compare-stage]', (els) => els.map((e) => JSON.parse(e.dataset.camera)))
  const [ca, cb] = await cams()
  check('acceptance 2: both versions open with the same camera', near(ca, cb), ca.slice(0, 3).join(', '))
  check('acceptance 2: the camera is the one the first version was saved with', near(ca, saved))
  await orbit(fresh, '[data-testid=compare-stage][data-side=a] canvas', -160, 30)
  await fresh.waitForTimeout(2500)
  const [ma, mb] = await cams()
  check('acceptance 2: orbiting one window moves both', near(ma, mb) && !near(ma, ca), `${ma.slice(0, 3).join(', ')} | ${mb.slice(0, 3).join(', ')}`)
  const diff = await fresh.$$eval('[data-testid=metric-diff] tr[data-metric]', (rows) => Object.fromEntries(rows.map((r) => [r.dataset.metric, r.dataset.changed === 'true'])))
  check('acceptance 2: changed metrics are marked', diff.outerDiameter === true && diff.courtyardDiameter === true && diff.volume === true, Object.entries(diff).filter(([, v]) => v).map(([k]) => k).join(', '))
  check('acceptance 2: unchanged metrics are not', diff.edgeCount === false && diff.cuspBurial === false)
  const fields = await fresh.textContent('[data-testid=field-diff]')
  check('the recipe fields that changed are listed', /generator\.params\.path\.R/.test(fields) && !/meta\./.test(fields), fields.replace(/[⁦⁩]/g, '').slice(0, 90))
  await fresh.screenshot({ path: shots + 'stage5-compare.png', timeout: 120000 })

  // ---------- offline save and sync ----------
  await open(fresh, `#/studio?v=${v1.id}`)
  await modelReady(fresh)
  await fresh.click('[data-testid=level-bare]')
  await nudgeR(fresh, -1)
  offline = true
  await fresh.click('[data-testid=save-version]')
  await fresh.waitForSelector('[data-testid=save-status][data-status=queued]', { timeout: 30000 })
  const queued = await fresh.evaluate(() => JSON.parse(localStorage.getItem('mathcreator-pending') ?? '[]').length)
  check('without a connection the version waits on the device', queued === 1 && db.mathcreator_recipe_versions.length === 2, `${queued} queued`)
  offline = false
  await fresh.evaluate(() => window.dispatchEvent(new Event('online')))
  await fresh.waitForFunction(() => JSON.parse(localStorage.getItem('mathcreator-pending') ?? '[]').length === 0, null, { timeout: 30000 })
  const v3 = db.mathcreator_recipe_versions[2]
  check('when the connection returns, it is sent once, with its parent', db.mathcreator_recipe_versions.length === 3 && v3?.parent_id === v1.id && files.size === 3, `${db.mathcreator_recipe_versions.length} versions, ${files.size} snapshots`)
  const status = await fresh.$eval('[data-testid=save-status]', (el) => el.dataset.status)
  check('the studio reports the sync', status === 'saved', status)

  // ---------- local draft ----------
  const rDraft = await nudgeR(fresh, 3)
  await fresh.waitForTimeout(1200)
  await open(fresh, '#/projects')
  await fresh.reload()
  await fresh.waitForSelector('[data-testid=draft]', { timeout: 30000 })
  await fresh.click('[data-testid=draft] button')
  await modelReady(fresh)
  const restored = Number(await fresh.$eval('[data-testid=param-R]', (el) => el.value))
  const notice = await fresh.textContent('[data-testid=notice]')
  check('an unsaved change survives a reload as a local draft', restored === rDraft && /טיוטה מקומית/.test(notice), `R ${restored} / ${rDraft}`)

  // ---------- 400 px ----------
  const narrow = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 })
  await mock(narrow)
  await narrow.addInitScript((s) => localStorage.setItem('mathcreator-auth', JSON.stringify(s)), session())
  for (const [hash, sel] of [['#/projects', '[data-testid=project]'], [`#/compare?a=${v1.id}&b=${v2.id}`, '[data-testid=metric-diff]']]) {
    await open(narrow, hash)
    await narrow.waitForSelector(sel, { timeout: 120000 })
    if (hash.startsWith('#/projects')) await narrow.click('[data-testid=toggle-versions]')
    const layout = await narrow.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      icons: document.querySelectorAll('svg, img:not(.snapshot), [class*=icon]').length,
      small: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 44).length,
      dir: document.documentElement.dir,
    }))
    const name = hash.startsWith('#/projects') ? 'projects' : 'compare'
    check(`${name}: RTL, no horizontal scroll and no icons at 400 px`, layout.dir === 'rtl' && layout.scrollWidth <= layout.clientWidth && layout.icons === 0, `${layout.scrollWidth} ≤ ${layout.clientWidth}, icons ${layout.icons}`)
    check(`${name}: touch targets at least 44 px`, layout.small === 0, `${layout.small} smaller`)
  }
  await narrow.close()
} finally {
  await browser.close()
  server.kill()
}
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
