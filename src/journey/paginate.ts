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
