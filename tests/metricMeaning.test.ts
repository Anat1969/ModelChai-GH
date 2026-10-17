/** Every metric explains itself, and a change is read as a meaning, not only a number. */
import { describe, expect, it } from 'vitest'
import { metricRows } from '../src/ui/panels/MetricsPanel'
import { changes, infoOf, METRIC_INFO } from '../src/ui/metricMeaning'

describe('metric meaning', () => {
  it('explains every metric the panel can show', () => {
    const keys = ['outerDiameter', 'courtyardDiameter', 'edgeCount', 'edgeLength', 'floorWidth', 'clearHeight', 'floorContinuous', 'wallAtCorners', 'openingFraction', 'volume', 'weight', 'saving', 'envelopeArea', 'cuspBurial']
    for (const k of keys) {
      const i = infoOf(k)
      expect(i, k).toBeDefined()
      expect(i!.measures && i!.learn && i!.decide && i!.up && i!.down, k).toBeTruthy()
    }
    expect(Object.keys(METRIC_INFO).sort()).toEqual([...keys].sort())
    expect(typeof metricRows).toBe('function')
  })

  it('reads a change above half a percent, with its meaning and direction', () => {
    const prev = [
      { key: 'courtyardDiameter', label: 'קוטר החצר', value: "21.6 מ'", raw: 21.6 },
      { key: 'volume', label: 'נפח', value: '1,000', raw: 1000 },
    ]
    const next = [
      { key: 'courtyardDiameter', label: 'קוטר החצר', value: "25.0 מ'", raw: 25 },
      { key: 'volume', label: 'נפח', value: '1,003', raw: 1003 },
    ]
    const c = changes(prev, next)
    expect(c.map((x) => x.key)).toEqual(['courtyardDiameter'])
    expect(c[0]!.meaning).toBe(METRIC_INFO.courtyardDiameter!.up)
    expect(changes(next, prev)[0]!.meaning).toBe(METRIC_INFO.courtyardDiameter!.down)
  })
})
