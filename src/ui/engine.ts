/** The single engine Worker for the app. */
import { createEngineClient } from '../engine/client'

export const engine = createEngineClient(new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' }))
