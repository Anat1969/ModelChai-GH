/**
 * Draws one frame at a size larger than the window, for a frozen view. The renderer is resized for that one
 * draw and restored, so tone, fog and line widths stay what is on screen (DECISIONS.md 85).
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { PerspectiveCamera } from 'three'
import { capture, fitToLimit } from '../capture/frame'

export function CaptureBridge() {
  const { gl, scene, camera, size, invalidate } = useThree()

  useEffect(() => {
    capture.render = async (req) => {
      const ctx = gl.getContext()
      const vp = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS) as Int32Array
      const rb = ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number
      const { width, height } = fitToLimit(req.width, req.height, [Math.min(vp[0]!, rb), Math.min(vp[1]!, rb)])
      const cam = camera as PerspectiveCamera
      const ratio = gl.getPixelRatio()
      const aspect = cam.aspect
      try {
        gl.setPixelRatio(1)
        gl.setSize(width, height, false)
        cam.aspect = width / height
        cam.updateProjectionMatrix()
        gl.render(scene, cam)
        // toBlob copies the drawing buffer when it is called; the encoding runs after.
        const blob = await new Promise<Blob | null>((res) => gl.domElement.toBlob(res, req.type, req.quality))
        if (!blob) throw new Error('הדפדפן לא הפיק תמונה')
        return { blob, width, height }
      } finally {
        gl.setPixelRatio(ratio)
        gl.setSize(size.width, size.height, false)
        cam.aspect = aspect
        cam.updateProjectionMatrix()
        // Resizing clears the canvas; draw the window again now, so a snapshot read right after is not blank.
        gl.render(scene, cam)
        invalidate()
      }
    }
    return () => {
      capture.render = null
    }
  }, [gl, scene, camera, size, invalidate])

  return null
}
