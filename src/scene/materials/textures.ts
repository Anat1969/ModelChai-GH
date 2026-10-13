/**
 * Procedural textures for the material library (LEVELS.md 2.3): light grain, fibers and layers drawn on a
 * Canvas, with no image files. Each texture is a grey modulation (around 1) that multiplies the base color,
 * and covers TILE meters of surface, so the grain keeps its real size on any model.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { MATERIALS } from '../../recipe/schema'
import { rng } from '../contexts/layout'

export type MaterialId = (typeof MATERIALS)[number]

/** The six opaque materials of the minimum product, in the order of the selector. */
export const MVP_MATERIALS: MaterialId[] = ['polished_concrete_light', 'concrete_matte', 'polished_concrete_grey', 'jerusalem_stone', 'timber_oak', 'rammed_earth']

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

export type GroundKind = 'sand' | 'paving' | 'earth' | 'grass'
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
