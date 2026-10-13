import '@vitest/web-worker'
import { afterAll, describe, expect, it } from 'vitest'
import { createEngineClient } from '../src/engine/client'
import { fixture } from './helpers'

const client = createEngineClient(new Worker(new URL('../src/engine/worker.ts', import.meta.url), { type: 'module' }))
afterAll(() => client.dispose())

describe('engine Worker', () => {
  it('6. the default recipe builds in under 150 ms inside the Worker', async () => {
    const times: number[] = []
    for (let i = 0; i < 6; i++) {
      const o = await client.build(fixture('umbilic-torus'))
      if (o.status !== 'done' || !o.result.ok) throw new Error('build failed')
      times.push(o.result.stats.ms)
    }
    const [cold, ...warm] = times
    const median = [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)]!
    console.info(`[test 6] cold ${cold!.toFixed(1)} ms, warm median ${median.toFixed(1)} ms (${warm.map((t) => t.toFixed(0)).join(', ')})`)
    expect(median).toBeLessThan(150)
  })

  it('returns typed arrays across the Worker boundary', async () => {
    const o = await client.build(fixture('mobius-strip'))
    if (o.status !== 'done' || !o.result.ok) throw new Error('build failed')
    expect(o.result.meshes.outer.positions).toBeInstanceOf(Float32Array)
    expect(o.result.meshes.outer.indices).toBeInstanceOf(Uint32Array)
  })

  it('cancels a waiting request when a newer one arrives; only the latest waiting one is built', async () => {
    const before = client.buildCount
    const a = client.build(fixture('umbilic-torus'))
    const b = client.build(fixture('mobius-strip'))
    const c = client.build(fixture('golden-ratio'))
    const [ra, rb, rc] = await Promise.all([a, b, c])
    expect(ra.status).toBe('done')
    expect(rb.status).toBe('superseded')
    expect(rc.status).toBe('done')
    expect(client.buildCount - before).toBe(2)
  })

  it('reports schema and rule failures without building', async () => {
    const raw = fixture('umbilic-torus')
    raw.generator.params.twist.turns_per_lap = 0.25
    const o = await client.build(raw)
    if (o.status !== 'done') throw new Error('expected done')
    expect(o.result.ok).toBe(false)
  })
})
