import {
  clampToPolygon,
  ensureCCW,
  isSimplePolygon,
  locatePointInMesh,
  pointInPolygon,
  polygonArea,
  polygonPerimeter,
  solvePolygonModes2D,
  type FemObstacleInput,
  type FemSolution,
  type Point2D,
} from './fem2d'
import {
  FURNITURE_DEFAULT_ABSORPTION,
  getObstacleAbsorption,
  getObstacleArea,
  getObstaclePolygon,
  getObstacleSamplePoints,
  isPointInObstacle2D,
  isPointInObstacle3D,
  isPorousAbsorberKind,
  type FurniturePreset,
  type RoomObstacle,
} from './furniture'

export type { Point2D, FemSolution } from './fem2d'
export type { RoomObstacle, FurnitureKind, FurniturePreset } from './furniture'
export { FURNITURE_DEFAULT_ABSORPTION, getObstacleAbsorption, isPorousAbsorberKind } from './furniture'

export type RoomShape = 'rect' | 'lshape' | 'polygon'

export interface RoomConfig {
  shape: RoomShape
  /** Segment A: length along x (m) */
  L1: number
  /** Segment A: width along y (m) */
  W1: number
  /** Segment B (L-shape only): length along x, attached above segment A at y = W1 */
  L2: number
  /** Segment B (L-shape only): depth along y */
  W2: number
  /** Custom polygon vertices (when shape === 'polygon') */
  polygon: Point2D[]
  /** Room height (m) */
  H: number
}

export interface Subwoofer {
  id: string
  name: string
  x: number
  y: number
  z: number
  /** Gain in dB */
  gain: number
  /** Phase in degrees (0 or 180) */
  phase: 0 | 180
  enabled: boolean
}

export interface ListeningPoint {
  x: number
  y: number
}

export interface AnalysisSettings {
  /** Speed of sound (m/s) */
  c: number
  /** Modal damping (loss factor). Q = 1/eta */
  eta: number
  /** Ear height / cut plane height (m) */
  earHeight: number
  fMin: number
  fMax: number
  /** Maximum mode index per axis */
  nMax: number
}

export type ModeType = 'axial' | 'tangential' | 'oblique'

export interface Segment {
  id: 'A' | 'B'
  x0: number
  y0: number
  Lx: number
  Ly: number
  Lz: number
}

export interface RoomMode {
  id: string
  segment: 'A' | 'B' | 'FEM'
  nx: number
  ny: number
  nz: number
  /** 2D horizontal FEM mode index (0 = DC mode) when segment === 'FEM' */
  femIndex?: number
  f: number
  type: ModeType
  /** Effective modal loss factor including furniture damping (defaults to settings.eta) */
  eta?: number
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  c: 343,
  eta: 0.05,
  earHeight: 1.2,
  fMin: 20,
  fMax: 200,
  nMax: 8,
}

export function makeRectPolygon(L: number, W: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ]
}

export function makeLShapePolygon(L1 = 6.2, W1 = 4.35, L2 = 3.0, W2 = 2.5): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: L1, y: 0 },
    { x: L1, y: W1 },
    { x: L2, y: W1 },
    { x: L2, y: W1 + W2 },
    { x: 0, y: W1 + W2 },
  ]
}

export function makeUShapePolygon(): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: 6.4, y: 0 },
    { x: 6.4, y: 4.8 },
    { x: 4.5, y: 4.8 },
    { x: 4.5, y: 2.8 },
    { x: 1.9, y: 2.8 },
    { x: 1.9, y: 4.8 },
    { x: 0, y: 4.8 },
  ]
}

export function makeTrapezoidPolygon(): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: 6.2, y: 0.5 },
    { x: 6.2, y: 3.9 },
    { x: 0, y: 4.4 },
  ]
}

export const DEFAULT_ROOM: RoomConfig = {
  shape: 'rect',
  L1: 6.2,
  W1: 4.35,
  L2: 3.0,
  W2: 2.5,
  polygon: makeLShapePolygon(6.2, 4.35, 3.0, 2.5),
  H: 2.6,
}

export function getRoomPolygon(room: RoomConfig): Point2D[] {
  if (room.shape === 'rect') return makeRectPolygon(room.L1, room.W1)
  if (room.shape === 'lshape') return makeLShapePolygon(room.L1, room.W1, room.L2, room.W2)
  return room.polygon
}

export function getSegments(room: RoomConfig): Segment[] {
  const a: Segment = { id: 'A', x0: 0, y0: 0, Lx: room.L1, Ly: room.W1, Lz: room.H }
  if (room.shape === 'rect') return [a]
  const b: Segment = { id: 'B', x0: 0, y0: room.W1, Lx: room.L2, Ly: room.W2, Lz: room.H }
  return [a, b]
}

export function getBounds(room: RoomConfig) {
  if (room.shape === 'rect') {
    return {
      minX: 0,
      minY: 0,
      maxX: room.L1,
      maxY: room.W1,
      width: room.L1,
      depth: room.W1,
      H: room.H,
    }
  }
  const poly = getRoomPolygon(room)
  if (poly.length === 0) {
    return { minX: 0, minY: 0, maxX: 6, maxY: 4, width: 6, depth: 4, H: room.H }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0.5, maxX - minX),
    depth: Math.max(0.5, maxY - minY),
    H: room.H,
  }
}

export function getRoomArea(room: RoomConfig): number {
  if (room.shape === 'rect') return room.L1 * room.W1
  return polygonArea(getRoomPolygon(room))
}

export function getRoomPerimeter(room: RoomConfig): number {
  return polygonPerimeter(getRoomPolygon(room))
}

export function isRoomGeometryValid(room: RoomConfig): boolean {
  if (room.shape === 'rect') return room.L1 > 0.2 && room.W1 > 0.2 && room.H > 0.5
  return room.H > 0.5 && isSimplePolygon(getRoomPolygon(room))
}

export function segmentAt(room: RoomConfig, x: number, y: number): Segment | null {
  const segs = getSegments(room)
  for (const s of segs) {
    if (x >= s.x0 - 1e-9 && x <= s.x0 + s.Lx + 1e-9 && y >= s.y0 - 1e-9 && y <= s.y0 + s.Ly + 1e-9) return s
  }
  return null
}

export function isInsideRoom(room: RoomConfig, x: number, y: number) {
  if (room.shape === 'rect') return segmentAt(room, x, y) !== null
  if (room.shape === 'lshape') return segmentAt(room, x, y) !== null
  return pointInPolygon(room.polygon, x, y)
}

/** Clamp a point into the room footprint (nearest valid position). */
export function clampToRoom(room: RoomConfig, x: number, y: number): { x: number; y: number } {
  if (room.shape === 'polygon') {
    return clampToPolygon(room.polygon, x, y)
  }
  if (isInsideRoom(room, x, y)) return { x, y }
  let best = { x, y }
  let bestD = Infinity
  for (const s of getSegments(room)) {
    const cx = Math.min(Math.max(x, s.x0), s.x0 + s.Lx)
    const cy = Math.min(Math.max(y, s.y0), s.y0 + s.Ly)
    const d = (cx - x) ** 2 + (cy - y) ** 2
    if (d < bestD) {
      bestD = d
      best = { x: cx, y: cy }
    }
  }
  return best
}

export function clampObstacleToRoom(room: RoomConfig, obs: RoomObstacle): RoomObstacle {
  const c = clampToRoom(room, obs.x, obs.y)
  const z = Math.min(Math.max(0, obs.z), Math.max(0, room.H - 0.1))
  const height = Math.min(room.H - z, Math.max(0.15, obs.height))
  return {
    ...obs,
    x: Number(c.x.toFixed(2)),
    y: Number(c.y.toFixed(2)),
    z: Number(z.toFixed(2)),
    width: Number(Math.min(12, Math.max(0.2, obs.width)).toFixed(2)),
    depth: Number(Math.min(12, Math.max(0.2, obs.depth)).toFixed(2)),
    height: Number(height.toFixed(2)),
    rotation: ((Math.round(obs.rotation) % 360) + 360) % 360,
  }
}

export function createObstacleFromPreset(preset: FurniturePreset, room: RoomConfig, existingCount: number): RoomObstacle {
  const bounds = getBounds(room)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const offset = (existingCount % 4) * 0.25
  const rawPos = clampToRoom(room, cx + offset - 0.25, cy + offset - 0.25)
  return clampObstacleToRoom(room, {
    id: `obs-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    kind: preset.kind,
    name: preset.defaultName,
    x: rawPos.x,
    y: rawPos.y,
    z: 0,
    width: Math.min(preset.width, bounds.width * 0.85),
    depth: Math.min(preset.depth, bounds.depth * 0.85),
    height: preset.fullHeight ? room.H : Math.min(preset.height, room.H),
    rotation: 0,
    enabled: true,
  })
}

export function classifyMode(nx: number, ny: number, nz: number): ModeType {
  const zeros = [nx, ny, nz].filter((n) => n === 0).length
  if (zeros >= 2) return 'axial'
  if (zeros === 1) return 'tangential'
  return 'oblique'
}

export function modeFrequency(seg: Segment, nx: number, ny: number, nz: number, c: number) {
  return (c / 2) * Math.sqrt((nx / seg.Lx) ** 2 + (ny / seg.Ly) ** 2 + (nz / seg.Lz) ** 2)
}

export function solveRoomFem(
  room: RoomConfig,
  settings: AnalysisSettings,
  fLimit: number,
  obstacles: readonly RoomObstacle[] = [],
): FemSolution | null {
  const solidObstacles = obstacles.filter((o) => o.enabled && !isPorousAbsorberKind(o.kind))
  if (room.shape === 'rect' && solidObstacles.length === 0) return null
  const poly = ensureCCW(getRoomPolygon(room))
  const femObstacles: FemObstacleInput[] = solidObstacles.map((o) => ({
    polygon: getObstaclePolygon(o),
    depthRatio: Math.max(0, Math.min(1, (room.H - Math.min(room.H, o.height)) / room.H)),
  }))
  return solvePolygonModes2D(poly, settings.c, fLimit, femObstacles)
}

function evalFemGradientSq(
  fem: FemSolution,
  femIndex: number,
  loc: NonNullable<ReturnType<typeof locatePointInMesh>>,
): number {
  const vals = fem.modes[femIndex]?.values
  if (!vals) return 0
  const p0 = fem.mesh.nodes[loc.i0]
  const p1 = fem.mesh.nodes[loc.i1]
  const p2 = fem.mesh.nodes[loc.i2]
  const area2 = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
  if (Math.abs(area2) < 1e-10) return 0
  const v0 = vals[loc.i0]
  const v1 = vals[loc.i1]
  const v2 = vals[loc.i2]
  const gx = (v0 * (p1.y - p2.y) + v1 * (p2.y - p0.y) + v2 * (p0.y - p1.y)) / area2
  const gy = (v0 * (p2.x - p1.x) + v1 * (p0.x - p2.x) + v2 * (p1.x - p0.x)) / area2
  return gx * gx + gy * gy
}

/**
 * Computes spatially weighted effective modal loss factors (eta_m = eta_room + delta_eta_m)
 * from active furniture and porous absorbers using local pressure & particle-velocity overlap.
 */
function applyObstacleModalDamping(
  modes: RoomMode[],
  room: RoomConfig,
  settings: AnalysisSettings,
  fem: FemSolution | null,
  obstacles: readonly RoomObstacle[],
) {
  const active = obstacles.filter((o) => o.enabled && getObstacleAbsorption(o) > 0)
  if (active.length === 0) {
    for (const m of modes) m.eta = settings.eta
    return
  }

  const roomArea = Math.max(0.25, getRoomArea(room))
  const roomVol = Math.max(0.5, roomArea * room.H)
  const segments = getSegments(room)
  const segMap = new Map<string, Segment>(segments.map((s) => [s.id, s]))

  interface PreppedObs {
    porous: boolean
    alpha: number
    activeArea: number
    fRoll: number
    z0: number
    z1: number
    dz: number
    samplePts: Point2D[]
    femLocs: NonNullable<ReturnType<typeof locatePointInMesh>>[]
  }

  const prepped: PreppedObs[] = []
  for (const o of active) {
    const z0 = Math.max(0, o.z)
    const z1 = Math.min(room.H, o.z + o.height)
    const dz = z1 - z0
    if (dz <= 0.01) continue

    const porous = isPorousAbsorberKind(o.kind)
    const alpha = getObstacleAbsorption(o)
    const poly = getObstaclePolygon(o)
    const fpArea = getObstacleArea(o)
    const fpPerim = polygonPerimeter(poly)
    const activeArea = porous
      ? fpPerim * dz * 0.65 + fpArea * (1 + dz / Math.max(0.5, room.H))
      : 0.5 * fpPerim * dz + fpArea
    const fRoll = porous ? 35 : 55

    const rawSamples = getObstacleSamplePoints(o)
    const samplePts: Point2D[] = []
    for (const pt of rawSamples) {
      if (isInsideRoom(room, pt.x, pt.y)) samplePts.push(pt)
    }
    if (samplePts.length === 0) {
      for (const vp of poly) {
        if (isInsideRoom(room, vp.x, vp.y)) samplePts.push(vp)
      }
    }
    if (samplePts.length === 0) {
      samplePts.push(clampToRoom(room, o.x, o.y))
    }

    const femLocs: NonNullable<ReturnType<typeof locatePointInMesh>>[] = []
    if (fem) {
      for (const pt of samplePts) {
        const loc = locatePointInMesh(fem.mesh, pt.x, pt.y)
        if (loc) femLocs.push(loc)
      }
      if (femLocs.length === 0) {
        for (const vp of poly) {
          const loc = locatePointInMesh(fem.mesh, vp.x, vp.y)
          if (loc) femLocs.push(loc)
        }
      }
    }

    prepped.push({ porous, alpha, activeArea, fRoll, z0, z1, dz, samplePts, femLocs })
  }

  if (prepped.length === 0) {
    for (const m of modes) m.eta = settings.eta
    return
  }

  for (const mode of modes) {
    if (mode.f <= 0.5) {
      mode.eta = settings.eta
      continue
    }

    let deltaEta = 0
    const H = room.H
    const az = (mode.nz * Math.PI) / H

    for (const obs of prepped) {
      // Vertical average of normalized cos^2 and sin^2 over [z0, z1]
      let vPress = 1
      let vGrad = 0
      if (mode.nz > 0) {
        const osc = (Math.sin(2 * az * obs.z1) - Math.sin(2 * az * obs.z0)) / (2 * az * obs.dz)
        vPress = Math.max(0, 1 + osc)
        vGrad = Math.max(0, 1 - osc)
      }

      let wSpatial = 0
      if (fem && mode.segment === 'FEM') {
        const mIdx = mode.femIndex ?? 0
        const fxy = fem.modes[mIdx]?.fxy ?? 0
        const kxy2 = fxy > 0.5 ? ((2 * Math.PI * fxy) / settings.c) ** 2 : 0
        const kz2 = az * az
        const kTot2 = kxy2 + kz2

        if (obs.femLocs.length > 0) {
          let pSum = 0
          let gSum = 0
          for (const loc of obs.femLocs) {
            const p2d = evalFemPsi2D(fem, mIdx, loc)
            const p3Sq = p2d * p2d * vPress
            pSum += p3Sq
            if (kTot2 > 1e-8) {
              const gxySq = evalFemGradientSq(fem, mIdx, loc) * vPress
              const gzSq = p2d * p2d * kz2 * vGrad
              gSum += (gxySq + gzSq) / kTot2
            }
          }
          const avgP = pSum / obs.femLocs.length
          const avgG = gSum / obs.femLocs.length
          wSpatial = obs.porous ? 0.72 * avgP + 0.28 * avgG : 0.45 * avgP + 0.55 * avgG
        } else {
          wSpatial = 1
        }
      } else {
        const seg = segMap.get(mode.segment)
        if (!seg) continue
        const kx = (mode.nx * Math.PI) / seg.Lx
        const ky = (mode.ny * Math.PI) / seg.Ly
        const kTot2 = kx * kx + ky * ky + az * az
        const normXY = eps(mode.nx) * eps(mode.ny)

        let pSum = 0
        let gSum = 0
        let cnt = 0
        for (const pt of obs.samplePts) {
          const lx = Math.min(Math.max(pt.x - seg.x0, 0), seg.Lx)
          const ly = Math.min(Math.max(pt.y - seg.y0, 0), seg.Ly)
          const cx = Math.cos(kx * lx)
          const cy = Math.cos(ky * ly)
          const sx = Math.sin(kx * lx)
          const sy = Math.sin(ky * ly)
          const p2Sq = normXY * cx * cx * cy * cy
          pSum += p2Sq * vPress
          if (kTot2 > 1e-8) {
            const gxySq = normXY * (kx * kx * sx * sx * cy * cy + ky * ky * cx * cx * sy * sy) * vPress
            const gzSq = p2Sq * az * az * vGrad
            gSum += (gxySq + gzSq) / kTot2
          }
          cnt++
        }
        if (cnt > 0) {
          const avgP = pSum / cnt
          const avgG = gSum / cnt
          wSpatial = obs.porous ? 0.72 * avgP + 0.28 * avgG : 0.45 * avgP + 0.55 * avgG
        }
      }

      const clampedW = Math.min(4.5, Math.max(0, wSpatial))
      const f2 = mode.f * mode.f
      const freqWeight = f2 / (f2 + obs.fRoll * obs.fRoll)
      const baseTerm = ((13.66 * obs.alpha * obs.activeArea) / (roomVol * mode.f)) * freqWeight
      deltaEta += baseTerm * clampedW
    }

    mode.eta = Math.min(0.45, settings.eta + deltaEta)
  }
}

/**
 * Compute all modes up to `fLimit`.
 * Rectangular rooms without solid obstacles use closed-form analytical eigenmodes;
 * L-shapes, polygons, and rooms with solid furniture obstacles use the 2D FEM Helmholtz solver + analytical z-modes.
 * Active furniture & porous absorbers contribute spatially weighted per-mode damping (m.eta).
 */
export function computeModes(
  room: RoomConfig,
  settings: AnalysisSettings,
  fLimit: number,
  fem?: FemSolution | null,
  obstacles: readonly RoomObstacle[] = [],
): RoomMode[] {
  const hasSolidObstacles = obstacles.some((o) => o.enabled && !isPorousAbsorberKind(o.kind))
  if (fem || room.shape !== 'rect' || hasSolidObstacles) {
    const sol = fem ?? solveRoomFem(room, settings, fLimit, obstacles)
    if (!sol) return []
    const modes: RoomMode[] = []
    const nzMax = Math.min(settings.nMax, Math.floor((2 * room.H * fLimit) / settings.c))
    for (const m2d of sol.modes) {
      for (let nz = 0; nz <= nzMax; nz++) {
        const fz = (settings.c * nz) / (2 * room.H)
        const f = Math.hypot(m2d.fxy, fz)
        if (f > fLimit) continue
        const type: ModeType = m2d.index === 0 ? 'axial' : nz === 0 ? 'tangential' : 'oblique'
        modes.push({
          id: `FEM-${m2d.index}-z${nz}`,
          segment: 'FEM',
          nx: m2d.index,
          ny: 0,
          nz,
          femIndex: m2d.index,
          f,
          type,
        })
      }
    }
    modes.sort((a, b) => a.f - b.f)
    applyObstacleModalDamping(modes, room, settings, sol, obstacles)
    return modes
  }

  const modes: RoomMode[] = []
  for (const seg of getSegments(room)) {
    const nxMax = Math.min(settings.nMax, Math.floor((2 * seg.Lx * fLimit) / settings.c))
    const nyMax = Math.min(settings.nMax, Math.floor((2 * seg.Ly * fLimit) / settings.c))
    const nzMax = Math.min(settings.nMax, Math.floor((2 * seg.Lz * fLimit) / settings.c))
    for (let nx = 0; nx <= nxMax; nx++) {
      for (let ny = 0; ny <= nyMax; ny++) {
        for (let nz = 0; nz <= nzMax; nz++) {
          const f = modeFrequency(seg, nx, ny, nz, settings.c)
          if (f > fLimit) continue
          modes.push({
            id: `${seg.id}-${nx}${ny}${nz}`,
            segment: seg.id,
            nx,
            ny,
            nz,
            f,
            type: classifyMode(nx, ny, nz),
          })
        }
      }
    }
  }
  modes.sort((a, b) => a.f - b.f)
  applyObstacleModalDamping(modes, room, settings, null, obstacles)
  return modes
}

/** Modes listed to the user: within [fMin, fMax]. */
export function listedModes(modes: RoomMode[], settings: AnalysisSettings) {
  return modes.filter((m) => m.f >= settings.fMin && m.f <= settings.fMax)
}

function eps(n: number) {
  return n === 0 ? 1 : 2
}

/** Normalised eigenfunction value at local coordinates for rectangular segments. */
function psi(m: RoomMode, seg: Segment, lx: number, ly: number, lz: number) {
  const norm = Math.sqrt(eps(m.nx) * eps(m.ny) * eps(m.nz))
  return (
    norm *
    Math.cos((m.nx * Math.PI * lx) / seg.Lx) *
    Math.cos((m.ny * Math.PI * ly) / seg.Ly) *
    Math.cos((m.nz * Math.PI * lz) / seg.Lz)
  )
}

function evalFemPsi2D(fem: FemSolution, femIndex: number, loc: ReturnType<typeof locatePointInMesh>): number {
  if (!loc) return NaN
  const vals = fem.modes[femIndex]?.values
  if (!vals) return 0
  return loc.w0 * vals[loc.i0] + loc.w1 * vals[loc.i1] + loc.w2 * vals[loc.i2]
}

export interface PreparedSource {
  sub: Subwoofer
  seg: Segment | null
  femLoc: ReturnType<typeof locatePointInMesh>
  /** Linear amplitude including phase sign */
  amp: number
}

export interface PreparedField {
  room: RoomConfig
  segments: Segment[]
  modes: RoomMode[]
  modesBySegment: Record<'A' | 'B', RoomMode[]>
  modeEtas: Float64Array
  modeEtasBySegment: Record<'A' | 'B', Float64Array>
  fem: FemSolution | null
  sources: PreparedSource[]
  obstacles: RoomObstacle[]
  eta: number
}

export function prepareField(
  room: RoomConfig,
  subs: Subwoofer[],
  modes: RoomMode[],
  settings: AnalysisSettings,
  fem: FemSolution | null = null,
  obstacles: readonly RoomObstacle[] = [],
  opts?: { ignoreObstacleDamping?: boolean },
): PreparedField {
  const ignoreDamping = Boolean(opts?.ignoreObstacleDamping)
  const segments = getSegments(room)
  const modesBySegment: Record<'A' | 'B', RoomMode[]> = { A: [], B: [] }
  const modeEtas = new Float64Array(modes.length)
  const segEtasA: number[] = []
  const segEtasB: number[] = []
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i]
    const mEta = ignoreDamping ? settings.eta : (m.eta ?? settings.eta)
    modeEtas[i] = mEta
    if (m.segment === 'A') {
      modesBySegment.A.push(m)
      segEtasA.push(mEta)
    } else if (m.segment === 'B') {
      modesBySegment.B.push(m)
      segEtasB.push(mEta)
    }
  }
  const modeEtasBySegment: Record<'A' | 'B', Float64Array> = {
    A: Float64Array.from(segEtasA),
    B: Float64Array.from(segEtasB),
  }
  const activeObstacles = obstacles.filter((o) => o.enabled)
  const sources: PreparedSource[] = []
  for (const sub of subs) {
    if (!sub.enabled) continue
    if (!isInsideRoom(room, sub.x, sub.y)) continue
    const amp = Math.pow(10, sub.gain / 20) * (sub.phase === 180 ? -1 : 1)
    if (fem) {
      const femLoc = locatePointInMesh(fem.mesh, sub.x, sub.y)
      if (!femLoc) continue
      sources.push({ sub, seg: null, femLoc, amp })
    } else {
      const seg = segmentAt(room, sub.x, sub.y)
      if (!seg) continue
      sources.push({ sub, seg, femLoc: null, amp })
    }
  }
  return {
    room,
    segments,
    modes,
    modesBySegment,
    modeEtas,
    modeEtasBySegment,
    fem,
    sources,
    obstacles: activeObstacles,
    eta: settings.eta,
  }
}

const CROSS_SEGMENT_COUPLING = 0.5

interface PrecomputedPointFem {
  loc: NonNullable<ReturnType<typeof locatePointInMesh>>
  /** Precomputed numerator per FEM mode index */
  nums: Float64Array
}

function precomputePointFem(field: PreparedField, x: number, y: number, z: number): PrecomputedPointFem | null {
  const fem = field.fem
  if (!fem) return null
  const loc = locatePointInMesh(fem.mesh, x, y)
  if (!loc) return null
  const H = field.room.H
  const nums = new Float64Array(field.modes.length)

  // Cache 2D values at receiver (x, y) and each source
  const n2d = fem.modes.length
  const rx2d = new Float64Array(n2d)
  for (let m = 0; m < n2d; m++) rx2d[m] = evalFemPsi2D(fem, m, loc)

  for (const src of field.sources) {
    if (!src.femLoc) continue
    for (let i = 0; i < field.modes.length; i++) {
      const mode = field.modes[i]
      const mIdx = mode.femIndex ?? 0
      const psiR2d = rx2d[mIdx]
      const psiS2d = evalFemPsi2D(fem, mIdx, src.femLoc)
      const zScale =
        eps(mode.nz) * Math.cos((mode.nz * Math.PI * z) / H) * Math.cos((mode.nz * Math.PI * src.sub.z) / H)
      nums[i] += psiR2d * psiS2d * zScale * src.amp
    }
  }
  return { loc, nums }
}

function pressureFromPrecomputedFem(field: PreparedField, pt: PrecomputedPointFem, f: number): [number, number] {
  const f2 = f * f
  let re = 0
  let im = 0
  for (let i = 0; i < field.modes.length; i++) {
    const num = pt.nums[i]
    if (num === 0) continue
    const fm = field.modes[i].f
    const fm2 = fm * fm
    const dRe = fm2 - f2
    const dIm = field.modeEtas[i] * (fm2 > 0 ? fm2 : f2)
    const den = dRe * dRe + dIm * dIm
    if (den === 0) continue
    re += (num * dRe) / den
    im += (-num * dIm) / den
  }
  return [re, im]
}

/**
 * Complex pressure at (x, y, z) for frequency f, summed over all sources and modes.
 * Returns [re, im].
 */
export function pressureAt(field: PreparedField, x: number, y: number, z: number, f: number): [number, number] {
  if (field.fem) {
    const pt = precomputePointFem(field, x, y, z)
    if (!pt) return [NaN, NaN]
    return pressureFromPrecomputedFem(field, pt, f)
  }

  const seg = segmentAt(field.room, x, y)
  if (!seg) return [NaN, NaN]
  const modes = field.modesBySegment[seg.id]
  const segEtas = field.modeEtasBySegment[seg.id]
  const lx = x - seg.x0
  const ly = y - seg.y0
  const f2 = f * f
  let re = 0
  let im = 0
  for (const src of field.sources) {
    if (!src.seg) continue
    let sx: number
    let sy: number
    let coupling = 1
    if (src.seg.id === seg.id) {
      sx = src.sub.x - seg.x0
      sy = src.sub.y - seg.y0
    } else {
      sx = Math.min(Math.max(src.sub.x - seg.x0, 0), seg.Lx)
      sy = Math.min(Math.max(src.sub.y - seg.y0, 0), seg.Ly)
      coupling = CROSS_SEGMENT_COUPLING
    }
    const amp = src.amp * coupling
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i]
      const num = psi(m, seg, lx, ly, z) * psi(m, seg, sx, sy, src.sub.z) * amp
      if (num === 0) continue
      const fm2 = m.f * m.f
      const dRe = fm2 - f2
      const dIm = segEtas[i] * (fm2 > 0 ? fm2 : f2)
      const den = dRe * dRe + dIm * dIm
      if (den === 0) continue
      re += (num * dRe) / den
      im += (-num * dIm) / den
    }
  }
  return [re, im]
}

export function magnitudeDb(re: number, im: number) {
  const mag = Math.hypot(re, im)
  if (!Number.isFinite(mag) || mag <= 0) return -Infinity
  return 20 * Math.log10(mag)
}

/** Field of a single mode (mode shape weighted by source coupling), returns signed amplitude. */
export function singleModeAmplitude(field: PreparedField, mode: RoomMode, x: number, y: number, z: number) {
  if (field.fem && mode.segment === 'FEM') {
    const loc = locatePointInMesh(field.fem.mesh, x, y)
    if (!loc) return NaN
    const mIdx = mode.femIndex ?? 0
    const H = field.room.H
    let weight = 0
    for (const src of field.sources) {
      if (!src.femLoc) continue
      const psiS =
        evalFemPsi2D(field.fem, mIdx, src.femLoc) *
        Math.sqrt(eps(mode.nz)) *
        Math.cos((mode.nz * Math.PI * src.sub.z) / H)
      weight += src.amp * psiS
    }
    if (field.sources.length === 0) weight = 1
    const psiR = evalFemPsi2D(field.fem, mIdx, loc) * Math.sqrt(eps(mode.nz)) * Math.cos((mode.nz * Math.PI * z) / H)
    return psiR * weight
  }

  const seg = segmentAt(field.room, x, y)
  if (!seg || seg.id !== mode.segment) return NaN
  let weight = 0
  for (const src of field.sources) {
    if (!src.seg || src.seg.id !== seg.id) continue
    weight += src.amp * psi(mode, seg, src.sub.x - seg.x0, src.sub.y - seg.y0, src.sub.z)
  }
  if (field.sources.length === 0) weight = 1
  return psi(mode, seg, x - seg.x0, y - seg.y0, z) * weight
}

export interface FrequencyResponsePoint {
  f: number
  db: number
}

/** Frequency response at a point, normalised so the band mean is 0 dB. */
export function frequencyResponse(
  field: PreparedField,
  x: number,
  y: number,
  z: number,
  fMin: number,
  fMax: number,
  step = 0.5,
): FrequencyResponsePoint[] {
  const points: FrequencyResponsePoint[] = []
  const ptFem = field.fem ? precomputePointFem(field, x, y, z) : null
  for (let f = fMin; f <= fMax + 1e-9; f += step) {
    const [re, im] = field.fem
      ? ptFem
        ? pressureFromPrecomputedFem(field, ptFem, f)
        : [NaN, NaN]
      : pressureAt(field, x, y, z, f)
    points.push({ f: Math.round(f * 100) / 100, db: magnitudeDb(re, im) })
  }
  const finite = points.filter((p) => Number.isFinite(p.db))
  if (finite.length === 0) return points.map((p) => ({ ...p, db: 0 }))
  const mean = finite.reduce((s, p) => s + p.db, 0) / finite.length
  return points.map((p) => ({ f: p.f, db: Number.isFinite(p.db) ? p.db - mean : -60 }))
}

export interface SweetSpotConfig {
  enabled: boolean
  /** Width along X around listening.x (m) */
  width: number
  /** Depth along Y around listening.y (m) */
  depth: number
  /** Height along Z around earHeight (m) */
  height: number
}

export const DEFAULT_SWEET_SPOT: SweetSpotConfig = {
  enabled: true,
  width: 1.2,
  depth: 0.6,
  height: 0.4,
}

export interface SweetSpotBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface SweetSpotSample {
  x: number
  y: number
  z: number
  value: number
  deltaDb: number
}

export interface SweetSpotEvaluation {
  samples: SweetSpotSample[]
  centerValue: number
  minValue: number
  maxValue: number
  spanDb: number
  stdDb: number
  bounds: SweetSpotBounds
  bipolar: boolean
}

export interface SweetSpotEnvelopePoint {
  f: number
  minDb: number
  maxDb: number
}

export function clampSweetSpotConfig(room: RoomConfig, zone: SweetSpotConfig): SweetSpotConfig {
  const b = getBounds(room)
  return {
    enabled: Boolean(zone.enabled),
    width: Number(Math.min(Math.max(0.2, b.width), Math.max(0.2, zone.width)).toFixed(2)),
    depth: Number(Math.min(Math.max(0.2, b.depth), Math.max(0.2, zone.depth)).toFixed(2)),
    height: Number(Math.min(Math.max(0.15, room.H - 0.1), Math.max(0.1, zone.height)).toFixed(2)),
  }
}

export function getSweetSpotBounds(
  room: RoomConfig,
  listening: ListeningPoint,
  earHeight: number,
  zone: SweetSpotConfig,
): SweetSpotBounds {
  const rb = getBounds(room)
  const hw = zone.width / 2
  const hd = zone.depth / 2
  const hh = zone.height / 2
  const minZ = Math.max(0.05, Math.min(room.H - 0.15, earHeight - hh))
  const maxZ = Math.min(room.H - 0.05, Math.max(minZ + 0.08, earHeight + hh))
  const minX = Math.max(rb.minX + 0.02, listening.x - hw)
  const maxX = Math.min(rb.maxX - 0.02, Math.max(minX + 0.1, listening.x + hw))
  const minY = Math.max(rb.minY + 0.02, listening.y - hd)
  const maxY = Math.min(rb.maxY - 0.02, Math.max(minY + 0.1, listening.y + hd))
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function pointBandDb(
  field: PreparedField,
  x: number,
  y: number,
  z: number,
  freqs: number[],
): number {
  const ptFem = field.fem ? precomputePointFem(field, x, y, z) : null
  if (field.fem && !ptFem) return NaN
  let sum = 0
  let count = 0
  for (let i = 0; i < freqs.length; i++) {
    const [re, im] = field.fem
      ? pressureFromPrecomputedFem(field, ptFem!, freqs[i])
      : pressureAt(field, x, y, z, freqs[i])
    const mag2 = re * re + im * im
    if (Number.isFinite(mag2) && mag2 > 0) {
      sum += mag2
      count++
    }
  }
  return count > 0 ? 10 * Math.log10(sum / count) : NaN
}

export function evaluateSweetSpotZone(
  field: PreparedField,
  listening: ListeningPoint,
  earHeight: number,
  zone: SweetSpotConfig,
  opts: {
    mode: HeatmapMode
    frequency: number
    singleMode: RoomMode | null
    fMin: number
    fMax: number
  },
): SweetSpotEvaluation | null {
  if (!zone.enabled) return null
  const bounds = getSweetSpotBounds(field.room, listening, earHeight, zone)
  const nx = 5
  const ny = 4
  const nz = 3
  const bipolar = opts.mode === 'single'

  const freqs: number[] = []
  if (opts.mode === 'band') {
    const steps = 13
    const f0 = Math.max(1, opts.fMin)
    const f1 = Math.max(f0 + 1, opts.fMax)
    for (let i = 0; i < steps; i++) {
      freqs.push(f0 * Math.pow(f1 / f0, i / (steps - 1)))
    }
  }

  const evalPoint = (x: number, y: number, z: number): number => {
    if (!isInsideRoom(field.room, x, y)) return NaN
    for (const o of field.obstacles) {
      if (isPointInObstacle3D(o, x, y, z)) return NaN
    }
    if (opts.mode === 'single') {
      if (!opts.singleMode) return 0
      return singleModeAmplitude(field, opts.singleMode, x, y, z)
    }
    if (opts.mode === 'band') {
      return pointBandDb(field, x, y, z, freqs)
    }
    const [re, im] = pressureAt(field, x, y, z, opts.frequency)
    return magnitudeDb(re, im)
  }

  const rawCenter = evalPoint(listening.x, listening.y, earHeight)
  const samples: SweetSpotSample[] = []
  let minValue = Infinity
  let maxValue = -Infinity

  for (let ix = 0; ix < nx; ix++) {
    const x = bounds.minX + ((bounds.maxX - bounds.minX) * ix) / (nx - 1)
    for (let iy = 0; iy < ny; iy++) {
      const y = bounds.minY + ((bounds.maxY - bounds.minY) * iy) / (ny - 1)
      for (let iz = 0; iz < nz; iz++) {
        const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * iz) / (nz - 1)
        const v = evalPoint(x, y, z)
        if (!Number.isFinite(v)) continue
        if (v < minValue) minValue = v
        if (v > maxValue) maxValue = v
        samples.push({ x, y, z, value: v, deltaDb: 0 })
      }
    }
  }

  if (samples.length === 0) {
    return {
      samples: [],
      centerValue: 0,
      minValue: 0,
      maxValue: 0,
      spanDb: 0,
      stdDb: 0,
      bounds,
      bipolar,
    }
  }

  const centerValue = Number.isFinite(rawCenter)
    ? rawCenter
    : samples.reduce((s, p) => s + p.value, 0) / samples.length

  if (bipolar) {
    let absMax = Math.abs(centerValue)
    for (const s of samples) {
      const av = Math.abs(s.value)
      if (av > absMax) absMax = av
    }
    const safeMax = Math.max(1e-6, absMax)
    const dbVals: number[] = []
    for (const s of samples) {
      const db = Math.abs(s.value) > 0 ? 20 * Math.log10(Math.abs(s.value) / safeMax) : -40
      const cDb = Math.abs(centerValue) > 0 ? 20 * Math.log10(Math.abs(centerValue) / safeMax) : -40
      s.deltaDb = db - cDb
      dbVals.push(db)
    }
    const maxDb = Math.max(...dbVals)
    const minDb = Math.min(...dbVals)
    const meanDb = dbVals.reduce((a, b) => a + b, 0) / dbVals.length
    const stdDb = Math.sqrt(dbVals.reduce((a, b) => a + (b - meanDb) ** 2, 0) / dbVals.length)
    return {
      samples,
      centerValue,
      minValue,
      maxValue,
      spanDb: Math.min(40, maxDb - minDb),
      stdDb,
      bounds,
      bipolar: true,
    }
  }

  let sum = 0
  for (const s of samples) {
    s.deltaDb = s.value - centerValue
    sum += s.value
  }
  const mean = sum / samples.length
  let varSum = 0
  for (const s of samples) varSum += (s.value - mean) ** 2

  return {
    samples,
    centerValue,
    minValue,
    maxValue,
    spanDb: Math.max(0, maxValue - minValue),
    stdDb: Math.sqrt(varSum / samples.length),
    bounds,
    bipolar: false,
  }
}

/**
 * Min/max SPL envelope across representative points in the Sweet-Spot-Box,
 * normalized relative to the center listening position's band mean.
 */
export function sweetSpotResponseEnvelope(
  field: PreparedField,
  listening: ListeningPoint,
  earHeight: number,
  zone: SweetSpotConfig,
  fMin: number,
  fMax: number,
  step = 0.5,
): SweetSpotEnvelopePoint[] | null {
  if (!zone.enabled) return null
  const b = getSweetSpotBounds(field.room, listening, earHeight, zone)
  const xs = [b.minX, (b.minX + b.maxX) / 2, b.maxX]
  const ys = [b.minY, (b.minY + b.maxY) / 2, b.maxY]
  const zs = [b.minZ, earHeight, b.maxZ]

  const pts: { x: number; y: number; z: number }[] = []
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        // Keep center + corners + mid-edges (skip inner redundancies except center)
        const isCenterXY = Math.abs(x - (b.minX + b.maxX) / 2) < 1e-4 && Math.abs(y - (b.minY + b.maxY) / 2) < 1e-4
        const isEdge = x === b.minX || x === b.maxX || y === b.minY || y === b.maxY
        if (!isCenterXY && !isEdge && z !== earHeight) continue
        if (!isInsideRoom(field.room, x, y)) continue
        let blocked = false
        for (const o of field.obstacles) {
          if (isPointInObstacle3D(o, x, y, z)) {
            blocked = true
            break
          }
        }
        if (!blocked) pts.push({ x, y, z })
      }
    }
  }

  const freqs: number[] = []
  for (let f = fMin; f <= fMax + 1e-9; f += step) {
    freqs.push(Math.round(f * 100) / 100)
  }

  // Reference band mean at center listening point
  const centerRaw: number[] = []
  const centerFem = field.fem ? precomputePointFem(field, listening.x, listening.y, earHeight) : null
  for (const f of freqs) {
    const [re, im] = field.fem
      ? centerFem
        ? pressureFromPrecomputedFem(field, centerFem, f)
        : [NaN, NaN]
      : pressureAt(field, listening.x, listening.y, earHeight, f)
    centerRaw.push(magnitudeDb(re, im))
  }
  const finiteCenter = centerRaw.filter((v) => Number.isFinite(v))
  const centerMean = finiteCenter.length > 0 ? finiteCenter.reduce((a, b) => a + b, 0) / finiteCenter.length : 0

  const minArr = new Float64Array(freqs.length).fill(Infinity)
  const maxArr = new Float64Array(freqs.length).fill(-Infinity)

  for (let i = 0; i < freqs.length; i++) {
    if (Number.isFinite(centerRaw[i])) {
      const d = centerRaw[i] - centerMean
      minArr[i] = d
      maxArr[i] = d
    }
  }

  for (const pt of pts) {
    const ptFem = field.fem ? precomputePointFem(field, pt.x, pt.y, pt.z) : null
    if (field.fem && !ptFem) continue
    for (let i = 0; i < freqs.length; i++) {
      const [re, im] = field.fem
        ? pressureFromPrecomputedFem(field, ptFem!, freqs[i])
        : pressureAt(field, pt.x, pt.y, pt.z, freqs[i])
      const db = magnitudeDb(re, im)
      if (!Number.isFinite(db)) continue
      const rel = db - centerMean
      if (rel < minArr[i]) minArr[i] = rel
      if (rel > maxArr[i]) maxArr[i] = rel
    }
  }

  return freqs.map((f, i) => ({
    f,
    minDb: Number.isFinite(minArr[i]) ? minArr[i] : 0,
    maxDb: Number.isFinite(maxArr[i]) ? maxArr[i] : 0,
  }))
}

export type HeatmapMode = 'frequency' | 'band' | 'single' | 'wave'

export interface HeatmapGrid {
  cols: number
  rows: number
  /** Cell size (m) */
  cell: number
  /** dB values (or signed normalized amplitude when bipolar=true), NaN outside the room */
  values: Float32Array
  min: number
  max: number
  originX: number
  originY: number
  bipolar?: boolean
}

export interface HeatmapOptions {
  mode: HeatmapMode
  frequency: number
  singleMode: RoomMode | null
  cols: number
}

export function computeHeatmap(
  field: PreparedField,
  settings: AnalysisSettings,
  opts: HeatmapOptions,
): HeatmapGrid {
  const bounds = getBounds(field.room)
  const cols = Math.max(8, opts.cols)
  const cell = bounds.width / cols
  const rows = Math.max(4, Math.ceil(bounds.depth / cell))
  const values = new Float32Array(cols * rows)
  const z = settings.earHeight
  let min = Infinity
  let max = -Infinity

  if (opts.mode === 'wave') {
    values.fill(NaN)
    const cutObs = field.obstacles.filter(
      (o) => o.enabled && !isPorousAbsorberKind(o.kind) && o.z <= z + 1e-4 && o.z + o.height >= z - 1e-4,
    )
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bounds.minX + (c + 0.5) * cell
        const y = bounds.minY + (r + 0.5) * cell
        if (isInsideRoom(field.room, x, y) && !cutObs.some((o) => isPointInObstacle2D(o, x, y))) {
          values[r * cols + c] = 0
        }
      }
    }
    return { cols, rows, cell, values, min: -1, max: 1, originX: bounds.minX, originY: bounds.minY, bipolar: true }
  }

  const bandFreqs: number[] = []
  if (opts.mode === 'band') {
    const steps = 48
    for (let i = 0; i <= steps; i++) bandFreqs.push(settings.fMin + ((settings.fMax - settings.fMin) * i) / steps)
  }

  const cutObstacles = field.obstacles.filter(
    (o) => !isPorousAbsorberKind(o.kind) && o.z <= z + 1e-4 && o.z + o.height >= z - 1e-4,
  )

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c + 0.5) * cell
      const y = bounds.minY + (r + 0.5) * cell
      let db = NaN
      const blocked = cutObstacles.some((o) => isPointInObstacle2D(o, x, y))
      if (!blocked && isInsideRoom(field.room, x, y)) {
        if (opts.mode === 'single') {
          if (opts.singleMode) {
            const a = singleModeAmplitude(field, opts.singleMode, x, y, z)
            db = Number.isFinite(a) ? a : NaN
          }
        } else if (field.fem) {
          const ptFem = precomputePointFem(field, x, y, z)
          if (ptFem) {
            if (opts.mode === 'frequency') {
              const [re, im] = pressureFromPrecomputedFem(field, ptFem, opts.frequency)
              db = magnitudeDb(re, im)
            } else {
              let sum = 0
              for (const f of bandFreqs) {
                const [re, im] = pressureFromPrecomputedFem(field, ptFem, f)
                sum += re * re + im * im
              }
              db = sum > 0 ? 10 * Math.log10(sum / bandFreqs.length) : -Infinity
            }
          }
        } else if (opts.mode === 'frequency') {
          const [re, im] = pressureAt(field, x, y, z, opts.frequency)
          db = magnitudeDb(re, im)
        } else if (opts.mode === 'band') {
          let sum = 0
          for (const f of bandFreqs) {
            const [re, im] = pressureAt(field, x, y, z, f)
            sum += re * re + im * im
          }
          db = sum > 0 ? 10 * Math.log10(sum / bandFreqs.length) : -Infinity
        }
        if (Number.isFinite(db)) {
          if (db < min) min = db
          if (db > max) max = db
        }
      }
      values[r * cols + c] = db
    }
  }
  if (!Number.isFinite(min)) {
    min = -1
    max = 0
  }
  if (opts.mode === 'single') {
    const absMax = Math.max(1e-6, Math.abs(min), Math.abs(max))
    return {
      cols,
      rows,
      cell,
      values,
      min: -absMax,
      max: absMax,
      originX: bounds.minX,
      originY: bounds.minY,
      bipolar: true,
    }
  }
  return { cols, rows, cell, values, min, max, originX: bounds.minX, originY: bounds.minY }
}

export interface PreparedHeatmapPlane {
  cols: number
  rows: number
  cell: number
  originX: number
  originY: number
  nModes: number
  eta: number
  modeEtas: Float64Array
  modeF2: Float64Array
  insideIndices: Int32Array
  /** Flat row-major numerators: [cellIdx * nModes + modeIdx] */
  nums: Float32Array
}

/**
 * Precomputes frequency-independent modal coupling coefficients on a 2D cut plane
 * so evaluating any single frequency (e.g. during a live frequency sweep) runs in ~1 ms.
 */
export function prepareHeatmapPlane(
  field: PreparedField,
  settings: AnalysisSettings,
  cols = 80,
): PreparedHeatmapPlane {
  const bounds = getBounds(field.room)
  const cCount = Math.max(8, cols)
  const cell = bounds.width / cCount
  const rows = Math.max(4, Math.ceil(bounds.depth / cell))
  const z = settings.earHeight
  const H = field.room.H

  const modes = field.fem ? field.modes : field.modesBySegment.A
  const modeEtas = field.fem ? field.modeEtas : field.modeEtasBySegment.A
  const nModes = modes.length
  const modeF2 = new Float64Array(nModes)
  for (let i = 0; i < nModes; i++) modeF2[i] = modes[i].f * modes[i].f

  const cutObstacles = field.obstacles.filter(
    (o) => !isPorousAbsorberKind(o.kind) && o.z <= z + 1e-4 && o.z + o.height >= z - 1e-4,
  )
  const insideIdxList: number[] = []
  const insideCoords: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cCount; c++) {
      const x = bounds.minX + (c + 0.5) * cell
      const y = bounds.minY + (r + 0.5) * cell
      if (isInsideRoom(field.room, x, y) && !cutObstacles.some((o) => isPointInObstacle2D(o, x, y))) {
        insideIdxList.push(r * cCount + c)
        insideCoords.push({ x, y })
      }
    }
  }

  const insideCount = insideIdxList.length
  const insideIndices = Int32Array.from(insideIdxList)
  const nums = new Float32Array(insideCount * nModes)

  if (field.fem) {
    const fem = field.fem
    const n2d = fem.modes.length
    const srcFactor = field.sources.map((src) => {
      const arr = new Float64Array(nModes)
      if (!src.femLoc) return arr
      const s2d = new Float64Array(n2d)
      for (let m = 0; m < n2d; m++) s2d[m] = evalFemPsi2D(fem, m, src.femLoc)
      for (let i = 0; i < nModes; i++) {
        const mode = modes[i]
        const mIdx = mode.femIndex ?? 0
        arr[i] =
          s2d[mIdx] *
          eps(mode.nz) *
          Math.cos((mode.nz * Math.PI * z) / H) *
          Math.cos((mode.nz * Math.PI * src.sub.z) / H) *
          src.amp
      }
      return arr
    })

    const rx2d = new Float64Array(n2d)
    for (let k = 0; k < insideCount; k++) {
      const pt = insideCoords[k]
      const loc = locatePointInMesh(fem.mesh, pt.x, pt.y)
      if (!loc) continue
      for (let m = 0; m < n2d; m++) rx2d[m] = evalFemPsi2D(fem, m, loc)
      const base = k * nModes
      for (let s = 0; s < field.sources.length; s++) {
        const sf = srcFactor[s]
        for (let i = 0; i < nModes; i++) {
          const mIdx = modes[i].femIndex ?? 0
          nums[base + i] += rx2d[mIdx] * sf[i]
        }
      }
    }
  } else {
    const seg = field.segments[0]
    if (seg) {
      const srcFactor = field.sources.map((src) => {
        const arr = new Float64Array(nModes)
        if (!src.seg) return arr
        const sx = src.sub.x - src.seg.x0
        const sy = src.sub.y - src.seg.y0
        for (let i = 0; i < nModes; i++) {
          arr[i] = psi(modes[i], src.seg, sx, sy, src.sub.z) * src.amp
        }
        return arr
      })

      for (let k = 0; k < insideCount; k++) {
        const pt = insideCoords[k]
        const lx = pt.x - seg.x0
        const ly = pt.y - seg.y0
        const base = k * nModes
        for (let i = 0; i < nModes; i++) {
          const rx = psi(modes[i], seg, lx, ly, z)
          let sum = 0
          for (let s = 0; s < srcFactor.length; s++) sum += rx * srcFactor[s][i]
          nums[base + i] = sum
        }
      }
    }
  }

  return {
    cols: cCount,
    rows,
    cell,
    originX: bounds.minX,
    originY: bounds.minY,
    nModes,
    eta: field.eta,
    modeEtas,
    modeF2,
    insideIndices,
    nums,
  }
}

export function evaluateHeatmapPlane(plane: PreparedHeatmapPlane, frequency: number): HeatmapGrid {
  const { cols, rows, cell, originX, originY, nModes, modeEtas, modeF2, insideIndices, nums } = plane
  const values = new Float32Array(cols * rows)
  values.fill(NaN)

  const f2 = frequency * frequency
  const wRe = new Float64Array(nModes)
  const wIm = new Float64Array(nModes)
  for (let i = 0; i < nModes; i++) {
    const fm2 = modeF2[i]
    const dRe = fm2 - f2
    const dIm = modeEtas[i] * (fm2 > 0 ? fm2 : f2)
    const den = dRe * dRe + dIm * dIm
    if (den > 0) {
      wRe[i] = dRe / den
      wIm[i] = -dIm / den
    }
  }

  let min = Infinity
  let max = -Infinity
  const insideCount = insideIndices.length
  for (let k = 0; k < insideCount; k++) {
    const base = k * nModes
    let re = 0
    let im = 0
    for (let i = 0; i < nModes; i++) {
      const num = nums[base + i]
      if (num !== 0) {
        re += num * wRe[i]
        im += num * wIm[i]
      }
    }
    const mag2 = re * re + im * im
    const db = mag2 > 0 ? 10 * Math.log10(mag2) : -Infinity
    values[insideIndices[k]] = db
    if (Number.isFinite(db)) {
      if (db < min) min = db
      if (db > max) max = db
    }
  }

  if (!Number.isFinite(min)) {
    min = -1
    max = 0
  }
  return { cols, rows, cell, values, min, max, originX, originY }
}

export interface VolumeGridMeta {
  nx: number
  ny: number
  nz: number
  dx: number
  dy: number
  dz: number
  originX: number
  originY: number
  H: number
  /** Maps (ix + nx * (iy + ny * iz)) -> voxel index in values[], or -1 if outside room */
  cellToVoxel: Int32Array
}

export interface HeatmapVolume {
  count: number
  /** Interleaved Three.js world coordinates [x, zHeight, y, ...] */
  positions: Float32Array
  /** Nominal voxel spacing (m) */
  step: number
  /** dB values (or signed normalized amplitude when bipolar=true) */
  values: Float32Array
  min: number
  max: number
  bipolar?: boolean
  grid: VolumeGridMeta
}

export interface PreparedHeatmapVolume {
  count: number
  positions: Float32Array
  step: number
  nModes: number
  eta: number
  modeEtas: Float64Array
  modeF2: Float64Array
  modeIds: string[]
  /** Flat row-major numerators: [voxelIdx * nModes + modeIdx] */
  nums: Float32Array
  grid: VolumeGridMeta
}

/**
 * Precomputes frequency-independent 3D modal coupling coefficients inside the room volume
 * using a 2D footprint column cache so sweeping any frequency in 3D runs in ~1–2 ms.
 */
export function prepareHeatmapVolume(
  field: PreparedField,
  targetVoxels = 4200,
): PreparedHeatmapVolume {
  const bounds = getBounds(field.room)
  const area = Math.max(0.25, getRoomArea(field.room))
  const volume = area * bounds.H
  const rawStep = Math.cbrt(volume / Math.max(500, targetVoxels))

  let nx = Math.max(8, Math.min(24, Math.round(bounds.width / rawStep)))
  let ny = Math.max(8, Math.min(24, Math.round(bounds.depth / rawStep)))
  const nz = Math.max(7, Math.min(13, Math.round(bounds.H / rawStep)))
  while (nx * ny * nz > 6400 && (nx > 8 || ny > 8)) {
    if (nx >= ny && nx > 8) nx--
    else if (ny > 8) ny--
    else break
  }

  const dx = bounds.width / nx
  const dy = bounds.depth / ny
  const dz = bounds.H / nz
  const step = (dx + dy + dz) / 3

  const colsXY: { x: number; y: number; ix: number; iy: number }[] = []
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const x = bounds.minX + (c + 0.5) * dx
      const y = bounds.minY + (r + 0.5) * dy
      if (isInsideRoom(field.room, x, y)) {
        colsXY.push({ x, y, ix: c, iy: r })
      }
    }
  }

  const modes = field.fem ? field.modes : field.modesBySegment.A
  const modeEtas = field.fem ? field.modeEtas : field.modeEtasBySegment.A
  const nModes = modes.length
  const modeF2 = new Float64Array(nModes)
  const modeIds: string[] = new Array(nModes)
  let maxNz = 0
  for (let i = 0; i < nModes; i++) {
    modeF2[i] = modes[i].f * modes[i].f
    modeIds[i] = modes[i].id
    if (modes[i].nz > maxNz) maxNz = modes[i].nz
  }

  const H = field.room.H
  const cellToVoxel = new Int32Array(nx * ny * nz)
  cellToVoxel.fill(-1)
  const activeObs = field.obstacles.filter((o) => !isPorousAbsorberKind(o.kind))
  let vTotal = 0
  const colVoxels: { k: number; z: number; vIdx: number }[][] = []
  for (let c = 0; c < colsXY.length; c++) {
    const { x, y, ix, iy } = colsXY[c]
    const list: { k: number; z: number; vIdx: number }[] = []
    for (let k = 0; k < nz; k++) {
      const z = (k + 0.5) * dz
      if (activeObs.length > 0 && activeObs.some((o) => isPointInObstacle3D(o, x, y, z))) {
        continue
      }
      const vIdx = vTotal++
      cellToVoxel[ix + nx * (iy + ny * k)] = vIdx
      list.push({ k, z, vIdx })
    }
    colVoxels.push(list)
  }

  const count = vTotal
  const positions = new Float32Array(count * 3)
  const nums = new Float32Array(count * nModes)
  const grid: VolumeGridMeta = {
    nx,
    ny,
    nz,
    dx,
    dy,
    dz,
    originX: bounds.minX,
    originY: bounds.minY,
    H,
    cellToVoxel,
  }

  // Precompute vertical cosine factors cos(nz * pi * z / H) for all z layers
  const zCos = Array.from({ length: maxNz + 1 }, (_, n) => {
    const arr = new Float64Array(nz)
    for (let k = 0; k < nz; k++) {
      const z = (k + 0.5) * dz
      arr[k] = Math.cos((n * Math.PI * z) / H)
    }
    return arr
  })

  if (field.fem) {
    const fem = field.fem
    const n2d = fem.modes.length
    const srcFactor = field.sources.map((src) => {
      const arr = new Float64Array(nModes)
      if (!src.femLoc) return arr
      const s2d = new Float64Array(n2d)
      for (let m = 0; m < n2d; m++) s2d[m] = evalFemPsi2D(fem, m, src.femLoc)
      for (let i = 0; i < nModes; i++) {
        const mode = modes[i]
        const mIdx = mode.femIndex ?? 0
        arr[i] = s2d[mIdx] * eps(mode.nz) * Math.cos((mode.nz * Math.PI * src.sub.z) / H) * src.amp
      }
      return arr
    })

    const rx2d = new Float64Array(n2d)
    const xyCol = new Float64Array(nModes)
    for (let c = 0; c < colsXY.length; c++) {
      const pt = colsXY[c]
      const list = colVoxels[c]
      if (list.length === 0) continue
      const loc = locatePointInMesh(fem.mesh, pt.x, pt.y)
      xyCol.fill(0)
      if (loc) {
        for (let m = 0; m < n2d; m++) rx2d[m] = evalFemPsi2D(fem, m, loc)
        for (let i = 0; i < nModes; i++) {
          const mIdx = modes[i].femIndex ?? 0
          let sum = 0
          for (let s = 0; s < srcFactor.length; s++) sum += srcFactor[s][i]
          xyCol[i] = rx2d[mIdx] * sum
        }
      }
      for (const { k, z, vIdx } of list) {
        const pOff = vIdx * 3
        positions[pOff] = pt.x
        positions[pOff + 1] = z
        positions[pOff + 2] = pt.y
        const base = vIdx * nModes
        for (let i = 0; i < nModes; i++) {
          nums[base + i] = xyCol[i] * zCos[modes[i].nz][k]
        }
      }
    }
  } else {
    const seg = field.segments[0]
    if (seg) {
      const srcFactor = field.sources.map((src) => {
        const arr = new Float64Array(nModes)
        if (!src.seg) return arr
        const sx = src.sub.x - src.seg.x0
        const sy = src.sub.y - src.seg.y0
        for (let i = 0; i < nModes; i++) {
          arr[i] = psi(modes[i], src.seg, sx, sy, src.sub.z) * src.amp
        }
        return arr
      })
      const xyNorm = new Float64Array(nModes)
      for (let i = 0; i < nModes; i++) {
        const m = modes[i]
        let sum = 0
        for (let s = 0; s < srcFactor.length; s++) sum += srcFactor[s][i]
        xyNorm[i] = Math.sqrt(eps(m.nx) * eps(m.ny) * eps(m.nz)) * sum
      }

      const xyCol = new Float64Array(nModes)
      for (let c = 0; c < colsXY.length; c++) {
        const pt = colsXY[c]
        const list = colVoxels[c]
        if (list.length === 0) continue
        const lx = pt.x - seg.x0
        const ly = pt.y - seg.y0
        for (let i = 0; i < nModes; i++) {
          const m = modes[i]
          xyCol[i] =
            xyNorm[i] *
            Math.cos((m.nx * Math.PI * lx) / seg.Lx) *
            Math.cos((m.ny * Math.PI * ly) / seg.Ly)
        }
        for (const { k, z, vIdx } of list) {
          const pOff = vIdx * 3
          positions[pOff] = pt.x
          positions[pOff + 1] = z
          positions[pOff + 2] = pt.y
          const base = vIdx * nModes
          for (let i = 0; i < nModes; i++) {
            nums[base + i] = xyCol[i] * zCos[modes[i].nz][k]
          }
        }
      }
    }
  }

  return {
    count,
    positions,
    step,
    nModes,
    eta: field.eta,
    modeEtas,
    modeF2,
    modeIds,
    nums,
    grid,
  }
}

export function evaluateHeatmapVolumeAtFrequency(vol: PreparedHeatmapVolume, frequency: number): HeatmapVolume {
  const { count, positions, step, nModes, modeEtas, modeF2, nums, grid } = vol
  const values = new Float32Array(count)
  const f2 = frequency * frequency
  const wRe = new Float64Array(nModes)
  const wIm = new Float64Array(nModes)
  for (let i = 0; i < nModes; i++) {
    const fm2 = modeF2[i]
    const dRe = fm2 - f2
    const dIm = modeEtas[i] * (fm2 > 0 ? fm2 : f2)
    const den = dRe * dRe + dIm * dIm
    if (den > 0) {
      wRe[i] = dRe / den
      wIm[i] = -dIm / den
    }
  }

  let min = Infinity
  let max = -Infinity
  for (let k = 0; k < count; k++) {
    const base = k * nModes
    let re = 0
    let im = 0
    for (let i = 0; i < nModes; i++) {
      const num = nums[base + i]
      if (num !== 0) {
        re += num * wRe[i]
        im += num * wIm[i]
      }
    }
    const mag2 = re * re + im * im
    const db = mag2 > 0 ? 10 * Math.log10(mag2) : -Infinity
    values[k] = db
    if (Number.isFinite(db)) {
      if (db < min) min = db
      if (db > max) max = db
    }
  }
  if (!Number.isFinite(min)) {
    min = -1
    max = 0
  }
  return { count, positions, step, values, min, max, grid }
}

export function evaluateHeatmapVolumeBand(
  vol: PreparedHeatmapVolume,
  fMin: number,
  fMax: number,
  steps = 28,
): HeatmapVolume {
  const { count, positions, step, nModes, modeEtas, modeF2, nums, grid } = vol
  const values = new Float32Array(count)
  const wReAll = new Float64Array(steps * nModes)
  const wImAll = new Float64Array(steps * nModes)

  for (let s = 0; s < steps; s++) {
    const f = fMin + ((fMax - fMin) * s) / Math.max(1, steps - 1)
    const f2 = f * f
    const off = s * nModes
    for (let i = 0; i < nModes; i++) {
      const fm2 = modeF2[i]
      const dRe = fm2 - f2
      const dIm = modeEtas[i] * (fm2 > 0 ? fm2 : f2)
      const den = dRe * dRe + dIm * dIm
      if (den > 0) {
        wReAll[off + i] = dRe / den
        wImAll[off + i] = -dIm / den
      }
    }
  }

  let min = Infinity
  let max = -Infinity
  for (let k = 0; k < count; k++) {
    const base = k * nModes
    let sum = 0
    for (let s = 0; s < steps; s++) {
      const off = s * nModes
      let re = 0
      let im = 0
      for (let i = 0; i < nModes; i++) {
        const num = nums[base + i]
        if (num !== 0) {
          re += num * wReAll[off + i]
          im += num * wImAll[off + i]
        }
      }
      sum += re * re + im * im
    }
    const db = sum > 0 ? 10 * Math.log10(sum / steps) : -Infinity
    values[k] = db
    if (Number.isFinite(db)) {
      if (db < min) min = db
      if (db > max) max = db
    }
  }
  if (!Number.isFinite(min)) {
    min = -1
    max = 0
  }
  return { count, positions, step, values, min, max, grid }
}

export function evaluateHeatmapVolumeSingle(
  vol: PreparedHeatmapVolume,
  singleMode: RoomMode | null,
): HeatmapVolume {
  const { count, positions, step, nModes, modeIds, nums, grid } = vol
  const values = new Float32Array(count)
  const mIdx = singleMode ? modeIds.indexOf(singleMode.id) : -1
  if (mIdx === -1) {
    return { count, positions, step, values, min: -1, max: 1, bipolar: true, grid }
  }
  let absMax = 0
  for (let k = 0; k < count; k++) {
    const v = nums[k * nModes + mIdx]
    values[k] = v
    const av = Math.abs(v)
    if (av > absMax) absMax = av
  }
  const normMax = Math.max(1e-6, absMax)
  return { count, positions, step, values, min: -normMax, max: normMax, bipolar: true, grid }
}

function interpolateStops(t: number, stops: [number, [number, number, number]][]): [number, number, number] {
  const v = Math.min(1, Math.max(0, t))
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1]
    const [t1, c1] = stops[i]
    if (v <= t1) {
      const k = (v - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ]
    }
  }
  return stops[stops.length - 1][1]
}

/**
 * SPL colour map matching vesalaasanen.com/tools/room-mode-calculator:
 * deep blue -> cyan -> green -> yellow -> red for t in [0, 1].
 */
export function heatColor(t: number): [number, number, number] {
  return interpolateStops(t, [
    [0, [0, 0, 80]],
    [0.25, [0, 180, 255]],
    [0.5, [0, 255, 0]],
    [0.75, [255, 255, 0]],
    [1, [255, 0, 0]],
  ])
}

/**
 * Bipolar eigenmode phase colour map matching vesalaasanen.com:
 * blue (-1) -> white (0, nodal line) -> red (+1) for t in [0, 1].
 */
export function bipolarColor(t: number): [number, number, number] {
  return interpolateStops(t, [
    [0, [0, 0, 255]],
    [0.5, [255, 255, 255]],
    [1, [255, 0, 0]],
  ])
}

/** Paint a heatmap grid into a canvas (one pixel per cell, scaled by CSS/drawImage). */
export function paintHeatmap(grid: HeatmapGrid, canvas: HTMLCanvasElement, rangeDb = 30) {
  canvas.width = grid.cols
  canvas.height = grid.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(grid.cols, grid.rows)
  if (grid.bipolar) {
    const absMax = Math.max(1e-6, Math.abs(grid.max))
    for (let i = 0; i < grid.values.length; i++) {
      const v = grid.values[i]
      const o = i * 4
      if (!Number.isFinite(v)) {
        img.data[o + 3] = 0
        continue
      }
      const t = 0.5 + 0.5 * (v / absMax)
      const [r, g, b] = bipolarColor(t)
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  } else {
    const top = grid.max
    const bottom = Math.max(grid.min, grid.max - rangeDb)
    const span = Math.max(1e-6, top - bottom)
    for (let i = 0; i < grid.values.length; i++) {
      const v = grid.values[i]
      const o = i * 4
      if (!Number.isFinite(v)) {
        img.data[o + 3] = 0
        continue
      }
      const t = (v - bottom) / span
      const [r, g, b] = heatColor(t)
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

export const MODE_TYPE_LABEL: Record<ModeType, string> = {
  axial: 'Axial',
  tangential: 'Tangential',
  oblique: 'Schräg',
}

export function formatMeters(v: number) {
  return v.toFixed(2)
}
