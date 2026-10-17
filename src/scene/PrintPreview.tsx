/**
 * The print preview (DECISIONS.md 115): the STL that will be downloaded, read back byte for byte, on the drawn
 * printer bed, in millimeters. Its own small canvas, made only when the print file is made: the studio model is
 * never rebuilt for it, and the build counter does not move.
 */
import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { num } from '../ui/format'
import { BARE } from './BareScene'

type V3 = [number, number, number]

/** Printer axes (Z up) to the scene's (Y up): (x, y, z) → (x, z, −y). */
const toScene = ([x, y, z]: V3): V3 => [x, z, -y]

interface Label {
  at: V3
  text: string
}

/** Moves the labels, plain spans over the canvas, to their points on every frame the view draws. */
function LabelTracker({ labels, spans }: { labels: Label[]; spans: RefObject<(HTMLSpanElement | null)[]> }) {
  const v = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    labels.forEach((l, i) => {
      const el = spans.current[i]
      if (!el) return
      v.set(...toScene(l.at)).project(camera)
      const hidden = v.z > 1
      el.style.display = hidden ? 'none' : 'block'
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`
    })
  })
  return null
}

const cm = (mm: number) => `${num(mm / 10, 1)} ס"מ`

export function PrintPreview({ stl, bed }: { stl: Uint8Array; bed: [number, number, number] }) {
  const geo = useMemo(() => {
    const g = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer)
    g.rotateX(-Math.PI / 2)
    g.computeBoundingBox()
    return g
  }, [stl])
  useEffect(() => () => geo.dispose(), [geo])

  // The box in printer axes, back from the scene's.
  const bb = geo.boundingBox!
  const min: V3 = [bb.min.x, -bb.max.z, bb.min.y]
  const max: V3 = [bb.max.x, -bb.min.z, bb.max.y]
  const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const [bx, by] = [bed[0] / 2, bed[1] / 2]

  const grid = useMemo(() => {
    const pts: V3[] = []
    for (let x = -bx; x <= bx + 1e-6; x += 10) pts.push(toScene([x, -by, 0]), toScene([x, by, 0]))
    for (let y = -by; y <= by + 1e-6; y += 10) pts.push(toScene([-bx, y, 0]), toScene([bx, y, 0]))
    return pts
  }, [bx, by])
  const outline: V3[] = [toScene([-bx, -by, 0]), toScene([bx, -by, 0]), toScene([bx, by, 0]), toScene([-bx, by, 0]), toScene([-bx, -by, 0])]
  // Dimension lines just outside the box: width along the front, depth along the right side, height at a corner.
  const off = 6
  const wLine: V3[] = [toScene([min[0], min[1] - off, 0]), toScene([max[0], min[1] - off, 0])]
  const dLine: V3[] = [toScene([max[0] + off, min[1], 0]), toScene([max[0] + off, max[1], 0])]
  const hLine: V3[] = [toScene([max[0] + off, min[1] - off, 0]), toScene([max[0] + off, min[1] - off, max[2]])]
  const reach = Math.max(bed[0], bed[1], size[2] * 2)
  const labels: Label[] = [
    { at: [(min[0] + max[0]) / 2, min[1] - off - 20, 0], text: `רוחב ${cm(size[0])}` },
    { at: [max[0] + off + 26, (min[1] + max[1]) / 2, 0], text: `עומק ${cm(size[1])}` },
    { at: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2] + 12], text: `גובה ${cm(size[2])}` },
  ]
  const spans = useRef<(HTMLSpanElement | null)[]>([])

  return (
    <div className="print-preview-canvas">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 35, near: 1, far: reach * 20, position: [reach * 0.75, reach * 0.62, reach * 0.95] }}
      >
        <color attach="background" args={[BARE.background]} />
        <hemisphereLight args={['#ffffff', '#9a9a9a', 0.9]} />
        <directionalLight position={[reach * 0.9, reach * 1.3, reach * 0.15]} intensity={2.4} />
        <directionalLight position={[-reach, reach * 0.6, reach]} intensity={0.5} />
        <mesh position={[0, -0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[bed[0], bed[1]]} />
          <meshStandardMaterial color={BARE.ground} roughness={1} />
        </mesh>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(grid.flat()), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#c9c9c9" />
        </lineSegments>
        <Line points={outline} color={BARE.section} lineWidth={1.5} />
        <mesh geometry={geo}>
          <meshStandardMaterial color={BARE.outer} roughness={0.75} metalness={0} />
        </mesh>
        <Line points={wLine} color={BARE.accent} lineWidth={1.5} />
        <Line points={dLine} color={BARE.accent} lineWidth={1.5} />
        <Line points={hLine} color={BARE.accent} lineWidth={1.5} />
        <LabelTracker labels={labels} spans={spans} />
        <OrbitControls makeDefault target={[0, size[2] / 3, 0]} enableDamping={false} maxPolarAngle={Math.PI * 0.49} minDistance={40} maxDistance={reach * 4} />
      </Canvas>
      {labels.map((l, i) => (
        <span key={i} className="preview-label" ref={(el) => void (spans.current[i] = el)}>
          {l.text}
        </span>
      ))}
    </div>
  )
}
