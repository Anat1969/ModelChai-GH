/**
 * The "סביבה" tab (LEVELS.md 2): date, hour, place, quick season buttons, the model's orientation, weather, wind,
 * materials, context and people, what is computed and what is only shown, and the visual prompt. Every control
 * writes a field under `realistic`, so none of them rebuilds.
 */
import { useMemo, useState } from 'react'
import { DENSITY, MATERIAL_LOOK } from '../../engine/materials'
import { visualPrompt } from '../../prompt/visualPrompt'
import { atmosphere } from '../../scene/atmosphere'
import { bounds } from '../../scene/cameras'
import { CONTEXTS, SELECTOR_CONTEXTS, VEGETATION, type ContextId, type VegetationId } from '../../scene/contexts/layout'
import { SELECTOR_MATERIALS, type MaterialId } from '../../scene/materials/textures'
import { seasonOf } from '../../scene/seasons'
import {
  SITES,
  clockLabel,
  dateLabel,
  dayOfYear,
  daysInYear,
  isoAt,
  localTime,
  quickMoment,
  sunAt,
  sunPath,
  withDayOfYear,
  type LocalTime,
  type QuickMoment,
} from '../../scene/sun'
import { windOf } from '../../prompt/visualPrompt'
import { beaufort, orientationOf, passageBearings, readWind, sunOnFront, windOfRecipe } from '../../scene/wind'
import { Choice } from '../controls/Choice'
import { Select } from '../controls/Select'
import { Slider } from '../controls/Slider'
import { num } from '../format'
import type { Sweep } from '../params'
import { useStudio } from '../store'

const QUICK: { id: QuickMoment; label: string }[] = [
  { id: 'winter_solstice', label: 'היפוך חורף' },
  { id: 'equinox', label: 'שוויון' },
  { id: 'summer_solstice', label: 'היפוך קיץ' },
  { id: 'sunset', label: 'שקיעה' },
]

const WEATHER = [
  { value: 'clear', label: 'בהיר' },
  { value: 'haze', label: 'אובך' },
  { value: 'overcast', label: 'מעונן' },
  { value: 'rain', label: 'גשם' },
  { value: 'fog', label: 'ערפל' },
  { value: 'snow', label: 'שלג' },
]
const WEATHER_WHY: Record<string, string> = {
  clear: 'שמיים לפי גובה השמש, צל חד וערפל רחוק.',
  haze: 'שמיים מוחלשים וחמים, צל רך וערפל בינוני.',
  overcast: 'אפור אחיד, בלי שמש ישירה: כמעט אין צל, רק אור סביבה.',
  rain: 'שמיים כהים בלי שמש ישירה ובלי צל. הקרקע והמבנה רטובים, כהים ומבריקים יותר, וקווי הגשם נוטים עם הרוח.',
  fog: 'ראות של כמה גדלי מבנה בלבד. השמש נראית כעיגול חיוור ומטילה צל חלש ורך מאוד.',
  snow: 'שלג יורד ומכסה את הקרקע ואת הצמחייה. בלי שמש ישירה, ואור לבן ובהיר שחוזר מהשלג.',
}

const materialOptions = (current?: string) => {
  const ids: string[] = [...SELECTOR_MATERIALS]
  if (current && !ids.includes(current)) ids.push(current)
  return ids.map((id) => ({ value: id, label: MATERIAL_LOOK[id as MaterialId].name_he }))
}

const densityWords = (id: MaterialId) => `צפיפות ${num(DENSITY[id], DENSITY[id] < 1 ? 2 : 1)} טון למ"ק`

/** What each part of the scene rests on (DECISIONS.md 123): computed, or shown to be seen. */
const BASIS: { what: string; kind: 'computed' | 'visual' | 'illustration' | 'scale'; how: string }[] = [
  { what: 'מיקום השמש וכיוון הצל', kind: 'computed', how: 'suncalc, לפי התאריך, השעה והמקום האמיתיים. כיוון הצל ואורכו נכונים.' },
  { what: 'זריחה, שקיעה וגובה בצהריים', kind: 'computed', how: 'suncalc, לפי השעון המקומי של המקום.' },
  { what: 'משקל', kind: 'computed', how: 'נפח הרשת כפול צפיפות החומר. ערך מקורב לסדר גודל, לא לתכנון הנדסי.' },
  { what: 'חומרים ומרקמים', kind: 'visual', how: 'גוון, חספוס ומרקם לעין. לא מבטאים בידוד, חוזק או התנהגות לאורך זמן.' },
  { what: 'מזג אוויר', kind: 'visual', how: 'שמיים, ערפל, רטיבות ושלג לעין. לא נתוני אקלים של המקום.' },
  { what: 'רוח', kind: 'illustration', how: 'כיוון ועוצמה מהמתכון. הקווים עוקפים עיגול סביב המבנה, לא את הצורה עצמה.' },
  { what: 'אנשים וצמחייה', kind: 'scale', how: 'לקנה מידה ולתחושת המקום. המיקום שלהם אקראי וקבוע.' },
]
const KIND_HE = { computed: 'מחושב', visual: 'המחשה חזותית', illustration: 'המחשה, לא סימולציה', scale: 'קנה מידה בלבד' } as const

export function RealisticPanel({ recipe, built }: { recipe: Sweep; built: Sweep }) {
  const setParam = useStudio((s) => s.setParam)
  const setParams = useStudio((s) => s.setParams)
  const [copied, setCopied] = useState(false)
  const real = recipe.realistic
  const site = real.site
  const t = localTime(real.datetime, site)
  const sun = sunAt(site, new Date(real.datetime))
  const season = seasonOf(t.month)
  const air = atmosphere(sun.altitude, real.weather, season, bounds(built).extent)
  const prompt = useMemo(() => visualPrompt(recipe), [recipe])
  const showWind = useStudio((s) => s.showWind)
  const setView = useStudio((s) => s.set)
  const orientation = orientationOf(real)
  const wind = windOfRecipe(real)
  const path = sunPath(site, new Date(isoAt({ ...t, hour: 12 }, site)))
  const onFront = sunOnFront(sun.bearing, orientation)
  const ring = built.generator.params.path.type === 'circle' || built.generator.params.path.type === 'ellipse'
  const passages = built.bare.mode === 'shell' && ring ? built.bare.openings?.passages : undefined
  const reading = readWind(wind, passages?.count ? passageBearings(passages.count, passages.start_angle_deg, orientation) : [])
  const force = beaufort(wind.speed_ms)
  const setWind = (next: Partial<typeof wind>) => setParam('realistic.wind', { ...wind, ...next })

  const setTime = (next: LocalTime) => {
    setCopied(false)
    setParam('realistic.datetime', isoAt(next, site))
  }
  const known = SITES.find((s) => s.name === site.name || (Math.abs(s.lat - site.lat) < 0.01 && Math.abs(s.lon - site.lon) < 0.01))
  const siteOptions = [
    ...SITES.map((s) => ({ value: s.name, label: `${s.name_he} (${s.full})` })),
    ...(known ? [] : [{ value: '__current', label: `${site.name ?? 'המיקום במתכון'}, ${num(site.lat, 2)}°, ${num(site.lon, 2)}°` }]),
  ]
  const context = real.context.preset as ContextId
  const contextIds = SELECTOR_CONTEXTS.includes(context) ? SELECTOR_CONTEXTS : [...SELECTOR_CONTEXTS, context]
  const vegetation = (real.context.vegetation ?? CONTEXTS[context].vegetation) as VegetationId
  const shell = built.bare.mode === 'shell'

  return (
    <>
      <fieldset>
        <legend>
          <h3>שמש ועונה</h3>
        </legend>
        <p className="readout" data-testid="sun-altitude" data-value={sun.altitude.toFixed(3)} data-datetime={real.datetime}>
          {sun.altitude > 0
            ? `השמש ${num(sun.altitude, 1)}° מעל האופק, מה${windOf(sun.bearing)}. צל של מוט במטר: ${num(sun.shadowPerMeter, 2)} מ'.`
            : 'השמש מתחת לאופק בשעה הזאת. אפשר לבחור שעה מוקדמת יותר, או ללחוץ על "שקיעה".'}{' '}
          {season.name_he}, אור {num(air.kelvin, 0)}K.
        </p>
        <p className="readout" data-testid="sun-path" data-noon-altitude={path.noonAltitude.toFixed(3)} data-relative={onFront.rel.toFixed(1)}>
          {path.sunrise !== null && path.sunset !== null ? `זריחה ${clockLabel(path.sunrise)}, שקיעה ${clockLabel(path.sunset)}. ` : 'השמש לא זורחת או לא שוקעת ביום הזה. '}
          בצהריים ({clockLabel(path.noon)}) השמש מגיעה ל-{num(path.noonAltitude, 1)}°.{' '}
          {sun.altitude > 0 ? `עכשיו ${onFront.words}: ${num(onFront.rel, 0)}° מכיוון החזית, שפונה ל${windOf(orientation)}.` : `החזית פונה ל${windOf(orientation)}.`}
        </p>
        <div className="seg" role="group" aria-label="רגעים מהירים">
          {QUICK.map((q) => (
            <button key={q.id} type="button" data-testid={`quick-${q.id}`} onClick={() => setTime(quickMoment(q.id, t, site))}>
              {q.label}
            </button>
          ))}
        </div>
        <Slider
          testId="real-day"
          label="תאריך"
          why="התאריך קובע את גובה השמש בצהריים, את העונה ואת צבע הצמחייה."
          value={dayOfYear(t)}
          min={1}
          max={daysInYear(t.year)}
          step={1}
          display={dateLabel(t)}
          onChange={(d) => setTime(withDayOfYear(t, d))}
        />
        <Slider
          testId="real-hour"
          label="שעה"
          why="השעה קובעת את כיוון הצל ואת אורכו, ואת חום האור."
          value={t.hour}
          min={4}
          max={21}
          step={1 / 6}
          display={clockLabel(t.hour)}
          onChange={(h) => setTime({ ...t, hour: h })}
        />
        <Select
          testId="real-site"
          label="מקום"
          why="קו הרוחב קובע כמה גבוה השמש עולה. השעון הוא השעון המקומי של המקום."
          value={known?.name ?? '__current'}
          options={siteOptions}
          onChange={(name) => {
            const s = SITES.find((x) => x.name === name)
            if (!s) return
            const next = { lat: s.lat, lon: s.lon, name: s.name }
            // The local clock stays: noon in Ashdod becomes noon in Eilat.
            setParams([
              ['realistic.site', next],
              ['realistic.datetime', isoAt(t, next)],
            ])
          }}
        />
      </fieldset>

      <fieldset>
        <legend>
          <h3>כיוון המבנה</h3>
        </legend>
        <Slider
          testId="real-orientation"
          label="סיבוב מהצפון"
          why="המבנה מסתובב סביב מרכזו עם כיוון השעון. כך בודקים איזה צד מקבל שמש ואיזה צד פונה לרוח, בלי לבנות מחדש. במודל כתוב איפה הצפון ואיפה החזית."
          value={orientation}
          min={0}
          max={359}
          step={1}
          display={`${num(orientation, 0)}°, החזית ל${windOf(orientation)}`}
          onChange={(v) => setParam('realistic.orientation_deg', Math.round(v))}
        />
      </fieldset>

      <fieldset>
        <legend>
          <h3>מזג אוויר</h3>
        </legend>
        <Choice testId="real-weather" label="מצב השמיים" why={WEATHER_WHY[real.weather]!} value={real.weather} options={WEATHER} onChange={(v) => setParam('realistic.weather', v)} />
      </fieldset>

      <fieldset>
        <legend>
          <h3>רוח</h3>
        </legend>
        <Slider
          testId="real-wind-from"
          label="כיוון הרוח"
          why="הכיוון שממנו הרוח מגיעה. בחוף הישראלי רוח הים של אחר הצהריים מגיעה ממערב."
          value={wind.from_deg}
          min={0}
          max={359}
          step={1}
          display={`${windOf(wind.from_deg)}, ${num(wind.from_deg, 0)}°`}
          onChange={(v) => setWind({ from_deg: Math.round(v) })}
        />
        <Slider
          testId="real-wind-speed"
          label="מהירות"
          why={`בסולם בופור: ${force.name_he}. ${force.effect_he}.`}
          value={wind.speed_ms}
          min={0}
          max={30}
          step={0.5}
          display={`${num(wind.speed_ms, 1)} מ' לשנייה, בופור ${force.force}`}
          onChange={(v) => setWind({ speed_ms: v })}
        />
        <label className="check">
          <input type="checkbox" data-testid="wind-show" checked={showWind} onChange={(e) => setView('showWind', e.currentTarget.checked)} />
          קווי רוח במודל, בגובה הקרקע ובחצי גובה המבנה
        </label>
        <p className="basis-note" data-testid="wind-note" role="note">
          <strong>המחשה, לא סימולציה:</strong> הקווים מראים כיוון ועוצמה, לא זרימה מחושבת סביב הצורה.
        </p>
        <p className="hint" data-testid="wind-reading">
          {force.force === 0
            ? 'בלי רוח אין קווים ואין צד מוגן.'
            : `מה אפשר להסיק: הצד ה${reading.windward_he} של המבנה חשוף לרוח, והצד ה${reading.leeward_he} מוגן ממנה${passages?.count ? `. מתוך ${passages.count} המעברים, ${reading.passages.into} פונים אל הרוח, ${reading.passages.across} לאורכה ו-${reading.passages.sheltered} בצד המוגן` : ''}. מה אי אפשר להסיק: לחץ הרוח על המעטפת, מערבולות, ומהירות הרוח בתוך החצר. לזה נדרשת סימולציית זרימה.`}
        </p>
      </fieldset>

      <fieldset>
        <legend>
          <h3>חומרים</h3>
        </legend>
        <Select
          testId="real-material-outer"
          label="מעטפת"
          why={`החומר של הפנים החיצוניות. ${densityWords(real.materials.outer)}, והיא קובעת את המשקל בפאנל המדדים.`}
          value={real.materials.outer}
          options={materialOptions(real.materials.outer)}
          onChange={(v) => setParam('realistic.materials.outer', v)}
        />
        {shell && (
          <Select
            testId="real-material-inner"
            label="דופן פנימית"
            why="החומר של הקליפה מבפנים, מה שרואים כשעומדים ברצפה הפנימית."
            value={real.materials.inner ?? real.materials.outer}
            options={materialOptions(real.materials.inner)}
            onChange={(v) => setParam('realistic.materials.inner', v)}
          />
        )}
        {shell && (
          <Select
            testId="real-material-floor"
            label="רצפה"
            why="החומר של הרצפה הפנימית, שעליה הולכים."
            value={real.materials.floor ?? real.materials.inner ?? real.materials.outer}
            options={materialOptions(real.materials.floor)}
            onChange={(v) => setParam('realistic.materials.floor', v)}
          />
        )}
      </fieldset>

      <fieldset>
        <legend>
          <h3>סביבה</h3>
        </legend>
        <Select
          testId="real-context"
          label="הקשר"
          why={`${CONTEXTS[context].ground_he}, ${CONTEXTS[context].elements_he}. טביעת הרגל של המבנה נשארת פנויה.`}
          value={context}
          options={contextIds.map((id) => ({ value: id, label: CONTEXTS[id].name_he }))}
          onChange={(v) => setParams([
            ['realistic.context.preset', v],
            ['realistic.context.vegetation', CONTEXTS[v as ContextId].vegetation],
          ])}
        />
        <Select
          testId="real-vegetation"
          label="צמחייה"
          why={`הגוון נגזר מהעונה: ${season.vegetation_he}.`}
          value={vegetation}
          options={Object.values(VEGETATION).map((v) => ({ value: v.id, label: v.name_he }))}
          onChange={(v) => setParam('realistic.context.vegetation', v)}
        />
        <Slider
          testId="real-people"
          label="אנשים"
          why="דמויות בגובה 1.6 עד 1.85 מ'. אדם ליד המבנה הוא סרגל המידה המהיר ביותר."
          value={real.context.people ?? 0}
          min={0}
          max={40}
          step={1}
          display={`${real.context.people ?? 0}`}
          onChange={(v) => setParam('realistic.context.people', v)}
        />
      </fieldset>

      <fieldset data-testid="basis-box">
        <legend>
          <h3>מה מחושב ומה מומחש</h3>
        </legend>
        <p className="hint">כל תצוגה עונה על שאלה אחרת. ממה שמחושב אפשר למדוד ולהסיק. מה שמומחש עוזר לראות, ולא מוכיח דבר.</p>
        <table className="basis">
          <tbody>
            {BASIS.map((b) => (
              <tr key={b.what} data-kind={b.kind}>
                <th scope="row">{b.what}</th>
                <td>
                  <strong>{KIND_HE[b.kind]}</strong>. {b.how}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <fieldset>
        <legend>
          <h3>פרומפט להמחשה</h3>
        </legend>
        <p className="hint">נגזר מהערכים שעל המסך, כך שהתמונה והמודל מספרים את אותו סיפור. כל פרט מגיע משדה במתכון.</p>
        <p className="distill" data-testid="prompt-distill">
          {prompt.distill}
        </p>
        <p className="prompt" data-testid="visual-prompt">
          {prompt.prompt}
        </p>
        <button
          type="button"
          className="primary"
          data-testid="copy-prompt"
          onClick={() =>
            navigator.clipboard?.writeText(`${prompt.distill}\n\n${prompt.prompt}`).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'הועתק' : 'העתקת הפרומפט'}
        </button>
      </fieldset>
    </>
  )
}
