/**
 * The exhibition flyer (DECISIONS.md 127): one page in the magazine format, composed from the project and the
 * atlas, with the model's own line drawn over the image. Every word can be rewritten beside the page, the image
 * chosen from the project's, the ground dark or light. Exports: PDF at A4 or A3, and PNG for sharing.
 */
import '@fontsource/frank-ruhl-libre/400.css'
import '@fontsource/frank-ruhl-libre/700.css'
import '@fontsource/heebo/400.css'
import '@fontsource/heebo/700.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ensureSession, type SessionState } from '../../data/supabase'
import { loadWork, saveArticle, type Work } from '../../data/work'
import { loadImage, type LoadedImage } from '../../dossier/images'
import { accentOf, buildPoster, posterFileName, type PosterEdits, type PosterFormat } from '../../journey/poster'
import { projectName } from '../../journey/stages'
import { FIGURES } from '../../learn/figures'
import { download } from '../download'
import { useOnReturn } from '../freshness'
import { EmailLogin } from '../panels/EmailLogin'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'
import { PosterPage } from '../poster/PosterPage'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function accentFrom(dataUrl: string, tone: 'dark' | 'light') {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, 64, 64)
  return accentOf(ctx.getImageData(0, 0, 64, 64).data, tone)
}

export function PosterScreen() {
  const projectId = useParam('p')
  const [session, setSession] = useState<SessionState | null>(null)
  const [work, setWork] = useState<Work | null>(null)
  const [edits, setEdits] = useState<PosterEdits>({})
  const [loaded, setLoaded] = useState<LoadedImage | null>(null)
  const [accent, setAccent] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [format, setFormat] = useState<PosterFormat>('a4')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return setError('חסר פרויקט בכתובת.')
    setError(null)
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    try {
      const w = await loadWork(projectId)
      setWork(w)
      setEdits(w.row.article?.poster ?? {})
    } catch (e) {
      setError(errText(e))
    }
  }, [projectId])
  useEffect(() => void refresh(), [refresh])
  useOnReturn(refresh, () => !!timer.current || !!busy)

  const poster = useMemo(() => (work ? buildPoster({ ...work.state, journey: work.row.journey }, edits) : null), [work, edits])

  // The image, as data so the export never meets a cross-origin picture, and the accent taken from its light.
  const imageId = poster?.image?.id
  const imageSrc = poster?.image?.src
  useEffect(() => {
    if (!imageSrc) return setLoaded(null)
    let live = true
    void loadImage(imageSrc, 2400)
      .then(async (l) => {
        if (!live) return
        setLoaded(l)
        setAccent(await accentFrom(l.dataUrl, poster!.tone))
      })
      .catch(() => live && setLoaded(null))
    return () => {
      live = false
    }
  }, [imageId, imageSrc, poster?.tone]) // eslint-disable-line react-hooks/exhaustive-deps

  // A link to the video becomes a code on the page (step 8).
  const video = poster?.video
  useEffect(() => {
    if (!video) return setQr(null)
    void import('qrcode').then((QR) => QR.toString(video, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setQr))
  }, [video])

  // The page is A4 at 96 dpi; on a narrow screen it is shown smaller, never cut.
  useLayoutEffect(() => {
    const el = holder.current
    if (!el) return
    const fit = () => page.current?.style.setProperty('zoom', String(Math.min(1, el.clientWidth / 794)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [poster !== null])

  const edit = (patch: Partial<PosterEdits>) => {
    if (!work) return
    const next = { ...edits, ...patch }
    setEdits(next)
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void saveArticle(projectId!, { ...work.row.article, poster: next }).then(
        () => (setSaveState('saved'), (work.row.article = { ...work.row.article, poster: next })),
        () => setSaveState('failed'),
      )
    }, 600)
  }

  const run = async (what: string, job: () => Promise<string>) => {
    setBusy(what)
    setStatus('')
    try {
      setStatus(await job())
    } catch (e) {
      setStatus(`${errText(e)} אפשר לנסות שוב.`)
    } finally {
      setBusy(null)
    }
  }
  const withFullSize = async <T,>(job: (el: HTMLElement) => Promise<T>) => {
    const el = page.current!
    const zoom = el.style.zoom
    el.style.zoom = '1'
    try {
      return await job(el.querySelector<HTMLElement>('.pf-page')!)
    } finally {
      el.style.zoom = zoom
    }
  }
  const exportPdf = () =>
    run('pdf', () =>
      withFullSize(async (el) => {
        const { pagesToPdf } = await import('../../dossier/pdf')
        const blob = await pagesToPdf([el], { title: `${poster!.title1} ${poster!.title2}`.trim(), subject: poster!.modelName }, undefined, format)
        download(blob, blob.type, posterFileName(work!.state, format, 'pdf'))
        return `הפלייר ירד כ-PDF בגודל ${format.toUpperCase()} (${Math.round(blob.size / 1024)} KB).`
      }),
    )
  const exportPng = () =>
    run('png', () =>
      withFullSize(async (el) => {
        const { toBlob, getFontEmbedCSS } = await import('html-to-image')
        const blob = await toBlob(el, { pixelRatio: format === 'a3' ? 3 : 2, fontEmbedCSS: await getFontEmbedCSS(el), cacheBust: false })
        if (!blob) throw new Error('התמונה לא נוצרה.')
        download(blob, 'image/png', posterFileName(work!.state, format, 'png'))
        return `הפלייר ירד כתמונה (${Math.round(blob.size / 1024)} KB), לשיתוף ברשתות.`
      }),
    )

  const name = work ? projectName({ ...work.state, journey: work.row.journey }) : 'פרויקט'
  const figure = useMemo(() => (poster?.modelId ? FIGURES[poster.modelId]?.() : undefined), [poster?.modelId])
  const ready = !!poster && (!poster.image || !!loaded) && !busy
  const field = (key: keyof PosterEdits, label: string, value: string, hint: string, long = false) => (
    <div className="field">
      <label htmlFor={`pf-${key}`}>{label}</label>
      {long ? (
        <textarea id={`pf-${key}`} rows={3} value={value} onChange={(e) => edit({ [key]: e.currentTarget.value })} data-testid={`pf-${key}`} />
      ) : (
        <input id={`pf-${key}`} value={value} onChange={(e) => edit({ [key]: e.currentTarget.value })} data-testid={`pf-${key}`} />
      )}
      <span className="hint">{hint}</span>
    </div>
  )

  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'בית', to: 'home' }, { label: name, to: 'project', params: projectId ? { p: projectId } : undefined }, { label: 'פלייר לתערוכה' }]} />
      <header className="screen">
        <span className="eyebrow">שלב 9 · תיעוד לתערוכה</span>
        <h1>פלייר לתערוכה</h1>
        <p className="lead">עמוד אחד בפורמט של עמוד מגזין: התמונה, הקו של המודל המתמטי עליה, הרעיון במשפט, וארבע תכונות של המודל עם מה שכל אחת עושה למרחב. כל מילה נלקחת מהפרויקט או מהאטלס, ואפשר לשכתב אותה כאן.</p>
      </header>

      {session?.status === 'needs-email' && <EmailLogin why="הפרויקטים שמורים בחשבון." />}
      {error && (
        <div className="notice" role="alert">
          <strong>הפלייר לא נטען</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            ניסיון חוזר
          </button>
        </div>
      )}
      {!poster && !error && session?.status !== 'needs-email' && <p className="hint">טוען את הפרויקט</p>}

      {poster && (
        <div className="pf-layout">
          <aside className="pf-side" aria-label="עריכת הפלייר">
            <div className="toolbar compact">
              <button type="button" className="primary" onClick={exportPdf} disabled={!ready} data-testid="poster-pdf">
                {busy === 'pdf' ? 'מכין PDF' : `PDF ${format.toUpperCase()}`}
              </button>
              <button type="button" onClick={exportPng} disabled={!ready} data-testid="poster-png">
                {busy === 'png' ? 'מכין תמונה' : 'PNG לשיתוף'}
              </button>
              <button type="button" className="quiet" onClick={() => navigate('article', { p: projectId! })}>
                המאמר
              </button>
            </div>
            <p className="hint" role="status" data-testid="poster-status">
              {status || (saveState === 'saving' ? 'שומר את השינויים' : saveState === 'saved' ? 'השינויים נשמרו בפרויקט' : saveState === 'failed' ? 'השינוי לא נשמר. הוא יישמר בעריכה הבאה.' : '')}
            </p>

            <fieldset className="pf-choice">
              <legend>גודל</legend>
              {(['a4', 'a3'] as const).map((f) => (
                <label key={f}>
                  <input type="radio" name="pf-format" checked={format === f} onChange={() => setFormat(f)} data-testid={`pf-format-${f}`} /> {f.toUpperCase()}
                  <span className="hint">{f === 'a4' ? ' לחלוקה ולשיתוף' : ' לתלייה בתערוכה, באותו עימוד ובחדות גבוהה יותר'}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="pf-choice">
              <legend>רקע</legend>
              {(['dark', 'light'] as const).map((t) => (
                <label key={t}>
                  <input type="radio" name="pf-tone" checked={poster.tone === t} onChange={() => edit({ tone: t })} data-testid={`pf-tone-${t}`} /> {t === 'dark' ? 'כהה, טקסט בהיר' : 'בהיר, טקסט כהה'}
                </label>
              ))}
            </fieldset>

            {poster.images.length > 1 && (
              <div className="field">
                <span className="label">התמונה</span>
                <div className="pf-thumbs">
                  {poster.images.slice(0, 12).map((i) => (
                    <button key={i.id} type="button" aria-pressed={poster.image?.id === i.id} onClick={() => edit({ imageId: i.id })} title={i.caption} data-testid="pf-image">
                      <img src={i.src} alt={i.caption} loading="lazy" />
                    </button>
                  ))}
                </div>
                <span className="hint">צבע ההדגשה נלקח מהאור שבתמונה שנבחרה.</span>
              </div>
            )}

            {field('kicker', 'שורת פתיחה', poster.kicker, 'המקום והמושג, מעל התמונה.')}
            {field('title1', 'כותרת, שורה ראשונה', poster.title1, 'שם של רעיון, לא של נושא.')}
            {field('title2', 'כותרת, שורה שנייה', poster.title2, 'בצבע ההדגשה. ברירת המחדל: שם המושג.')}
            {field('maxim', 'הרעיון במשפט אחד', poster.maxim, 'מהמשפט המסכם בשלב 2, או מהרעיון.', true)}
            {field('verse', 'שלוש שורות', edits.verse ?? '', 'לא חובה. תצפית קצרה בשלוש שורות; השורה האחרונה בצבע ההדגשה.', true)}
            {field('question', 'שאלה לסיום', poster.question, 'שאלה לקורא על המקום שלו. מהשאלה שבשלב 1.')}

            {poster.gaps.length > 0 && (
              <div className="ar-gaps" data-testid="poster-gaps">
                <strong>חסר בפלייר</strong>
                <ul>
                  {poster.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
                <button type="button" className="quiet" onClick={() => navigate('project', { p: projectId!, s: 'exhibition' })}>
                  להשלמה בשלבים
                </button>
              </div>
            )}
          </aside>
          <div className="pf-holder" ref={holder}>
            <div className="pf-zoom" ref={page}>
              <PosterPage poster={poster} image={loaded} accent={accent} figure={figure} qr={qr} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
