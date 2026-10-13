/** Ready examples: each opens in the studio at once, in its ideal state. */
import { EXAMPLES } from '../../data/examples'
import { navigate } from '../router'
import { useStudio } from '../store'

export function ExamplesGallery() {
  const load = useStudio((s) => s.loadRecipe)
  return (
    <section className="examples" aria-labelledby="examples-title">
      <h2 id="examples-title">דוגמאות מוכנות</h2>
      <p className="hint">כל דוגמה מגיעה במצבה המאוזן: בקנה מידה אנושי, ובלי אף כלל שנשבר. נפתחת בסטודיו מיד, בלי לחכות ל-Claude.</p>
      <ul className="example-list">
        {EXAMPLES.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className="example"
              data-testid={`example-${e.id}`}
              onClick={() => {
                load(structuredClone(e.recipe), e.id)
                navigate('studio')
              }}
            >
              <span className="example-concept">
                {e.recipe.concept.name_he} · {e.recipe.concept.name}
              </span>
              <strong className="example-name">{e.recipe.narrative.name_he}</strong>
              {e.recipe.narrative.maxim && <span className="example-maxim">{e.recipe.narrative.maxim}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
