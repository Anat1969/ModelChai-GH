/**
 * The work path (DECISIONS.md 97) in Chromium, against an in-memory Supabase (the mock of projects.e2e.mjs).
 * One project goes the whole way: the landing page, a project that starts from a sentence, the nine steps with
 * their fields and images, a recipe made from step 3 that lands in the same project, the prompt and its image,
 * and the article that gathers everything, edited and exported as PDF and Word. An older project made from a
 * concept is completed after the fact. Run with `node tests/e2e/journey.e2e.mjs` after `vite build`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
const project = () => db.mathcreator_projects.find((p) => p.title_he === 'שער הים' || p.journey?.idea?.title === 'שער הים' || p.journey?.concept?.model === 'umbilic_torus')
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
// The partner function: answers like Claude would, slowly enough to see the key lit, and records what it was sent.
const partnerCalls = []
let failNextPartner = false
await page.route('**/functions/v1/concept-partner', async (route) => {
  const body = JSON.parse(route.request().postData())
  partnerCalls.push(body)
  await new Promise((r) => setTimeout(r, 900))
  if (failNextPartner) {
    failNextPartner = false
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'שירות Claude עמוס כרגע. אפשר לנסות שוב בעוד דקה.' }) })
  }
  const reply =
    body.mode === 'explore'
      ? { summary: 'טבעת שהחתך שלה משולש קעור.', dna: ['שלושה חודים.'], uses: [{ use: 'ביתן', why: 'הקצה הרציף.', how: 'טבעת סביב חצר.' }], limits: ['חודים צרים.'], connections: [{ title: 'קטסטרופות', text: 'רנה תום.' }], questions: ['איפה נכנסים?'] }
      : body.mode === 'suggest'
        ? {
            understanding: 'כניסה לעיר מבקשת סף ברור.',
            suggestions: [
              { name_he: 'שרשרת תלויה', name: 'Catenary', atlas_id: 'catenary', why: 'קשת בלחיצה טהורה עוברת מעל הדרך.', experience: 'עוברים מתחת לקשת.', limits: 'קירות נמוכים בצדדים.', buildable: 'none' },
              { name_he: 'טורוס טבורי', name: 'Umbilic torus', atlas_id: 'umbilic_torus', why: 'שלושה חודים מסמנים כיוון.', experience: 'מקיפים.', limits: 'סגור.', buildable: 'full' },
              { name_he: 'פרקטל עץ', name: 'Fractal tree', atlas_id: null, why: 'הסתעפות כמו שער של עצים.', experience: 'צל מדורג.', limits: 'קשה לבנייה.', buildable: 'none' },
            ],
            alternatives: [{ name_he: 'סכום רימן', name: 'Riemann sum', why: 'קירות נפרדים לאורך הדרך.' }],
            knowledge: [{ title: 'שער', text: 'שערי עיר היו תמיד סף.' }],
            statement: body.chosen ? 'שער שהוא קו אחד: מי שנכנס לעיר מהים עובר מתחת לחוד, ומקיף את החצר לפני שהוא ממשיך.' : '',
          }
        : Object.fromEntries(['concept', 'knowledge', 'context', 'inspiration', 'image', 'model', 'environment', 'production', 'result', 'closing'].map((k) => [k, k === 'closing' || body.materials[k] ? `טיוטה של Claude לחלק ${k}.` : '']))
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, mode: body.mode, ...reply, model: 'mock', durationMs: 900 }) })
})
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const keyState = () => page.getAttribute('[data-testid=claude-key]', 'data-state')

// 1. The landing page: the vision, two doors, the path
await open(page, '')
await page.waitForSelector('[data-testid=door-learn]', { timeout: 30000 })
const steps = await page.$$eval('.home-steps li strong', (els) => els.map((e) => e.textContent))
check('the landing page starts from knowledge: two doors, and nine steps from learning to the exhibition', steps.length === 9 && steps[0] === 'למידה וגילוי' && steps[8] === 'תיעוד לתערוכה' && !!(await page.$('[data-testid=door-need]')), steps.join(' > '))
const nav = await page.$$eval('.topnav a', (els) => els.map((e) => e.textContent))
check('the top bar has two doors only: concepts and projects', nav.join('|') === 'מושגים|פרויקטים', nav.join(' · '))
check('the Claude key is in the top bar, idle', (await keyState()) === 'idle')
await page.screenshot({ path: shots + 'journey-home.png', fullPage: true })

// 2. Discovering a model
await page.click('[data-testid=door-learn]')
await page.waitForSelector('[data-testid=atlas]')
const cards = await page.$$('[data-testid=atlas-card]')
check('the atlas shows at least twenty models', cards.length >= 20, `${cards.length}`)
await page.screenshot({ path: shots + 'learn-atlas.png' })
await page.click('[data-testid=atlas-card][data-model=umbilic_torus] h3 a')
await page.waitForSelector('[data-testid=model-page]')
const mp = await page.evaluate(() => ({
  dna: document.querySelectorAll('.model-dna li').length,
  uses: [...document.querySelectorAll('[data-testid=model-use] h3')].map((e) => e.textContent),
  reasons: document.querySelectorAll('[data-testid=model-use] li').length,
  limits: document.querySelector('.model-grid')?.textContent.includes('מגבלות'),
  figure: document.querySelectorAll('.model-hero path').length,
}))
check('a model page: what it is, its DNA, uses with reasons, limits, a drawing', mp.dna >= 3 && mp.uses.length >= 2 && mp.reasons >= mp.uses.length && mp.limits && mp.figure > 2, `${mp.uses.join(', ')}; ${mp.reasons} reasons`)
await page.click('[data-testid=explore-claude]')
await page.waitForFunction(() => document.querySelector('[data-testid=claude-key]')?.dataset.state === 'running', null, { timeout: 5000 })
const lit = await page.$eval('[data-testid=claude-key]', (e) => [e.textContent, e.querySelector('svg')?.dataset.lit])
check('while Claude works, the key is lit and says what it does', lit[1] === 'true' && /Claude חוקר/.test(lit[0]), lit[0])
await page.waitForSelector('[data-testid=explore-result]', { timeout: 15000 })
check('when Claude is done, the key says so', (await keyState()) === 'done' && /הסתיים/.test(await page.textContent('[data-testid=claude-key]')))
await page.screenshot({ path: shots + 'learn-model.png', fullPage: true })

// 3. From a need
await open(page, '#/learn?mode=need')
await page.waitForSelector('[data-testid=use-gateway]')
await page.click('[data-testid=use-gateway]')
const ranked = await page.$$eval('[data-testid=need-ranked] [data-testid=atlas-card]', (els) => els.map((e) => e.dataset.model))
check('a need ranks the models whose traits serve it', ranked.includes('catenary') && ranked.length >= 4, ranked.join(', '))
await page.fill('[data-testid=need-idea]', 'כניסה לעיר מהים')
failNextPartner = true
await page.click('[data-testid=ask-suggest]')
await page.waitForFunction(() => document.querySelector('[data-testid=claude-key]')?.dataset.state === 'failed', null, { timeout: 15000 })
check('a failed Claude call says why, in plain words', /עמוס/.test(await page.textContent('[data-testid=claude-key]')))
await page.click('[data-testid=ask-suggest]')
await page.waitForSelector('[data-testid=suggest-result]', { timeout: 15000 })
const sugg = await page.$$eval('[data-testid=suggestion] h4', (els) => els.map((e) => e.textContent))
check('Claude suggests concepts, inside and outside the atlas, with alternatives and knowledge', sugg.length === 3 && (await page.textContent('[data-testid=suggest-result]')).includes('כיוונים אחרים') && partnerCalls.at(-1).atlas.length >= 20, sugg.join(' | '))

// 4. A project from a model
await open(page, '#/learn?m=umbilic_torus')
await page.waitForSelector('[data-testid=start-from-model]')
await page.click('[data-testid=start-from-model]')
await page.waitForSelector('[data-testid=step][data-stage=concept]', { timeout: 15000 })
const P = project()?.id
check('a project starts from a model, on the step of the concept', !!P && project().journey.concept.model === 'umbilic_torus' && !!(await page.$('[data-testid=chosen-concept] svg')), P)
const type = async (sel, text) => page.fill(`[data-testid=${sel}]`, text)
await type('f-concept-why', 'קצה אחד שמקיף שלוש פעמים, כמו מעבר שחוזר אל עצמו.')
await page.click('[data-testid=rail-discover]')
await page.waitForSelector('[data-testid=step][data-stage=discover]')
await type('f-discover-learned', 'קצה אחד יכול להקיף שלוש פעמים לפני שהוא נסגר.')
check('the model chosen is in the learning list', (await page.$$('.jw-model')).length >= 1)
await page.click('[data-testid=rail-context]')
await page.waitForSelector('[data-testid=step][data-stage=context]')
await type('f-idea-title', 'שער הים')
await type('f-idea-idea', 'מבנה שמחבר את העיר לים.')
await type('f-idea-intent', 'לעצור רגע לפני המים.')
await type('f-context-place', 'אשדוד (Ashdod, Israel)')
await type('f-context-use', 'כניסה לעיר')
await page.waitForSelector('[data-testid=use-fit]')
const fitText = await page.textContent('[data-testid=use-fit]')
check('the step shows why the concept serves the use, and what works against it', /נגד/.test(fitText) && /חוד|פיתול/.test(fitText), fitText.slice(0, 120))
check('fields are saved on the project as they are written', await until(() => project()?.journey?.context?.use === 'כניסה לעיר' && project().journey.discover?.learned))

// 5. Inspiration: drag and drop, preview, saved
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=inspiration]')
await type('f-context-inspiration', 'הגלים שחוזרים אל עצמם.')
const dropped = await page.evaluateHandle(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'gal.png', { type: 'image/png' }))
  return dt
}, readFileSync(shots + 'stage4-context-coastal_dunes.png').toString('base64'))
await page.dispatchEvent('[data-testid=upload-reference-zone]', 'drop', { dataTransfer: dropped })
await page.waitForSelector('[data-testid=upload-reference-item][data-state=saved]', { timeout: 15000 })
const preview = await page.$eval('[data-testid=upload-reference-item] img', (i) => i.naturalWidth)
check('a dropped image shows at once and says it was saved in the project', preview > 0 && (await page.textContent('[data-testid=upload-reference-item]')).includes('נשמרה בפרויקט') && lib('reference').length === 1)
await page.setInputFiles('[data-testid=upload-reference]', pngFile('stage4-plaza-stone-haze.png'))
check('an image chosen from the disk is saved too', await until(() => lib('reference').length === 2))
await page.waitForFunction(() => document.querySelectorAll('.jw-materials .gallery img').length >= 2, null, { timeout: 15000 })
await page.click('[data-testid=suggest-statement]')
await page.waitForSelector('[data-testid=statement]', { timeout: 15000 })
const sent = partnerCalls.at(-1)
check('Claude reads the concept, the context, the inspiration and its images', sent.mode === 'suggest' && sent.chosen?.name === 'Umbilic torus' && sent.need.use === 'כניסה לעיר' && sent.need.images.length === 2 && /הגלים/.test(sent.need.inspiration), `${sent.need.images.length} images`)
await page.click('[data-testid=statement] button')
check('the suggested concept goes into the field, to edit', await until(() => /שער שהוא קו אחד/.test(project()?.journey?.concept?.statement ?? '')))
await page.screenshot({ path: shots + 'journey-inspiration.png', fullPage: true })

// 6. The model: the recipe lands in the project, metrics explain themselves, the view is navigable
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=make-recipe]')
await page.click('[data-testid=make-recipe]')
await page.waitForSelector('[data-testid=concept]')
await page.waitForFunction(() => document.querySelector('[data-testid=concept]').value !== '', null, { timeout: 15000 }).catch(() => null)
const pre = { concept: await page.inputValue('[data-testid=concept]'), use: await page.inputValue('[data-testid=use]') }
check('the concept form arrives filled from the earlier steps', pre.concept === 'Umbilic torus' && pre.use === 'כניסה לעיר', JSON.stringify(pre))
await page.click('[data-testid=submit]')
check('the first version is saved in the same project', await until(() => db.mathcreator_recipe_versions.some((v) => v.project_id === P), 60000))
await page.waitForSelector('[data-testid=metric-why]', { timeout: 60000 })
check('in the studio, every metric opens to what it measures and how it helps decide', (await page.$$('[data-testid=metric-why]')).length >= 8)
check('in the studio, the view has navigation controls', (await page.$$('.nav-controls button, [data-testid^=nav-]')).length >= 6)

// 7–9. Environment, illustration, production
await open(page, `#/project?p=${P}&s=environment`)
await page.waitForSelector('[data-testid=f-environment-decisions]', { timeout: 30000 })
await type('f-environment-decisions', 'אבן ירושלמית, צהרי חורף, רוח מערבית.')
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=prompt-from-model]')
await page.click('[data-testid=prompt-from-model]')
check('a prompt is derived from the model', await until(() => lib('prompt').length === 1))
await page.waitForSelector('[data-testid=upload-to-prompt]', { state: 'attached' })
await page.setInputFiles('[data-testid=upload-to-prompt]', pngFile('stage4-plaza-stone-haze.png'))
check('the image is kept with the prompt it was made from', await until(() => lib('image').length === 1 && lib('image')[0].prompt_id === lib('prompt')[0].id))
await type('f-illustration-expresses', 'הקצה האחד נראה כקו של אור.')
await type('f-illustration-translates', 'הקו הופך לשביל שמקיף את החצר.')
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=production]')
await type('f-physical-scale', '1:324, הצלע הארוכה 15 ס"מ')
await type('f-physical-notes', 'החודים דרשו עיבוי של הדופן.')
await type('f-production-video', 'מעבר כניסה מהחוף אל החצר.')
await page.click('[data-testid=next-stage]')
await page.waitForSelector('[data-testid=step][data-stage=exhibition]')
await page.setInputFiles('[data-testid=upload-photo]', pngFile('stage2-umbilic-eye-level.png'))
check('a photo of the result joins the project', await until(() => lib('photo').length === 1))
await type('f-documentation-result', 'המודל עומד על החוד, והאור עובר בפתחים.')
await type('f-exhibition-author', 'ענת')
check('every step wrote to the project', await until(() => project()?.journey?.exhibition?.author === 'ענת' && project().journey.production?.video && project().journey.environment?.decisions))
await page.reload()
await page.waitForSelector('[data-testid=f-exhibition-author]', { timeout: 30000 })
check('after a reload the fields come back', (await page.inputValue('[data-testid=f-exhibition-author]')) === 'ענת')
await page.screenshot({ path: shots + 'journey-step.png', fullPage: true })

// 10. The article
await page.click('[data-testid=open-article]')
await page.waitForSelector('[data-testid=article-page]', { timeout: 30000 })
await page.waitForFunction(() => !/טוען תמונות/.test(document.querySelector('[data-testid=article-status]')?.textContent ?? ''), null, { timeout: 30000 })
const text = await page.textContent('[data-testid=article-pages]')
const typed = ['קצה אחד שמקיף שלוש פעמים', 'קצה אחד יכול להקיף', 'מבנה שמחבר את העיר לים.', 'הגלים שחוזרים אל עצמם.', 'שער שהוא קו אחד', 'הקצה האחד נראה כקו של אור.', 'אבן ירושלמית', 'החודים דרשו עיבוי', 'המודל עומד על החוד']
check('the article carries what was written on every step', typed.every((t) => text.includes(t)), typed.filter((t) => !text.includes(t)).join(' | ') || 'all')
const heads = await page.$$eval('.ar-page .ar-h2', (els) => els.map((e) => e.textContent.replace(/^\d+\s*/, '')))
check('the article tells the development in order', heads[0] === 'המושג המתמטי' && heads[1] === 'הידע שנלמד' && heads.indexOf('מהמילים לתמונה') < heads.indexOf('המודל') && heads.indexOf('התוצאה') > heads.indexOf('לייצור ולהצגה'), heads.join(' > '))
const gaps = await page.$$eval('[data-testid=article-gaps] li', (els) => els.map((e) => e.textContent))
check('missing material is marked, not invented', gaps.some((g) => /מבט ערום/.test(g)) && gaps.some((g) => /קובץ הדפסה/.test(g)) && !/חסר/.test(text), gaps.join(' | '))
const ratios = await page.$$eval('.ar-page .ar-fig img', (els) => els.map((e) => Math.abs(e.naturalWidth / e.naturalHeight - e.clientWidth / e.clientHeight)))
check('images keep their own proportions', ratios.length >= 4 && ratios.every((d) => d < 0.03), ratios.map((d) => d.toFixed(3)).join(','))
await page.click('[data-testid=article-draft]')
await page.waitForSelector('[data-testid=article-editor]', { timeout: 15000 })
check('Claude drafts the article from the materials; empty sections stay empty', await until(() => project()?.article?.drafted && project().article.sections.concept?.startsWith('טיוטה')) && partnerCalls.at(-1).mode === 'article' && /קצה אחד/.test(partnerCalls.at(-1).materials.concept))
await page.fill('[data-testid=edit-text-concept]', 'נוסח ערוך של המושג, לתערוכה.')
check('the draft is edited before export, and the edit is kept', await until(() => project()?.article?.sections?.concept === 'נוסח ערוך של המושג, לתערוכה.'))
await page.click('[data-testid=mode-preview]')
await page.waitForSelector('[data-testid=article-page]')
const pages = await page.$$eval('[data-testid=article-page]', (els) => els.map((e) => [e.offsetWidth, e.offsetHeight]))
check('the preview is A4 pages', pages.length >= 2 && pages.every(([w, h]) => w === 794 && h === 1123), JSON.stringify(pages))
await page.screenshot({ path: shots + 'journey-article.png' })

let t = Date.now()
const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('[data-testid=article-pdf]')])
const pdf = readFileSync(await pdfDl.path())
const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('the article exports as a PDF, page for page', pdf.subarray(0, 4).toString() === '%PDF' && pdfPages === pages.length, `${pdfPages} pages, ${Math.round(pdf.length / 1024)} KB, ${Date.now() - t} ms`)
// The exported file itself, rendered back to images and looked at.
const tmp = root + 'node_modules/.tmp/e2e-article/'
mkdirSync(tmp, { recursive: true })
for (const f of readdirSync(tmp)) if (f.endsWith('.png')) statSync(tmp + f) && execFileSync('rm', [tmp + f])
writeFileSync(tmp + 'article.pdf', pdf)
execFileSync('pdftoppm', ['-r', '60', '-png', tmp + 'article.pdf', tmp + 'p'])
const pngs = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort()
const sizes = pngs.map((f) => execFileSync('python3', ['-c', `import struct;d=open('${tmp + f}','rb').read(24);print(*struct.unpack('>II',d[16:24]))`]).toString().trim())
check('the exported PDF opens, every page A4 upright', pngs.length === pages.length && sizes.every((s) => { const [w, h] = s.split(' ').map(Number); return Math.abs(h / w - 297 / 210) < 0.02 }), sizes.join(' | '))
execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '2', tmp + 'article.pdf', shots + 'journey-pdf'])
t = Date.now()
const [docDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=article-docx]')])
const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(await docDl.path())))['word/document.xml'])
check('the article exports as Word, right to left, with the edit and without the gap marks', xml.includes('<w:bidi/>') && xml.includes('נוסח ערוך של המושג') && !xml.includes('חסר:'), `${Date.now() - t} ms`)

// 11. An older project, completed after the fact
const O = '33333333-3333-4333-8333-333333333333'
db.mathcreator_projects.push({ id: O, concept: 'Umbilic torus', title_he: 'הטבעת המשולשת', created_at: now(), updated_at: now(), owner: USER, journey: { idea: { idea: 'רעיון ישן' } }, article: {} })
db.mathcreator_recipe_versions.push({ id: '44444444-4444-4444-8444-444444444444', project_id: O, parent_id: null, note: null, schema_version: '1.0', view: null, created_at: now(), recipe })
await open(page, `#/project?p=${O}`)
await page.waitForFunction(() => document.querySelector('.jw-head h1')?.textContent !== 'שער הים' && document.querySelector('[data-testid=step]'), null, { timeout: 30000 })
check('an older project opens on its first unfinished step, with its text kept', (await page.getAttribute('[data-testid=step]', 'data-stage')) === 'discover')
await page.click('[data-testid=rail-context]')
await page.waitForSelector('[data-testid=step][data-stage=context]')
check('its old text is on the new step', (await page.inputValue('[data-testid=f-idea-idea]')) === 'רעיון ישן')
await page.click('[data-testid=rail-illustration]')
await page.waitForSelector('[data-testid=step][data-stage=illustration]')
await page.fill('[data-testid=own-body]', 'Umbilic torus pavilion on the shore, Documentary realism, Professional architecture photography, 3:2')
await page.setInputFiles('[data-testid=upload-with-prompt]', pngFile('stage4-summer-noon-aerial.png'))
const older = () => db.mathcreator_library.filter((r) => r.project_id === O)
check('an image and its prompt are added after the fact', await until(() => older().some((r) => r.kind === 'prompt' && /Umbilic/.test(r.body)) && older().some((r) => r.kind === 'image')))

// 12. Phone
await page.setViewportSize({ width: 400, height: 860 })
for (const [hash, name] of [['', 'home'], ['#/learn', 'atlas'], ['#/learn?m=umbilic_torus', 'model'], [`#/project?p=${P}&s=inspiration`, 'step'], [`#/article?p=${P}`, 'article']]) {
  await open(page, hash)
  await page.waitForTimeout(1500)
  const sw = await sideways(page)
  check(`at 400 px, no sideways scroll: ${name}`, sw <= 0, `${sw} px`)
}
await page.screenshot({ path: shots + 'journey-400px.png' })

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
server.kill()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
