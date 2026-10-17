/**
 * Navigation in the model window (DECISIONS.md 110), in Chromium against the production build:
 * every button, the keyboard, mouse and touch, and the phone layout. Run after `vite build`:
 * `node tests/e2e/navigation.e2e.mjs`. Port 4301 only.
 */
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shots = root + 'docs/screenshots/'
mkdirSync(shots, { recursive: true })
const PORT = 4301
const URL_ = `http://localhost:${PORT}/#/studio`

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...extra })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(URL_)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=stage]')?.dataset.modelVersion) > 0, null, { timeout: 90000 })
  await page.waitForFunction(() => !!document.querySelector('[data-testid=stage]')?.dataset.camera, null, { timeout: 30000 })
  await page.waitForTimeout(800)
  return page
}

// The pose the rig writes on the stage: camera position and target, in millimeters.
const pose = async (page) => {
  const a = JSON.parse(await page.$eval('[data-testid=stage]', (el) => el.dataset.camera))
  return { p: a.slice(0, 3), t: a.slice(3, 6) }
}
const sub = (a, b) => a.map((v, i) => v - b[i])
const len = (a) => Math.hypot(...a)
const dist = (q) => len(sub(q.p, q.t))
const theta = (q) => Math.atan2(q.p[0] - q.t[0], q.p[2] - q.t[2])
const height = (q) => (q.p[1] - q.t[1]) / dist(q)
const deg = (r) => (r * 180) / Math.PI
const wrap = (r) => Math.atan2(Math.sin(r), Math.cos(r))
const same = (a, b, eps = 0.01) => len(sub(a.p, b.p)) < eps && len(sub(a.t, b.t)) < eps
const fmt = (q) => `(${q.p.map((v) => v.toFixed(2)).join(', ')}) → (${q.t.map((v) => v.toFixed(2)).join(', ')})`

/** Run an action and wait until the camera has settled on a new pose (the rig marks it when a move ends). */
async function act(page, fn) {
  const prev = await page.$eval('[data-testid=stage]', (el) => el.dataset.camera)
  await fn()
  await page.waitForFunction((p) => {
    const el = document.querySelector('[data-testid=stage]')
    return el.dataset.camera !== p && !el.dataset.moving
  }, prev, { timeout: 20000 })
  return pose(page)
}
const press = (page, id) => act(page, () => page.click(`[data-testid=${id}]`))
const key = (page, k) => act(page, () => page.keyboard.press(k))

try {
  // ---------- 1. Buttons, at the desktop size ----------
  const page = await open({ width: 1360, height: 1000 })
  const start = await pose(page)
  console.log('start pose', fmt(start), `distance ${dist(start).toFixed(2)}`)

  const t0 = performance.now()
  const right = await press(page, 'nav-right')
  console.log(`  click to settled pose: ${(performance.now() - t0).toFixed(0)} ms (software rendering)`)
  check('סיבוב ימינה: camera turns 15° around the target', Math.abs(deg(wrap(theta(right) - theta(start))) - 15) < 0.2, `${deg(wrap(theta(right) - theta(start))).toFixed(2)}°`)
  check('סיבוב ימינה: distance and target kept', Math.abs(dist(right) - dist(start)) < 0.01 && len(sub(right.t, start.t)) < 0.01, `${dist(right).toFixed(3)} / ${dist(start).toFixed(3)}`)
  const left = await press(page, 'nav-left')
  check('סיבוב שמאלה undoes ימינה', same(left, start), fmt(left))

  const up = await press(page, 'nav-up')
  check('למעלה raises the camera by 8°', Math.abs(deg(Math.asin(height(up)) - Math.asin(height(start))) - 8) < 0.2, `${deg(Math.asin(height(start))).toFixed(2)}° → ${deg(Math.asin(height(up))).toFixed(2)}°`)
  const down = await press(page, 'nav-down')
  check('למטה undoes למעלה', same(down, start), fmt(down))

  const near = await press(page, 'nav-in')
  check('קרוב divides the distance by 1.25', Math.abs(dist(start) / dist(near) - 1.25) < 0.002, `${dist(start).toFixed(2)} → ${dist(near).toFixed(2)}`)
  const far = await press(page, 'nav-out')
  check('רחוק undoes קרוב', same(far, start), `${dist(far).toFixed(2)}`)

  await page.click('[data-testid=nav-mode-pan]')
  const pressed = await page.$eval('[data-testid=nav-mode-pan]', (b) => b.getAttribute('aria-pressed'))
  check('הזזה mode is pressed', pressed === 'true')
  const panR = await press(page, 'nav-right')
  const move = sub(panR.t, start.t)
  check('הזזה ימינה moves camera and target together', len(sub(sub(panR.p, start.p), move)) < 0.01 && len(move) > 0.5, `target moved ${len(move).toFixed(2)} m`)
  check('הזזה ימינה keeps the view direction and distance', Math.abs(dist(panR) - dist(start)) < 0.01 && Math.abs(wrap(theta(panR) - theta(start))) < 1e-3)
  // Camera right, on the ground plane: perpendicular to the view and level.
  const fwd = sub(start.t, start.p)
  const rightAxis = [-fwd[2], 0, fwd[0]].map((v) => v / Math.hypot(fwd[0], fwd[2]))
  check('הזזה ימינה goes to the camera’s right', (move[0] * rightAxis[0] + move[2] * rightAxis[2]) / len(move) > 0.999, `cos ${((move[0] * rightAxis[0] + move[2] * rightAxis[2]) / len(move)).toFixed(4)}`)
  const panL = await press(page, 'nav-left')
  check('הזזה שמאלה undoes ימינה', same(panL, start), fmt(panL))
  const panU = await press(page, 'nav-up')
  check('הזזה למעלה lifts the target', panU.t[1] - start.t[1] > 0.5, `+${(panU.t[1] - start.t[1]).toFixed(2)} m`)
  const panD = await press(page, 'nav-down')
  check('הזזה למטה undoes למעלה', same(panD, start), fmt(panD))
  await page.click('[data-testid=nav-mode-orbit]')

  // Quick clicks add up: three clicks inside one move turn 45°.
  const three = await act(page, async () => {
    for (let i = 0; i < 3; i++) await page.click('[data-testid=nav-right]', { delay: 0 })
  })
  check('three quick clicks add up to 45°', Math.abs(deg(wrap(theta(three) - theta(start))) - 45) < 0.3, `${deg(wrap(theta(three) - theta(start))).toFixed(2)}°`)

  const centered = await press(page, 'nav-center')
  const [cx, cy, cz, r, fovDeg, aspect] = JSON.parse(await page.$eval('[data-testid=stage]', (el) => el.dataset.frame))
  const canvasAspect = await page.$eval('[data-testid=stage] canvas', (c) => c.clientWidth / c.clientHeight)
  check('מרכוז puts the target on the model’s center', len(sub(centered.t, [cx, cy, cz])) < 0.01, `center (${cx}, ${cy}, ${cz}), radius ${r}`)
  check('מרכוז keeps the view direction', Math.abs(wrap(theta(centered) - theta(three))) < 1e-3)
  check('מרכוז uses the window’s 3:2 aspect', Math.abs(aspect - canvasAspect) < 0.01 && Math.abs(aspect - 1.5) < 0.01, `${aspect} / ${canvasAspect.toFixed(3)}`)
  // The whole model fits: the sphere's angular radius is the narrower half field of view, less the 5% margin.
  const half = Math.min((fovDeg * Math.PI) / 360, Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect))
  const angular = Math.asin(r / dist(centered))
  const expected = r / Math.sin(half) * 1.05
  console.log(`  fov ${fovDeg}°, distance ${dist(centered).toFixed(3)} / analytic ${expected.toFixed(3)}, model ${deg(angular).toFixed(2)}° of ${deg(half).toFixed(2)}°`)
  check('מרכוז distance = analytic fit within 0.5%', Math.abs(dist(centered) / expected - 1) < 0.005, `${((dist(centered) / expected - 1) * 100).toFixed(3)}%`)
  check('מרכוז frames the whole model', angular <= half, `${(angular / half).toFixed(3)} of the half view`)
  await page.locator('.work-center-inner').screenshot({ path: shots + 'navigation.png' })

  const reset = await press(page, 'nav-reset')
  check('איפוס מבט returns to the preset', same(reset, start), fmt(reset))

  // Reset follows the chosen preset.
  const aerial = await press(page, 'camera-aerial')
  await press(page, 'nav-left')
  const back = await press(page, 'nav-reset')
  check('איפוס מבט returns to the aerial preset after a turn', same(back, aerial), fmt(back))
  await press(page, 'camera-eye_level_oblique')

  // ---------- 2. Keyboard on the focused model ----------
  await page.focus('[data-testid=stage]')
  const k0 = await pose(page)
  const kR = await key(page, 'ArrowRight')
  check('ArrowRight turns 15°', Math.abs(deg(wrap(theta(kR) - theta(k0))) - 15) < 0.2, `${deg(wrap(theta(kR) - theta(k0))).toFixed(2)}°`)
  const kU = await key(page, 'Shift+ArrowUp')
  check('Shift+ArrowUp pans up', kU.t[1] - kR.t[1] > 0.5 && Math.abs(dist(kU) - dist(kR)) < 0.01, `+${(kU.t[1] - kR.t[1]).toFixed(2)} m`)
  const kIn = await key(page, '+')
  check('+ zooms in', Math.abs(dist(kU) / dist(kIn) - 1.25) < 0.002, `${dist(kU).toFixed(2)} → ${dist(kIn).toFixed(2)}`)
  const scrollBefore = await page.evaluate(() => scrollY)
  const kReset = await act(page, async () => {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('0')
  })
  check('0 resets the view', same(kReset, k0), fmt(kReset))
  check('arrow keys do not scroll the page', (await page.evaluate(() => scrollY)) === scrollBefore)

  // ---------- 3. Free mouse ----------
  const box = await page.locator('[data-testid=stage] canvas').boundingBox()
  const cxp = box.x + box.width / 2, cyp = box.y + box.height / 2
  const m0 = await pose(page)
  const mRot = await act(page, async () => {
    await page.mouse.move(cxp, cyp)
    await page.mouse.down()
    await page.mouse.move(cxp + 60, cyp, { steps: 6 })
    await page.mouse.up()
  })
  check('left drag rotates (target kept)', Math.abs(wrap(theta(mRot) - theta(m0))) > 0.1 && len(sub(mRot.t, m0.t)) < 0.01, `${deg(wrap(theta(mRot) - theta(m0))).toFixed(1)}°`)
  const mPan = await act(page, async () => {
    await page.mouse.move(cxp, cyp)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(cxp + 100, cyp + 40, { steps: 6 })
    await page.mouse.up({ button: 'right' })
  })
  check('right drag pans (target moves, distance kept)', len(sub(mPan.t, mRot.t)) > 0.5 && Math.abs(dist(mPan) - dist(mRot)) < 0.05, `target moved ${len(sub(mPan.t, mRot.t)).toFixed(2)} m`)
  await page.mouse.move(cxp, cyp)
  const mWheel = await act(page, () => page.mouse.wheel(0, -400))
  check('wheel zooms in', dist(mWheel) < dist(mPan) - 0.5, `${dist(mPan).toFixed(2)} → ${dist(mWheel).toFixed(2)}`)

  const desk = await page.evaluate(() => ({
    help: document.querySelector('[data-testid=nav-help]').textContent,
    helpLines: (() => {
      const el = document.querySelector('[data-testid=nav-help]')
      return Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))
    })(),
    scrollH: document.documentElement.scrollHeight,
    innerH: innerHeight,
    stage: [document.querySelector('[data-testid=stage]').clientWidth, document.querySelector('[data-testid=stage]').clientHeight],
    onModel: [...document.querySelectorAll('[data-testid^=nav-]')].some((b) => {
      const s = document.querySelector('[data-testid=stage]').getBoundingClientRect()
      const r = b.getBoundingClientRect()
      return r.top < s.bottom && r.bottom > s.top && r.left < s.right && r.right > s.left
    }),
  }))
  console.log(`desktop help: ${desk.help}`)
  check('desktop help uses mouse wording', desk.help.includes('גלגלת'))
  check('desktop help is one line', desk.helpLines === 1, `${desk.helpLines} lines`)
  check('no control sits on the model', !desk.onModel)
  check('1360×1000: no page scroll', desk.scrollH <= desk.innerH, `${desk.scrollH} / ${desk.innerH}, model ${desk.stage.join('×')}`)
  await page.close()

  // ---------- 4. Phone: touch wording, touch gestures, no horizontal scroll ----------
  const phone = await open({ width: 400, height: 860 }, { hasTouch: true, isMobile: true })
  const ph = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, help: document.querySelector('[data-testid=nav-help]').textContent }))
  check('400 px: no horizontal scroll', ph.sw <= ph.cw, `${ph.sw} / ${ph.cw}`)
  check('phone help uses touch wording', ph.help.includes('אצבע'), ph.help)
  await phone.locator('.navbar').scrollIntoViewIfNeeded()
  await phone.locator('.work-center-inner').screenshot({ path: shots + 'navigation-phone.png' })
  await phone.evaluate(() => scrollTo(0, 0))
  const cdp = await phone.context().newCDPSession(phone)
  const pb = await phone.locator('[data-testid=stage] canvas').boundingBox()
  const px = pb.x + pb.width / 2, py = pb.y + pb.height / 2
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  const gesture = async (from, to) => {
    await touch('touchStart', from)
    for (let i = 1; i <= 8; i++) await touch('touchMove', from.map(([x, y], k) => [x + ((to[k][0] - x) * i) / 8, y + ((to[k][1] - y) * i) / 8]))
    await touch('touchEnd', [])
    await phone.waitForTimeout(300)
  }
  const s0 = await pose(phone)
  const s1 = await act(phone, () => gesture([[px - 40, py]], [[px + 60, py]]))
  check('one finger rotates', Math.abs(wrap(theta(s1) - theta(s0))) > 0.1 && len(sub(s1.t, s0.t)) < 0.01, `${deg(wrap(theta(s1) - theta(s0))).toFixed(1)}°`)
  const s2 = await act(phone, () => gesture([[px - 40, py], [px + 40, py]], [[px - 40 + 50, py + 30], [px + 40 + 50, py + 30]]))
  check('two fingers pan', len(sub(s2.t, s1.t)) > 0.5, `target moved ${len(sub(s2.t, s1.t)).toFixed(2)} m`)
  const s3 = await act(phone, () => gesture([[px - 30, py], [px + 30, py]], [[px - 110, py], [px + 110, py]]))
  check('pinch apart zooms in', dist(s3) < dist(s2) - 0.5, `${dist(s2).toFixed(2)} → ${dist(s3).toFixed(2)}`)
  const s4 = await press(phone, 'nav-reset')
  check('phone: איפוס מבט returns to the preset', same(s4, s0), fmt(s4))
  await phone.close()
} catch (e) {
  failed++
  console.log('FAIL  run aborted:', e)
} finally {
  await browser.close()
  server.kill()
  // `server.kill()` leaves the vite child behind; stop every preview this script started on its port.
  try {
    execSync(`ps -eo pid,args | grep "[v]ite preview --port ${PORT}" | awk '{print $1}' | xargs -r kill`)
  } catch {}
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
