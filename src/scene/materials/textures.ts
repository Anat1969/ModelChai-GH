/**
 * Procedural textures for the material library (LEVELS.md 2.3): light grain, fibers and layers drawn on a
 * Canvas, with no image files. Each texture is a grey modulation (around 1) that multiplies the base color,
 * and covers TILE meters of surface, so the grain keeps its real size on any model.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { MATERIALS } from '../../recipe/schema'
import { rng } from '../contexts/layout'

export type MaterialId = (typeof MATERIALS)[number]

/** The six opaque materials of the minimum product. */
export const MVP_MATERIALS: MaterialId[] = ['polished_concrete_light', 'concrete_matte', 'polished_concrete_grey', 'jerusalem_stone', 'timber_oak', 'rammed_earth']

/**
 * The selector (DECISIONS.md 119): the minimum product, then the wider library. Clear glass stays out of it and
 * shows only when a recipe has it (DECISIONS.md 56).
 */
export const SELECTOR_MATERIALS: MaterialId[] = [
  ...MVP_MATERIALS,
  'white_marble',
  'basalt',
  'red_brick',
  'terracotta_tiles',
  'white_render',
  'charred_timber',
  'corten_steel',
  'copper_patina',
  'perforated_metal',
]

/** Meters of surface covered by one texture tile. */
export const TILE: Record<MaterialId, number> = {
  polished_concrete_light: 3,
  concrete_matte: 3,
  polished_concrete_grey: 3,
  jerusalem_stone: 2.4,
  corten_steel: 3,
  timber_oak: 1.2,
  rammed_earth: 2.4,
  glass_clear: 3,
  white_marble: 2.4,
  red_brick: 1.2,
  terracotta_tiles: 1.2,
  basalt: 2.4,
  copper_patina: 3,
  charred_timber: 1.2,
  white_render: 3,
  perforated_metal: 1.8,
}

const SIZE = 512

type Painter = (g: CanvasRenderingContext2D, rand: () => number) => void

const grey = (v: number) => {
  const c = Math.round(Math.min(255, Math.max(0, v)))
  return `rgb(${c},${c},${c})`
}

/** Per-pixel noise around a mean, with a spread. */
function noise(g: CanvasRenderingContext2D, rand: () => number, mean: number, spread: number) {
  const img = g.getImageData(0, 0, SIZE, SIZE)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i]! + (rand() - 0.5) * spread + (mean - 235)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, Math.max(0, v))
  }
  g.putImageData(img, 0, 0)
}

/** Soft blotches: the cloudiness of cast concrete or earth. */
function blotches(g: CanvasRenderingContext2D, rand: () => number, count: number, alpha: number, dark: number) {
  for (let i = 0; i < count; i++) {
    const x = rand() * SIZE, y = rand() * SIZE, r = 20 + rand() * 90
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    const v = 235 + (rand() - 0.5) * dark
    grad.addColorStop(0, `rgba(${v},${v},${v},${alpha})`)
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`)
    g.fillStyle = grad
    // Draw the blotch on the wrapped copies too, so the tile repeats without a seam.
    for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) g.fillRect(x - r + dx, y - r + dy, r * 2, r * 2)
  }
}

/** Small pores and aggregate dots. */
function dots(g: CanvasRenderingContext2D, rand: () => number, count: number, size: number, shade: [number, number]) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = grey(shade[0] + rand() * (shade[1] - shade[0]))
    g.beginPath()
    g.arc(rand() * SIZE, rand() * SIZE, size * (0.4 + rand()), 0, Math.PI * 2)
    g.fill()
  }
}

const PAINTERS: Record<MaterialId, Painter> = {
  polished_concrete_light(g, rand) {
    blotches(g, rand, 40, 0.25, 30)
    dots(g, rand, 900, 1.1, [205, 245])
    noise(g, rand, 236, 10)
  },
  concrete_matte(g, rand) {
    blotches(g, rand, 60, 0.35, 44)
    dots(g, rand, 1600, 0.9, [190, 225])
    noise(g, rand, 232, 26)
    // Formwork joints every 1.5 m (half a tile).
    g.fillStyle = 'rgba(150,150,150,0.35)'
    for (const y of [0, SIZE / 2]) g.fillRect(0, y, SIZE, 2)
  },
  polished_concrete_grey(g, rand) {
    blotches(g, rand, 50, 0.3, 36)
    dots(g, rand, 1400, 1.4, [180, 250])
    noise(g, rand, 234, 12)
  },
  jerusalem_stone(g, rand) {
    // Courses of 0.4 m, blocks 0.6–1.2 m long, each with its own tone, and a light joint.
    const course = SIZE / 6
    for (let row = 0; row < 6; row++) {
      let x = -rand() * 120
      while (x < SIZE) {
        const w = 128 + rand() * 128
        g.fillStyle = grey(234 + rand() * 16)
        g.fillRect(x, row * course, w, course)
        x += w
        g.fillStyle = grey(214)
        g.fillRect(x - 2, row * course, 3, course)
      }
      g.fillStyle = grey(214)
      g.fillRect(0, row * course, SIZE, 3)
    }
    dots(g, rand, 1400, 0.9, [190, 235])
    noise(g, rand, 236, 18)
  },
  corten_steel(g, rand) {
    blotches(g, rand, 120, 0.45, 70)
    noise(g, rand, 230, 30)
  },
  timber_oak(g, rand) {
    // Boards 0.15 m wide with fibers along them.
    const board = SIZE / 8
    for (let b = 0; b < 8; b++) {
      g.fillStyle = grey(214 + rand() * 34)
      g.fillRect(0, b * board, SIZE, board)
      for (let f = 0; f < 26; f++) {
        const y = b * board + rand() * board
        g.strokeStyle = `rgba(120,120,120,${0.08 + rand() * 0.18})`
        g.lineWidth = 0.6 + rand() * 1.4
        g.beginPath()
        g.moveTo(0, y)
        for (let x = 0; x <= SIZE; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + f) * 2.5)
        g.stroke()
      }
      g.fillStyle = grey(150)
      g.fillRect(0, b * board, SIZE, 2)
    }
    noise(g, rand, 236, 8)
  },
  rammed_earth(g, rand) {
    // Compacted lifts of 5–15 cm with their own tone: the strata that make rammed earth recognizable.
    let y = 0
    while (y < SIZE) {
      const h = 10 + rand() * 30
      g.fillStyle = grey(200 + rand() * 50)
      g.fillRect(0, y, SIZE, h)
      y += h
    }
    dots(g, rand, 2200, 1, [170, 240])
    noise(g, rand, 230, 22)
  },
  glass_clear(g) {
    g.fillStyle = grey(255)
    g.fillRect(0, 0, SIZE, SIZE)
  },
  white_marble(g, rand) {
    // Slabs of 1.2 m with hairline joints, soft clouds and a few long grey veins.
    blotches(g, rand, 40, 0.18, 24)
    for (let v = 0; v < 9; v++) {
      g.strokeStyle = `rgba(150,150,150,${0.12 + rand() * 0.22})`
      g.lineWidth = 0.6 + rand() * 1.8
      let x = rand() * SIZE, y = rand() * SIZE
      const dir = rand() * Math.PI
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 40; k++) {
        x += Math.cos(dir + (rand() - 0.5) * 1.2) * 14
        y += Math.sin(dir + (rand() - 0.5) * 1.2) * 14
        g.lineTo(x, y)
      }
      g.stroke()
    }
    g.fillStyle = grey(222)
    for (const p of [0, SIZE / 2]) {
      g.fillRect(0, p, SIZE, 1)
      g.fillRect(p, 0, 1, SIZE)
    }
    noise(g, rand, 240, 6)
  },
  red_brick(g, rand) {
    // Bricks of 215 × 65 mm with 10 mm joints, in running bond: 16 courses of 75 mm per 1.2 m tile.
    const course = SIZE / 16, brick = SIZE / 5.333
    g.fillStyle = grey(250)
    g.fillRect(0, 0, SIZE, SIZE)
    for (let row = 0; row < 16; row++) {
      const off = row % 2 ? brick / 2 : 0
      for (let col = -1; col < 7; col++) {
        g.fillStyle = grey(196 + rand() * 40)
        g.fillRect(col * brick + off + 2, row * course + 2, brick - 4, course - 4)
      }
    }
    dots(g, rand, 1800, 0.8, [170, 230])
    noise(g, rand, 232, 16)
  },
  terracotta_tiles(g, rand) {
    // Overlapping tiles in rows of 0.3 m: each row has a shaded lower lip and slightly different tone per tile.
    const row = SIZE / 4, tile = SIZE / 6
    for (let r = 0; r < 4; r++) {
      const off = r % 2 ? tile / 2 : 0
      for (let c = -1; c < 7; c++) {
        const x = c * tile + off
        const grad = g.createLinearGradient(0, r * row, 0, (r + 1) * row)
        const v = 222 + rand() * 26
        grad.addColorStop(0, grey(v - 18))
        grad.addColorStop(0.8, grey(v))
        grad.addColorStop(1, grey(v - 40))
        g.fillStyle = grad
        g.fillRect(x + 1, r * row, tile - 2, row)
      }
    }
    dots(g, rand, 900, 0.9, [190, 240])
    noise(g, rand, 234, 14)
  },
  basalt(g, rand) {
    // Dark blocks in courses of 0.3 m, with gas vesicles: the pores that make basalt recognizable.
    const course = SIZE / 8
    for (let row = 0; row < 8; row++) {
      let x = -rand() * 100
      while (x < SIZE) {
        const w = 90 + rand() * 120
        g.fillStyle = grey(220 + rand() * 30)
        g.fillRect(x, row * course, w, course)
        x += w
        g.fillStyle = grey(180)
        g.fillRect(x - 2, row * course, 3, course)
      }
      g.fillStyle = grey(180)
      g.fillRect(0, row * course, SIZE, 3)
    }
    dots(g, rand, 2600, 1.3, [120, 200])
    noise(g, rand, 232, 24)
  },
  copper_patina(g, rand) {
    // Standing-seam panels of 0.5 m and rain streaks running down them, where the patina is thicker.
    blotches(g, rand, 140, 0.4, 60)
    for (let i = 0; i < 160; i++) {
      const x = rand() * SIZE
      g.fillStyle = `rgba(200,200,200,${0.05 + rand() * 0.12})`
      g.fillRect(x, rand() * SIZE, 1 + rand() * 3, 30 + rand() * 120)
    }
    g.fillStyle = grey(170)
    for (let k = 0; k < 6; k++) g.fillRect((k * SIZE) / 6, 0, 3, SIZE)
    noise(g, rand, 232, 20)
  },
  charred_timber(g, rand) {
    // Vertical slats of 0.12 m with dark gaps, and the alligator cracks of charred wood.
    const slat = SIZE / 10
    for (let k = 0; k < 10; k++) {
      g.fillStyle = grey(222 + rand() * 30)
      g.fillRect(k * slat, 0, slat, SIZE)
      for (let c = 0; c < 70; c++) {
        const x = k * slat + 4 + rand() * (slat - 8), y = rand() * SIZE
        g.fillStyle = grey(140 + rand() * 50)
        g.fillRect(x, y, 3 + rand() * 9, 1.5)
      }
      g.fillStyle = grey(90)
      g.fillRect(k * slat, 0, 5, SIZE)
    }
    noise(g, rand, 230, 18)
  },
  white_render(g, rand) {
    // Fine sand grain and the soft arcs of the trowel.
    blotches(g, rand, 50, 0.2, 20)
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = `rgba(215,215,215,${0.15 + rand() * 0.2})`
      g.lineWidth = 1 + rand() * 2
      g.beginPath()
      g.arc(rand() * SIZE, rand() * SIZE, 20 + rand() * 50, rand() * 6, rand() * 6 + 1.2)
      g.stroke()
    }
    dots(g, rand, 2400, 0.6, [205, 250])
    noise(g, rand, 240, 12)
  },
  perforated_metal(g, rand) {
    // Brushed sheet; the holes themselves are cut by the alpha map below.
    for (let y = 0; y < SIZE; y += 2) {
      g.fillStyle = grey(228 + rand() * 20)
      g.fillRect(0, y, SIZE, 2)
    }
    noise(g, rand, 236, 6)
  },
}

/** Hole pitch and radius of the perforated sheet, in pixels of a 1.8 m tile: 90 mm pitch, 63 mm holes, about 38% open. */
export const PERFORATION = { pitch: SIZE / 20, radius: (SIZE / 20) * 0.35 }

const alphaCache = new Map<MaterialId, CanvasTexture>()

/** Alpha map for materials with real holes: white is sheet, black is open. Null for solid materials. */
export function materialAlpha(id: MaterialId): CanvasTexture | null {
  if (id !== 'perforated_metal') return null
  const hit = alphaCache.get(id)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, SIZE, SIZE)
  g.fillStyle = '#000'
  const { pitch, radius } = PERFORATION
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      g.beginPath()
      // Staggered rows, as perforated sheet is punched.
      g.arc(x * pitch + (y % 2 ? pitch / 2 : 0) + pitch / 4, y * pitch + pitch / 2, radius, 0, Math.PI * 2)
      g.fill()
    }
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(1 / TILE[id], 1 / TILE[id])
  alphaCache.set(id, tex)
  return tex
}

/**
 * Scales the tile so its mean is near white: the texture adds grain without darkening the base color, which
 * stays the value from LEVELS.md 2.3.
 */
function normalize(g: CanvasRenderingContext2D, target = 247) {
  const img = g.getImageData(0, 0, SIZE, SIZE)
  let sum = 0
  for (let i = 0; i < img.data.length; i += 4) sum += img.data[i]!
  const k = target / (sum / (img.data.length / 4))
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, img.data[i]! * k)
  g.putImageData(img, 0, 0)
}

const cache = new Map<MaterialId, CanvasTexture>()

export function materialTexture(id: MaterialId): CanvasTexture {
  const hit = cache.get(id)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = grey(235)
  g.fillRect(0, 0, SIZE, SIZE)
  PAINTERS[id](g, rng(id.length * 7919 + id.charCodeAt(0)))
  normalize(g)
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  tex.repeat.set(1 / TILE[id], 1 / TILE[id])
  cache.set(id, tex)
  return tex
}

// ---------- ground ----------

export type GroundKind = 'sand' | 'paving' | 'earth' | 'grass' | 'rock' | 'snow'
/** Meters of ground per tile. */
export const GROUND_TILE = 6

const GROUND_PAINTERS: Record<GroundKind, Painter> = {
  sand(g, rand) {
    blotches(g, rand, 80, 0.3, 40)
    // Wind ripples.
    for (let y = 0; y < SIZE; y += 6 + rand() * 6) {
      g.strokeStyle = `rgba(160,160,160,${0.08 + rand() * 0.1})`
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= SIZE; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 3)
      g.stroke()
    }
    noise(g, rand, 236, 20)
  },
  paving(g, rand) {
    // Stone slabs of 0.6 × 1.2 m with joints, each a little different.
    const sw = SIZE / 5, sh = SIZE / 10
    for (let row = 0; row < 10; row++) {
      const off = row % 2 ? sw / 2 : 0
      for (let col = -1; col < 6; col++) {
        g.fillStyle = grey(222 + rand() * 28)
        g.fillRect(col * sw + off, row * sh, sw, sh)
      }
    }
    g.fillStyle = grey(170)
    for (let row = 0; row <= 10; row++) g.fillRect(0, row * sh - 1, SIZE, 2)
    for (let row = 0; row < 10; row++) for (let col = 0; col <= 6; col++) g.fillRect(col * sw + (row % 2 ? sw / 2 : 0) - 1, row * sh, 2, sh)
    noise(g, rand, 236, 14)
  },
  earth(g, rand) {
    blotches(g, rand, 120, 0.4, 60)
    dots(g, rand, 2600, 1.2, [170, 245])
    noise(g, rand, 232, 26)
  },
  grass(g, rand) {
    blotches(g, rand, 90, 0.35, 50)
    for (let i = 0; i < 9000; i++) {
      const x = rand() * SIZE, y = rand() * SIZE
      g.strokeStyle = grey(190 + rand() * 65)
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4)
      g.stroke()
    }
  },
  rock(g, rand) {
    // Bare rock with cracks and loose stones.
    blotches(g, rand, 140, 0.45, 70)
    for (let c = 0; c < 40; c++) {
      g.strokeStyle = `rgba(110,110,110,${0.2 + rand() * 0.3})`
      g.lineWidth = 0.8 + rand() * 1.6
      let x = rand() * SIZE, y = rand() * SIZE
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) g.lineTo((x += (rand() - 0.5) * 60), (y += (rand() - 0.5) * 60))
      g.stroke()
    }
    dots(g, rand, 1600, 2, [150, 245])
    noise(g, rand, 230, 24)
  },
  snow(g, rand) {
    // Soft drifts and a fine sparkle.
    blotches(g, rand, 60, 0.25, 22)
    noise(g, rand, 242, 8)
  },
}

const groundCache = new Map<GroundKind, CanvasTexture>()

export function groundTexture(kind: GroundKind): CanvasTexture {
  const hit = groundCache.get(kind)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = grey(235)
  g.fillRect(0, 0, SIZE, SIZE)
  GROUND_PAINTERS[kind](g, rng(kind.length * 104729))
  normalize(g, 240)
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  groundCache.set(kind, tex)
  return tex
}
