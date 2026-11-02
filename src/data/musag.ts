/**
 * Reads bridge.json from "מושג מתמטי" (DECISIONS.md 143). Kept on the device, so the knowledge shows at once
 * on the next visit; without the network the last copy stays, and with none the section stays out of the way.
 */
import { useEffect, useState } from 'react'
import { MUSAG_SITE, type MusagConcept } from '../learn/bridge'

const KEY = 'mathcreator.musag.v1'
let cache: MusagConcept[] | null = null
let pending: Promise<MusagConcept[]> | null = null

function readLocal(): MusagConcept[] | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? (JSON.parse(v) as MusagConcept[]) : null
  } catch {
    return null
  }
}

function load(): Promise<MusagConcept[]> {
  pending ??= fetch(`${MUSAG_SITE}/bridge.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json() as Promise<{ concepts: MusagConcept[] }>
    })
    .then((b) => {
      cache = b.concepts
      try {
        localStorage.setItem(KEY, JSON.stringify(b.concepts))
      } catch {
        /* storage full or blocked */
      }
      return b.concepts
    })
    .catch(() => cache ?? readLocal() ?? [])
  return pending
}

export function useMusag(): MusagConcept[] {
  const [concepts, setConcepts] = useState<MusagConcept[]>(() => cache ?? readLocal() ?? [])
  useEffect(() => {
    let on = true
    void load().then((c) => on && setConcepts(c))
    return () => {
      on = false
    }
  }, [])
  return concepts
}
