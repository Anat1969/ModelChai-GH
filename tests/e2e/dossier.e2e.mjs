/**
 * The project's document (DECISIONS.md 92) in Chromium, against an in-memory Supabase (the same mock as
 * projects.e2e.mjs). A project with versions, frozen views, a render, a reading and a post becomes seven A4
 * pages, read from the end to the beginning; it downloads as a PDF and as a Word file, is kept in the collection,
 * and gives a share link. Run with `node tests/e2e/dossier.e2e.mjs` after `vite build`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4179
const BASE = `http://localhost:${PORT}/`

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ---------- in-memory Supabase ----------
const USER = '00000000-0000-4000-8000-0000000000aa'
const db = { mathcreator_projects: [], mathcreator_recipe_versions: [], mathcreator_snapshots: [], mathcreator_library: [] }
const postCalls = []
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
    if ((req.headers()['prefer'] ?? '').includes('return=representation')) {
      const made = rows.filter((r) => (Array.isArray(body) ? body : [body]).some((b) => b.id === r.id))
      return (req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? json(201, made[0]) : json(201, made)
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
  if (req.method() === 'DELETE') {
    const gone = filterRows(rows, url.searchParams).map((r) => r.id)
    db[table] = rows.filter((r) => !gone.includes(r.id))
    // The prompt's images go with it (on delete cascade).
    if (table === 'mathcreator_library') db[table] = db[table].filter((r) => !gone.includes(r.prompt_id))
    return route.fulfill({ status: 204, body: '' })
  }
  return json(405, {})
}

async function storage(route) {
  const req = route.request()
  const url = new URL(req.url())
  const path = decodeURIComponent(url.pathname.split('/storage/v1/')[1])
  const m = path.match(/^object\/(sign\/)?([a-z-]+)(?:\/(.*))?$/)
  if (!m) return route.fulfill({ status: 404, body: '{}' })
  const [, sign, bucket, key = ''] = m
  const full = (k) => `${bucket}/${k}`
  if (req.method() === 'POST' && sign && !key) {
    const { paths } = JSON.parse(req.postData())
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(paths.map((p) => ({ path: p, error: null, signedURL: `/object/sign/${bucket}/${p}?token=t` }))) })
  }
  if (req.method() === 'POST' && sign) log.push(`SIGN ${key} ${JSON.parse(req.postData() ?? '{}').expiresIn}`)
  if (req.method() === 'POST' && sign) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/${bucket}/${key}?token=t` }) })
  if (req.method() === 'GET' && sign) {
    const file = files.get(full(key))
    const type = key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.3mf') ? 'model/3mf' : 'image/jpeg'
    return file ? route.fulfill({ contentType: type, body: file }) : route.fulfill({ status: 404, body: '' })
  }
  if (req.method() === 'DELETE' && !sign) {
    const { prefixes } = JSON.parse(req.postData())
    for (const p of prefixes) files.delete(full(p))
    log.push(`REMOVE ${bucket} ${prefixes.length}`)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(prefixes.map((name) => ({ name }))) })
  }
  if (req.method() === 'POST') {
    log.push(`UPLOAD ${key}`)
    if (!key.startsWith(USER + '/')) return route.fulfill({ status: 403, body: '{"message":"not your folder"}' })
    if (files.has(full(key))) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' })
    const buf = req.postDataBuffer()
    // Where the file starts inside the multipart body: PNG, JPEG, a zip (3MF), or an MP4's first box.
    const sig = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('%PDF', 'latin1')].map((b) => buf.indexOf(b)).filter((i) => i >= 0)
    const ftyp = buf.indexOf(Buffer.from('ftyp'))
    if (key.endsWith('.mp4') && ftyp >= 4) sig.push(ftyp - 4)
    const start = key.endsWith('.mp4') ? ftyp - 4 : Math.min(...sig)
    const end = buf.lastIndexOf(Buffer.from('\r\n--'))
    files.set(full(key), buf.subarray(start, end > start ? end : buf.length))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Key: full(key), Id: key }) })
  }
  return route.fulfill({ status: 404, body: '{}' })
}

async function mock(page) {
  // The device account: the app signs in on its own, with no email (DECISIONS.md 81).
  await page.route('**/functions/v1/mathcreator-device', (r) =>
    offline ? r.abort('internetdisconnected') : (log.push('DEVICE'), r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'device-test@device.math-creator.app', password: 'p' }) })),
  )
  await page.route('**/auth/v1/**', (r) => (offline ? r.abort('internetdisconnected') : r.fulfill({ contentType: 'application/json', body: JSON.stringify(session()) })))
  await page.route('**/rest/v1/**', (r) => (offline ? r.abort('internetdisconnected') : rest(r)))
  await page.route('**/storage/v1/**', (r) => (offline ? r.abort('internetdisconnected') : storage(r)))
  // The post function: answers like Claude would, and records what it was sent.
  await page.route('**/functions/v1/concept-post', async (r) => {
    const body = JSON.parse(r.request().postData())
    postCalls.push({ auth: r.request().headers()['authorization'], body })
    if (body.mode === 'reading')
      return r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, reading: { logic: 'לוגיקה.', space: 'מרחב.', figure_ground: 'החצר היא הנגטיב.', synthesis: 'משפט אחד שמחבר.' }, model: 'mock', durationMs: 3100 }),
      })
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, short: 'טבעת אחת שנראית כשלוש.', post: 'פסקה ראשונה.\n\nפסקה שנייה.', model: 'mock', durationMs: 4200 }),
    })
  })
}

// ---------- helpers ----------

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true })

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

// ---------- a project with its whole way ----------
const recipe = JSON.parse(readFileSync(root + 'docs/fixtures/umbilic-torus.recipe.json', 'utf8'))
const P = '11111111-1111-4111-8111-111111111111'
const V1 = '22222222-2222-4222-8222-222222222221'
const V2 = '22222222-2222-4222-8222-222222222222'
const at = (h) => `2026-10-1${h}T10:00:00Z`
db.mathcreator_projects.push({ id: P, concept: 'Umbilic torus', title_he: 'הטבעת המשולשת', created_at: at(3), updated_at: at(5), owner: USER })
db.mathcreator_recipe_versions.push(
  { id: V1, project_id: P, parent_id: null, note: null, schema_version: '1.0', view: null, created_at: at(3), recipe },
  { id: V2, project_id: P, parent_id: V1, note: 'דופן עבה יותר', schema_version: '1.0', view: null, created_at: at(5), recipe },
)
const png = (name) => readFileSync(shots + name)
const view = (level) => ({ level, camera: { preset: 'eye_level_oblique', position: [-31, 22, 45], target: [0, 3, 0] } })
const still = (id, stage, file, h) => {
  const path = `${USER}/${P}/${id}.png`
  files.set(`mathcreator-library/${path}`, png(file))
  db.mathcreator_library.push({ id, project_id: P, version_id: V2, kind: 'still', stage, view: view(stage === 'bare' ? 'bare' : 'realistic'), image_path: path, created_at: at(h) })
}
still('a0000000-0000-4000-8000-000000000001', 'bare', 'stage2-umbilic-eye-level.png', 4)
still('a0000000-0000-4000-8000-000000000002', 'realistic', 'stage4-plaza-stone-haze.png', 4)
still('a0000000-0000-4000-8000-000000000003', 'render', 'stage4-context-coastal_dunes.png', 5)
for (const [v, f] of [[V1, 'stage2-section-aerial.png'], [V2, 'stage4-summer-noon-aerial.png']]) {
  const path = `${USER}/${v}.png`
  files.set(`mathcreator-snapshots/${path}`, png(f))
  db.mathcreator_snapshots.push({ id: crypto.randomUUID(), version_id: v, image_path: path, level: 'bare', created_at: at(5) })
}
db.mathcreator_library.push(
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    project_id: P,
    version_id: V2,
    kind: 'reading',
    distill: 'שלושה חודים שהם קו אחד: מבחוץ רואים שלוש פסגות, ומבפנים הולכים על שביל אחד שחוזר אל עצמו.',
    body: JSON.stringify({ logic: 'הטורוס הטבורי הוא משטח שהחתך שלו הוא דלתואיד.', space: 'החתך הופך לחלל שעוברים בו.', figure_ground: 'החצר היא הנגטיב.' }),
    created_at: at(5),
  },
  { id: 'b0000000-0000-4000-8000-000000000002', project_id: P, version_id: V2, kind: 'post', distill: 'טבעת אחת שנראית כשלוש.', body: 'פסקה ראשונה.\n\nפסקה שנייה.', created_at: at(5) },
  { id: 'b0000000-0000-4000-8000-000000000003', project_id: P, version_id: V2, kind: 'print', stage: 'print', view: null, image_path: `${USER}/${P}/p.3mf`, distill: '1:324, הצלע הארוכה 150 מ"מ, 94 גרם PLA', created_at: at(5) },
)
files.set(`mathcreator-library/${USER}/${P}/p.3mf`, Buffer.from('PK'))

const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await mock(page)
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })

await open(page, `#/collection?p=${P}`)
await page.waitForSelector('[data-testid=open-dossier]', { timeout: 30000 })
await page.click('[data-testid=open-dossier]')
await page.waitForSelector('[data-testid=dossier-page]', { timeout: 30000 })
const t0 = Date.now()
await page.waitForFunction(() => /7 עמודים/.test(document.querySelector('[data-testid=dossier-status]')?.textContent ?? ''), null, { timeout: 60000 })
check('the collection opens the document, and the pages are ready with their images', true, `${Date.now() - t0} ms for the images`)

const pages = await page.$$eval('[data-testid=dossier-page]', (els) => els.map((e) => ({ label: e.getAttribute('aria-label'), w: e.offsetWidth, h: e.offsetHeight })))
check('seven A4 pages: flyer, two of distillation, three of the way back, the method', pages.length === 7 && pages[0].label === 'פלייר' && pages[6].label === 'השיטה', pages.map((p) => p.label).join(' | '))
check('each page is 794 px wide and at least A4 tall', pages.every((p) => p.w === 794 && p.h >= 1123), pages.map((p) => p.h).join(','))
const order = await page.$$eval('.dz-step', (els) => els.map((e) => e.dataset.stage))
check('the way back runs from the print to the concept', order.join(',') === 'print,render,realistic,bare,recipe,concept', order.join(','))
const forms = await page.$$eval('.dz-rung', (els) => els.map((e) => e.dataset.form))
check('the forms of distillation run from the name to the prompt', forms[0] === 'שם' && forms[1] === 'פתגם' && forms.indexOf('סינתזה') < forms.indexOf('פרשנות') && forms.includes('פרומפט'), forms.join(' > '))
const cover = await page.$eval('.dz-hero figcaption', (e) => e.textContent)
check('the cover shows the render', /הדמיה/.test(cover), cover)
const imgs = await page.$$eval('.dz-page img', (els) => els.map((e) => e.naturalWidth))
check('every picture is loaded as data, so the PDF never meets a foreign image', imgs.length >= 6 && imgs.every((w) => w > 0), `${imgs.length} images`)
const facts = await page.$$eval('.dz-facts dt', (els) => els.map((e) => e.textContent))
check('the cover carries measured numbers', facts.includes('קוטר חיצוני') && facts.includes('מקום'), facts.join(', '))
await page.screenshot({ path: shots + 'dossier-screen.png' })
// The sticky top bar would cover a page in an element screenshot.
await page.addStyleTag({ content: '.topbar{position:static!important}' })
for (const [i, name] of [[0, 'flyer'], [1, 'distillation'], [3, 'way-back'], [6, 'method']]) await (await page.$$('[data-testid=dossier-page]'))[i].screenshot({ path: shots + `dossier-${name}.png` })

// PDF
let t = Date.now()
const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('[data-testid=dossier-pdf]')])
const pdf = readFileSync(await pdfDl.path())
const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('the PDF downloads, one A4 page per page', pdf.subarray(0, 4).toString() === '%PDF' && pdfPages === 7 && /^Umbilic-torus-dossier-\d{4}-\d\d-\d\d\.pdf$/.test(pdfDl.suggestedFilename()) && /595\.2\d* 841\.8\d*/.test(pdf.toString('latin1')), `${pdfPages} pages, ${Math.round(pdf.length / 1024)} KB, ${Date.now() - t} ms, ${pdfDl.suggestedFilename()}`)

// Word
t = Date.now()
const [docDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=dossier-docx]')])
const zip = unzipSync(new Uint8Array(readFileSync(await docDl.path())))
const xml = strFromU8(zip['word/document.xml'])
const media = Object.keys(zip).filter((k) => k.startsWith('word/media/')).length
check('the Word file is right to left, editable text, with the pictures', xml.includes('<w:bidi/>') && xml.includes('צורות הזיקוק') && xml.includes('06 הדפסה') && media >= 4, `${media} images, ${Date.now() - t} ms, ${docDl.suggestedFilename()}`)

// Kept in the collection, with a share link
await page.click('[data-testid=dossier-save]')
await page.waitForFunction(() => /נשמרו בקולקציה/.test(document.querySelector('[data-testid=dossier-status]')?.textContent ?? ''), null, { timeout: 120000 })
const kept = db.mathcreator_library.filter((r) => r.kind === 'dossier')
check('PDF and Word are kept in the collection', kept.length === 2 && kept.some((k) => k.image_path.endsWith('.pdf')) && kept.some((k) => k.image_path.endsWith('.docx')), kept.map((k) => k.distill).join(' | '))
check('the stored PDF is the PDF', files.get(`mathcreator-library/${kept.find((k) => k.image_path.endsWith('.pdf')).image_path}`)?.subarray(0, 4).toString() === '%PDF')
await page.click('[data-testid=dossier-saved] button:has-text("העתקת קישור")')
await page.waitForFunction(() => /הקישור הועתק/.test(document.querySelector('[data-testid=dossier-status]')?.textContent ?? ''), null, { timeout: 20000 })
const signed = log.filter((l) => l.startsWith('SIGN ') && /\.(pdf|docx) /.test(l))
check('the share link opens for 30 days', signed.some((l) => l.endsWith(' 2592000')), signed.at(-1))
const clip = await page.evaluate(() => navigator.clipboard.readText())
check('the link is on the clipboard', /object\/sign\/mathcreator-library\/.+\.(pdf|docx)/.test(clip), clip.slice(0, 80))

// Cover choice
await page.selectOption('[data-testid=dossier-cover]', { index: 0 })
const cover2 = await page.$eval('.dz-hero figcaption', (e) => e.textContent)
check('the owner can choose another cover', cover2 !== cover, cover2)

// Phone: no sideways scroll
await page.setViewportSize({ width: 400, height: 860 })
await page.waitForTimeout(300)
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('at 400 px the pages shrink to the screen, no sideways scroll', sideways <= 0, `${sideways} px`)
await page.screenshot({ path: shots + 'dossier-400px.png', fullPage: false })

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
