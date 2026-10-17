/**
 * The new sweep paths and the openings in the print (DECISIONS.md 130–134), in Chromium against the production
 * build: `npx vite build && node tests/e2e/paths.e2e.mjs`. Each new example opens from the atlas in the studio,
 * builds, shows its metrics, and prints watertight with a recommended face; the ring of the default recipe prints
 * with its passages and light slots cut through and closed by reveals. Screenshots: docs/screenshots/path-*.png.
 * Port 4311, so it runs beside the other suites.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
const tmp = root + 'node_modules/.tmp/e2e-paths/'
mkdirSync(shots, { recursive: true })
mkdirSync(tmp, { recursive: true })
const PORT = 4311
const BASE = `http://localhost:${PORT}/`

const results = []
let failed = 0
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b)

/** Binary STL: triangle count and edges that do not join exactly two triangles after welding. */
function readStl(buf) {
  const tris = buf.readUInt32LE(80)
  const ids = new Map()
  const id = (o) => {
    const k = `${buf.readFloatLE(o)},${buf.readFloatLE(o + 4)},${buf.readFloatLE(o + 8)}`
    let i = ids.get(k)
    if (i === undefined) ids.set(k, (i = ids.size))
    return i
  }
  const edges = new Map()
  let minZ = Infinity
  for (let t = 0; t < tris; t++) {
    const o = 84 + 50 * t + 12
    const v = [0, 1, 2].map((k) => {
      minZ = Math.min(minZ, buf.readFloatLE(o + 12 * k + 8))
      return id(o + 12 * k)
    })
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const c of edges.values()) if (c !== 2) open++
  return { tris, open, minZ }
}

// Path lengths measured by the engine in node (tests/paths.test.ts checks them against analytic references).
const EXAMPLES = [
  { model: 'trefoil', id: 'trefoil-knot', length: 179.483, openings: false },
  { model: 'lemniscate', id: 'lemniscate-walk', length: 126.045, openings: false },
  { model: 'sine', id: 'sine-promenade', length: 131.086, openings: true },
  { model: 'catenary', id: 'catenary-arch', length: 25.967, openings: false },
]

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function goto(page, hash) {
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(BASE + hash)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('the preview server did not answer')
}

/** Prepares the print in the panel, checks the report, and reads back the STL that downloads. */
async function print(page, label, expectOpenings) {
  await page.click('[data-testid=tab-print]')
  const t0 = Date.now()
  await page.click('[data-testid=print-prepare]')
  await page.waitForSelector('[data-testid=print-report]', { timeout: 240000 })
  const seconds = (Date.now() - t0) / 1000
  const checks = await page.$$eval('[data-testid=print-report] li[data-check]', (els) => els.map((e) => [e.dataset.check, e.dataset.ok]))
  check(`${label}: the print checks pass`, checks.length === 3 && checks.every(([, ok]) => ok === 'true'), `${JSON.stringify(checks)}, ${seconds.toFixed(1)} s`)
  const o = await page.$eval('[data-testid=print-orientation]', (e) => ({ down: e.dataset.down, text: e.textContent.replace(/\s+/g, ' ') }))
  check(`${label}: a recommended face, with the reason in numbers`, /כיוון הדפסה מומלץ/.test(o.text) && /סמ"ר/.test(o.text) && !!o.down, `${o.down}: ${o.text}`)
  const openings = await page.$('[data-testid=print-openings]')
  const cut = openings ? await openings.evaluate((e) => ({ cut: e.dataset.cut, text: e.textContent })) : null
  if (expectOpenings) check(`${label}: the openings go through the printed shell`, cut?.cut === 'true' && /משקוף/.test(cut.text), cut?.text)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=print-stl]')])
  const path = tmp + dl.suggestedFilename()
  await dl.saveAs(path)
  const stl = readStl(readFileSync(path))
  check(`${label}: the STL is closed${expectOpenings ? ' with its openings' : ''}, standing on Z = 0`, stl.open === 0 && Math.abs(stl.minZ) < 1e-4, `${stl.open} open edges, ${stl.tris} triangles, min z ${stl.minZ.toFixed(6)} mm`)
}

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('pageerror:', e.message)
  })

  // ---------- 1. The default ring prints with its passages and slots, closed by reveals ----------
  await goto(page, '#/studio')
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await print(page, 'umbilic torus', true)

  // ---------- 2. Each new path, opened from the atlas ----------
  for (const ex of EXAMPLES) {
    await goto(page, `#/learn?m=${ex.model}`)
    await page.waitForSelector('[data-testid=open-example]', { timeout: 30000 })
    const t0 = Date.now()
    await page.click('[data-testid=open-example]')
    await page.waitForFunction(
      (L) => {
        const stage = document.querySelector('[data-testid=stage]')
        const m = document.querySelector('[data-metric=pathLength]')
        return Number(stage?.dataset.modelVersion) > 0 && m && Math.abs(Number(m.dataset.value) - L) / L < 0.005
      },
      ex.length,
      { timeout: 90000 },
    )
    const seconds = (Date.now() - t0) / 1000
    const version = Number(await page.$eval('[data-testid=stage]', (e) => e.dataset.modelVersion))
    const L = Number(await page.$eval('[data-metric=pathLength]', (e) => e.dataset.value))
    check(`${ex.id}: opens in the studio and builds`, version > 0, `model version ${version}, ${seconds.toFixed(1)} s`)
    check(`${ex.id}: path length on screen = the engine's, within 0.5%`, rel(L, ex.length) < 0.005, `${L.toFixed(3)} / ${ex.length} m`)
    const rows = await page.$$eval('[data-metric]', (els) => Object.fromEntries(els.map((e) => [e.dataset.metric, e.textContent.trim()])))
    check(`${ex.id}: metrics shown, with the plan size and the height`, !!rows.footprint && !!rows.top && !!rows.volume, `${rows.footprint} · ${rows.top} · ${rows.volume}`)
    if (ex.model === 'trefoil' || ex.model === 'lemniscate') {
      const gap = Number(await page.$eval('[data-metric=crossingClearance]', (e) => e.dataset.value))
      check(`${ex.id}: the clearance at the crossing is shown, at least 2.4 m`, gap >= 2.4, `${gap.toFixed(2)} m`)
    }
    if (ex.model === 'sine') {
      // The wave runs along z from 0 to 120 m: the view is framed on it, not on the model opened before.
      await page.waitForFunction(() => Math.abs(JSON.parse(document.querySelector('[data-testid=stage]').dataset.camera ?? '[0,0,0,0,0,0]')[5] - 60) < 1, null, { timeout: 15000 }).catch(() => {})
      const cam = JSON.parse(await page.$eval('[data-testid=stage]', (e) => e.dataset.camera ?? '[]'))
      check(`${ex.id}: the view is framed on the new model`, Math.abs(cam[5] - 60) < 1, `target ${cam.slice(3).join(', ')}`)
    }
    const warnings = await page.$$('dl.metrics [data-rule]')
    check(`${ex.id}: no rule warning`, warnings.length === 0, `${warnings.length}`)
    await page.waitForTimeout(2500)
    await page.locator('[data-testid=stage]').screenshot({ path: shots + `path-${ex.id}.png` })
    // From above the plan reads: the figure eight, the wave, the knot's three lobes, the arch's line.
    await page.click('[data-testid=camera-aerial]')
    await page.waitForTimeout(2500)
    await page.locator('[data-testid=stage]').screenshot({ path: shots + `path-${ex.id}-aerial.png` })
    await page.click('[data-testid=camera-eye_level_oblique]')
    await page.waitForTimeout(500)
    await print(page, ex.id, ex.openings)
  }
  check('no page error', errors.length === 0, errors.join(' | '))
  await page.close()
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
