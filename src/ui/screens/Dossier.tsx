/**
 * The project's document (DECISIONS.md 92): a flyer and a dossier for sharing a concept with architects.
 * Read from the end to the beginning: the flyer (one image, one sentence, a few numbers), the forms in which the
 * knowledge was distilled, the way back from the print to the concept, and the general method. The same pages
 * become a PDF to share, a Word file to edit, and a printout. Every file can be kept in the collection, with
 * a link that opens without an account.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadCollection, type Collection } from '../../data/collection'
import { listDossiers, saveDossier, shareLink, SHARE_DAYS, type DossierFormat } from '../../data/dossier'
import { loadLibrary, removeItem, type Library, type LibraryItem } from '../../data/library'
import { ensureSession, type SessionState } from '../../data/supabase'
import { buildDossier, dossierFileName, type Dossier, type DossierImage, type DossierStage, type JourneyStep, type Rung } from '../../dossier/content'
import { loadImages, type LoadedImage } from '../../dossier/images'
import { figureGround } from '../../prompt/figureGround'
import { asBuilt, parseRecipe } from '../../recipe/schema'
import { download } from '../download'
import { engine } from '../engine'
import { EmailLogin } from '../panels/EmailLogin'
import { metricRows } from '../panels/MetricsPanel'
import type { Built } from '../params'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

const CAMERA_LABEL: Record<string, string> = { eye_level_oblique: 'גובה עיניים', aerial: 'מבט על', inside: 'בפנים', courtyard: 'מהחצר' }
const STAGE_LABEL: Record<DossierStage, string> = { concept: 'מושג', recipe: 'מתכון', bare: 'ערום', realistic: 'ריאליסטי', render: 'הדמיה', print: 'הדפסה' }
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Every image the collection holds, as the document sees it. */
function imagesOf(c: Collection): DossierImage[] {
  const numberOf = (id: string | null) => c.versions.find((v) => v.id === id)?.number
  const out: DossierImage[] = []
  for (const s of c.stills) {
    if (s.kind !== 'still' || !s.url || !s.stage) continue
    const n = numberOf(s.version_id)
    out.push({
      id: s.id,
      stage: s.stage as DossierStage,
      source: 'still',
      src: s.url,
      caption: [s.stage === 'render' ? 'הדמיה' : 'מבט קפוא', n ? `גרסה ${n}` : null, s.view ? CAMERA_LABEL[s.view.camera.preset] : null, dateShort(s.created_at)].filter(Boolean).join(', '),
      created_at: s.created_at,
    })
  }
  for (const i of c.images) if (i.url) out.push({ id: i.id, stage: 'render', source: 'prompt-image', src: i.url, caption: `תמונה מהפרומפט, ${dateShort(i.created_at)}`, created_at: i.created_at })
  for (const v of c.versions)
    if (v.thumbnail)
      out.push({ id: v.id, stage: 'recipe', source: 'version', src: v.thumbnail, caption: `גרסה ${v.number}${v.note ? `: ${v.note}` : ''}, ${dateShort(v.created_at)}`, created_at: v.created_at })
  return out
}

/** All images a document shows: the cover and the steps. */
const usedImages = (d: Dossier) => {
  const all = [d.cover.image, ...d.journey.flatMap((s) => s.images)].filter((i): i is DossierImage => !!i)
  return [...new Map(all.map((i) => [i.id, i])).values()]
}

// ---------- the pages ----------

function Pic({ img, loaded, className }: { img: DossierImage | null; loaded: Map<string, LoadedImage>; className?: string }) {
  const src = img ? loaded.get(img.id)?.dataUrl : undefined
  return (
    <figure className={`dz-pic ${className ?? ''}`}>
      {src ? <img src={src} alt={img!.caption} /> : <div className="dz-pic-empty">{img ? 'התמונה נטענת' : 'עוד אין תמונה בשלב הזה'}</div>}
      {img && <figcaption>{img.caption}</figcaption>}
    </figure>
  )
}

function Page({ d, n, total, section, children, cover = false }: { d: Dossier; n: number; total: number; section: string; children: React.ReactNode; cover?: boolean }) {
  return (
    <section className={`dz-page${cover ? ' dz-cover' : ''}`} data-testid="dossier-page" aria-label={section}>
      {!cover && (
        <header className="dz-run">
          <span>{d.title} · מסמך פרויקט</span>
          <span>{section}</span>
        </header>
      )}
      <div className="dz-body">{children}</div>
      <footer className="dz-foot">
        <span>מתמטיקה הפוכה · יוצר: מתמטיקה</span>
        <span className="num">
          {n} / {total}
        </span>
      </footer>
    </section>
  )
}

function RungView({ r, i }: { r: Rung; i: number }) {
  return (
    <div className="dz-rung" data-form={r.form}>
      <div className="dz-rung-head">
        <span className="num">{String(i + 1).padStart(2, '0')}</span>
        <strong>{r.form}</strong>
      </div>
      <div className="dz-rung-text">
        <p className="dz-why">{r.why}</p>
        {r.text?.map((t, k) => (
          <p key={k} className={r.form === 'פרומפט' && k === 1 ? 'dz-prompt' : r.form === 'שם' && k === 0 ? 'dz-name' : r.form === 'פתגם' ? 'dz-maxim' : undefined}>
            {t}
          </p>
        ))}
        {r.pairs && (
          <dl>
            {r.pairs.map((p) => (
              <div key={p.label}>
                <dt>{p.label}</dt>
                <dd>
                  {p.value}
                  {p.note && <span className="dz-why">{p.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}

function StepView({ s, loaded }: { s: JourneyStep; loaded: Map<string, LoadedImage> }) {
  return (
    <article className="dz-step" data-stage={s.stage}>
      <header>
        <span className="dz-step-num num">{s.num}</span>
        <div>
          <h3>{s.label}</h3>
          <p className="dz-question">{s.question}</p>
        </div>
      </header>
      <div className={`dz-step-main n${s.images.length}`}>
        {s.images.length > 0 && (
          <div className="dz-step-pics">
            {s.images.map((img) => (
              <Pic key={img.id} img={img} loaded={loaded} />
            ))}
          </div>
        )}
        <div className="dz-step-text">
          {s.decided.length > 0 && (
            <ul className="dz-decided">
              {s.decided.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {s.text.map((t, k) => (
            <p key={k}>{t}</p>
          ))}
        </div>
      </div>
    </article>
  )
}

const DENSE = new Set(['פרשנות', 'מספרים', 'פרומפט', 'מה אבד בתרגום'])

export function DossierPages({ d, loaded }: { d: Dossier; loaded: Map<string, LoadedImage> }) {
  const ladderA = d.ladder.filter((r) => !DENSE.has(r.form))
  const ladderB = d.ladder.filter((r) => DENSE.has(r.form))
  const steps = [d.journey.slice(0, 2), d.journey.slice(2, 4), d.journey.slice(4, 6)]
  const total = 1 + 2 + steps.length + 1
  let n = 0
  return (
    <>
      <Page d={d} n={++n} total={total} section="פלייר" cover>
        <p className="dz-eyebrow">{d.eyebrow}</p>
        <h1 className="dz-title">{d.title}</h1>
        <p className="dz-concept">{d.concept}</p>
        <Pic img={d.cover.image} loaded={loaded} className="dz-hero" />
        <p className="dz-maxim dz-cover-maxim">{d.cover.maxim}</p>
        {d.cover.synthesis && <p className="dz-synthesis">{d.cover.synthesis}</p>}
        {d.cover.short && <p className="dz-short">{d.cover.short}</p>}
        {d.cover.facts.length > 0 && (
          <dl className="dz-facts">
            {d.cover.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className="num">{f.value}</dd>
                {f.sub && <dd className="dz-fact-sub">{f.sub}</dd>}
              </div>
            ))}
          </dl>
        )}
      </Page>

      <Page d={d} n={++n} total={total} section="צורות הזיקוק · 1">
        <h2 className="dz-h2">צורות הזיקוק</h2>
        <p className="dz-lead">אותו ידע בגדלים שונים, מהצורה המרוכזת ביותר אל המפורטת. כל צורה משרתת קורא אחר ורגע אחר.</p>
        <div className="dz-ladder">
          {ladderA.map((r) => (
            <RungView key={r.form} r={r} i={d.ladder.indexOf(r)} />
          ))}
        </div>
      </Page>
      <Page d={d} n={++n} total={total} section="צורות הזיקוק · 2">
        <div className="dz-ladder">
          {ladderB.map((r) => (
            <RungView key={r.form} r={r} i={d.ladder.indexOf(r)} />
          ))}
        </div>
      </Page>

      {steps.map((pair, k) => (
        <Page key={k} d={d} n={++n} total={total} section={`הדרך לאחור · ${k + 1}`}>
          {k === 0 && (
            <>
              <h2 className="dz-h2">הדרך לאחור: מההדפסה אל המושג</h2>
              <p className="dz-lead">כל תחנה עונה על שאלה אחת בין המתמטיקה לאדריכלות. כל תמונה שייכת לגרסה ולנקודת מבט שאפשר לפתוח מחדש.</p>
            </>
          )}
          {pair.map((s) => (
            <StepView key={s.stage} s={s} loaded={loaded} />
          ))}
        </Page>
      ))}

      <Page d={d} n={++n} total={total} section="השיטה">
        <h2 className="dz-h2">השיטה: מהרעיון לביצוע</h2>
        <div className="dz-method">
          {d.method.map((m) => (
            <section key={m.title}>
              <h3>{m.title}</h3>
              {m.text?.map((t, k) => (
                <p key={k}>{t}</p>
              ))}
              {m.pairs && (
                <dl>
                  {m.pairs.map((p) => (
                    <div key={p.label}>
                      <dt>{p.label}</dt>
                      <dd>{p.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>
        <div className="dz-colophon">
          {d.colophon.map((c) => (
            <p key={c}>{c}</p>
          ))}
        </div>
      </Page>
    </>
  )
}

// ---------- the screen ----------

interface Source {
  collection: Collection
  library: Library
  recipe: Built
  metrics: { label: string; value: string }[]
  fg: { label: string; value: string; why: string }[]
}

export function DossierScreen() {
  const projectId = useParam('p')
  const [session, setSession] = useState<SessionState | null>(null)
  const [src, setSrc] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Map<string, LoadedImage>>(new Map())
  const [coverId, setCoverId] = useState<string | null>(null)
  const [saved, setSaved] = useState<LibraryItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const sheets = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return setError('חסר פרויקט בכתובת.')
    setError(null)
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    try {
      const [collection, library, docs] = await Promise.all([loadCollection(projectId), loadLibrary(projectId), listDossiers(projectId)])
      setSaved(docs)
      const parsed = collection.latest ? parseRecipe(collection.latest.recipe) : null
      const recipe = parsed?.ok ? asBuilt(parsed.recipe) : null
      if (!recipe) {
        setError('בפרויקט עוד אין גרסה שאפשר לבנות ממנה מסמך. שומרים גרסה בסטודיו, ואז חוזרים לכאן.')
        return
      }
      let metrics: Source['metrics'] = []
      let fg: Source['fg'] = []
      const built = await engine.build(recipe).catch(() => null)
      if (built?.status === 'done' && built.result.ok) {
        metrics = metricRows(built.result.metrics, recipe).map((r) => ({ label: r.label, value: r.value }))
        fg = figureGround(built.result.metrics, recipe.bare.mode === 'shell').map((r) => ({ label: r.label, value: r.value, why: r.why }))
      }
      setSrc({ collection, library, recipe, metrics, fg })
    } catch (e) {
      setError(errText(e))
    }
  }, [projectId])
  useEffect(() => void refresh(), [refresh])

  const all = useMemo(() => (src ? imagesOf(src.collection) : []), [src])
  const dossier = useMemo(() => {
    if (!src) return null
    const c = src.collection
    const post = src.library.posts[0]
    const prompt = src.library.prompts[0]
    return buildDossier({
      recipe: src.recipe,
      projectTitle: c.project.title_he ?? src.recipe.narrative.name_he,
      versions: c.versions.map((v) => ({ number: v.number, created_at: v.created_at, note: v.note })),
      images: all,
      reading: c.reading,
      post: post ? { short: post.distill ?? '', body: post.body ?? '' } : null,
      prompt: prompt ? { distill: prompt.distill ?? '', body: prompt.body ?? '' } : null,
      metrics: src.metrics,
      figureGround: src.fg,
      print: [...c.stills].reverse().find((s) => s.kind === 'print')?.distill ?? null,
      hasClip: c.stills.some((s) => s.kind === 'clip'),
      coverId,
    })
  }, [src, all, coverId])

  // Images load once each; a new cover only loads what is missing.
  useEffect(() => {
    if (!dossier) return
    const missing = usedImages(dossier).filter((i) => !loaded.has(i.id))
    if (!missing.length) return
    let live = true
    void loadImages(missing).then((m) => live && setLoaded((prev) => new Map([...prev, ...m])))
    return () => {
      live = false
    }
  }, [dossier, loaded])

  // A4 pages are 794 px wide; on a narrow screen they are zoomed out, never scrolled sideways.
  useLayoutEffect(() => {
    const el = holder.current
    if (!el) return
    const fit = () => sheets.current?.style.setProperty('zoom', String(Math.min(1, el.clientWidth / 794)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dossier])

  const ready = !!dossier && usedImages(dossier).every((i) => loaded.has(i.id) || !i.src)
  const pages = () => [...(sheets.current?.querySelectorAll<HTMLElement>('.dz-page') ?? [])]

  /** Pages are captured at full size, whatever the zoom on screen. */
  const makePdf = async () => {
    const el = sheets.current!
    const zoom = el.style.zoom
    el.style.zoom = '1'
    try {
      const { pagesToPdf } = await import('../../dossier/pdf')
      const list = pages()
      return await pagesToPdf(list, { title: `${dossier!.title} · מסמך פרויקט`, subject: dossier!.cover.maxim }, (k) => setStatus(`מכין PDF: עמוד ${k} מתוך ${list.length}`))
    } finally {
      el.style.zoom = zoom
    }
  }
  const makeDocx = async () => {
    const { dossierDocx } = await import('../../dossier/docx')
    return dossierDocx(dossier!, loaded)
  }
  const make = (f: DossierFormat) => (f === 'pdf' ? makePdf() : makeDocx())

  const run = async (what: string, job: () => Promise<string>) => {
    setBusy(what)
    setStatus(what === 'pdf' ? 'מכין PDF' : 'עובד')
    try {
      setStatus(await job())
    } catch (e) {
      setStatus(`${errText(e)}. אפשר לנסות שוב.`)
    } finally {
      setBusy(null)
    }
  }

  const downloadAs = (f: DossierFormat) =>
    run(f, async () => {
      const blob = await make(f)
      download(blob, blob.type, dossierFileName(dossier!, f))
      return f === 'pdf' ? `ה-PDF ירד (${Math.round(blob.size / 1024)} KB).` : `קובץ ה-Word ירד (${Math.round(blob.size / 1024)} KB). אפשר לערוך בו כל מילה.`
    })

  const keep = async (f: DossierFormat) => {
    const blob = await make(f)
    const item = await saveDossier({ projectId: projectId!, versionId: src!.collection.latest?.id ?? null, format: f, blob, fileName: dossierFileName(dossier!, f) })
    setSaved((s) => [item, ...s])
    return item
  }

  const saveBoth = () =>
    run('save', async () => {
      await keep('pdf')
      await keep('docx')
      return 'ה-PDF וקובץ ה-Word נשמרו בקולקציה.'
    })

  const share = () =>
    run('share', async () => {
      const blob = await makePdf()
      const name = dossierFileName(dossier!, 'pdf')
      const file = new File([blob], name, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: dossier!.title, text: dossier!.cover.maxim })
          return 'המסמך נשלח.'
        } catch (e) {
          if ((e as Error).name === 'AbortError') return 'השיתוף בוטל.'
        }
      }
      const item = await saveDossier({ projectId: projectId!, versionId: src!.collection.latest?.id ?? null, format: 'pdf', blob, fileName: name })
      setSaved((s) => [item, ...s])
      const link = await shareLink(item)
      const copied = await navigator.clipboard?.writeText(link).then(
        () => true,
        () => false,
      )
      return copied ? `הקישור הועתק. הוא פותח את ה-PDF בלי חשבון, למשך ${SHARE_DAYS} יום.` : `הקישור, למשך ${SHARE_DAYS} יום: ${link}`
    })

  const copyLink = (item: LibraryItem) =>
    run('link', async () => {
      const link = await shareLink(item)
      const ok = await navigator.clipboard?.writeText(link).then(
        () => true,
        () => false,
      )
      return ok ? `הקישור הועתק, פתוח ${SHARE_DAYS} יום.` : link
    })

  const remove = (item: LibraryItem) =>
    run('remove', async () => {
      await removeItem(item)
      setSaved((s) => s.filter((x) => x.id !== item.id))
      return 'המסמך נמחק מהקולקציה. קישורים שכבר נשלחו מפסיקים לעבוד.'
    })

  const title = dossier?.title ?? src?.collection.project.title_he ?? 'מסמך פרויקט'
  const projectCrumb = src?.collection.project.title_he ?? 'פרויקט'
  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'פרויקטים', to: 'projects' }, { label: projectCrumb }, { label: 'קולקציה', to: 'collection', params: projectId ? { p: projectId } : undefined }, { label: 'מסמך' }]} />
      <header className="screen">
        <span className="eyebrow">מסמך פרויקט · {dossier?.concept ?? ''}</span>
        <h1>{title}</h1>
        <p className="lead">פלייר ומסמך לשיתוף עם אדריכלים, מהסוף להתחלה: התמונה והמשפט, צורות הזיקוק של הידע, הדרך מההדפסה אל המושג, והשיטה. נבנה מהקולקציה ומתעדכן איתה.</p>
      </header>

      {session?.status === 'needs-email' && <EmailLogin why="המסמך נבנה מהקולקציה שבחשבון." />}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <div className="toolbar compact">
            <button type="button" onClick={refresh}>
              ניסיון חוזר
            </button>
            <button type="button" onClick={() => (projectId ? navigate('collection', { p: projectId }) : navigate('projects'))}>
              חזרה לקולקציה
            </button>
          </div>
        </div>
      )}
      {!dossier && !error && session?.status !== 'needs-email' && (
        <p className="hint" role="status">
          בונה את המסמך מהקולקציה
        </p>
      )}

      {dossier && (
        <div className="dossier-layout">
          <aside className="dossier-tools" aria-label="ייצוא ושיתוף">
            <section>
              <h2>ייצוא</h2>
              <div className="toolbar compact">
                <button type="button" className="primary" onClick={() => downloadAs('pdf')} disabled={!ready || !!busy} data-testid="dossier-pdf">
                  {busy === 'pdf' ? 'מכין PDF' : 'הורדת PDF'}
                </button>
                <button type="button" onClick={() => downloadAs('docx')} disabled={!ready || !!busy} data-testid="dossier-docx">
                  {busy === 'docx' ? 'מכין Word' : 'הורדת Word לעריכה'}
                </button>
                <button type="button" onClick={() => window.print()} disabled={!!busy}>
                  הדפסה
                </button>
              </div>
              <p className="hint">PDF לשיתוף, כפי שהעמודים נראים כאן. Word לעריכה: כל מילה ותמונה ניתנות לשינוי. הדפסה מהדפדפן נותנת PDF עם טקסט שאפשר לסמן.</p>
            </section>
            <section>
              <h2>שיתוף</h2>
              <div className="toolbar compact">
                <button type="button" className="primary" onClick={share} disabled={!ready || !!busy} data-testid="dossier-share">
                  {busy === 'share' ? 'מכין קישור' : 'שיתוף'}
                </button>
                <button type="button" onClick={saveBoth} disabled={!ready || !!busy} data-testid="dossier-save">
                  {busy === 'save' ? 'שומר' : 'שמירה בקולקציה'}
                </button>
              </div>
              <p className="hint">בטלפון נפתח חלון השיתוף עם קובץ ה-PDF. במחשב המסמך נשמר בקולקציה, והקישור אליו מועתק. הקישור פותח את הקובץ בלי חשבון, למשך {SHARE_DAYS} יום.</p>
            </section>
            {all.length > 0 && (
              <section>
                <h2>תמונת השער</h2>
                <label className="field">
                  <select value={coverId ?? dossier.cover.image?.id ?? ''} onChange={(e) => setCoverId(e.currentTarget.value)} data-testid="dossier-cover">
                    {all.map((i) => (
                      <option key={i.id} value={i.id}>
                        {STAGE_LABEL[i.stage]}: {i.caption}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">ברירת המחדל היא ההדמיה האחרונה. אחריה: תמונה מהפרומפט, מבט ריאליסטי, מבט ערום.</p>
              </section>
            )}
            <p className="hint" role="status" data-testid="dossier-status">
              {status || (ready ? `${usedImages(dossier).length} תמונות, 7 עמודים.` : `טוען תמונות: ${usedImages(dossier).filter((i) => loaded.has(i.id)).length} מתוך ${usedImages(dossier).length}`)}
            </p>
            {saved.length > 0 && (
              <section>
                <h2>בקולקציה</h2>
                <ul className="dossier-saved" data-testid="dossier-saved">
                  {saved.map((s) => (
                    <li key={s.id}>
                      <span>
                        {s.image_path?.endsWith('.docx') ? 'Word' : 'PDF'} · {when(s.created_at)}
                      </span>
                      <div className="toolbar compact">
                        <button type="button" onClick={() => copyLink(s)} disabled={!!busy}>
                          העתקת קישור
                        </button>
                        <button type="button" className="quiet" onClick={() => confirm('למחוק את המסמך מהקולקציה?') && remove(s)} disabled={!!busy}>
                          מחיקה
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
          <div className="dossier-holder" ref={holder}>
            <div className="dossier-sheets" ref={sheets} data-testid="dossier">
              <DossierPages d={dossier} loaded={loaded} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
