/**
 * Frame-by-frame MP4 (DECISIONS.md 88): WebCodecs encodes each frame as it is drawn, so none is dropped and
 * every run gives the same clip. H.264 first, which every player opens; VP9 where H.264 is missing.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { CLIP, timestampAt } from './clip'

const CANDIDATES: { codec: string; mux: 'avc' | 'vp9' | 'av1' }[] = [
  { codec: 'avc1.640028', mux: 'avc' },
  { codec: 'avc1.4D0028', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
]

export interface ClipEncoder {
  codec: 'avc' | 'vp9' | 'av1'
  add(source: CanvasImageSource, frame: number): Promise<void>
  finish(): Promise<Blob>
  close(): void
}

/** Null when this browser cannot encode video (no WebCodecs, or none of the codecs). */
export async function createEncoder(width: number = CLIP.width, height: number = CLIP.height): Promise<ClipEncoder | null> {
  if (typeof VideoEncoder === 'undefined') return null
  const base = { width, height, bitrate: 10_000_000, framerate: CLIP.fps }
  let pick: (typeof CANDIDATES)[number] | null = null
  for (const c of CANDIDATES) {
    const r = await VideoEncoder.isConfigSupported({ ...base, codec: c.codec }).catch(() => null)
    if (r?.supported) {
      pick = c
      break
    }
  }
  if (!pick) return null

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: pick.mux, width, height, frameRate: CLIP.fps }, fastStart: 'in-memory' })
  let failure: unknown = null
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) })
  encoder.configure({ ...base, codec: pick.codec, ...(pick.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}) })

  return {
    codec: pick.mux,
    async add(source, f) {
      if (failure) throw failure
      const frame = new VideoFrame(source, { timestamp: timestampAt(f), duration: timestampAt(f + 1) - timestampAt(f) })
      encoder.encode(frame, { keyFrame: f % CLIP.fps === 0 })
      frame.close()
      // Keep the queue short, so memory stays flat on a slow machine.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5))
    },
    async finish() {
      await encoder.flush()
      if (failure) throw failure
      muxer.finalize()
      encoder.close()
      return new Blob([muxer.target.buffer], { type: 'video/mp4' })
    },
    close() {
      if (encoder.state !== 'closed') encoder.close()
    },
  }
}
