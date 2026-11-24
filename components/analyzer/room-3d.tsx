'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type {
  HeatmapGrid,
  HeatmapVolume,
  ListeningPoint,
  RoomConfig,
  RoomObstacle,
  Subwoofer,
  SweetSpotEvaluation,
} from '@/lib/acoustics'
import { bipolarColor, getBounds, getRoomPolygon, heatColor, isRoomGeometryValid, paintHeatmap } from '@/lib/acoustics'
import { getLocalObstaclePolygon } from '@/lib/furniture'
import { extractIsosurface, type IsosurfaceMeshData } from '@/lib/marching-cubes'
import { subColor } from './subwoofer-panel'

export type View3dMode = 'iso' | 'plane' | 'both'

interface Room3DProps {
  room: RoomConfig
  subs: Subwoofer[]
  listening: ListeningPoint
  earHeight: number
  grid: HeatmapGrid | null
  volume: HeatmapVolume | null
  view3dMode: View3dMode
  volumeOpacity: number
  showMaxima: boolean
  showNulls: boolean
  showHeatmap: boolean
  heatRangeDb: number
  selectedId: string | null
  obstacles?: RoomObstacle[]
  selectedObstacleId?: string | null
  sweetSpotEval?: SweetSpotEvaluation | null
  previewSubs?: Subwoofer[] | null
}

function RoomShell({ room }: { room: RoomConfig }) {
  const geometry = useMemo(() => {
    const poly = getRoomPolygon(room)
    const shape = new THREE.Shape()
    poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: room.H, bevelEnabled: false })
  }, [room])

  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 1), [geometry])

  useEffect(() => {
    return () => {
      geometry.dispose()
      edges.dispose()
    }
  }, [geometry, edges])

  // Extrusion runs along local +z; rotating +90° about X maps local (x, y, z) -> (x, H - z, y),
  // so room y becomes world z and the extrusion spans world y from H down to 0.
  return (
    <group rotation={[Math.PI / 2, 0, 0]} position={[0, room.H, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#8a9bb5" transparent opacity={0.05} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#cbd5e1" transparent opacity={0.75} />
      </lineSegments>
    </group>
  )
}

function Floor({ room }: { room: RoomConfig }) {
  const geometry = useMemo(() => {
    const poly = getRoomPolygon(room)
    const shape = new THREE.Shape()
    poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [room])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
      <meshStandardMaterial color="#23262e" roughness={0.88} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  )
}

function HeatPlane({
  grid,
  earHeight,
  heatRangeDb,
}: {
  grid: HeatmapGrid
  earHeight: number
  heatRangeDb: number
}) {
  const canvas = useMemo(() => document.createElement('canvas'), [])
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [canvas])

  useEffect(() => {
    paintHeatmap(grid, canvas, heatRangeDb)
    texture.needsUpdate = true
  }, [grid, heatRangeDb, canvas, texture])

  useEffect(() => () => texture.dispose(), [texture])

  const w = grid.cols * grid.cell
  const h = grid.rows * grid.cell
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[grid.originX + w / 2, earHeight, grid.originY + h / 2]}
      renderOrder={2}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={0.86} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function IsosurfaceMesh({
  data,
  color,
  emissive,
  emissiveIntensity,
  opacity,
  renderOrder,
}: {
  data: IsosurfaceMeshData
  color: string
  emissive: string
  emissiveIntensity: number
  opacity: number
  renderOrder: number
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
    geo.computeBoundingSphere()
    return geo
  }, [data])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (data.vertexCount === 0 || data.indexCount === 0 || opacity <= 0.004) return null

  const isOpaque = opacity >= 0.96

  return (
    <mesh geometry={geometry} renderOrder={renderOrder}>
      <meshPhysicalMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.34}
        metalness={0.04}
        clearcoat={0.35}
        clearcoatRoughness={0.28}
        transparent={!isOpaque}
        opacity={opacity}
        depthWrite={isOpaque}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}

function computeSplIsoThresholds(values: Float32Array, minVal: number, maxVal: number, rangeDb: number) {
  const sorted: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) sorted.push(v)
  }
  if (sorted.length === 0) {
    return { peakIso: maxVal, nullIso: minVal }
  }
  sorted.sort((a, b) => a - b)
  const q16 = sorted[Math.floor(sorted.length * 0.16)] ?? minVal
  const q84 = sorted[Math.floor(sorted.length * 0.84)] ?? maxVal
  const span = Math.max(0.1, maxVal - minVal)
  const eff = Math.min(span, rangeDb)

  const peakIso = Math.min(maxVal - Math.min(2.0, span * 0.15), Math.max(q84, maxVal - eff * 0.42))
  const nullIso = Math.min(peakIso - 2.0, Math.max(minVal + Math.min(1.0, span * 0.08), Math.min(q16, maxVal - eff * 0.65)))
  return { peakIso, nullIso }
}

function IsosurfaceLayers({
  volume,
  heatRangeDb,
  opacity,
  showMaxima,
  showNulls,
}: {
  volume: HeatmapVolume
  heatRangeDb: number
  opacity: number
  showMaxima: boolean
  showNulls: boolean
}) {
  const { peakData, nullData } = useMemo(() => {
    if (opacity <= 0.004) return { peakData: null, nullData: null }

    if (volume.bipolar) {
      const absMax = Math.max(1e-6, Math.abs(volume.max))
      const thr = 0.42 * absMax
      return {
        peakData: showMaxima ? extractIsosurface(volume, thr, 'above') : null,
        nullData: showNulls ? extractIsosurface(volume, -thr, 'below') : null,
      }
    }

    const { peakIso, nullIso } = computeSplIsoThresholds(volume.values, volume.min, volume.max, heatRangeDb)

    return {
      peakData: showMaxima ? extractIsosurface(volume, peakIso, 'above') : null,
      nullData: showNulls && nullIso < peakIso - 0.5 ? extractIsosurface(volume, nullIso, 'below') : null,
    }
  }, [volume, heatRangeDb, opacity, showMaxima, showNulls])

  return (
    <>
      {peakData && (
        <IsosurfaceMesh
          data={peakData}
          color={volume.bipolar ? '#ef4444' : '#f43f5e'}
          emissive={volume.bipolar ? '#7f1d1d' : '#9a3412'}
          emissiveIntensity={0.18}
          opacity={opacity}
          renderOrder={3}
        />
      )}
      {nullData && (
        <IsosurfaceMesh
          data={nullData}
          color={volume.bipolar ? '#3b82f6' : '#0ea5e9'}
          emissive={volume.bipolar ? '#1e3a8a' : '#1e40af'}
          emissiveIntensity={0.18}
          opacity={opacity}
          renderOrder={4}
        />
      )}
    </>
  )
}

function LShapeSeatMesh({
  width,
  depth,
  seatHeight,
  color,
  emissive,
  emissiveIntensity,
  transparent,
  opacity,
}: {
  width: number
  depth: number
  seatHeight: number
  color: string
  emissive: string
  emissiveIntensity: number
  transparent: boolean
  opacity: number
}) {
  const geometry = useMemo(() => {
    const poly = getLocalObstaclePolygon({ kind: 'lsofa', width, depth })
    const shape = new THREE.Shape()
    poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: seatHeight, bevelEnabled: false })
  }, [width, depth, seatHeight])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]} position={[0, seatHeight, 0]}>
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.78}
        transparent={transparent}
        opacity={opacity}
      />
    </mesh>
  )
}

function FurnitureItemMesh({ obs, selected }: { obs: RoomObstacle; selected: boolean }) {
  const w = obs.width
  const d = obs.depth
  const h = obs.height
  const rad = (obs.rotation * Math.PI) / 180
  const transparent = !obs.enabled
  const opacity = obs.enabled ? 1 : 0.25
  const emissive = selected ? '#f5b942' : '#000000'
  const emissiveIntensity = selected ? 0.22 : 0

  const renderBody = () => {
    switch (obs.kind) {
      case 'sofa': {
        const plinthH = Math.min(0.08, h * 0.1)
        const seatH = Math.max(0.12, h * 0.44)
        const backH = Math.max(0.15, h - plinthH - seatH)
        const backT = Math.min(0.22, d * 0.26)
        const armW = Math.min(0.18, w * 0.12)
        const armH = seatH + backH * 0.45
        return (
          <>
            <mesh position={[0, plinthH / 2, 0]}>
              <boxGeometry args={[w * 0.96, plinthH, d * 0.94]} />
              <meshStandardMaterial color="#1f2937" roughness={0.85} transparent={transparent} opacity={opacity} />
            </mesh>
            <mesh position={[0, plinthH + seatH / 2, backT * 0.25]}>
              <boxGeometry args={[w - armW * 2, seatH, d - backT * 0.5]} />
              <meshStandardMaterial
                color="#475569"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[0, plinthH + seatH + backH / 2, -d / 2 + backT / 2]}>
              <boxGeometry args={[w, backH, backT]} />
              <meshStandardMaterial
                color="#334155"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[-w / 2 + armW / 2, plinthH + armH / 2, 0]}>
              <boxGeometry args={[armW, armH, d]} />
              <meshStandardMaterial
                color="#3b485b"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[w / 2 - armW / 2, plinthH + armH / 2, 0]}>
              <boxGeometry args={[armW, armH, d]} />
              <meshStandardMaterial
                color="#3b485b"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
          </>
        )
      }
      case 'lsofa': {
        const seatH = Math.max(0.18, h * 0.52)
        const backH = Math.max(0.14, h - seatH)
        const backT = Math.min(0.22, Math.min(w, d) * 0.18)
        return (
          <>
            <LShapeSeatMesh
              width={w}
              depth={d}
              seatHeight={seatH}
              color="#475569"
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              transparent={transparent}
              opacity={opacity}
            />
            <mesh position={[0, seatH + backH / 2, -d / 2 + backT / 2]}>
              <boxGeometry args={[w, backH, backT]} />
              <meshStandardMaterial
                color="#334155"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[-w / 2 + backT / 2, seatH + backH / 2, backT / 2]}>
              <boxGeometry args={[backT, backH, Math.max(0.1, d - backT)]} />
              <meshStandardMaterial
                color="#334155"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.82}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
          </>
        )
      }
      case 'shelf': {
        const t = Math.min(0.035, Math.min(w, d) * 0.12)
        const levels = Math.max(2, Math.min(6, Math.round(h / 0.42)))
        const boards = Array.from({ length: levels + 1 }, (_, i) => (i * (h - t)) / levels + t / 2)
        return (
          <>
            <mesh position={[-w / 2 + t / 2, h / 2, 0]}>
              <boxGeometry args={[t, h, d]} />
              <meshStandardMaterial
                color="#92400e"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.68}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[w / 2 - t / 2, h / 2, 0]}>
              <boxGeometry args={[t, h, d]} />
              <meshStandardMaterial
                color="#92400e"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.68}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            <mesh position={[0, h / 2, -d / 2 + t * 0.35]}>
              <boxGeometry args={[Math.max(0.05, w - t * 2), h, t * 0.6]} />
              <meshStandardMaterial
                color="#78350f"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.75}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            {boards.map((by, idx) => (
              <mesh key={idx} position={[0, by, 0]}>
                <boxGeometry args={[Math.max(0.05, w - t * 2), t, d]} />
                <meshStandardMaterial
                  color="#b45309"
                  emissive={emissive}
                  emissiveIntensity={emissiveIntensity}
                  roughness={0.65}
                  transparent={transparent}
                  opacity={opacity}
                />
              </mesh>
            ))}
          </>
        )
      }
      case 'cabinet': {
        const plinthH = Math.min(0.08, h * 0.1)
        const bodyH = Math.max(0.08, h - plinthH)
        return (
          <>
            <mesh position={[0, plinthH / 2, 0]}>
              <boxGeometry args={[w * 0.94, plinthH, d * 0.9]} />
              <meshStandardMaterial color="#292524" roughness={0.85} transparent={transparent} opacity={opacity} />
            </mesh>
            <mesh position={[0, plinthH + bodyH / 2, 0]}>
              <boxGeometry args={[w, bodyH, d]} />
              <meshStandardMaterial
                color="#7c4a24"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.62}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
          </>
        )
      }
      case 'table': {
        const topT = Math.min(0.05, h * 0.16)
        const legH = Math.max(0.08, h - topT)
        const legW = Math.min(0.06, Math.min(w, d) * 0.12)
        const lx = w / 2 - legW * 0.9
        const lz = d / 2 - legW * 0.9
        return (
          <>
            <mesh position={[0, legH + topT / 2, 0]}>
              <boxGeometry args={[w, topT, d]} />
              <meshStandardMaterial
                color="#a8a29e"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.55}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            {[
              [-lx, -lz],
              [lx, -lz],
              [-lx, lz],
              [lx, lz],
            ].map(([px, pz], idx) => (
              <mesh key={idx} position={[px, legH / 2, pz]}>
                <boxGeometry args={[legW, legH, legW]} />
                <meshStandardMaterial color="#3f3f46" roughness={0.7} transparent={transparent} opacity={opacity} />
              </mesh>
            ))}
          </>
        )
      }
      case 'basstrap': {
        const slatT = 0.025
        return (
          <>
            <mesh position={[0, h / 2, 0]}>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial
                color="#134e4a"
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                roughness={0.9}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
            {[-0.28, 0, 0.28].map((frac, idx) => (
              <mesh key={idx} position={[frac * w, h / 2, d / 2 + slatT * 0.3]}>
                <boxGeometry args={[Math.max(0.02, w * 0.08), h * 0.96, slatT]} />
                <meshStandardMaterial color="#78350f" roughness={0.65} transparent={transparent} opacity={opacity} />
              </mesh>
            ))}
          </>
        )
      }
      case 'pillar':
      default:
        return (
          <mesh position={[0, h / 2, 0]}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial
              color="#64748b"
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              roughness={0.78}
              transparent={transparent}
              opacity={opacity}
            />
          </mesh>
        )
    }
  }

  return (
    <group position={[obs.x, obs.z, obs.y]} rotation={[0, -rad, 0]}>
      {renderBody()}
    </group>
  )
}

function FurnitureMeshes({
  obstacles,
  selectedId,
}: {
  obstacles: RoomObstacle[]
  selectedId: string | null
}) {
  return (
    <>
      {obstacles.map((obs) => (
        <FurnitureItemMesh key={obs.id} obs={obs} selected={obs.id === selectedId} />
      ))}
    </>
  )
}

function Subs({ subs, selectedId }: { subs: Subwoofer[]; selectedId: string | null }) {
  return (
    <>
      {subs.map((s) => {
        const size = 0.42
        const color = subColor(s.id)
        const selected = s.id === selectedId
        return (
          <group key={s.id} position={[s.x, s.z + size / 2, s.y]}>
            <mesh castShadow>
              <boxGeometry args={[size, size, size]} />
              <meshStandardMaterial
                color={s.enabled ? color : '#555'}
                emissive={selected ? color : '#000'}
                emissiveIntensity={selected ? 0.35 : 0}
                roughness={0.55}
              />
            </mesh>
            <mesh position={[0, 0, size / 2 + 0.001]}>
              <circleGeometry args={[size * 0.3, 24]} />
              <meshStandardMaterial color="#1a1a1a" />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

function PreviewSubs({ subs }: { subs: Subwoofer[] }) {
  return (
    <>
      {subs.map((s) => {
        const size = 0.44
        return (
          <group key={`preview-${s.id}`} position={[s.x, s.z + size / 2, s.y]}>
            <mesh renderOrder={8}>
              <boxGeometry args={[size, size, size]} />
              <meshBasicMaterial color="#5fd68a" transparent opacity={0.28} depthWrite={false} />
            </mesh>
            <mesh renderOrder={9}>
              <boxGeometry args={[size + 0.015, size + 0.015, size + 0.015]} />
              <meshBasicMaterial color="#5fd68a" wireframe transparent opacity={0.85} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

const _dummy = new THREE.Object3D()
const _sampleColor = new THREE.Color()

function SweetSpotBox({
  evaluation,
  grid,
  heatRangeDb,
  earHeight,
}: {
  evaluation: SweetSpotEvaluation
  grid: HeatmapGrid | null
  heatRangeDb: number
  earHeight: number
}) {
  const { bounds, samples, spanDb, bipolar } = evaluation
  const dx = Math.max(0.05, bounds.maxX - bounds.minX)
  const dy = Math.max(0.05, bounds.maxY - bounds.minY)
  const dz = Math.max(0.05, bounds.maxZ - bounds.minZ)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2

  const frameColor = spanDb < 4 ? '#5fd68a' : spanDb < 8 ? '#f5b942' : '#f43f5e'

  const boxGeo = useMemo(() => new THREE.BoxGeometry(dx, dz, dy), [dx, dy, dz])
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo, 1), [boxGeo])
  const earSliceGeo = useMemo(() => {
    const hw = dx / 2
    const hd = dy / 2
    const pts = [
      new THREE.Vector3(-hw, earHeight - cz, -hd),
      new THREE.Vector3(hw, earHeight - cz, -hd),
      new THREE.Vector3(hw, earHeight - cz, -hd),
      new THREE.Vector3(hw, earHeight - cz, hd),
      new THREE.Vector3(hw, earHeight - cz, hd),
      new THREE.Vector3(-hw, earHeight - cz, hd),
      new THREE.Vector3(-hw, earHeight - cz, hd),
      new THREE.Vector3(-hw, earHeight - cz, -hd),
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [dx, dy, earHeight, cz])

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.028, 12, 12), [])

  useEffect(() => {
    return () => {
      boxGeo.dispose()
      edgesGeo.dispose()
      earSliceGeo.dispose()
      sphereGeo.dispose()
    }
  }, [boxGeo, edgesGeo, earSliceGeo, sphereGeo])

  const instancedRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = instancedRef.current
    if (!mesh || samples.length === 0) return

    if (bipolar) {
      const absMax = Math.max(
        1e-6,
        grid?.bipolar ? Math.abs(grid.max) : Math.max(Math.abs(evaluation.minValue), Math.abs(evaluation.maxValue)),
      )
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        _dummy.position.set(s.x, s.z, s.y)
        _dummy.updateMatrix()
        mesh.setMatrixAt(i, _dummy.matrix)
        const [r, g, b] = bipolarColor(0.5 + 0.5 * (s.value / absMax))
        _sampleColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
        mesh.setColorAt(i, _sampleColor)
      }
    } else {
      const top = grid && !grid.bipolar ? grid.max : evaluation.maxValue
      const minRef = grid && !grid.bipolar ? grid.min : evaluation.minValue
      const bottom = Math.max(minRef, top - heatRangeDb)
      const span = Math.max(1e-6, top - bottom)
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        _dummy.position.set(s.x, s.z, s.y)
        _dummy.updateMatrix()
        mesh.setMatrixAt(i, _dummy.matrix)
        const [r, g, b] = heatColor((s.value - bottom) / span)
        _sampleColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
        mesh.setColorAt(i, _sampleColor)
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [samples, bipolar, grid, heatRangeDb, evaluation.minValue, evaluation.maxValue])

  return (
    <group>
      <group position={[cx, cz, cy]}>
        <mesh geometry={boxGeo} renderOrder={5}>
          <meshBasicMaterial
            color={frameColor}
            transparent
            opacity={0.07}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <lineSegments geometry={edgesGeo} renderOrder={6}>
          <lineBasicMaterial color={frameColor} transparent opacity={0.85} />
        </lineSegments>
        {earHeight >= bounds.minZ - 1e-4 && earHeight <= bounds.maxZ + 1e-4 && (
          <lineSegments geometry={earSliceGeo} renderOrder={6}>
            <lineBasicMaterial color="#4fb3e8" transparent opacity={0.55} />
          </lineSegments>
        )}
      </group>
      {samples.length > 0 && (
        <instancedMesh
          key={samples.length}
          ref={instancedRef}
          args={[sphereGeo, undefined, samples.length]}
          frustumCulled={false}
          renderOrder={7}
        >
          <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.05} />
        </instancedMesh>
      )}
    </group>
  )
}

function Listener({ p, earHeight }: { p: ListeningPoint; earHeight: number }) {
  const points = useMemo(
    () => [new THREE.Vector3(p.x, 0, p.y), new THREE.Vector3(p.x, earHeight, p.y)],
    [p.x, p.y, earHeight],
  )
  const lineGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points])
  useEffect(() => () => lineGeo.dispose(), [lineGeo])
  return (
    <group>
      <mesh position={[p.x, earHeight, p.y]}>
        <sphereGeometry args={[0.09, 20, 20]} />
        <meshStandardMaterial color="#4fb3e8" emissive="#4fb3e8" emissiveIntensity={0.5} />
      </mesh>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color="#4fb3e8" />
      </lineSegments>
    </group>
  )
}

/** Re-frames the camera whenever the room footprint changes so the whole room stays in view. */
function CameraRig({ cx, cy, width, depth, H }: { cx: number; cy: number; width: number; depth: number; H: number }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    const diag = Math.hypot(width, depth, H)
    camera.position.set(cx + width * 0.85, H * 1.6 + diag * 0.25, cy + depth * 1.15)
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    if (orbit) {
      orbit.target.set(cx, H / 2, cy)
      orbit.update()
    } else {
      camera.lookAt(cx, H / 2, cy)
    }
  }, [camera, controls, cx, cy, width, depth, H])
  return null
}

function WebGLContextMonitor({ onContextChange }: { onContextChange: (lost: boolean) => void }) {
  const { gl } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const handleLost = (e: Event) => {
      e.preventDefault()
      onContextChange(true)
    }
    const handleRestored = () => {
      onContextChange(false)
    }
    canvas.addEventListener('webglcontextlost', handleLost)
    canvas.addEventListener('webglcontextrestored', handleRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost)
      canvas.removeEventListener('webglcontextrestored', handleRestored)
    }
  }, [gl, onContextChange])
  return null
}

export default function Room3D({
  room,
  subs,
  listening,
  earHeight,
  grid,
  volume,
  view3dMode,
  volumeOpacity,
  showMaxima,
  showNulls,
  showHeatmap,
  heatRangeDb,
  selectedId,
  obstacles = [],
  selectedObstacleId = null,
  sweetSpotEval = null,
  previewSubs = null,
}: Room3DProps) {
  const [contextLost, setContextLost] = useState(false)
  const valid = isRoomGeometryValid(room)
  const bounds = getBounds(room)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const diag = Math.hypot(bounds.width, bounds.depth, bounds.H)
  const target: [number, number, number] = [cx, bounds.H / 2, cy]

  if (!valid) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Ungültiger Grundriss: Wände dürfen sich nicht schneiden.
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{
          position: [cx + bounds.width * 0.85, bounds.H * 1.6 + diag * 0.25, cy + bounds.depth * 1.15],
          fov: 42,
          near: 0.05,
          far: 500,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <WebGLContextMonitor onContextChange={setContextLost} />
        <hemisphereLight args={['#dce8ff', '#1e222b', 0.65]} />
        <directionalLight
          position={[cx + bounds.width * 1.2, bounds.H * 3.2, cy + bounds.depth * 1.1]}
          intensity={1.15}
          color="#fff7ed"
        />
        <directionalLight
          position={[cx - bounds.width * 1.3, bounds.H * 1.6, cy - bounds.depth * 1.4]}
          intensity={0.55}
          color="#bfdbfe"
        />
        <Floor room={room} />
        <gridHelper
          args={[
            Math.ceil(Math.max(bounds.width, bounds.depth)) * 2,
            Math.ceil(Math.max(bounds.width, bounds.depth)) * 2,
            '#3a3e47',
            '#2c2f36',
          ]}
          position={[cx, 0.002, cy]}
        />
        <RoomShell room={room} />
        <FurnitureMeshes obstacles={obstacles} selectedId={selectedObstacleId} />
        {showHeatmap && (view3dMode === 'plane' || view3dMode === 'both') && grid && (
          <HeatPlane grid={grid} earHeight={earHeight} heatRangeDb={heatRangeDb} />
        )}
        {showHeatmap && (view3dMode === 'iso' || view3dMode === 'both') && volume && (
          <IsosurfaceLayers
            volume={volume}
            heatRangeDb={heatRangeDb}
            opacity={volumeOpacity}
            showMaxima={showMaxima}
            showNulls={showNulls}
          />
        )}
        {sweetSpotEval && (
          <SweetSpotBox
            evaluation={sweetSpotEval}
            grid={grid}
            heatRangeDb={heatRangeDb}
            earHeight={earHeight}
          />
        )}
        <Subs subs={subs} selectedId={selectedId} />
        {previewSubs && previewSubs.length > 0 && <PreviewSubs subs={previewSubs} />}
        <Listener p={listening} earHeight={earHeight} />
        <CameraRig cx={cx} cy={cy} width={bounds.width} depth={bounds.depth} H={bounds.H} />
        <OrbitControls
          makeDefault
          target={target}
          enableDamping
          dampingFactor={0.1}
          minDistance={1}
          maxDistance={diag * 4}
        />
      </Canvas>
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface p-4 text-center text-xs text-muted-foreground">
          WebGL-Kontext unterbrochen – 3D-Ansicht wird wiederhergestellt…
        </div>
      )}
    </div>
  )
}


