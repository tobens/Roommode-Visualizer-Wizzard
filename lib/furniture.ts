import type { Point2D } from './fem2d'
import { pointInPolygon } from './fem2d'

export type FurnitureKind =
  | 'sofa'
  | 'lsofa'
  | 'shelf'
  | 'cabinet'
  | 'table'
  | 'pillar'
  | 'basstrap'

export interface RoomObstacle {
  id: string
  kind: FurnitureKind
  name: string
  /** Center X in room coordinates (m) */
  x: number
  /** Center Y in room coordinates (m) */
  y: number
  /** Elevation above floor (m) */
  z: number
  /** Width along local X axis (m) */
  width: number
  /** Depth along local Y axis (m) */
  depth: number
  /** Height along vertical Z axis (m) */
  height: number
  /** Rotation around center in degrees */
  rotation: number
  /** Whether this item acts as an acoustic obstacle in mode calculations */
  enabled: boolean
}

export interface FurniturePreset {
  kind: FurnitureKind
  label: string
  defaultName: string
  width: number
  depth: number
  height: number
  fullHeight?: boolean
}

export const FURNITURE_CATALOG: FurniturePreset[] = [
  {
    kind: 'sofa',
    label: 'Sofa',
    defaultName: 'Sofa (3-Sitzer)',
    width: 2.2,
    depth: 0.95,
    height: 0.85,
  },
  {
    kind: 'lsofa',
    label: 'Ecksofa',
    defaultName: 'Ecksofa (L-Form)',
    width: 2.6,
    depth: 1.85,
    height: 0.85,
  },
  {
    kind: 'shelf',
    label: 'Regal',
    defaultName: 'Bücherregal',
    width: 1.8,
    depth: 0.42,
    height: 2.1,
  },
  {
    kind: 'cabinet',
    label: 'Sideboard',
    defaultName: 'Sideboard',
    width: 1.8,
    depth: 0.48,
    height: 0.65,
  },
  {
    kind: 'cabinet',
    label: 'Schrank',
    defaultName: 'Hochschrank',
    width: 1.0,
    depth: 0.6,
    height: 2.3,
  },
  {
    kind: 'table',
    label: 'Couchtisch',
    defaultName: 'Couchtisch',
    width: 1.2,
    depth: 0.7,
    height: 0.45,
  },
  {
    kind: 'pillar',
    label: 'Säule',
    defaultName: 'Wandpfeiler / Säule',
    width: 0.5,
    depth: 0.5,
    height: 2.6,
    fullHeight: true,
  },
  {
    kind: 'basstrap',
    label: 'Bassfalle',
    defaultName: 'Eck-Bassfalle',
    width: 0.55,
    depth: 0.55,
    height: 2.1,
  },
]

export const FURNITURE_KIND_LABEL: Record<FurnitureKind, string> = {
  sofa: 'Sofa',
  lsofa: 'Ecksofa',
  shelf: 'Regal',
  cabinet: 'Schrank',
  table: 'Tisch',
  pillar: 'Säule',
  basstrap: 'Bassfalle',
}

/**
 * Plausible predefined low-frequency acoustic absorption coefficients (alpha in [0, 1])
 * assigned automatically per furniture/absorber kind.
 */
export const FURNITURE_DEFAULT_ABSORPTION: Record<FurnitureKind, number> = {
  sofa: 0.35,
  lsofa: 0.38,
  shelf: 0.22,
  cabinet: 0.08,
  table: 0.04,
  pillar: 0.02,
  basstrap: 0.75,
}

export function getObstacleAbsorption(obs: Pick<RoomObstacle, 'kind'>): number {
  return FURNITURE_DEFAULT_ABSORPTION[obs.kind] ?? 0.08
}

/** Porous absorbers allow low-frequency sound waves to enter and dissipate energy inside. */
export function isPorousAbsorberKind(kind: FurnitureKind): boolean {
  return kind === 'basstrap'
}

/** Local (unrotated, centered at origin) footprint polygon in CCW order. */
export function getLocalObstaclePolygon(obs: Pick<RoomObstacle, 'kind' | 'width' | 'depth'>): Point2D[] {
  const hw = Math.max(0.1, obs.width) / 2
  const hd = Math.max(0.1, obs.depth) / 2
  if (obs.kind === 'lsofa') {
    // L-shape sofa: back along -Y, long leg on -X..+X (depth ~ 0.92m), return leg on -X (width ~ 0.95m)
    const armD = Math.min(hd * 1.15, 0.95)
    const armW = Math.min(hw * 1.15, 0.95)
    return [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: -hd + armD },
      { x: -hw + armW, y: -hd + armD },
      { x: -hw + armW, y: hd },
      { x: -hw, y: hd },
    ]
  }
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ]
}

/** World 2D footprint polygon in room coordinates (m). */
export function getObstaclePolygon(obs: RoomObstacle): Point2D[] {
  const local = getLocalObstaclePolygon(obs)
  const rad = (obs.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return local.map((p) => ({
    x: obs.x + p.x * cos - p.y * sin,
    y: obs.y + p.x * sin + p.y * cos,
  }))
}

export function getObstacleArea(obs: Pick<RoomObstacle, 'kind' | 'width' | 'depth'>): number {
  const poly = getLocalObstaclePolygon(obs)
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) * 0.5
}

/** Representative interior sample points in world coordinates for spatial modal overlap. */
export function getObstacleSamplePoints(obs: RoomObstacle): Point2D[] {
  const hw = Math.max(0.1, obs.width) / 2
  const hd = Math.max(0.1, obs.depth) / 2
  const rad = (obs.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const toWorld = (lx: number, ly: number): Point2D => ({
    x: obs.x + lx * cos - ly * sin,
    y: obs.y + lx * sin + ly * cos,
  })

  if (obs.kind === 'lsofa') {
    const armD = Math.min(hd * 1.15, 0.95)
    const armW = Math.min(hw * 1.15, 0.95)
    const candidates: [number, number][] = [
      [-hw + armW * 0.5, -hd + armD * 0.5],
      [0, -hd + armD * 0.5],
      [hw * 0.55, -hd + armD * 0.5],
      [-hw + armW * 0.5, (-hd + armD + hd) * 0.5],
      [-hw + armW * 0.5, hd * 0.72],
    ]
    return candidates.map(([lx, ly]) => toWorld(lx, ly))
  }

  const pts: Point2D[] = [toWorld(0, 0)]
  for (const sx of [-0.55, 0.55]) {
    for (const sy of [-0.55, 0.55]) {
      pts.push(toWorld(sx * hw, sy * hd))
    }
  }
  return pts
}

export function isPointInObstacle2D(obs: RoomObstacle, x: number, y: number): boolean {
  return pointInPolygon(getObstaclePolygon(obs), x, y)
}

export function isPointInObstacle3D(obs: RoomObstacle, x: number, y: number, z: number): boolean {
  if (z < obs.z - 1e-4 || z > obs.z + obs.height + 1e-4) return false
  return isPointInObstacle2D(obs, x, y)
}
