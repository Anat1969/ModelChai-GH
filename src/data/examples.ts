/**
 * Ready examples: recipes that open in the studio at once, with no call to Claude. Each arrives in its ideal
 * state: balanced, at human scale, with no rule broken (tests/examples.test.ts, DECISIONS.md 83).
 */
import astroid from '../../docs/examples/astroid-pavilion.recipe.json'
import ellipse from '../../docs/examples/elliptic-gallery.recipe.json'
import helix from '../../docs/examples/helix-ramp.recipe.json'
import lame from '../../docs/examples/lame-curve-ring.recipe.json'
import pentacle from '../../docs/examples/pentacle-sculpture.recipe.json'
import golden from '../../docs/fixtures/golden-ratio.recipe.json'
import mobius from '../../docs/fixtures/mobius-strip.recipe.json'
import umbilic from '../../docs/fixtures/umbilic-torus.recipe.json'

export interface Example {
  id: string
  recipe: { concept: { name: string; name_he: string; use?: string }; narrative: { name_he: string; maxim?: string } } & Record<string, unknown>
}

// Ids follow the file names, so links and saved sources keep working.
export const EXAMPLES: Example[] = (
  [
    ['umbilic-torus', umbilic],
    ['mobius-strip', mobius],
    ['golden-ratio', golden],
    ['astroid-pavilion', astroid],
    ['lame-curve-ring', lame],
    ['pentacle-sculpture', pentacle],
    ['helix-ramp', helix],
    ['elliptic-gallery', ellipse],
  ] as const
).map(([id, r]) => ({ id, recipe: r as unknown as Example['recipe'] }))

/**
 * Concepts to try next, each with the place where its logic meets space: where the open and the closed, the
 * built and its surroundings, touch. Choosing one fills the form; Claude builds the recipe.
 */
export const SUGGESTIONS: { concept: string; he: string; use: string; context: string; why: string }[] = [
  { concept: 'Klein bottle', he: 'בקבוק קליין', use: 'ביתן', context: 'פארק', why: 'פנים שהופך לחוץ בלי לחצות דופן' },
  { concept: 'Torus knot', he: 'קשר טורי', use: 'גשר הולכי רגל', context: 'חזית מים', why: 'דרך אחת שעוברת מעל ומתחת לעצמה' },
  { concept: 'Hypocycloid with seven cusps', he: 'היפוציקלואיד בעל שבעה חודים', use: 'ביתן הצללה', context: 'כיכר עירונית', why: 'שבעה צללים שמסתובבים לקצה אחד' },
  { concept: 'Golden spiral', he: 'ספירלת הזהב', use: 'מגדל תצפית', context: 'גבעות לס', why: 'צמיחה שלא משנה את צורתה' },
  { concept: 'Riemann sum', he: 'סכום רימן', use: 'ביתן', context: 'חוף ים', why: 'מלבנים שמתקרבים לעקומה, והרווח ביניהם' },
  { concept: 'Catenary', he: 'שרשרת תלויה', use: 'קשת כניסה', context: 'כיכר עירונית', why: 'הצורה שבה הכוח זורם בלי כפיפה' },
  { concept: 'Sine wave', he: 'גל סינוס', use: 'טיילת', context: 'חזית מים', why: 'מחזור קבוע שפותח וסוגר את הנוף' },
  { concept: 'Reuleaux triangle', he: 'משולש רולו', use: 'מרכז קהילתי', context: 'פארק', why: 'רוחב קבוע בכל כיוון, בלי להיות עיגול' },
  { concept: 'Lemniscate', he: 'למניסקטה', use: 'מסלול הליכה', context: 'פארק', why: 'לולאה אחת עם שתי חצרות' },
  { concept: 'Hyperboloid', he: 'היפרבולואיד', use: 'מגדל מים', context: 'כיכר עירונית', why: 'קווים ישרים שיוצרים משטח מעוקל' },
  { concept: 'Fibonacci sequence', he: 'סדרת פיבונאצ׳י', use: 'גלריה', context: 'גבעות לס', why: 'כל חדר הוא סכום שני הקודמים' },
  { concept: 'Trefoil knot', he: 'קשר תלתן', use: 'פסל סביבתי', context: 'חוף ים', why: 'שלוש לולאות שהן קו אחד' },
]
