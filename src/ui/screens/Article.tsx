/**
 * The exhibition article (DECISIONS.md 97): the project's story from the idea to the built model, composed from
 * everything the project holds. Two modes: a preview in A4 pages, exactly as it exports, and editing, where every
 * section's text can be rewritten and every gap leads to the step that fills it. Edits are kept on the project.
 * Exports: PDF for the exhibition, Word for further editing, and the browser's print.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ensureSession, type SessionState } from '../../data/supabase'
import { loadWork, saveArticle, type Work } from '../../data/work'
import { loadImages, type LoadedImage } from '../../dossier/images'
import { paginate } from '../../journey/paginate'
import { articleFileName, buildArticle, type Article, type ArticleEdits, type ArticleSection, type SectionKey } from '../../journey/article'
import { projectName, stageById, type WorkImage } from '../../journey/stages'
import { download } from '../download'
import { engine } from '../engine'
import { EmailLogin } from '../panels/EmailLogin'
import { metricRows } from '../panels/MetricsPanel'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- blocks: the article cut into pieces that pages are filled with ----------

interface Block {
  key: string
  /** A heading stays with what follows it. */
  keep?: boolean
  node: React.ReactNode
}

function Fig({ img, loaded }: { img: WorkImage; loaded: Map<string, LoadedImage> }) {
  const src = loaded.get(img.id)?.dataUrl
  return (
    <figure className="ar-fig">
      {src ? <img src={src} alt={img.caption} /> : <div className="ar-fig-empty">התמונה נטענת</div>}
      <figcaption>{img.caption}</figcaption>
    </figure>
  )
}

function blocksOf(a: Article, loaded: Map<string, LoadedImage>): Block[] {
  const out: Block[] = [
    {
      key: 'head',
      node: (
        <header className="ar-head">
          {a.byline && <p className="ar-byline">{a.byline}</p>}
          <h1 className="ar-title">{a.title}</h1>
          {a.subtitle && <p className="ar-subtitle">{a.subtitle}</p>}
        </header>
      ),
    },
  ]
  if (a.cover) out.push({ key: 'cover', node: <Fig img={a.cover} loaded={loaded} /> })
  if (a.lead) out.push({ key: 'lead', node: <p className="ar-lead">{a.lead}</p> })
  for (const s of a.sections) {
    if (!s.paras.length && !s.figures.length && !s.quote && !s.facts.length) continue
    out.push({
      key: `${s.key}-h`,
      keep: true,
      node: (
        <h2 className="ar-h2">
          <span className="num">{s.num}</span> {s.heading}
        </h2>
      ),
    })
    s.paras.forEach((p, i) => out.push({ key: `${s.key}-p${i}`, node: <p className="ar-p">{p}</p> }))
    if (s.quote) out.push({ key: `${s.key}-q`, node: <blockquote className="ar-quote">{s.quote}</blockquote> })
    if (s.figures.length)
      out.push({
        key: `${s.key}-f`,
        node: (
          <div className={`ar-figs n${s.figures.length}`}>
            {s.figures.map((f) => (
              <Fig key={f.id} img={f} loaded={loaded} />
            ))}
          </div>
        ),
      })
    if (s.facts.length)
      out.push({
        key: `${s.key}-x`,
        node: (
          <dl className="ar-facts">
            {s.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className="num">{f.value}</dd>
              </div>
            ))}
          </dl>
        ),
      })
  }
  out.push({
    key: 'colophon',
    node: (
      <div className="ar-colophon">
        {a.colophon.map((c) => (
          <p key={c}>{c}</p>
        ))}
      </div>
    ),
  })
  return out
}

function ArticlePages({ a, loaded, sheetsRef }: { a: Article; loaded: Map<string, LoadedImage>; sheetsRef: React.RefObject<HTMLDivElement | null> }) {
  const blocks = useMemo(() => blocksOf(a, loaded), [a, loaded])
  const measure = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number[][] | null>(null)
  useLayoutEffect(() => {
    const el = measure.current
    if (!el) return
    const kids = [...el.children] as HTMLElement[]
    const heights = kids.map((k) => {
      const cs = getComputedStyle(k)
      return k.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
    })
    setPages(
      paginate(
        heights,
        blocks.map((b) => !!b.keep),
      ),
    )
  }, [blocks])
  return (
    <>
      <div className="ar-measure ar-body" ref={measure} aria-hidden="true">
        {blocks.map((b) => (
          <div key={b.key}>{b.node}</div>
        ))}
      </div>
      <div className="dossier-sheets" ref={sheetsRef} data-testid="article-pages">
        {(pages ?? [blocks.map((_, i) => i)]).map((ids, n, all) => (
          <section key={n} className="dz-page ar-page" data-testid="article-page">
            {n > 0 && (
              <header className="dz-run">
                <span>{a.title}</span>
                <span>{a.byline ?? 'מאמר לתערוכה'}</span>
              </header>
            )}
            <div className="ar-body">
              {ids.map((i) => (
                <div key={blocks[i]!.key}>{blocks[i]!.node}</div>
              ))}
            </div>
            <footer className="dz-foot">
              <span>מתמטיקה הפוכה · יוצר: מתמטיקה</span>
              <span className="num">
                {n + 1} / {all.length}
              </span>
            </footer>
          </section>
        ))}
      </div>
    </>
  )
}

// ---------- editing ----------

function SectionEditor({ s, onEdit, onReset, goStage }: { s: ArticleSection; onEdit: (text: string) => void; onReset: () => void; goStage: (id: string) => void }) {
  const [text, setText] = useState(s.paras.join('\n\n'))
  // Only an undone edit, or new materials under an unedited section, replace what is in the box.
  const composed = s.composed.join('\n\n')
  useEffect(() => {
    if (!s.edited) setText(composed)
  }, [s.edited, composed])
  return (
    <section className="ar-edit-section" data-testid={`edit-${s.key}`} data-edited={s.edited}>
      <h2>
        <span className="num">{s.num}</span> {s.heading}
      </h2>
      {s.gaps.map((g) => (
        <p key={g.text} className="ar-gap" data-testid="gap">
          <strong>חסר: </strong>
          {g.text}.{' '}
          <button type="button" className="quiet" onClick={() => goStage(g.stage)}>
            להשלמה בשלב {stageById(g.stage)!.num}, {stageById(g.stage)!.title}
          </button>
        </p>
      ))}
      <textarea
        rows={Math.max(3, Math.min(14, Math.ceil(text.length / 80) + s.paras.length))}
        value={text}
        placeholder="אין עדיין טקסט מהחומרים. אפשר לכתוב כאן, או להשלים בשלב."
        onChange={(e) => {
          setText(e.currentTarget.value)
          onEdit(e.currentTarget.value)
        }}
        dir="auto"
        data-testid={`edit-text-${s.key}`}
      />
      <div className="toolbar compact">
        <span className="hint">{s.edited ? 'נערך ידנית. החומרים בשלבים לא משתנים.' : 'מורכב מהחומרים של השלבים. עריכה כאן גוברת עליהם.'}</span>
        {s.edited && (
          <button type="button" className="quiet" onClick={onReset} data-testid={`reset-${s.key}`}>
            חזרה לטקסט מהחומרים
          </button>
        )}
      </div>
      {s.quote && <blockquote className="ar-quote">{s.quote}</blockquote>}
      {s.figures.length > 0 && (
        <p className="hint">
          {s.figures.length === 1 ? 'תמונה אחת' : `${s.figures.length} תמונות`}: {s.figures.map((f) => f.caption).join(' | ')}
        </p>
      )}
    </section>
  )
}

// ---------- the screen ----------

export function ArticleScreen() {
  const projectId = useParam('p')
  const [session, setSession] = useState<SessionState | null>(null)
  const [work, setWork] = useState<Work | null>(null)
  const [metrics, setMetrics] = useState<{ label: string; value: string }[]>([])
  const [edits, setEdits] = useState<ArticleEdits>({})
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [loaded, setLoaded] = useState<Map<string, LoadedImage>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const sheets = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return setError('חסר פרויקט בכתובת.')
    setError(null)
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    try {
      const w = await loadWork(projectId)
      setWork(w)
      setEdits(w.row.article ?? {})
      if (w.state.recipe) {
        const built = await engine.build(w.state.recipe).catch(() => null)
        if (built?.status === 'done' && built.result.ok) setMetrics(metricRows(built.result.metrics, w.state.recipe).map((r) => ({ label: r.label, value: r.value })))
      }
    } catch (e) {
      setError(errText(e))
    }
  }, [projectId])
  useEffect(() => void refresh(), [refresh])

  const article = useMemo(() => (work ? buildArticle({ ...work.state, metrics }, edits) : null), [work, metrics, edits])
  const images = useMemo(() => (article ? [article.cover, ...article.sections.flatMap((s) => s.figures)].filter((i): i is WorkImage => !!i && !!i.src) : []), [article])
  useEffect(() => {
    const missing = images.filter((i) => !loaded.has(i.id))
    if (!missing.length) return
    let live = true
    void loadImages(missing.map((i) => ({ id: i.id, src: i.src! }))).then((m) => live && setLoaded((prev) => new Map([...prev, ...m])))
    return () => {
      live = false
    }
  }, [images, loaded])
  const ready = images.every((i) => loaded.has(i.id))

  useLayoutEffect(() => {
    const el = holder.current
    if (!el || mode !== 'preview') return
    const fit = () => sheets.current?.style.setProperty('zoom', String(Math.min(1, el.clientWidth / 794)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, article])

  const persist = (next: ArticleEdits) => {
    setEdits(next)
    if (timer.current) clearTimeout(timer.current)
    setStatus('שומר')
    timer.current = setTimeout(() => {
      saveArticle(projectId!, next).then(
        () => setStatus('העריכה נשמרה בפרויקט.'),
        (e) => setStatus(`השמירה נכשלה: ${errText(e)}. העריכה נשארת כאן ונשלחת שוב בשינוי הבא.`),
      )
    }, 700)
  }
  const editSection = (key: SectionKey, text: string) => persist({ ...edits, sections: { ...edits.sections, [key]: text } })
  const resetSection = (key: SectionKey) => {
    const rest = { ...edits.sections }
    delete rest[key]
    persist({ ...edits, sections: rest })
  }

  const run = async (what: string, job: () => Promise<string>) => {
    setBusy(what)
    try {
      setStatus(await job())
    } catch (e) {
      setStatus(`${errText(e)}. אפשר לנסות שוב.`)
    } finally {
      setBusy(null)
    }
  }
  const exportPdf = () =>
    run('pdf', async () => {
      const el = sheets.current!
      const zoom = el.style.zoom
      el.style.zoom = '1'
      try {
        const { pagesToPdf } = await import('../../dossier/pdf')
        const pages = [...el.querySelectorAll<HTMLElement>('.ar-page')]
        const blob = await pagesToPdf(pages, { title: article!.title, subject: article!.subtitle ?? '' }, (k) => setStatus(`מכין PDF: עמוד ${k} מתוך ${pages.length}`))
        download(blob, blob.type, articleFileName(work!.state, 'pdf'))
        return `ה-PDF ירד: ${pages.length} עמודים, ${Math.round(blob.size / 1024)} KB.`
      } finally {
        el.style.zoom = zoom
      }
    })
  const exportDocx = () =>
    run('docx', async () => {
      const { articleDocx } = await import('../../journey/docx')
      const blob = await articleDocx(article!, loaded)
      download(blob, blob.type, articleFileName(work!.state, 'docx'))
      return `קובץ ה-Word ירד (${Math.round(blob.size / 1024)} KB). אפשר לערוך בו כל מילה.`
    })

  const goStage = (id: string) => navigate('project', { p: projectId!, s: id })
  const name = work ? projectName({ ...work.state, journey: work.row.journey }) : 'פרויקט'
  const editedCount = article?.sections.filter((s) => s.edited).length ?? 0

  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'בית', to: 'home' }, { label: name, to: 'project', params: projectId ? { p: projectId } : undefined }, { label: 'מאמר לתערוכה' }]} />
      <header className="screen">
        <span className="eyebrow">שלב 09 · מאמר לתערוכה</span>
        <h1>{article?.title ?? 'מאמר'}</h1>
        <p className="lead">הסיפור של הפרויקט מהרעיון ועד התוצאה, מכל מה שנכתב ונוצר בשלבים. שום דבר לא נכתב במקום חומר שחסר: חלק חסר מסומן ומוביל לשלב שבו משלימים אותו.</p>
      </header>

      {session?.status === 'needs-email' && <EmailLogin why="המאמר נבנה מהפרויקט שבחשבון." />}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <div className="toolbar compact">
            <button type="button" onClick={refresh}>
              ניסיון חוזר
            </button>
            <button type="button" onClick={() => navigate('home')}>
              לדף הבית
            </button>
          </div>
        </div>
      )}
      {!article && !error && session?.status !== 'needs-email' && (
        <p className="hint" role="status">
          מרכיב את המאמר מהפרויקט
        </p>
      )}

      {article && (
        <div className="dossier-layout">
          <aside className="dossier-tools" aria-label="מצב, חוסרים וייצוא">
            <section>
              <div className="seg" role="tablist" aria-label="מצב">
                <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')} data-testid="mode-preview">
                  תצוגה מקדימה
                </button>
                <button type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => setMode('edit')} data-testid="mode-edit">
                  עריכה
                </button>
              </div>
              <p className="hint">{editedCount ? `${editedCount} חלקים נערכו ידנית.` : 'כל הטקסט מורכב מהחומרים של השלבים.'}</p>
            </section>
            <section>
              <h2>ייצוא</h2>
              <div className="toolbar compact">
                <button type="button" className="primary" onClick={() => (setMode('preview'), setTimeout(exportPdf, 50))} disabled={!ready || !!busy} data-testid="article-pdf">
                  {busy === 'pdf' ? 'מכין PDF' : 'PDF לתערוכה'}
                </button>
                <button type="button" onClick={exportDocx} disabled={!ready || !!busy} data-testid="article-docx">
                  {busy === 'docx' ? 'מכין Word' : 'Word לעריכה'}
                </button>
                <button type="button" onClick={() => (setMode('preview'), setTimeout(() => window.print(), 50))} disabled={!!busy}>
                  הדפסה
                </button>
              </div>
              <p className="hint">הקבצים כוללים רק את המאמר. סימוני החוסר נשארים כאן.</p>
              {work?.state.recipe && (
                <button type="button" className="quiet" onClick={() => navigate('dossier', { p: projectId! })}>
                  פלייר הפרויקט
                </button>
              )}
            </section>
            <section>
              <h2>חסר ({article.gaps.length})</h2>
              {article.gaps.length === 0 ? (
                <p className="hint">כל החלקים מלאים.</p>
              ) : (
                <ul className="ar-gaps" data-testid="article-gaps">
                  {article.gaps.map((g) => (
                    <li key={`${g.stage}-${g.text}`}>
                      <button type="button" className="quiet" onClick={() => goStage(g.stage)}>
                        <span className="num">{stageById(g.stage)!.num}</span> {g.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="hint" role="status" data-testid="article-status">
              {status || (ready ? '' : 'טוען תמונות')}
            </p>
          </aside>

          <div className="dossier-holder" ref={holder}>
            {mode === 'preview' ? (
              <ArticlePages a={article} loaded={loaded} sheetsRef={sheets} />
            ) : (
              <div className="ar-editor" data-testid="article-editor">
                <p className="hint">כל חלק מורכב מהחומרים של השלב שלו. כתיבה כאן גוברת עליהם, ו"חזרה לטקסט מהחומרים" מבטלת את העריכה. פסקאות מופרדות בשורה ריקה.</p>
                {article.sections.map((s) => (
                  <SectionEditor key={s.key} s={s} onEdit={(t) => editSection(s.key, t)} onReset={() => resetSection(s.key)} goStage={goStage} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
