/** Read and write a recipe field by dotted path, without mutating the original. */
export function getAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

export function setAt<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.')
  const root = structuredClone(obj) as Record<string, unknown>
  let o = root
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}
    o = o[k] as Record<string, unknown>
  }
  if (value === undefined) delete o[keys.at(-1)!]
  else o[keys.at(-1)!] = value
  return root as T
}

/** Only generator and bare change geometry (CLAUDE.md, "הפרדת רמות"). */
export const changesGeometry = (path: string) => /^(generator|bare)(\.|$)/.test(path)
