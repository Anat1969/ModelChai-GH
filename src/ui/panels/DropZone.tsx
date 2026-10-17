/**
 * Images into the project (DECISIONS.md 105): drag them onto the area or choose them. Each one shows at once as
 * a preview with its state in words: being saved, saved in the project, or why it was not, with a retry. The
 * preview is from the file itself, so nothing waits on the network to be seen.
 */
import { useEffect, useRef, useState } from 'react'
import { imageProblem } from '../../data/library'

type ItemState = { id: string; name: string; url: string; state: 'saving' | 'saved' | 'failed'; error?: string; file: File }

export function DropZone({ label, hint, onUpload, testid }: { label: string; hint: string; onUpload: (file: File) => Promise<void>; testid: string }) {
  const [over, setOver] = useState(false)
  const [items, setItems] = useState<ItemState[]>([])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (it: ItemState) => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'saving', error: undefined } : x)))
    try {
      await onUpload(it.file)
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'saved' } : x)))
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'failed', error: e instanceof Error ? e.message : String(e) } : x)))
    }
  }

  const take = (files: File[]) => {
    const fresh = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), file, state: 'saving' as const, error: imageProblem(file) ?? undefined }))
    setItems((xs) => [...fresh.map((f) => (f.error ? { ...f, state: 'failed' as const } : f)), ...xs])
    for (const f of fresh) if (!f.error) void send(f)
  }

  return (
    <div className="dropzone-wrap">
      <div
        className="dropzone"
        data-over={over}
        role="button"
        tabIndex={0}
        aria-label={`${label}: גרירה או בחירה`}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')))
        }}
        data-testid={`${testid}-zone`}
      >
        <strong>{over ? 'אפשר לשחרר' : label}</strong>
        <span>{hint}</span>
        <span className="hint">גוררים לכאן, או לוחצים לבחירה. PNG, JPEG או WebP, עד 10MB.</span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            take([...(e.currentTarget.files ?? [])])
            e.currentTarget.value = ''
          }}
          data-testid={testid}
        />
      </div>
      {items.length > 0 && (
        <ul className="dropzone-items" aria-label="תמונות שנוספו עכשיו">
          {items.map((it) => (
            <li key={it.id} data-state={it.state} data-testid={`${testid}-item`}>
              <img src={it.url} alt={it.name} />
              <span>
                <strong>{it.state === 'saving' ? 'נשמרת' : it.state === 'saved' ? 'נשמרה בפרויקט' : 'לא נשמרה'}</strong>
                <span className="hint">{it.error ?? it.name}</span>
                {it.state === 'failed' && !imageProblem(it.file) && (
                  <button type="button" className="quiet" onClick={() => void send(it)}>
                    ניסיון חוזר
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
