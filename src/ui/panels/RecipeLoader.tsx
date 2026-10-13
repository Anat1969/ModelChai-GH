import { useRef } from 'react'
import golden from '../../../docs/fixtures/golden-ratio.recipe.json'
import mobius from '../../../docs/fixtures/mobius-strip.recipe.json'
import umbilic from '../../../docs/fixtures/umbilic-torus.recipe.json'
import { useStudio } from '../store'

export const FIXTURES = [
  { id: 'umbilic-torus', label: 'טורוס טבורי: הטבעת המשולשת', recipe: umbilic },
  { id: 'mobius-strip', label: 'רצועת מביוס: הגשר שאין לו צד', recipe: mobius },
  { id: 'golden-ratio', label: 'יחס הזהב: המגדל המתכנס', recipe: golden },
] as const

/** Until Stage 3 a recipe comes from a JSON file or from the three examples. */
export function RecipeLoader() {
  const load = useStudio((s) => s.loadRecipe)
  const source = useStudio((s) => s.sourceName)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File) => {
    try {
      load(JSON.parse(await file.text()), file.name)
    } catch {
      useStudio.getState().set('notice', {
        tone: 'error',
        title: `הקובץ "${file.name}" אינו JSON תקין`,
        lines: [{ text: 'המתכון צריך להיות קובץ JSON, כמו הקבצים שהאפליקציה מייצאת.' }],
        action: 'בחירת קובץ אחר',
      })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <fieldset>
      <legend>
        <h3>מתכון</h3>
      </legend>
      <div className="ctl">
        <label htmlFor="fixture">דוגמה</label>
        <span />
        <select
          id="fixture"
          data-testid="fixture"
          value={FIXTURES.some((f) => f.id === source) ? source : ''}
          onChange={(e) => {
            const f = FIXTURES.find((x) => x.id === e.currentTarget.value)
            if (f) load(structuredClone(f.recipe), f.id)
          }}
        >
          {!FIXTURES.some((f) => f.id === source) && <option value="">{source || 'בחירת דוגמה'}</option>}
          {FIXTURES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <label className="filebtn">
        טעינת מתכון מקובץ JSON
        <input ref={fileRef} type="file" accept="application/json,.json" data-testid="file" onChange={(e) => e.currentTarget.files?.[0] && onFile(e.currentTarget.files[0])} />
      </label>
    </fieldset>
  )
}
