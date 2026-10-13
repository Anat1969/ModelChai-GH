/**
 * Main-thread client for the engine Worker. Latest wins: while a build runs, newer requests wait in a single
 * slot, and a request that is replaced there before it starts is cancelled ("superseded") and never built.
 * The running build always completes and is delivered, so the screen keeps updating during a slider drag
 * while the previous model stays visible until the new one is ready.
 */
import { wrap, releaseProxy, type Remote } from 'comlink'
import type { BuildResult } from './build'
import type { EngineApi } from './worker'

export type BuildOutcome = { status: 'done'; result: BuildResult } | { status: 'superseded' }

interface Pending {
  input: unknown
  resolve: (o: BuildOutcome) => void
  reject: (e: unknown) => void
}

export interface EngineClient {
  build(input: unknown): Promise<BuildOutcome>
  /** Number of builds the Worker actually ran. Used to prove that switching levels never rebuilds. */
  readonly buildCount: number
  dispose(): void
}

export function createEngineClient(worker: Worker): EngineClient {
  const remote: Remote<EngineApi> = wrap<EngineApi>(worker)
  let running = false
  let waiting: Pending | null = null
  let buildCount = 0

  const run = (job: Pending) => {
    running = true
    buildCount++
    remote
      .build(job.input)
      .then((result) => job.resolve({ status: 'done', result }), job.reject)
      .finally(() => {
        running = false
        const next = waiting
        waiting = null
        if (next) run(next)
      })
  }

  return {
    build(input) {
      return new Promise<BuildOutcome>((resolve, reject) => {
        const job = { input, resolve, reject }
        if (!running) return run(job)
        waiting?.resolve({ status: 'superseded' })
        waiting = job
      })
    },
    get buildCount() {
      return buildCount
    },
    dispose() {
      waiting?.resolve({ status: 'superseded' })
      waiting = null
      remote[releaseProxy]()
      worker.terminate()
    },
  }
}
