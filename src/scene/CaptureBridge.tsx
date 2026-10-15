/**
 * Draws frames at a size other than the window's: one large frame for a frozen view, or a run of frames along
 * a camera path for a clip. The renderer is resized for that one
 * draw and restored, so tone, fog and line widths stay what is on screen (DECISIONS.md 85).
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { PerspectiveCamera } from 'three'
import { capture, fitToLimit, type Pose } from '../capture/frame'

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
    capture.session = async (sz, work) => {
      const cam = camera as PerspectiveCamera
      const ratio = gl.getPixelRatio()
      const aspect = cam.aspect
      const position = cam.position.clone()
      const quaternion = cam.quaternion.clone()
      gl.setPixelRatio(1)
      gl.setSize(sz.width, sz.height, false)
      cam.aspect = sz.width / sz.height
      cam.updateProjectionMatrix()
      const draw = (pose: Pose) => {
        cam.position.set(...pose.position)
        cam.lookAt(...pose.target)
        cam.updateMatrixWorld()
        gl.render(scene, cam)
        return gl.domElement
      }
      try {
        return await work(draw)
      } finally {
        gl.setPixelRatio(ratio)
        gl.setSize(size.width, size.height, false)
        cam.aspect = aspect
        cam.updateProjectionMatrix()
        cam.position.copy(position)
        cam.quaternion.copy(quaternion)
        gl.render(scene, cam)
        invalidate()
      }
    }
    return () => {
      capture.render = null
      capture.session = null
    }
  }, [gl, scene, camera, size, invalidate])

  return null
}
