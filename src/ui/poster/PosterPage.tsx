/**
 * The flyer page itself, A4 at 96 dpi (794×1123). The image fills the top two thirds and fades into the ground;
 * the model's line, computed from its equation, lies over it in the accent color; the title stands on the border
 * between image and ground. Below, two columns and a foot. The accent is one color, taken from the image.
 */
import type { LoadedImage } from '../../dossier/images'
import type { Poster } from '../../journey/poster'
import { pathOf, type Figure } from '../../learn/figures'

const W = 794
const PAD = 48
const longest = (...xs: string[]) => Math.max(1, ...xs.map((x) => x.length))
/** The title as large as its longest line allows in the page's width. */
const titleSize = (a: string, b: string) => Math.round(Math.min(78, (W - 2 * PAD) / (0.56 * longest(a, b))))

export function PosterPage({ poster: p, image, accent, figure, qr }: { poster: Poster; image: LoadedImage | null; accent: string | null; figure?: Figure; qr: string | null }) {
  const dark = p.tone === 'dark'
  const ground = dark ? '#101214' : '#f3f0ea'
  const ink = dark ? '#f5f3ee' : '#15171a'
  const soft = dark ? 'rgba(245,243,238,0.72)' : 'rgba(21,23,26,0.7)'
  const acc = accent ?? (dark ? '#d9b26a' : '#9a6a1f')
  const size = titleSize(p.title1, p.title2)
  const dense = p.items.reduce((n, i) => n + i.text.length + i.head.length, 0) > 420
  return (
    <section className="pf-page" data-tone={p.tone} data-testid="poster-page" style={{ background: ground, color: ink, ['--acc' as string]: acc, ['--soft' as string]: soft, ['--ground' as string]: ground }}>
      <div className="pf-image">
        {image ? <img src={image.dataUrl} alt="" /> : <div className="pf-image-empty">אין עדיין תמונה בפרויקט</div>}
        {figure && (
          <svg className="pf-line" viewBox="0 0 240 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {/* Each line twice: a dark halo under the accent, so it reads on a bright sky and on a dark ground alike.
                Strokes are attributes, not CSS, so the export draws them exactly as the screen does. */}
            {figure.lines.map((l, i) => (
              <path key={`h${i}`} d={pathOf(l.pts, l.closed)} fill="none" stroke="rgb(0,0,0)" strokeOpacity={l.role === 'main' ? 0.35 : 0.2} strokeWidth={l.role === 'main' ? 6 : 3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
            {figure.lines.map((l, i) => (
              <path
                key={i}
                d={pathOf(l.pts, l.closed)}
                fill="none"
                stroke={l.role === 'guide' ? '#ffffff' : acc}
                strokeOpacity={l.role === 'main' ? 1 : l.role === 'guide' ? 0.55 : 0.4}
                strokeWidth={l.role === 'main' ? 2.8 : 1.1}
                strokeDasharray={l.role === 'guide' ? '4 5' : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        <div className="pf-fade" />
        {p.kicker && <p className="pf-kicker">{p.kicker}</p>}
        {p.imageLabel && <span className="pf-label">{p.imageLabel}</span>}
      </div>

      <header className="pf-title" style={{ fontSize: size }}>
        {p.title1 && <span className="pf-t1">{p.title1}</span>}
        {p.title2 && <span className="pf-t2">{p.title2}</span>}
        <span className="pf-rule" />
      </header>

      <div className={`pf-cols${dense ? ' dense' : ''}`}>
        <div className="pf-col pf-right">
          {p.maxim && <p className="pf-maxim">{p.maxim}</p>}
          {p.verse.length > 0 && (
            <p className="pf-verse">
              {p.verse.map((l, i) => (
                <span key={i} className={i === p.verse.length - 1 ? 'acc' : undefined}>
                  {l}
                </span>
              ))}
            </p>
          )}
          {p.dna && (
            <p className="pf-dna">
              <strong>ה־DNA של המודל</strong>
              {p.dna}
              {figure && <span className="pf-line-note"> הקו שעל התמונה: {p.modelName}, מחושב מהמשוואה שלו.</span>}
            </p>
          )}
        </div>
        <div className="pf-col pf-left">
          {p.listHead && <h2 className="pf-sub">{p.listHead}</h2>}
          <ol className="pf-list">
            {p.items.map((it, i) => (
              <li key={i}>
                <span className="pf-num">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  {it.head && <strong>{it.head}. </strong>}
                  {it.text}
                </span>
              </li>
            ))}
          </ol>
          {p.flow && (
            <p className="pf-dna">
              <strong>התנועה במבנה</strong>
              {p.flow}
            </p>
          )}
          {p.question && <p className="pf-question">{p.question}</p>}
        </div>
      </div>

      <footer className="pf-foot">
        <span>{p.author}</span>
        <span className="pf-mid">מתמטיקה הפוכה</span>
        <span>{p.place}</span>
        {qr && (
          <span className="pf-qr">
            <span className="pf-qr-code" dangerouslySetInnerHTML={{ __html: qr }} />
            <span>הסרטון</span>
          </span>
        )}
      </footer>
    </section>
  )
}
