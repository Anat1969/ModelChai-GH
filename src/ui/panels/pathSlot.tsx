/**
 * The path bar's status line: every step under the model writes its outcome (saved, download, error) into one
 * line under the steps, instead of floating over the model.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const PathSlot = createContext<HTMLElement | null>(null)

/** Renders into the path bar's status line when there is one, in place otherwise. */
export function PathStatus({ children }: { children: ReactNode }) {
  const slot = useContext(PathSlot)
  return slot ? createPortal(children, slot) : <>{children}</>
}
