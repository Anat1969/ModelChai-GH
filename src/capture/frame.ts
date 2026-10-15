/**
 * Frames taken from the model window for the collection (DECISIONS.md 84–86). The renderer registers itself
 * here from inside the canvas, so panels can ask for a frame without reaching into three.js.
 */

/** A frozen view: 30 × 20 cm at 300 dpi, in the window's 3:2. */
export const STILL = { width: 3600, height: 2400 } as const
export const STILL_TYPE = 'image/jpeg'
export const STILL_QUALITY = 0.92

export interface FrameRequest {
  width: number
  height: number
  type: 'image/jpeg' | 'image/png'
  quality?: number
}

export interface Frame {
  blob: Blob
  width: number
  height: number
}

export interface Pose {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * A run of frames at one size: `draw` moves the camera to a pose, draws, and returns the canvas holding the
 * frame. The renderer goes back to the window's size and camera when `work` ends.
 */
export type Session = <T>(size: { width: number; height: number }, work: (draw: (pose: Pose) => HTMLCanvasElement) => Promise<T>) => Promise<T>

/** Set by the canvas while it is mounted. */
export const capture: {
  /** The window as it is, larger. */
  render: ((r: FrameRequest) => Promise<Frame>) | null
  /** The window drawn for a visualization: deeper shadows, ambient occlusion, smooth edges (DECISIONS.md 91). */
  beauty: ((r: FrameRequest) => Promise<Frame>) | null
  session: Session | null
} = { render: null, beauty: null, session: null }

/**
 * The largest size, at the requested aspect, that the GPU can draw in one pass. Rounded down to whole pixels,
 * keeping the height a whole multiple of 2 and the width of 3, so 3:2 stays exact.
 */
export function fitToLimit(width: number, height: number, max: readonly [number, number]): { width: number; height: number } {
  const scale = Math.min(1, max[0] / width, max[1] / height)
  if (scale === 1) return { width, height }
  const unit = Math.floor((height * scale) / 2)
  return { width: unit * 3, height: unit * 2 }
}

/** A file name a person can read: the concept, what was frozen, and when. */
export function frameName(id: string, what: string, at: Date, ext: string): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return `${id || 'model'}-${what}-${stamp}.${ext}`
}
