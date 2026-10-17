/**
 * The work path (DECISIONS.md 97) in Chromium, against an in-memory Supabase (the mock of projects.e2e.mjs).
 * One project goes the whole way: the landing page, a project that starts from a sentence, the nine steps with
 * their fields and images, a recipe made from step 3 that lands in the same project, the prompt and its image,
 * and the article that gathers everything, edited and exported as PDF and Word. An older project made from a
 * concept is completed after the fact. Run with `node tests/e2e/journey.e2e.mjs` after `vite build`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4181
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

// ---------- the whole way, in one project ----------
const recipe = JSON.parse(readFileSync(root + 'docs/fixtures/umbilic-torus.recipe.json', 'utf8'))
const pngFile = (name) => ({ name, mimeType: 'image/png', buffer: readFileSync(shots + name) })
const project = () => db.mathcreator_projects.find((p) => p.title_he === 'שער הים' || p.journey?.idea?.title === 'שער הים')
const lib = (kind) => db.mathcreator_library.filter((r) => r.kind === kind && r.project_id === project()?.id)
const until = async (cond, ms = 15000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) return false
    await new Promise((r) => setTimeout(r, 100))
  }
  return true
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await mock(page)
let recipeAsked = null
await page.route('**/functions/v1/concept-to-recipe', async (route) => {
  recipeAsked = JSON.parse(route.request().postData())
  const lines = [{ type: 'progress', stage: 'calling', attempt: 1 }, { type: 'result', ok: true, recipe, attempts: 1, issues: [], model: 'mock', durationMs: 900 }]
  await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
})
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })

// 1. The landing page
await open(page, '')
await page.waitForSelector('[data-testid=home-start]', { timeout: 30000 })
const steps = await page.$$eval('.home-steps li strong', (els) => els.map((e) => e.textContent))
check('the landing page explains the way: nine steps, from an idea to the exhibition', steps.length === 9 && steps[0] === 'רעיון וכוונה' && steps[8] === 'עריכה לתערוכה', steps.join(' > '))
check('the landing page names what comes out at the end', (await page.$$('.home-outcome-grid .home-card')).length === 4)
await page.screenshot({ path: shots + 'journey-home.png', fullPage: true })
await page.fill('[data-testid=home-title]', 'שער הים')
await page.fill('[data-testid=home-idea]', 'מבנה שמחבר את העיר לים.')
await page.click('[data-testid=home-start]')
await page.waitForSelector('[data-testid=step][data-stage=idea]', { timeout: 15000 })
const P = project()?.id
check('a project starts from a sentence, before any recipe', !!P && project().journey.idea.idea === 'מבנה שמחבר את העיר לים.' && db.mathcreator_recipe_versions.length === 0, P)
check('the first step shows what is still missing, without blocking', /חסר: הכוונה/.test(await page.textContent('[data-testid=step-missing]')))

// 2. Writing on the steps is saved by itself
const type = async (sel, text) => {
  await page.fill(`[data-testid=${sel}]`, text)
}
await type('f-idea-intent', 'לעצור רגע לפני המים.')
await type('f-idea-question', 'האם קו אחד יכול להיות גם פנים וגם חוץ?')
check('fields are saved on the project as they are written', await until(() => project()?.journey?.idea?.question?.startsWith('האם קו')), JSON.stringify(project()?.journey?.idea))
check('a filled step is done', (await page.getAttribute('[data-testid=step]', 'data-state')) === 'done')

await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=context]')
check('the next step shows what the steps before it hold', /מבנה שמחבר את העיר לים/.test(await page.textContent('.jw-before')))
await type('f-context-place', 'אשדוד (Ashdod, Israel)')
await type('f-context-use', 'ביתן ציבורי')
await type('f-context-inspiration', 'הגלים שחוזרים אל עצמם.')
await page.setInputFiles('[data-testid=upload-reference]', pngFile('stage4-context-coastal_dunes.png'))
check('an inspiration image joins the project', await until(() => lib('reference').length === 1))
await page.waitForSelector('.jw-materials .gallery img')

// 3. The concept: the recipe is made from the steps before it, and lands in this project
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=concept]')
await type('f-concept-math', 'Umbilic torus')
await type('f-concept-why', 'לטורוס הטבורי יש קצה אחד שמקיף שלוש פעמים.')
await until(() => project()?.journey?.concept?.why)
await page.click('[data-testid=make-recipe]')
await page.waitForSelector('[data-testid=concept]')
await page.waitForFunction(() => document.querySelector('[data-testid=concept]').value !== '', null, { timeout: 15000 }).catch(() => null)
const pre = { concept: await page.inputValue('[data-testid=concept]'), use: await page.inputValue('[data-testid=use]'), context: await page.inputValue('[data-testid=context]') }
check('the new-concept form arrives filled from steps 2 and 3', pre.concept === 'Umbilic torus' && pre.use === 'ביתן ציבורי' && pre.context.startsWith('אשדוד'), JSON.stringify(pre))
await page.click('[data-testid=submit]')
check('the recipe is asked with the use and the place', await until(() => recipeAsked?.use === 'ביתן ציבורי'))
check('the first version is saved in the same project, without a manual save', await until(() => db.mathcreator_recipe_versions.some((v) => v.project_id === P), 60000))
check('the project keeps its own name', project().title_he === 'שער הים', project().title_he)

// 4. The prompt
await open(page, `#/project?p=${P}&s=prompt`)
await page.waitForSelector('[data-testid=prompt-from-model]', { timeout: 30000 })
await page.click('[data-testid=prompt-from-model]')
check('a prompt is derived from the model and kept', await until(() => lib('prompt').length === 1))
await page.waitForSelector('[data-testid=work-prompt]')

// 5. The image made from the prompt, and what it means
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=illustration]')
await page.setInputFiles('[data-testid=upload-to-prompt]', pngFile('stage4-plaza-stone-haze.png'))
check('the image is kept with the prompt it was made from', await until(() => lib('image').length === 1 && lib('image')[0].prompt_id === lib('prompt')[0].id))
await type('f-illustration-expresses', 'הקצה האחד נראה כקו של אור.')
await type('f-illustration-translates', 'הקו הופך לשביל שמקיף את החצר.')

// 6–9. Form, physical, result, exhibition
await open(page, `#/project?p=${P}&s=form`)
await page.waitForSelector('[data-testid=f-form-decisions]', { timeout: 30000 })
await type('f-form-decisions', 'עובי דופן של מטר, שלושה מעברים.')
await page.click('[data-testid=next-stage]')
await type('f-physical-scale', '1:324, הצלע הארוכה 150 מ"מ')
await type('f-physical-notes', 'החודים דרשו עיבוי של הדופן.')
await page.click('[data-testid=next-stage]')
await page.setInputFiles('[data-testid=upload-photo]', pngFile('stage2-umbilic-eye-level.png'))
check('a photo of the result joins the project', await until(() => lib('photo').length === 1))
await type('f-documentation-result', 'המודל עומד על החוד, והאור עובר בפתחים.')
await page.click('[data-testid=next-stage]')
await type('f-exhibition-author', 'ענת')
check('every step wrote to the project', await until(() => project()?.journey?.exhibition?.author === 'ענת' && project().journey.documentation?.result && project().journey.physical?.notes))

// Reload: everything is still there
await page.reload()
await page.waitForSelector('[data-testid=f-exhibition-author]', { timeout: 30000 })
check('after a reload the fields come back from the project', (await page.inputValue('[data-testid=f-exhibition-author]')) === 'ענת')
const rail = await page.$$eval('.jw-rail li', (els) => els.map((e) => e.dataset.state))
check('the rail marks steps done, and partial where a frozen view, a print file or a reading is missing', rail.length === 9 && rail.filter((s) => s === 'done').length === 5 && rail[5] === 'partial' && rail[6] === 'partial', rail.join(','))
await page.screenshot({ path: shots + 'journey-step.png', fullPage: true })

// 10. The article
await page.click('[data-testid=open-article]')
await page.waitForSelector('[data-testid=article-page]', { timeout: 30000 })
await page.waitForFunction(() => !/טוען תמונות/.test(document.querySelector('[data-testid=article-status]')?.textContent ?? ''), null, { timeout: 30000 })
const text = await page.textContent('[data-testid=article-pages]')
const typed = ['מבנה שמחבר את העיר לים.', 'הגלים שחוזרים אל עצמם.', 'לטורוס הטבורי יש קצה אחד', 'הקצה האחד נראה כקו של אור.', 'עובי דופן של מטר', 'החודים דרשו עיבוי', 'המודל עומד על החוד']
check('the article carries what was written on every step', typed.every((t) => text.includes(t)), typed.filter((t) => !text.includes(t)).join(' | ') || 'all')
const heads = await page.$$eval('.ar-page .ar-h2', (els) => els.map((e) => e.textContent.replace(/^\d+\s*/, '')))
check('the article runs from the idea to the result', heads[0] === 'הרעיון' && heads.indexOf('ההמחשה') > heads.indexOf('מהמילים לתמונה') && heads.indexOf('התוצאה') > heads.indexOf('המבנה הפיזי'), heads.join(' > '))
const gaps = await page.$$eval('[data-testid=article-gaps] li', (els) => els.map((e) => e.textContent))
check('missing material is marked and not invented: no frozen view, no print file yet', gaps.some((g) => /מבט קפוא/.test(g)) && gaps.some((g) => /קובץ הדפסה/.test(g)) && !/חסר/.test(text), gaps.join(' | '))
const pages = await page.$$eval('[data-testid=article-page]', (els) => els.map((e) => [e.offsetWidth, e.offsetHeight]))
check('the preview is A4 pages', pages.length >= 2 && pages.every(([w, h]) => w === 794 && h === 1123), JSON.stringify(pages))
const figs = await page.$$eval('.ar-page .ar-fig img', (els) => els.map((e) => e.naturalWidth))
check('the images of the steps are in the article', figs.length >= 4 && figs.every((w) => w > 0), `${figs.length} images`)
await page.screenshot({ path: shots + 'journey-article.png' })
await (await page.$$('[data-testid=article-page]'))[0].screenshot({ path: shots + 'journey-article-page1.png' })

// Edit, then undo
await page.click('[data-testid=mode-edit]')
await page.fill('[data-testid=edit-text-idea]', 'נוסח ערוך של הרעיון, לתערוכה.')
check('an edit is kept on the project', await until(() => project()?.article?.sections?.idea === 'נוסח ערוך של הרעיון, לתערוכה.'))
await page.click('[data-testid=mode-preview]')
check('the edit shows in the article', (await page.textContent('[data-testid=article-pages]')).includes('נוסח ערוך של הרעיון'))

// Exports
let t = Date.now()
const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('[data-testid=article-pdf]')])
const pdf = readFileSync(await pdfDl.path())
const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('the article exports as a PDF, page for page', pdf.subarray(0, 4).toString() === '%PDF' && pdfPages === pages.length && /-article-/.test(pdfDl.suggestedFilename()), `${pdfPages} pages, ${Math.round(pdf.length / 1024)} KB, ${Date.now() - t} ms, ${pdfDl.suggestedFilename()}`)
t = Date.now()
const [docDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=article-docx]')])
const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(await docDl.path())))['word/document.xml'])
check('the article exports as Word, right to left, with the edit and without the gap marks', xml.includes('<w:bidi/>') && xml.includes('נוסח ערוך של הרעיון') && xml.includes('הגלים שחוזרים') && !xml.includes('חסר:'), `${Date.now() - t} ms`)

await page.click('[data-testid=mode-edit]')
await page.click('[data-testid=reset-idea]')
check('undoing the edit brings back the text from the materials', await until(() => project()?.article?.sections && !('idea' in project().article.sections)))

// A gap leads to its step
await page.click('[data-testid=mode-preview]')
await page.click('[data-testid=article-gaps] li button:has-text("קובץ הדפסה")')
await page.waitForSelector('[data-testid=step][data-stage=physical]')
check('a gap opens the step where it is filled in', true)

// 11. An older project, made from a concept, completed after the fact
const O = '33333333-3333-4333-8333-333333333333'
db.mathcreator_projects.push({ id: O, concept: 'Umbilic torus', title_he: 'הטבעת המשולשת', created_at: now(), updated_at: now(), owner: USER, journey: {}, article: {} })
db.mathcreator_recipe_versions.push({ id: '44444444-4444-4444-8444-444444444444', project_id: O, parent_id: null, note: null, schema_version: '1.0', view: null, created_at: now(), recipe })
await open(page, `#/project?p=${O}`)
await page.waitForFunction(() => document.querySelector('.jw-head h1')?.textContent !== 'שער הים' && document.querySelector('[data-testid=step]'), null, { timeout: 30000 })
check('an older project opens on its first unfinished step', (await page.getAttribute('[data-testid=step]', 'data-stage')) === 'idea')
await page.click('[data-testid=rail-concept]')
await page.waitForSelector('[data-testid=step][data-stage=concept]')
check('its recipe already counts on step 3', (await page.getAttribute('[data-testid=step]', 'data-state')) === 'partial')
await page.click('[data-testid=rail-illustration]')
await page.waitForSelector('[data-testid=step][data-stage=illustration]')
await page.fill('[data-testid=ill-body]', 'Umbilic torus pavilion on the shore, Documentary realism, Professional architecture photography, 3:2')
await page.setInputFiles('[data-testid=upload-with-prompt]', pngFile('stage4-summer-noon-aerial.png'))
const older = () => db.mathcreator_library.filter((r) => r.project_id === O)
check('an image and its prompt are added after the fact', await until(() => older().some((r) => r.kind === 'prompt' && /Umbilic/.test(r.body)) && older().some((r) => r.kind === 'image')))

// 12. Phone
await page.setViewportSize({ width: 400, height: 860 })
for (const [hash, name] of [['', 'home'], [`#/project?p=${P}&s=illustration`, 'step'], [`#/article?p=${P}`, 'article']]) {
  await open(page, hash)
  await page.waitForTimeout(1500)
  const s = await sideways(page)
  check(`at 400 px, no sideways scroll: ${name}`, s <= 0, `${s} px`)
}
await page.screenshot({ path: shots + 'journey-400px.png' })

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
