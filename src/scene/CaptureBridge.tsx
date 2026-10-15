/**
 * Draws frames at a size other than the window's: one large frame for a frozen view, or a run of frames along
 * a camera path for a clip, or a visualization drawn through ambient occlusion (DECISIONS.md 91). The renderer
 * is resized for the draw and restored, so tone, fog and line widths stay what is on screen (DECISIONS.md 85).
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { HalfFloatType, Vector2, WebGLRenderTarget, type DirectionalLight, type PerspectiveCamera } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
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
    capture.beauty = async (req) => {
      const ctx = gl.getContext()
      const vp = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS) as Int32Array
      const rb = ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number
      const { width, height } = fitToLimit(req.width, req.height, [Math.min(vp[0]!, rb), Math.min(vp[1]!, rb)])
      const cam = camera as PerspectiveCamera
      const ratio = gl.getPixelRatio()
      const aspect = cam.aspect
      // Sharper shadows: each casting light's map at 4096 for this draw only.
      const lights: { light: DirectionalLight; size: Vector2 }[] = []
      scene.traverse((o) => {
        const l = o as DirectionalLight
        if (l.isDirectionalLight && l.castShadow) lights.push({ light: l, size: l.shadow.mapSize.clone() })
      })
      const resetMaps = () => {
        for (const { light } of lights) {
          light.shadow.map?.dispose()
          light.shadow.map = null
        }
      }
      const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 })
      const composer = new EffectComposer(gl, target)
      try {
        gl.setPixelRatio(1)
        gl.setSize(width, height, false)
        cam.aspect = width / height
        cam.updateProjectionMatrix()
        for (const { light } of lights) light.shadow.mapSize.set(4096, 4096)
        resetMaps()
        composer.setPixelRatio(1)
        composer.setSize(width, height)
        composer.addPass(new RenderPass(scene, cam))
        const ao = new GTAOPass(scene, cam, width, height)
        // The scene is in meters: occlusion reaches about a meter and a half, the scale of a wall's depth.
        ao.updateGtaoMaterial({ radius: 1.5, distanceExponent: 1, thickness: 1, scale: 1 })
        ao.blendIntensity = 0.85
        composer.addPass(ao)
        composer.addPass(new OutputPass())
        composer.render()
        const blob = await new Promise<Blob | null>((res) => gl.domElement.toBlob(res, req.type, req.quality))
        ao.dispose()
        if (!blob) throw new Error('הדפדפן לא הפיק תמונה')
        return { blob, width, height }
      } finally {
        composer.dispose()
        target.dispose()
        for (const { light, size } of lights) light.shadow.mapSize.copy(size)
        resetMaps()
        gl.setPixelRatio(ratio)
        gl.setSize(size.width, size.height, false)
        cam.aspect = aspect
        cam.updateProjectionMatrix()
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
      capture.beauty = null
      capture.session = null
    }
  }, [gl, scene, camera, size, invalidate])

  return null
}
