/**
 * The bridge to "מושג מתמטי" (musag-matemati-gh.vercel.app), DECISIONS.md 143. Each app publishes a bridge.json
 * built from its own source of truth, and reads the other's. Nothing is copied: the atlas stays here, the
 * sourced knowledge (rule, precedent, city, haiku) stays there. Pure: no React, no DOM, so vite.config can build it.
 */
import { FIT_WORD, MODELS } from './atlas'
import { TRAITS } from './traits'

export const SITE = 'https://math-creator.vercel.app'
export const MUSAG_SITE = 'https://musag-matemati-gh.vercel.app'

/** What this app publishes: every atlas model, with the traits that carry into space and what the engine builds. */
export function buildBridge() {
  return {
    app: 'math-creator',
    version: 1,
    url: SITE,
    models: MODELS.map((m) => ({
      id: m.id,
      name_he: m.name_he,
      name: m.name,
      family: m.family,
      plain: m.plain,
      traits: m.traits.map((t) => ({ id: t, label: TRAITS[t].label, space: TRAITS[t].space })),
      limits: m.limits,
      fit: { level: m.fit.level, word: FIT_WORD[m.fit.level], note: m.fit.note },
      url: `${SITE}/#/learn?m=${encodeURIComponent(m.id)}`,
    })),
  }
}

interface Named {
  he: string
  latin: string
}
interface Source {
  label: string
  href?: string
}

/** What "מושג מתמטי" publishes: one concept, with knowledge that has a source, and the models it links to. */
export interface MusagConcept {
  slug: string
  name: string
  latin: string
  force: { id: string; name: string; question: string }
  architecturalName: string
  url: string
  image: string
  insight: string
  insightText: string
  rule: { text: string; formula: string; source: Source }
  precedent: { name: Named; by: string; year: string; text: string; source: Source }
  city: { name: Named; text: string }
  quote: { text: string; by: Named; work: string; year: string } | null
  haiku: { lines: string[]; note: string }
  models: { id: string; relation: 'same' | 'near'; why: string }[]
}

/** The concepts that link to a model, the same concept first. */
export function conceptsForModel(concepts: MusagConcept[], modelId: string) {
  return concepts
    .flatMap((c) => c.models.filter((l) => l.id === modelId).map((link) => ({ concept: c, link })))
    .sort((a, b) => (a.link.relation === b.link.relation ? 0 : a.link.relation === 'same' ? -1 : 1))
}
