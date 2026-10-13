/**
 * The "ריאליסטי" tab (LEVELS.md 2): date, hour, place, quick season buttons, weather, materials, context and
 * people, and the visual prompt. Every control writes a field under `realistic`, so none of them rebuilds.
 */
import { useMemo, useState } from 'react'
import { MATERIAL_LOOK } from '../../engine/materials'
import { visualPrompt } from '../../prompt/visualPrompt'
import { atmosphere } from '../../scene/atmosphere'
import { bounds } from '../../scene/cameras'
import { CONTEXTS, MVP_CONTEXTS, VEGETATION, type ContextId, type VegetationId } from '../../scene/contexts/layout'
import { MVP_MATERIALS, type MaterialId } from '../../scene/materials/textures'
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
  withDayOfYear,
  type LocalTime,
  type QuickMoment,
} from '../../scene/sun'
import { windOf } from '../../prompt/visualPrompt'
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
]
const WEATHER_WHY: Record<string, string> = {
  clear: 'שמיים לפי גובה השמש, צל חד וערפל רחוק.',
  haze: 'שמיים מוחלשים וחמים, צל רך וערפל בינוני.',
  overcast: 'אפור אחיד, בלי שמש ישירה: כמעט אין צל, רק אור סביבה.',
}

const materialOptions = (current?: string) => {
  const ids: string[] = [...MVP_MATERIALS]
  if (current && !ids.includes(current)) ids.push(current)
  return ids.map((id) => ({ value: id, label: MATERIAL_LOOK[id as MaterialId].name_he }))
}

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
  const contextIds = MVP_CONTEXTS.includes(context) ? MVP_CONTEXTS : [...MVP_CONTEXTS, context]
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
          <h3>מזג אוויר</h3>
        </legend>
        <Choice testId="real-weather" label="מצב השמיים" why={WEATHER_WHY[real.weather]!} value={real.weather} options={WEATHER} onChange={(v) => setParam('realistic.weather', v)} />
      </fieldset>

      <fieldset>
        <legend>
          <h3>חומרים</h3>
        </legend>
        <Select
          testId="real-material-outer"
          label="מעטפת"
          why="החומר של הפנים החיצוניות. הצפיפות שלו קובעת את המשקל בפאנל המדדים."
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
