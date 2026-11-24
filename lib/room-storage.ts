import {
  DEFAULT_ROOM,
  DEFAULT_SETTINGS,
  DEFAULT_SWEET_SPOT,
  clampObstacleToRoom,
  clampSweetSpotConfig,
  clampToRoom,
  isInsideRoom,
  isRoomGeometryValid,
  makeLShapePolygon,
  type AnalysisSettings,
  type FurnitureKind,
  type ListeningPoint,
  type Point2D,
  type RoomConfig,
  type RoomObstacle,
  type RoomShape,
  type Subwoofer,
  type SweetSpotConfig,
} from './acoustics'

export interface RoomProject {
  version: 1
  id: string
  name: string
  updatedAt: string
  room: RoomConfig
  subs: Subwoofer[]
  listening: ListeningPoint
  settings: AnalysisSettings
  obstacles?: RoomObstacle[]
  sweetSpot?: SweetSpotConfig
}

const STORAGE_KEY = 'raummoden-projects-v1'

function round2(n: number): number {
  return Number(n.toFixed(2))
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizePoints(raw: unknown): Point2D[] {
  if (!Array.isArray(raw)) return []
  const pts: Point2D[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'x' in item && 'y' in item) {
      const x = finiteOr((item as { x: unknown }).x, NaN)
      const y = finiteOr((item as { y: unknown }).y, NaN)
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x: round2(x), y: round2(y) })
    } else if (Array.isArray(item) && item.length >= 2) {
      const x = finiteOr(item[0], NaN)
      const y = finiteOr(item[1], NaN)
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x: round2(x), y: round2(y) })
    }
  }
  return pts
}

function normalizeRoom(raw: unknown): RoomConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_ROOM
  const r = raw as Record<string, unknown>
  const shape: RoomShape =
    r.shape === 'rect' || r.shape === 'lshape' || r.shape === 'polygon'
      ? r.shape
      : Array.isArray(r.polygon) && r.polygon.length >= 3
        ? 'polygon'
        : 'rect'
  const L1 = Math.min(40, Math.max(0.5, finiteOr(r.L1, DEFAULT_ROOM.L1)))
  const W1 = Math.min(40, Math.max(0.5, finiteOr(r.W1, DEFAULT_ROOM.W1)))
  const L2 = Math.min(40, Math.max(0.5, finiteOr(r.L2, DEFAULT_ROOM.L2)))
  const W2 = Math.min(40, Math.max(0.5, finiteOr(r.W2, DEFAULT_ROOM.W2)))
  const H = Math.min(15, Math.max(1.2, finiteOr(r.H, DEFAULT_ROOM.H)))
  const parsedPoly = normalizePoints(r.polygon)
  const polygon = parsedPoly.length >= 3 ? parsedPoly : makeLShapePolygon(L1, W1, L2, W2)
  return { shape, L1, W1, L2, W2, polygon, H }
}

function normalizeSubs(raw: unknown, room: RoomConfig): Subwoofer[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    const p1 = clampToRoom(room, 0.35, 0.35)
    return [{ id: 'sub-0', name: 'Sub 1', x: round2(p1.x), y: round2(p1.y), z: 0, gain: 0, phase: 0, enabled: true }]
  }
  const out: Subwoofer[] = []
  for (let i = 0; i < Math.min(4, raw.length); i++) {
    const s = raw[i]
    if (!s || typeof s !== 'object') continue
    const obj = s as Record<string, unknown>
    const rawX = finiteOr(obj.x, 0.35)
    const rawY = finiteOr(obj.y, 0.35)
    const pos = isRoomGeometryValid(room) && !isInsideRoom(room, rawX, rawY) ? clampToRoom(room, rawX, rawY) : { x: rawX, y: rawY }
    const z = Math.min(room.H, Math.max(0, finiteOr(obj.z, 0)))
    const gain = Math.min(12, Math.max(-24, finiteOr(obj.gain, 0)))
    const phase: 0 | 180 = obj.phase === 180 ? 180 : 0
    const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 32) : `Sub ${i + 1}`
    out.push({
      id: `sub-${out.length}`,
      name,
      x: round2(pos.x),
      y: round2(pos.y),
      z: round2(z),
      gain: round2(gain),
      phase,
      enabled,
    })
  }
  return out.length > 0 ? out : normalizeSubs(null, room)
}

function normalizeListening(raw: unknown, room: RoomConfig): ListeningPoint {
  const defX = room.L1 / 2
  const defY = room.W1 * 0.62
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const x = finiteOr(obj.x, defX)
  const y = finiteOr(obj.y, defY)
  if (isRoomGeometryValid(room) && !isInsideRoom(room, x, y)) {
    const c = clampToRoom(room, x, y)
    return { x: round2(c.x), y: round2(c.y) }
  }
  return { x: round2(x), y: round2(y) }
}

function normalizeSettings(raw: unknown, roomHeight: number): AnalysisSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const c = Math.min(355, Math.max(330, finiteOr(obj.c, DEFAULT_SETTINGS.c)))
  const eta = Math.min(0.2, Math.max(0.01, finiteOr(obj.eta, DEFAULT_SETTINGS.eta)))
  const earHeight = Math.min(Math.max(0.4, roomHeight - 0.1), Math.max(0.3, finiteOr(obj.earHeight, DEFAULT_SETTINGS.earHeight)))
  const fMin = Math.min(190, Math.max(10, Math.round(finiteOr(obj.fMin, DEFAULT_SETTINGS.fMin))))
  const fMax = Math.min(300, Math.max(fMin + 5, Math.round(finiteOr(obj.fMax, DEFAULT_SETTINGS.fMax))))
  const nMax = Math.min(12, Math.max(2, Math.round(finiteOr(obj.nMax, DEFAULT_SETTINGS.nMax))))
  return { c, eta, earHeight, fMin, fMax, nMax }
}

const VALID_FURNITURE_KINDS = new Set<FurnitureKind>([
  'sofa',
  'lsofa',
  'shelf',
  'cabinet',
  'table',
  'pillar',
  'basstrap',
])

function normalizeObstacles(raw: unknown, room: RoomConfig): RoomObstacle[] {
  if (!Array.isArray(raw)) return []
  const out: RoomObstacle[] = []
  for (let i = 0; i < Math.min(32, raw.length); i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const kind: FurnitureKind =
      typeof obj.kind === 'string' && VALID_FURNITURE_KINDS.has(obj.kind as FurnitureKind)
        ? (obj.kind as FurnitureKind)
        : 'cabinet'
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 32) : `Möbel ${i + 1}`
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim().slice(0, 48) : `obs-${i}`
    const obs: RoomObstacle = {
      id,
      kind,
      name,
      x: finiteOr(obj.x, room.L1 / 2),
      y: finiteOr(obj.y, room.W1 / 2),
      z: finiteOr(obj.z, 0),
      width: finiteOr(obj.width, 1.2),
      depth: finiteOr(obj.depth, 0.6),
      height: finiteOr(obj.height, 0.8),
      rotation: finiteOr(obj.rotation, 0),
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
    }
    out.push(clampObstacleToRoom(room, obs))
  }
  return out
}

function normalizeSweetSpot(raw: unknown, room: RoomConfig): SweetSpotConfig {
  if (!raw || typeof raw !== 'object') return clampSweetSpotConfig(room, DEFAULT_SWEET_SPOT)
  const obj = raw as Record<string, unknown>
  return clampSweetSpotConfig(room, {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_SWEET_SPOT.enabled,
    width: finiteOr(obj.width, DEFAULT_SWEET_SPOT.width),
    depth: finiteOr(obj.depth, DEFAULT_SWEET_SPOT.depth),
    height: finiteOr(obj.height, DEFAULT_SWEET_SPOT.height),
  })
}

export function normalizeProjectData(raw: unknown): Omit<RoomProject, 'id' | 'updatedAt'> | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // Support either { room, subs, listening, settings } or bare { polygon, H, ... }
  const rawRoom = obj.room ?? (Array.isArray(obj.polygon) || typeof obj.L1 === 'number' ? obj : null)
  if (!rawRoom) return null

  const room = normalizeRoom(rawRoom)
  if (room.shape === 'polygon' && room.polygon.length < 3) return null

  const subs = normalizeSubs(obj.subs ?? obj.subwoofers, room)
  const listening = normalizeListening(obj.listening ?? obj.listener, room)
  const settings = normalizeSettings(obj.settings, room.H)
  const obstacles = normalizeObstacles(obj.obstacles, room)
  const sweetSpot = normalizeSweetSpot(obj.sweetSpot, room)
  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, 60)
      : room.shape === 'polygon'
        ? `Raumplan (${room.polygon.length} Ecken)`
        : room.shape === 'lshape'
          ? 'L-Form Raum'
          : 'Rechteck-Raum'

  return { version: 1, name, room, subs, listening, settings, obstacles, sweetSpot }
}

export function listSavedProjects(): RoomProject[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const projects: RoomProject[] = []
    for (const item of arr) {
      const norm = normalizeProjectData(item)
      if (!norm) continue
      const rec = item as Record<string, unknown>
      projects.push({
        ...norm,
        id: typeof rec.id === 'string' && rec.id ? rec.id : `proj-${projects.length}`,
        updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
      })
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function saveSavedProject(project: RoomProject): RoomProject[] {
  const existing = listSavedProjects().filter((p) => p.id !== project.id)
  const next = [project, ...existing].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore quota / private browsing errors gracefully
  }
  return next
}

export function deleteSavedProject(id: string): RoomProject[] {
  const next = listSavedProjects().filter((p) => p.id !== id)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage errors
  }
  return next
}

export function buildSafeFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().slice(0, 10)
  return `${slug || 'raumplan'}-${stamp}.json`
}

export function downloadProjectJson(project: Omit<RoomProject, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string }) {
  const payload: RoomProject = {
    version: 1,
    id: project.id ?? `proj-${Date.now()}`,
    name: project.name.trim() || 'Raumplan',
    updatedAt: project.updatedAt ?? new Date().toISOString(),
    room: project.room,
    subs: project.subs,
    listening: project.listening,
    settings: project.settings,
    obstacles: project.obstacles ?? [],
    sweetSpot: project.sweetSpot ?? DEFAULT_SWEET_SPOT,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = buildSafeFilename(payload.name)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeProjectHash(data: Omit<RoomProject, 'version' | 'id' | 'updatedAt'>): string {
  const json = JSON.stringify({ version: 1, ...data })
  return `#plan=${toBase64Url(json)}`
}

/**
 * Decodes either `#plan=<base64url>` OR external `#poly,H,x1,y1,...|s,x,y,z,gain,delay,pol,enabled|l,x,y,z` format.
 */
export function decodeProjectHash(hash: string): Omit<RoomProject, 'id' | 'updatedAt'> | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash
  if (!clean) return null

  if (clean.startsWith('plan=')) {
    try {
      const json = fromBase64Url(clean.slice(5))
      return normalizeProjectData(JSON.parse(json))
    } catch {
      return null
    }
  }

  // Compatibility with vesalaasanen.com hash format: #poly,H,x1,y1,...|s,...|l,...
  if (clean.startsWith('poly,')) {
    try {
      const parts = clean.split('|')
      const polyNums = parts[0].split(',').slice(1).map(Number)
      if (polyNums.length < 7 || polyNums.some((n) => !Number.isFinite(n))) return null
      const H = Math.min(15, Math.max(1.2, polyNums[0]))
      const polygon: Point2D[] = []
      for (let i = 1; i + 1 < polyNums.length; i += 2) {
        polygon.push({ x: round2(polyNums[i]), y: round2(polyNums[i + 1]) })
      }
      if (polygon.length < 3) return null
      const subs: unknown[] = []
      let listening: unknown = null
      let earHeight = DEFAULT_SETTINGS.earHeight
      for (const part of parts.slice(1)) {
        const seg = part.split(',')
        if (seg[0] === 's' && seg.length >= 4) {
          const x = Number(seg[1])
          const y = Number(seg[2])
          const z = Number(seg[3])
          const gain = seg[4] !== undefined ? Number(seg[4]) : 0
          const pol = seg[6] !== undefined ? Number(seg[6]) : 1
          const enabled = seg[7] !== undefined ? Number(seg[7]) !== 0 : true
          subs.push({ x, y, z, gain, phase: pol < 0 ? 180 : 0, enabled })
        } else if (seg[0] === 'l' && seg.length >= 3) {
          listening = { x: Number(seg[1]), y: Number(seg[2]) }
          if (seg[3] !== undefined && Number.isFinite(Number(seg[3]))) earHeight = Number(seg[3])
        }
      }
      return normalizeProjectData({
        name: `Importierter Raumplan (${polygon.length} Ecken)`,
        room: { ...DEFAULT_ROOM, shape: 'polygon', H, polygon },
        subs,
        listening,
        settings: { ...DEFAULT_SETTINGS, earHeight },
      })
    } catch {
      return null
    }
  }

  return null
}
