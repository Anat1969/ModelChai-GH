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
import { useOnReturn } from '../freshness'
import { flow, type FlowItem, type Placement } from '../../journey/paginate'
import { articleFileName, articleMaterials, buildArticle, SECTION_KEYS, type Article, type ArticleEdits, type ArticleSection, type SectionKey } from '../../journey/article'
import { projectName, stageById, type WorkImage } from '../../journey/stages'
import { download } from '../download'
import { engine } from '../engine'
import { EmailLogin } from '../panels/EmailLogin'
import { metricRows } from '../panels/MetricsPanel'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- blocks: the article cut into pieces that pages are filled with ----------

/** A paragraph's sentences, so a page can end between two of them (DECISIONS.md 126). */
export const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?:;׃])\s+(?=\S)/).filter(Boolean)

interface Block {
  key: string
  /** A heading stays with what follows it. */
  keep?: boolean
  /** The section, so a figure waits only for its own text. */
  group?: string
  /** A paragraph, cut into sentences. */
  sentences?: string[]
  figure?: boolean
  render: (p?: Placement) => React.ReactNode
}

function Fig({ img, loaded, maxH }: { img: WorkImage; loaded: Map<string, LoadedImage>; maxH?: number }) {
  const l = loaded.get(img.id)
  // The image keeps its own proportions; width and height are set before it decodes, so the page is measured right.
  return (
    <figure className="ar-fig">
      {l ? (
        <img src={l.dataUrl} alt={img.caption} width={l.width} height={l.height} style={{ aspectRatio: `${l.width} / ${l.height}`, ...(maxH ? { maxBlockSize: maxH } : {}) }} />
      ) : (
        <div className="ar-fig-empty">התמונה נטענת</div>
      )}
      <figcaption>{img.caption}</figcaption>
    </figure>
  )
}

function para(key: string, group: string, text: string): Block {
  const sentences = sentencesOf(text)
  return {
    key,
    group,
    sentences,
    render: (p) => {
      const from = p?.from ?? 0
      const to = p?.to ?? sentences.length
      // A paragraph cut at the foot is justified to its last line, so it reads on into the next page.
      return <p className={`ar-p${to < sentences.length ? ' ar-p-cut' : ''}${from > 0 ? ' ar-p-cont' : ''}`}>{sentences.slice(from, to).join(' ')}</p>
    },
  }
}

function blocksOf(a: Article, loaded: Map<string, LoadedImage>): Block[] {
  const out: Block[] = [
    {
      key: 'head',
      group: 'head',
      render: () => (
        <header className="ar-head">
          {a.byline && <p className="ar-byline">{a.byline}</p>}
          <h1 className="ar-title">{a.title}</h1>
          {a.subtitle && <p className="ar-subtitle">{a.subtitle}</p>}
        </header>
      ),
    },
  ]
  if (a.cover) out.push({ key: 'cover', group: 'head', figure: true, render: (p) => <Fig img={a.cover!} loaded={loaded} maxH={p?.imgH} /> })
  if (a.lead) out.push({ key: 'lead', group: 'head', render: () => <p className="ar-lead">{a.lead}</p> })
  for (const s of a.sections) {
    if (!s.paras.length && !s.figures.length && !s.quote && !s.facts.length) continue
    const g = s.key
    out.push({
      key: `${s.key}-h`,
      keep: true,
      group: g,
      render: () => (
        <h2 className="ar-h2">
          <span className="num">{s.num}</span> {s.heading}
        </h2>
      ),
    })
    const figs: Block | null = s.figures.length
      ? {
          key: `${s.key}-f`,
          group: g,
          figure: true,
          render: (p) => (
            <div className={`ar-figs n${s.figures.length}`}>
              {s.figures.map((f) => (
                <Fig key={f.id} img={f} loaded={loaded} maxH={p?.imgH} />
              ))}
            </div>
          ),
        }
      : null
    // The figures stand after the section's first paragraph, so the rest of the text can fill a page around them.
    s.paras.forEach((t, i) => {
      out.push(para(`${s.key}-p${i}`, g, t))
      if (i === 0 && figs) out.push(figs)
    })
    if (!s.paras.length && figs) out.push(figs)
    if (s.quote) out.push({ key: `${s.key}-q`, group: g, render: () => <blockquote className="ar-quote">{s.quote}</blockquote> })
    if (s.facts.length)
      out.push({
        key: `${s.key}-x`,
        group: g,
        render: () => (
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
    group: 'end',
    render: () => (
      <div className="ar-colophon">
        {a.colophon.map((c) => (
          <p key={c}>{c}</p>
        ))}
      </div>
    ),
  })
  return out
}

const outer = (el: HTMLElement) => {
  const cs = getComputedStyle(el)
  return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
}

function Sheet({ a, n, total, children, probe }: { a: Article; n: number; total: number; children?: React.ReactNode; probe?: boolean }) {
  return (
    <section className="dz-page ar-page" data-testid={probe ? undefined : 'article-page'}>
      {n > 0 && (
        <header className="dz-run">
          <span>{a.title}</span>
          <span>{a.byline ?? 'מאמר לתערוכה'}</span>
        </header>
      )}
      <div className="ar-body">{children}</div>
      <footer className="dz-foot">
        <span>מתמטיקה הפוכה · יוצר: מתמטיקה</span>
        <span className="num">
          {n + 1} / {total}
        </span>
      </footer>
    </section>
  )
}

function ArticlePages({ a, loaded, sheetsRef }: { a: Article; loaded: Map<string, LoadedImage>; sheetsRef: React.RefObject<HTMLDivElement | null> }) {
  const blocks = useMemo(() => blocksOf(a, loaded), [a, loaded])
  const measure = useRef<HTMLDivElement>(null)
  const scratch = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<Placement[][] | null>(null)
  useLayoutEffect(() => {
    const el = measure.current
    const sc = scratch.current
    const pr = probe.current
    if (!el || !sc || !pr) return
    // The room on a page is read from empty pages laid out like the real ones: the first has no running head.
    const bodies = [...pr.querySelectorAll('.ar-body')] as HTMLElement[]
    const caps = bodies.map((b) => b.clientHeight - 4)
    const kids = [...el.children] as HTMLElement[]
    const items: FlowItem[] = blocks.map((b, i) => {
      const k = kids[i]!
      const h = outer(k)
      if (b.figure) {
        const img = Math.max(0, ...[...k.querySelectorAll('img, .ar-fig-empty')].map((x) => (x as HTMLElement).offsetHeight))
        return { h, group: b.group, figure: { fixed: h - img, img } }
      }
      return { h, keep: b.keep, group: b.group, sentences: b.sentences?.length }
    })
    const p = sc.firstElementChild as HTMLElement
    const measureText = (i: number, from: number, to: number) => {
      p.textContent = blocks[i]!.sentences!.slice(from, to).join(' ')
      return outer(p)
    }
    setPages(flow(items, (n) => caps[Math.min(n, 1)]!, measureText))
  }, [blocks])
  return (
    <>
      <div className="ar-measure ar-body" ref={measure} aria-hidden="true">
        {blocks.map((b) => (
          <div key={b.key}>{b.render()}</div>
        ))}
      </div>
      <div className="ar-measure ar-body" ref={scratch} aria-hidden="true">
        <p className="ar-p" />
      </div>
      <div className="ar-probe" ref={probe} aria-hidden="true">
        <Sheet a={a} n={0} total={1} probe />
        <Sheet a={a} n={1} total={1} probe />
      </div>
      <div className="dossier-sheets" ref={sheetsRef} data-testid="article-pages">
        {(pages ?? [blocks.map((_, i): Placement => ({ i }))]).map((ps, n, all) => (
          <Sheet key={n} a={a} n={n} total={all.length}>
            {ps.map((pl) => (
              <div key={`${blocks[pl.i]!.key}-${pl.from ?? 0}`}>{blocks[pl.i]!.render(pl)}</div>
            ))}
          </Sheet>
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
  useOnReturn(refresh, () => !!timer.current || !!busy)

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
  /** Claude drafts a continuous article from the same materials; it becomes the edit, which the owner keeps editing. */
  const draft = () =>
    run('draft', async () => {
      if (editedCount && !confirm(`הטיוטה של Claude תחליף את ${editedCount} החלקים שנערכו. להמשיך?`)) return 'הטיוטה בוטלה.'
      const { draftArticle } = await import('../../data/partner')
      const out = await draftArticle(articleMaterials(article!), article!.title)
      if (!out.ok) throw new Error(out.error)
      const sections: Record<string, string> = {}
      for (const k of SECTION_KEYS) if (out[k]?.trim()) sections[k] = out[k].trim()
      persist({ sections, drafted: new Date().toISOString() })
      setMode('edit')
      return `Claude ניסח ${Object.keys(sections).length} חלקים מחומרי הפרויקט. אפשר לערוך כל אחד, או לחזור לטקסט מהחומרים.`
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
              <p className="hint">{editedCount ? `${editedCount} חלקים נערכו${edits.drafted ? ', מטיוטה של Claude' : ''}.` : 'כל הטקסט מורכב מהחומרים של השלבים.'}</p>
            </section>
            <section>
              <h2>מאמר מגובש</h2>
              <button type="button" onClick={draft} disabled={!!busy} data-testid="article-draft">
                {busy === 'draft' ? 'Claude כותב' : 'טיוטה רציפה מ-Claude'}
              </button>
              <p className="hint">Claude מחבר את חומרי השלבים למאמר רציף, בלי להוסיף עובדות. חלק בלי חומרים נשאר ריק ומסומן. אחרי הטיוטה עורכים לפני הייצוא.</p>
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
                <button type="button" className="quiet" onClick={() => navigate('poster', { p: projectId! })} data-testid="article-poster">
                  פלייר לתערוכה
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
