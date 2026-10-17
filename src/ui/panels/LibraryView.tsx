/**
 * The concept's library: a post that reads the concept as a building in its place, the visual prompts made
 * from it, and the images made from each prompt. Images are uploaded by the owner (DECISIONS.md 75).
 * The same view serves the studio's "ספרייה" tab and the full library screen.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  addPost,
  addPrompt,
  imageProblem,
  loadLibrary,
  removeItem,
  requestPost,
  uploadImage,
  type Library,
  type LibraryItem,
} from '../../data/library'
import { readingOf } from '../../data/library'
import { visualPrompt } from '../../prompt/visualPrompt'
import { ReadingText } from './ReadingPanel'
import type { Built } from '../params'

export interface LibrarySource {
  recipe: Built
  versionId: string | null
  /** Measured metrics, already worded, for the post. */
  metrics?: Record<string, string>
}

const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
const copyText = (text: string) => navigator.clipboard?.writeText(text).then(
  () => true,
  () => false,
)

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  )
}

function PostCard({ post, onCopy }: { post: LibraryItem; onCopy: () => void }) {
  return (
    <article className="post" data-testid="post">
      <p className="post-short">{post.distill}</p>
      <div className="post-body">
        <Paragraphs text={post.body ?? ''} />
      </div>
      <div className="toolbar compact">
        <button type="button" onClick={onCopy} data-testid="copy-post">
          העתקת הפוסט
        </button>
        <span className="hint">{when(post.created_at)}</span>
      </div>
    </article>
  )
}

function PromptCard({ item, projectId, onChange, setStatus, wide }: { item: Library['prompts'][number]; projectId: string; onChange: () => void; setStatus: (s: string) => void; wide: boolean }) {
  const [busy, setBusy] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    const problems = list.map(imageProblem).filter(Boolean)
    if (problems.length) {
      setStatus(problems.join(' '))
      return
    }
    setBusy(true)
    try {
      for (const file of list) await uploadImage({ projectId, promptId: item.id, versionId: item.version_id, file })
      setStatus(list.length === 1 ? 'התמונה נוספה.' : `${list.length} תמונות נוספו.`)
      onChange()
    } catch (e) {
      setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="prompt-card" data-testid="library-prompt">
      <p className="distill">{item.distill}</p>
      <details>
        <summary>הפרומפט · {when(item.created_at)}</summary>
        <p className="prompt">{item.body}</p>
      </details>
      {item.images.length > 0 && (
        <div className={wide ? 'gallery wide' : 'gallery'}>
          {item.images.map((img) => (
            <figure key={img.id} className="gallery-item">
              <a href={img.url} target="_blank" rel="noreferrer">
                <img className="snapshot" src={img.url} alt={`המחשה של ${item.distill ?? 'המושג'}`} loading="lazy" data-testid="library-image" />
              </a>
              <button
                type="button"
                className="quiet"
                onClick={async () => {
                  if (!confirm('למחוק את התמונה?')) return
                  try {
                    await removeItem(img)
                    onChange()
                  } catch (e) {
                    setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
                  }
                }}
              >
                מחיקה
              </button>
            </figure>
          ))}
        </div>
      )}
      <div className="toolbar compact">
        <label className="filebtn">
          {busy ? 'מעלה' : 'העלאת תמונות מהפרומפט'}
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(e) => void upload(e.currentTarget.files)} data-testid="upload-image" />
        </label>
        <button type="button" onClick={async () => setStatus((await copyText(`${item.distill}\n\n${item.body}`)) ? 'הפרומפט הועתק.' : 'ההעתקה נכשלה.')}>
          העתקה
        </button>
        <button
          type="button"
          className="quiet"
          onClick={async () => {
            if (!confirm(item.images.length ? `למחוק את הפרומפט ואת ${item.images.length} התמונות שלו?` : 'למחוק את הפרומפט?')) return
            try {
              await removeItem(item, item.images)
              onChange()
            } catch (e) {
              setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
            }
          }}
        >
          מחיקה
        </button>
      </div>
    </article>
  )
}

export function LibraryView({ projectId, source, wide = false }: { projectId: string; source: LibrarySource | null; wide?: boolean }) {
  const [lib, setLib] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [writing, setWriting] = useState(false)

  const refresh = useCallback(() => {
    loadLibrary(projectId).then(
      (l) => (setLib(l), setError(null)),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [projectId])
  useEffect(refresh, [refresh])

  const current = source ? visualPrompt(source.recipe) : null
  const latestPost = lib?.posts[0]

  const writePost = async () => {
    if (!source) return
    setWriting(true)
    setStatus('')
    const out = await requestPost({ recipe: source.recipe, prompt: current?.prompt, metrics: source.metrics })
    if (!out.ok) {
      setStatus(out.error)
      setWriting(false)
      return
    }
    try {
      await addPost({ projectId, versionId: source.versionId, short: out.short, post: out.post })
      setStatus(`הפוסט נכתב תוך ${Math.round(out.durationMs / 1000)} שניות ונשמר בספרייה.`)
      refresh()
    } catch (e) {
      setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className={wide ? 'library wide' : 'library'} data-testid="library">
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={refresh}>
            ניסיון חוזר
          </button>
        </div>
      )}

      {lib?.readings[0] && readingOf(lib.readings[0]) && (
        <section className="library-section sec-reading" aria-labelledby="lib-reading-title">
          <h2 id="lib-reading-title">פרשנות: מעולם המתמטיקה לעולם האדריכלי</h2>
          <ReadingText r={readingOf(lib.readings[0])!} />
        </section>
      )}

      <section className="library-section sec-post" aria-labelledby="post-title">
        <h2 id="post-title">פוסט: המושג כמבנה במקום</h2>
        {latestPost ? (
          <PostCard post={latestPost} onCopy={async () => setStatus((await copyText(`${latestPost.distill}\n\n${latestPost.body}`)) ? 'הפוסט הועתק.' : 'ההעתקה נכשלה.')} />
        ) : (
          <p className="hint">Claude כותב פוסט קצר שקורא את המושג כמבנה שעומד במקום, בשעה ובעונה שעל המסך. רק מהעובדות שבמתכון.</p>
        )}
        {source && (
          <div className="toolbar compact">
            <button type="button" className="primary" onClick={writePost} disabled={writing} data-testid="write-post">
              {writing ? 'Claude כותב' : latestPost ? 'כתיבה מחדש' : 'כתיבת פוסט'}
            </button>
          </div>
        )}
        {lib && lib.posts.length > 1 && (
          <details>
            <summary>פוסטים קודמים ({lib.posts.length - 1})</summary>
            {lib.posts.slice(1).map((p) => (
              <article key={p.id} className="post old">
                <p className="post-short">{p.distill}</p>
                <div className="post-body">
                  <Paragraphs text={p.body ?? ''} />
                </div>
                <span className="hint">{when(p.created_at)}</span>
              </article>
            ))}
          </details>
        )}
      </section>

      {current && source && (
        <section className="library-section sec-now" aria-labelledby="now-title">
          <h2 id="now-title">הפרומפט של המצב הנוכחי</h2>
          <p className="distill">{current.distill}</p>
          <details>
            <summary>הפרומפט</summary>
            <p className="prompt">{current.prompt}</p>
          </details>
          <div className="toolbar compact">
            <button
              type="button"
              className="primary"
              data-testid="save-prompt"
              onClick={async () => {
                try {
                  await addPrompt({ projectId, versionId: source.versionId, distill: current.distill, prompt: current.prompt })
                  setStatus('הפרומפט נשמר בספרייה. אחרי שיוצרים ממנו תמונות, מעלים אותן אליו.')
                  refresh()
                } catch (e) {
                  setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
                }
              }}
            >
              שמירה בספרייה
            </button>
            <button type="button" onClick={async () => setStatus((await copyText(`${current.distill}\n\n${current.prompt}`)) ? 'הפרומפט הועתק.' : 'ההעתקה נכשלה.')}>
              העתקה
            </button>
          </div>
        </section>
      )}

      <section className="library-section sec-gallery" aria-labelledby="gallery-title">
        <h2 id="gallery-title">המחשות {lib ? `(${lib.prompts.reduce((n, p) => n + p.images.length, 0)})` : ''}</h2>
        {lib && lib.prompts.length === 0 && <p className="hint">עוד אין פרומפטים שמורים. שומרים פרומפט, יוצרים ממנו תמונות, ומעלים אותן אליו.</p>}
        {lib?.prompts.map((p) => (
          <PromptCard key={p.id} item={p} projectId={projectId} onChange={refresh} setStatus={setStatus} wide={wide} />
        ))}
      </section>

      <p className="hint sec-status" role="status" data-testid="library-status">
        {status}
      </p>
    </div>
  )
}
