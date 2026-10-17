/// <reference lib="webworker" />
/** The engine's Web Worker. The UI talks to it only through ./client.ts. */
import { expose, transfer } from 'comlink'
import { build, transferables, type BuildResult } from './build'
import { buildClosedMesh } from './sweep/closedMesh'
import { buildSurfaceClosedMesh } from './surface/build'
import { parseRecipe } from '../recipe/schema'
import { exportFile, printFiles, type ExportFile, type ExportFormat, type PrintFiles } from './export'
import type { PrintOptions } from './export/print'
import type { SolidMesh } from './types'

const api = {
  exportFile(input: unknown, format: ExportFormat): ExportFile | { error: string } {
    const f = exportFile(input, format)
    return 'bytes' in f ? transfer(f, [f.bytes.buffer as ArrayBuffer]) : f
  },
  async printFiles(input: unknown, opts: PrintOptions): Promise<PrintFiles | { error: string }> {
    const f = await printFiles(input, opts)
    return 'error' in f ? f : transfer(f, [f.stl.bytes.buffer as ArrayBuffer, f.threeMf.bytes.buffer as ArrayBuffer])
  },
  build(input: unknown): BuildResult {
    const r = build(input)
    return transfer(r, transferables(r))
  },
  /** Welded export mesh at export resolution. Null when the recipe is not a valid sweep or surface. */
  closedMesh(input: unknown): SolidMesh | null {
    const p = parseRecipe(input)
    if (!p.ok) return null
    const g = p.recipe.generator
    if (g.type !== 'sweep' && g.type !== 'parametric_surface') return null
    const m = g.type === 'sweep' ? buildClosedMesh(p.recipe, g.params) : buildSurfaceClosedMesh(p.recipe, g.params)
    return transfer(m, [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
  },
}

export type EngineApi = typeof api

// Explicit endpoint: in a browser Worker self === globalThis; test harnesses only provide self.
expose(api, self)
