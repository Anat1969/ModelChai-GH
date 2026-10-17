/** Content height of an A4 page at 96 px per inch, inside the margins, the running head and the foot. */
export const PAGE_CONTENT = 930

/** Fills A4 pages with blocks, by their measured heights. A heading never ends a page. */
export function paginate(heights: number[], keep: boolean[], capacity = PAGE_CONTENT): number[][] {
  const pages: number[][] = [[]]
  let used = 0
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!
    const withNext = keep[i] && i + 1 < heights.length ? h + heights[i + 1]! : h
    if (used > 0 && used + withNext > capacity) {
      pages.push([])
      used = 0
    }
    pages.at(-1)!.push(i)
    used += h
  }
  return pages
}

// ---------- flow: pages filled to the foot (DECISIONS.md 126) ----------

/** One piece of the article, by its measured height. */
export interface FlowItem {
  h: number
  /** A heading: it stays with at least the start of what follows. */
  keep?: boolean
  /** Text that can be cut between sentences; `sentences` is how many it has. */
  sentences?: number
  /** A figure that can be made shorter: `fixed` is what does not shrink (caption, margins), `img` the image height. */
  figure?: { fixed: number; img: number }
  /** The section it belongs to: a figure may wait for the text of its own section, not of the next. */
  group?: string
}

/** Where a piece lands: the whole of it, sentences `from`–`to` of a text, or a figure with its image shortened. */
export interface Placement {
  i: number
  from?: number
  to?: number
  imgH?: number
}

/** Measures sentences `from`–`to` of text item `i`, as they would stand on a page. */
export type MeasureText = (i: number, from: number, to: number) => number

/** Least of a text worth starting at a page's foot, and least of an image worth keeping when shortened. */
const MIN_TEXT = 70
const MIN_IMG = 200

/**
 * Fills pages to the foot. Text that does not fit is cut between sentences; a figure that does not fit is
 * shortened down to 60% of its height, and below that it moves to the top of the next page while the text of its
 * own section fills the room it left. A heading never ends a page. `capacity` may differ for the first page.
 */
export function flow(items: FlowItem[], capacity: number | ((page: number) => number), measure: MeasureText): Placement[][] {
  const cap = typeof capacity === 'number' ? () => capacity : capacity
  const pages: Placement[][] = [[]]
  let used = 0
  let waiting: { p: Placement; h: number }[] = []
  const room = () => cap(pages.length - 1) - used
  const newPage = () => {
    pages.push([])
    used = 0
    // Figures that waited open the new page.
    const w = waiting
    waiting = []
    for (const x of w) place(x.p, x.h)
  }
  const place = (p: Placement, h: number) => {
    if (used > 0 && h > room()) newPage()
    pages.at(-1)!.push(p)
    used += h
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (waiting.length && it.group !== items[i - 1]?.group) newPage()
    if (it.keep) {
      const next = items[i + 1]
      const need = it.h + (next ? (next.sentences ? Math.min(next.h, MIN_TEXT) : next.h) : 0)
      if (used > 0 && need > room()) newPage()
      place({ i }, it.h)
      continue
    }
    if (it.sentences && it.sentences > 0) {
      let from = 0
      let h = it.h
      while (true) {
        if (h <= room() || used === 0 && h <= cap(pages.length - 1)) {
          place(from === 0 ? { i } : { i, from, to: it.sentences }, h)
          break
        }
        // The most sentences that fit in the room left.
        let fit = 0
        if (room() >= MIN_TEXT)
          for (let k = it.sentences - 1; k > from; k--)
            if (measure(i, from, k) <= room()) {
              fit = k
              break
            }
        if (!fit) {
          if (used === 0) {
            // Longer than a whole page and not one sentence fits: it goes as it is.
            place({ i, from, to: it.sentences }, h)
            break
          }
          newPage()
          continue
        }
        pages.at(-1)!.push({ i, from, to: fit })
        used += measure(i, from, fit)
        newPage()
        from = fit
        h = measure(i, from, it.sentences)
      }
      continue
    }
    if (it.figure && used > 0 && it.h > room()) {
      const imgH = room() - it.figure.fixed
      if (imgH >= Math.max(MIN_IMG, it.figure.img * 0.6)) {
        place({ i, imgH }, room())
        continue
      }
      // Wait for the next page, if text of this section can fill the room in the meantime.
      const textFollows = items[i + 1]?.group === it.group && !!items[i + 1]?.sentences
      if (textFollows) {
        waiting.push({ p: { i }, h: it.h })
        continue
      }
    }
    place({ i }, it.h)
  }
  if (waiting.length) newPage()
  return pages.filter((p) => p.length)
}
