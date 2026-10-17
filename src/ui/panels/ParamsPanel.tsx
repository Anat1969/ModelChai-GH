import { Choice } from '../controls/Choice'
import { Slider } from '../controls/Slider'
import { GROUPS, SURFACE_GROUPS, twistFormat, type Built, type ParamGroup, type Sweep } from '../params'
import { useStudio } from '../store'

export function ParamsPanel({ recipe }: { recipe: Built }) {
  const setParam = useStudio((s) => s.setParam)
  const setParams = useStudio((s) => s.setParams)

  const onMode = (mode: string) => {
    if (recipe.generator.type === 'sweep' && mode === 'shell' && !recipe.bare.shell) {
      const t = Math.min(0.3, Math.round(recipe.generator.params.section.a * 0.3 * 100) / 100)
      setParams([
        ['bare.shell', { thickness: t, inner_method: 'scaled_section' }],
        ['bare.mode', 'shell'],
      ])
    } else setParam('bare.mode', mode)
  }

  // Each generator has its own sliders, read through the same definitions (DECISIONS.md 139).
  const groups = (recipe.generator.type === 'sweep' ? GROUPS : SURFACE_GROUPS) as ParamGroup<Built>[]
  const display = (id: string, v: number, format: (v: number) => string) =>
    id === 'twist' && recipe.generator.type === 'sweep' ? twistFormat(recipe as Sweep, v) : format(v)

  return (
    <>
      {groups.map((g) => {
        const visible = g.params.filter((p) => !p.show || p.show(recipe))
        if (!visible.length) return null
        return (
          <fieldset key={g.title}>
            <legend>
              <h3>{g.title}</h3>
            </legend>
            {visible.map((p) =>
              p.kind === 'choice' ? (
                <Choice
                  key={p.id}
                  testId={`param-${p.id}`}
                  label={p.label}
                  why={p.why}
                  value={p.value(recipe)}
                  options={p.options}
                  onChange={(v) => (p.id === 'mode' ? onMode(v) : setParam(p.path, v))}
                />
              ) : (
                <Slider
                  key={p.id}
                  testId={`param-${p.id}`}
                  label={p.label}
                  why={p.why}
                  value={p.value(recipe)}
                  min={p.min(recipe)}
                  max={p.max(recipe)}
                  step={p.step}
                  display={display(p.id, p.value(recipe), p.format)}
                  onChange={(v) => setParam(p.path, p.write ? p.write(v, recipe) : v)}
                />
              ),
            )}
          </fieldset>
        )
      })}
    </>
  )
}
