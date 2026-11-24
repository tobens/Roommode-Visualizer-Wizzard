'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  HeatmapGrid,
  ListeningPoint,
  Point2D,
  RoomConfig,
  RoomObstacle,
  Subwoofer,
  SweetSpotConfig,
} from '@/lib/acoustics'
import {
  clampToRoom,
  getBounds,
  getRoomPolygon,
  getSweetSpotBounds,
  isInsideRoom,
  isRoomGeometryValid,
  paintHeatmap,
} from '@/lib/acoustics'
import { FURNITURE_KIND_LABEL, getObstaclePolygon, isPointInObstacle2D } from '@/lib/furniture'
import type { PlanTool } from './room-form'
import { subColor } from './subwoofer-panel'

interface TopViewProps {
  room: RoomConfig
  subs: Subwoofer[]
  listening: ListeningPoint
  grid: HeatmapGrid | null
  showHeatmap: boolean
  heatRangeDb: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSubMove: (id: string, x: number, y: number) => void
  onListeningChange: (p: ListeningPoint) => void
  onProbe: (p: ListeningPoint | null) => void
  canvasRef: RefObject<HTMLCanvasElement | null>
  planTool: PlanTool
  snapStep: number
  selectedVertexIdx: number | null
  onSelectVertex: (idx: number | null) => void
  onPolygonChange: (pts: Point2D[]) => void
  drawPoints: Point2D[]
  onDrawPointsChange: (pts: Point2D[]) => void
  onFinishDraw: (pts: Point2D[]) => void
  obstacles?: RoomObstacle[]
  selectedObstacleId?: string | null
  onSelectObstacle?: (id: string | null) => void
  onObstacleMove?: (id: string, x: number, y: number) => void
  sweetSpot?: SweetSpotConfig
  sweetSpotSpanDb?: number | null
  previewSubs?: Subwoofer[] | null
}

const PAD = 42
const SUB_RADIUS = 12
const VERTEX_RADIUS = 7

export function roomPolygon(room: RoomConfig): [number, number][] {
  return getRoomPolygon(room).map((p) => [p.x, p.y])
}

interface ViewportBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  depth: number
}

function snapValue(v: number, step: number) {
  if (step <= 0) return Number(v.toFixed(2))
  return Number((Math.round(v / step) * step).toFixed(2))
}

export function TopView({
  room,
  subs,
  listening,
  grid,
  showHeatmap,
  heatRangeDb,
  selectedId,
  onSelect,
  onSubMove,
  onListeningChange,
  onProbe,
  canvasRef,
  planTool,
  snapStep,
  selectedVertexIdx,
  onSelectVertex,
  onPolygonChange,
  drawPoints,
  onDrawPointsChange,
  onFinishDraw,
  obstacles = [],
  selectedObstacleId = null,
  onSelectObstacle,
  onObstacleMove,
  sweetSpot,
  sweetSpotSpanDb = null,
  previewSubs = null,
}: TopViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const heatCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const dragRef = useRef<
    | { kind: 'sub'; id: string; moved: boolean }
    | { kind: 'obs'; id: string; offsetX: number; offsetY: number; moved: boolean }
    | null
  >(null)
  const vertexDragRef = useRef<{ idx: number } | null>(null)
  const lockedBoundsRef = useRef<ViewportBounds | null>(null)
  const [dragInfo, setDragInfo] = useState<{ kind: 'sub' | 'obs'; id: string; x: number; y: number } | null>(null)
  const [vertexDragInfo, setVertexDragInfo] = useState<{ idx: number; x: number; y: number } | null>(null)
  const [alignGuides, setAlignGuides] = useState<{ x?: number; y?: number }>({})
  const [hover, setHover] = useState<ListeningPoint | null>(null)
  const [hoverGrab, setHoverGrab] = useState(false)
  const [hoverVertex, setHoverVertex] = useState<number | null>(null)
  const [hoverMid, setHoverMid] = useState<number | null>(null)
  const [drawCursor, setDrawCursor] = useState<Point2D | null>(null)
  const [closeSnap, setCloseSnap] = useState(false)

  const rawBounds = getBounds(room)
  const baseBounds: ViewportBounds =
    planTool === 'draw'
      ? {
          minX: Math.min(-0.5, rawBounds.minX - 1.2),
          minY: Math.min(-0.5, rawBounds.minY - 1.2),
          maxX: Math.max(7.5, rawBounds.maxX + 1.5),
          maxY: Math.max(5.5, rawBounds.maxY + 1.5),
          width: Math.max(8, rawBounds.width + 2.7),
          depth: Math.max(6, rawBounds.depth + 2.7),
        }
      : planTool === 'edit'
        ? {
            minX: rawBounds.minX - 0.5,
            minY: rawBounds.minY - 0.5,
            maxX: rawBounds.maxX + 0.5,
            maxY: rawBounds.maxY + 0.5,
            width: rawBounds.width + 1,
            depth: rawBounds.depth + 1,
          }
        : rawBounds

  const bounds = lockedBoundsRef.current ?? baseBounds

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(280, entry.contentRect.width)
      const aspect = bounds.depth / bounds.width
      const h = Math.min(640, Math.max(280, (w - 2 * PAD) * aspect + 2 * PAD))
      setSize({ w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [bounds.width, bounds.depth])

  const scale = Math.min((size.w - 2 * PAD) / bounds.width, (size.h - 2 * PAD) / bounds.depth)
  const offsetX = (size.w - bounds.width * scale) / 2
  const offsetY = (size.h - bounds.depth * scale) / 2

  const toRoom = useCallback(
    (px: number, py: number) => ({
      x: bounds.minX + (px - offsetX) / scale,
      y: bounds.minY + (py - offsetY) / scale,
    }),
    [bounds.minX, bounds.minY, offsetX, offsetY, scale],
  )
  const toPx = useCallback(
    (x: number, y: number) => ({
      px: offsetX + (x - bounds.minX) * scale,
      py: offsetY + (y - bounds.minY) * scale,
    }),
    [bounds.minX, bounds.minY, offsetX, offsetY, scale],
  )

  useEffect(() => {
    if (!grid) return
    if (!heatCanvasRef.current) heatCanvasRef.current = document.createElement('canvas')
    paintHeatmap(grid, heatCanvasRef.current, heatRangeDb)
  }, [grid, heatRangeDb])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const styles = getComputedStyle(canvas)
    const fg = styles.getPropertyValue('--foreground').trim() || '#eee'
    const muted = styles.getPropertyValue('--muted-foreground').trim() || '#999'
    const surface = styles.getPropertyValue('--surface').trim() || '#111'
    const accent = styles.getPropertyValue('--accent').trim() || '#4fb3e8'
    const primary = styles.getPropertyValue('--primary').trim() || '#f5b942'
    const destructive = styles.getPropertyValue('--destructive').trim() || '#ef4444'
    const gridColor = styles.getPropertyValue('--grid').trim() || 'rgba(255,255,255,0.06)'

    ctx.fillStyle = surface
    ctx.fillRect(0, 0, size.w, size.h)

    // Background meter grid in edit/draw mode for easier sketching
    if (planTool !== 'analyze') {
      const startX = Math.floor(bounds.minX)
      const endX = Math.ceil(bounds.maxX)
      const startY = Math.floor(bounds.minY)
      const endY = Math.ceil(bounds.maxY)
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 1
      for (let x = startX; x <= endX; x += 0.5) {
        const { px } = toPx(x, 0)
        ctx.strokeStyle = Number.isInteger(x) ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, size.h)
        ctx.stroke()
      }
      for (let y = startY; y <= endY; y += 0.5) {
        const { py } = toPx(0, y)
        ctx.strokeStyle = Number.isInteger(y) ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
        ctx.beginPath()
        ctx.moveTo(0, py)
        ctx.lineTo(size.w, py)
        ctx.stroke()
      }
    }

    const polyPts = getRoomPolygon(room)
    const valid = isRoomGeometryValid(room)
    const path = new Path2D()
    polyPts.forEach((p, i) => {
      const { px, py } = toPx(p.x, p.y)
      if (i === 0) path.moveTo(px, py)
      else path.lineTo(px, py)
    })
    if (polyPts.length >= 3) path.closePath()

    const dimExisting = planTool === 'draw'
    if (polyPts.length >= 3) {
      ctx.save()
      if (dimExisting) ctx.globalAlpha = 0.25
      ctx.fillStyle = valid ? 'rgba(255,255,255,0.03)' : 'rgba(239,68,68,0.08)'
      ctx.fill(path)

      if (showHeatmap && grid && heatCanvasRef.current && valid && !dimExisting) {
        ctx.save()
        ctx.clip(path)
        ctx.globalAlpha = 0.78
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        const o = toPx(grid.originX, grid.originY)
        ctx.drawImage(heatCanvasRef.current, o.px, o.py, grid.cols * grid.cell * scale, grid.rows * grid.cell * scale)
        ctx.restore()
      }

      if (planTool === 'analyze') {
        ctx.save()
        ctx.clip(path)
        ctx.strokeStyle = showHeatmap ? 'rgba(0,0,0,0.25)' : gridColor
        ctx.lineWidth = 1
        for (let x = Math.ceil(bounds.minX); x < bounds.maxX; x++) {
          const { px } = toPx(x, 0)
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, size.h)
          ctx.stroke()
        }
        for (let y = Math.ceil(bounds.minY); y < bounds.maxY; y++) {
          const { py } = toPx(0, y)
          ctx.beginPath()
          ctx.moveTo(0, py)
          ctx.lineTo(size.w, py)
          ctx.stroke()
        }
        ctx.restore()
      }

      ctx.strokeStyle = valid ? fg : destructive
      ctx.lineWidth = planTool === 'edit' ? 2 : 1.5
      ctx.stroke(path)
      ctx.restore()
    }

    // Edge dimension labels (for active polygon, or draw polygon when not drawing)
    if (planTool !== 'draw' && polyPts.length >= 3) {
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillStyle = muted
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < polyPts.length; i++) {
        const a = polyPts[i]
        const b = polyPts[(i + 1) % polyPts.length]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 0.05) continue
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        let nx = -(b.y - a.y) / len
        let ny = (b.x - a.x) / len
        if (isInsideRoom(room, mx + nx * 0.05, my + ny * 0.05)) {
          nx = -nx
          ny = -ny
        }
        const p = toPx(mx, my)
        const labelOffset = planTool === 'edit' ? 18 : 14
        let angle = Math.atan2(b.y - a.y, b.x - a.x)
        if (angle > Math.PI / 2) angle -= Math.PI
        if (angle < -Math.PI / 2) angle += Math.PI
        ctx.save()
        ctx.translate(p.px + nx * labelOffset, p.py + ny * labelOffset)
        if (Math.abs(angle) > 0.02) ctx.rotate(angle)
        ctx.fillText(`${len.toFixed(2)} m`, 0, 0)
        ctx.restore()
      }
    }

    // Axis hint + scale bar
    ctx.font = '11px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = muted
    ctx.fillText('x →', 6, size.h - 10)
    ctx.save()
    ctx.translate(14, size.h - 24)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('y →', 0, 0)
    ctx.restore()
    const barLen = scale
    const bx = size.w - barLen - 10
    const by = size.h - 12
    ctx.strokeStyle = fg
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + barLen, by)
    ctx.moveTo(bx, by - 4)
    ctx.lineTo(bx, by + 4)
    ctx.moveTo(bx + barLen, by - 4)
    ctx.lineTo(bx + barLen, by + 4)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = fg
    ctx.fillText('1 m', bx + barLen / 2, by - 10)

    // Furniture / acoustic obstacles
    if (planTool !== 'draw' && obstacles.length > 0) {
      ctx.save()
      if (planTool === 'edit') ctx.globalAlpha = 0.45
      for (const obs of obstacles) {
        const poly = getObstaclePolygon(obs)
        if (poly.length < 3) continue
        const obsPath = new Path2D()
        poly.forEach((p, i) => {
          const pp = toPx(p.x, p.y)
          if (i === 0) obsPath.moveTo(pp.px, pp.py)
          else obsPath.lineTo(pp.px, pp.py)
        })
        obsPath.closePath()
        const isSel = obs.id === selectedObstacleId
        ctx.save()
        if (!obs.enabled) ctx.setLineDash([4, 3])
        ctx.fillStyle = obs.enabled ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.08)'
        ctx.fill(obsPath)
        ctx.lineWidth = isSel ? 2.2 : 1.3
        ctx.strokeStyle = isSel ? primary : obs.enabled ? 'rgba(226,232,240,0.7)' : 'rgba(148,163,184,0.32)'
        ctx.stroke(obsPath)
        ctx.restore()

        // Orientation indicator toward front (+local Y)
        const rad = (obs.rotation * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const cp = toPx(obs.x, obs.y)
        const frontLen = Math.min(obs.depth * 0.32, 0.25)
        const fp = toPx(obs.x - frontLen * sin, obs.y + frontLen * cos)
        ctx.strokeStyle = isSel ? primary : 'rgba(226,232,240,0.5)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cp.px, cp.py)
        ctx.lineTo(fp.px, fp.py)
        ctx.stroke()

        // Label inside footprint
        ctx.fillStyle = obs.enabled ? fg : muted
        ctx.font = '600 10px ui-sans-serif, system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(FURNITURE_KIND_LABEL[obs.kind], cp.px, cp.py)
      }
      ctx.restore()
    }

    // Listening point & subwoofers (dimmed in edit mode, hidden in draw mode)
    if (planTool !== 'draw') {
      ctx.save()
      if (planTool === 'edit') ctx.globalAlpha = 0.45

      if (sweetSpot?.enabled && valid && polyPts.length >= 3) {
        const zb = getSweetSpotBounds(room, listening, 1.2, sweetSpot)
        const tl = toPx(zb.minX, zb.minY)
        const br = toPx(zb.maxX, zb.maxY)
        const zw = br.px - tl.px
        const zh = br.py - tl.py
        const zColor =
          sweetSpotSpanDb === null
            ? accent
            : sweetSpotSpanDb < 4
              ? '#5fd68a'
              : sweetSpotSpanDb < 8
                ? primary
                : destructive
        ctx.save()
        ctx.clip(path)
        ctx.fillStyle =
          sweetSpotSpanDb === null
            ? 'rgba(79,179,232,0.10)'
            : sweetSpotSpanDb < 4
              ? 'rgba(95,214,138,0.10)'
              : sweetSpotSpanDb < 8
                ? 'rgba(245,185,66,0.11)'
                : 'rgba(239,68,68,0.11)'
        ctx.fillRect(tl.px, tl.py, zw, zh)
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = zColor
        ctx.lineWidth = 1.4
        ctx.strokeRect(tl.px, tl.py, zw, zh)
        ctx.restore()
      }

      const lp = toPx(listening.x, listening.y)
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(lp.px, lp.py, 9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(lp.px - 14, lp.py)
      ctx.lineTo(lp.px + 14, lp.py)
      ctx.moveTo(lp.px, lp.py - 14)
      ctx.lineTo(lp.px, lp.py + 14)
      ctx.stroke()
      ctx.fillStyle = accent
      ctx.textAlign = 'left'
      ctx.fillText('Hörplatz', lp.px + 12, lp.py - 12)

      // hover probe in analyze mode
      if (planTool === 'analyze' && hover && !dragRef.current) {
        const hp = toPx(hover.x, hover.y)
        ctx.save()
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(hp.px, offsetY)
        ctx.lineTo(hp.px, offsetY + bounds.depth * scale)
        ctx.moveTo(offsetX, hp.py)
        ctx.lineTo(offsetX + bounds.width * scale, hp.py)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = fg
        ctx.beginPath()
        ctx.arc(hp.px, hp.py, 3, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const sub of subs) {
        const sp = toPx(sub.x, sub.y)
        const color = subColor(sub.id)
        ctx.beginPath()
        ctx.arc(sp.px, sp.py, SUB_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = sub.enabled ? color : 'rgba(120,120,120,0.6)'
        ctx.fill()
        ctx.lineWidth = sub.id === selectedId ? 3 : 1.5
        ctx.strokeStyle = sub.id === selectedId ? fg : 'rgba(0,0,0,0.6)'
        ctx.stroke()
        ctx.fillStyle = '#111'
        ctx.font = 'bold 11px ui-sans-serif, system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(String(Number.parseInt(sub.id.replace('sub-', ''), 10) + 1), sp.px, sp.py + 0.5)
        if (sub.phase === 180) {
          ctx.fillStyle = fg
          ctx.font = '9px ui-monospace, monospace'
          ctx.fillText('180°', sp.px, sp.py + SUB_RADIUS + 9)
        }
      }

      if (previewSubs && previewSubs.length > 0) {
        previewSubs.forEach((sub, idx) => {
          const sp = toPx(sub.x, sub.y)
          ctx.save()
          ctx.beginPath()
          ctx.arc(sp.px, sp.py, SUB_RADIUS + 2, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(95, 214, 138, 0.22)'
          ctx.fill()
          ctx.setLineDash([4, 3])
          ctx.lineWidth = 2
          ctx.strokeStyle = '#5fd68a'
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = '#5fd68a'
          ctx.font = 'bold 10px ui-monospace, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`V${idx + 1}`, sp.px, sp.py + 0.5)
          if (sub.phase === 180) {
            ctx.font = '9px ui-monospace, monospace'
            ctx.fillText('180°', sp.px, sp.py + SUB_RADIUS + 11)
          }
          ctx.restore()
        })
      }
      ctx.restore()
    }

    // Orthogonal alignment guides during edit or draw
    if ((planTool === 'edit' && vertexDragRef.current) || planTool === 'draw') {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = primary
      ctx.lineWidth = 1
      if (alignGuides.x !== undefined) {
        const { px } = toPx(alignGuides.x, 0)
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, size.h)
        ctx.stroke()
      }
      if (alignGuides.y !== undefined) {
        const { py } = toPx(0, alignGuides.y)
        ctx.beginPath()
        ctx.moveTo(0, py)
        ctx.lineTo(size.w, py)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Room plan edit handles (vertices + edge midpoints)
    if (planTool === 'edit' && room.shape === 'polygon') {
      const pts = room.polygon
      // Midpoint '+' handles
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const mp = toPx((a.x + b.x) / 2, (a.y + b.y) / 2)
        const hovered = hoverMid === i
        ctx.beginPath()
        ctx.arc(mp.px, mp.py, hovered ? 7 : 5.5, 0, Math.PI * 2)
        ctx.fillStyle = hovered ? primary : 'rgba(30,33,40,0.9)'
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = hovered ? '#111' : 'rgba(255,255,255,0.45)'
        ctx.stroke()
        ctx.fillStyle = hovered ? '#111' : fg
        ctx.font = 'bold 10px ui-sans-serif, system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('+', mp.px, mp.py + 0.5)
      }

      // Corner vertex handles
      for (let i = 0; i < pts.length; i++) {
        const vp = toPx(pts[i].x, pts[i].y)
        const selected = i === selectedVertexIdx
        const hovered = i === hoverVertex
        ctx.beginPath()
        ctx.arc(vp.px, vp.py, selected || hovered ? VERTEX_RADIUS + 1.5 : VERTEX_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = selected ? primary : hovered ? fg : '#1e222a'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = selected ? fg : primary
        ctx.stroke()
        ctx.fillStyle = selected || hovered ? '#111' : fg
        ctx.font = 'bold 9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), vp.px, vp.py + 0.5)
      }

      if (vertexDragInfo) {
        const vp = toPx(vertexDragInfo.x, vertexDragInfo.y)
        const label = `P${vertexDragInfo.idx + 1}  x ${vertexDragInfo.x.toFixed(2)}  y ${vertexDragInfo.y.toFixed(2)}`
        ctx.font = '11px ui-monospace, monospace'
        const w = ctx.measureText(label).width + 12
        const tx = Math.min(Math.max(vp.px - w / 2, 4), size.w - w - 4)
        const ty = Math.max(4, vp.py - VERTEX_RADIUS - 26)
        ctx.fillStyle = 'rgba(0,0,0,0.85)'
        ctx.fillRect(tx, ty, w, 18)
        ctx.fillStyle = fg
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, tx + 6, ty + 9)
      }
    }

    // Freehand / click-to-draw polygon mode
    if (planTool === 'draw') {
      if (drawPoints.length > 0) {
        ctx.strokeStyle = primary
        ctx.lineWidth = 2
        ctx.beginPath()
        drawPoints.forEach((p, i) => {
          const pp = toPx(p.x, p.y)
          if (i === 0) ctx.moveTo(pp.px, pp.py)
          else ctx.lineTo(pp.px, pp.py)
        })
        if (drawCursor) {
          const targetPt = closeSnap && drawPoints.length >= 3 ? drawPoints[0] : drawCursor
          const cp = toPx(targetPt.x, targetPt.y)
          ctx.lineTo(cp.px, cp.py)
        }
        ctx.stroke()

        // Segment lengths of drawn edges
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let i = 0; i < drawPoints.length - 1; i++) {
          const a = drawPoints[i]
          const b = drawPoints[i + 1]
          const len = Math.hypot(b.x - a.x, b.y - a.y)
          const mp = toPx((a.x + b.x) / 2, (a.y + b.y) / 2)
          ctx.fillStyle = 'rgba(0,0,0,0.75)'
          ctx.fillRect(mp.px - 24, mp.py - 9, 48, 18)
          ctx.fillStyle = fg
          ctx.fillText(`${len.toFixed(2)} m`, mp.px, mp.py)
        }
        if (drawCursor) {
          const last = drawPoints[drawPoints.length - 1]
          const targetPt = closeSnap && drawPoints.length >= 3 ? drawPoints[0] : drawCursor
          const len = Math.hypot(targetPt.x - last.x, targetPt.y - last.y)
          const mp = toPx((last.x + targetPt.x) / 2, (last.y + targetPt.y) / 2)
          if (len > 0.05) {
            ctx.fillStyle = 'rgba(0,0,0,0.85)'
            ctx.fillRect(mp.px - 26, mp.py - 9, 52, 18)
            ctx.fillStyle = primary
            ctx.fillText(`${len.toFixed(2)} m`, mp.px, mp.py)
          }
        }
      }

      // Draw placed vertices
      drawPoints.forEach((p, i) => {
        const pp = toPx(p.x, p.y)
        const isFirstClose = i === 0 && closeSnap && drawPoints.length >= 3
        ctx.beginPath()
        ctx.arc(pp.px, pp.py, isFirstClose ? 10 : 6, 0, Math.PI * 2)
        ctx.fillStyle = isFirstClose ? '#5fd68a' : primary
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#111'
        ctx.stroke()
        ctx.fillStyle = '#111'
        ctx.font = 'bold 9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), pp.px, pp.py + 0.5)
      })

      if (drawCursor) {
        const cp = toPx(drawCursor.x, drawCursor.y)
        const label = closeSnap && drawPoints.length >= 3
          ? 'P1 schließen'
          : `x ${drawCursor.x.toFixed(2)}  y ${drawCursor.y.toFixed(2)}`
        ctx.font = '11px ui-monospace, monospace'
        const w = ctx.measureText(label).width + 12
        const tx = Math.min(Math.max(cp.px + 12, 4), size.w - w - 4)
        const ty = Math.max(4, cp.py - 22)
        ctx.fillStyle = 'rgba(0,0,0,0.85)'
        ctx.fillRect(tx, ty, w, 18)
        ctx.fillStyle = closeSnap && drawPoints.length >= 3 ? '#5fd68a' : fg
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, tx + 6, ty + 9)
      }
    }

    // Subwoofer / obstacle drag coordinate tag
    if (dragInfo) {
      const sp = toPx(dragInfo.x, dragInfo.y)
      let label = `x ${dragInfo.x.toFixed(2)}  y ${dragInfo.y.toFixed(2)}`
      if (dragInfo.kind === 'sub') {
        const sub = subs.find((s) => s.id === dragInfo.id)
        label += `  z ${(sub?.z ?? 0).toFixed(2)}`
      } else {
        const obs = obstacles.find((o) => o.id === dragInfo.id)
        if (obs) label = `${FURNITURE_KIND_LABEL[obs.kind]}  ${label}`
      }
      ctx.font = '11px ui-monospace, monospace'
      const w = ctx.measureText(label).width + 12
      const tx = Math.min(Math.max(sp.px - w / 2, 4), size.w - w - 4)
      const ty = Math.max(4, sp.py - SUB_RADIUS - 26)
      ctx.fillStyle = 'rgba(0,0,0,0.8)'
      ctx.fillRect(tx, ty, w, 18)
      ctx.fillStyle = fg
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, tx + 6, ty + 9)
    }
  }, [
    size,
    room,
    subs,
    obstacles,
    selectedObstacleId,
    sweetSpot,
    sweetSpotSpanDb,
    previewSubs,
    listening,
    grid,
    showHeatmap,
    heatRangeDb,
    selectedId,
    hover,
    dragInfo,
    vertexDragInfo,
    alignGuides,
    hoverVertex,
    hoverMid,
    selectedVertexIdx,
    planTool,
    drawPoints,
    drawCursor,
    closeSnap,
    toPx,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
    bounds.width,
    bounds.depth,
    offsetX,
    offsetY,
    scale,
    canvasRef,
  ])

  const hitSub = (px: number, py: number) => {
    for (let i = subs.length - 1; i >= 0; i--) {
      const p = toPx(subs[i].x, subs[i].y)
      if (Math.hypot(p.px - px, p.py - py) <= SUB_RADIUS + 4) return subs[i]
    }
    return null
  }

  const hitListening = (px: number, py: number) => {
    const lp = toPx(listening.x, listening.y)
    return Math.hypot(lp.px - px, lp.py - py) <= 13
  }

  const hitObstacle = (rx: number, ry: number) => {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      if (isPointInObstacle2D(obstacles[i], rx, ry)) return obstacles[i]
    }
    return null
  }

  const hitVertex = (px: number, py: number) => {
    const pts = room.polygon
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = toPx(pts[i].x, pts[i].y)
      if (Math.hypot(p.px - px, p.py - py) <= VERTEX_RADIUS + 5) return i
    }
    return null
  }

  const hitMidpoint = (px: number, py: number) => {
    const pts = room.polygon
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const mp = toPx((a.x + b.x) / 2, (a.y + b.y) / 2)
      if (Math.hypot(mp.px - px, mp.py - py) <= 9) return i
    }
    return null
  }

  const snapWithGuides = (raw: Point2D, referencePts: Point2D[], excludeIdx?: number) => {
    let x = snapValue(raw.x, snapStep)
    let y = snapValue(raw.y, snapStep)
    const guides: { x?: number; y?: number } = {}
    const thresh = 0.08
    for (let i = 0; i < referencePts.length; i++) {
      if (i === excludeIdx) continue
      const ref = referencePts[i]
      if (guides.x === undefined && Math.abs(x - ref.x) <= thresh) {
        x = Number(ref.x.toFixed(2))
        guides.x = x
      }
      if (guides.y === undefined && Math.abs(y - ref.y) <= thresh) {
        y = Number(ref.y.toFixed(2))
        guides.y = y
      }
    }
    return { point: { x, y }, guides }
  }

  const localPos = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = localPos(e)

    if (planTool === 'draw') {
      if (e.button === 2) {
        if (drawPoints.length > 0) onDrawPointsChange(drawPoints.slice(0, -1))
        return
      }
      if (drawPoints.length >= 3) {
        const p0 = toPx(drawPoints[0].x, drawPoints[0].y)
        if (Math.hypot(p0.px - px, p0.py - py) <= 14) {
          onFinishDraw(drawPoints)
          return
        }
      }
      const raw = toRoom(px, py)
      const { point } = snapWithGuides(raw, drawPoints)
      onDrawPointsChange([...drawPoints, point])
      return
    }

    if (planTool === 'edit' && room.shape === 'polygon') {
      const vIdx = hitVertex(px, py)
      if (vIdx !== null) {
        lockedBoundsRef.current = baseBounds
        vertexDragRef.current = { idx: vIdx }
        onSelectVertex(vIdx)
        setVertexDragInfo({ idx: vIdx, x: room.polygon[vIdx].x, y: room.polygon[vIdx].y })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      const mIdx = hitMidpoint(px, py)
      if (mIdx !== null) {
        const pts = room.polygon
        const a = pts[mIdx]
        const b = pts[(mIdx + 1) % pts.length]
        const mid = { x: Number(((a.x + b.x) / 2).toFixed(2)), y: Number(((a.y + b.y) / 2).toFixed(2)) }
        const next = [...pts.slice(0, mIdx + 1), mid, ...pts.slice(mIdx + 1)]
        lockedBoundsRef.current = baseBounds
        onPolygonChange(next)
        const newIdx = mIdx + 1
        vertexDragRef.current = { idx: newIdx }
        onSelectVertex(newIdx)
        setVertexDragInfo({ idx: newIdx, x: mid.x, y: mid.y })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      onSelectVertex(null)
      return
    }

    const sub = hitSub(px, py)
    if (sub) {
      dragRef.current = { kind: 'sub', id: sub.id, moved: false }
      onSelect(sub.id)
      onSelectObstacle?.(null)
      setDragInfo({ kind: 'sub', id: sub.id, x: sub.x, y: sub.y })
      e.currentTarget.setPointerCapture(e.pointerId)
      setHover(null)
      onProbe(null)
      return
    }

    if (hitListening(px, py)) {
      dragRef.current = null
      onSelectObstacle?.(null)
      return
    }

    const pt = toRoom(px, py)
    const obs = hitObstacle(pt.x, pt.y)
    if (obs) {
      dragRef.current = {
        kind: 'obs',
        id: obs.id,
        offsetX: obs.x - pt.x,
        offsetY: obs.y - pt.y,
        moved: false,
      }
      onSelectObstacle?.(obs.id)
      onSelect(null)
      setDragInfo({ kind: 'obs', id: obs.id, x: obs.x, y: obs.y })
      e.currentTarget.setPointerCapture(e.pointerId)
      setHover(null)
      onProbe(null)
    } else {
      onSelectObstacle?.(null)
      dragRef.current = null
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = localPos(e)
    const pt = toRoom(px, py)

    if (planTool === 'draw') {
      const { point, guides } = snapWithGuides(pt, drawPoints)
      setDrawCursor(point)
      setAlignGuides(guides)
      if (drawPoints.length >= 3) {
        const p0 = toPx(drawPoints[0].x, drawPoints[0].y)
        setCloseSnap(Math.hypot(p0.px - px, p0.py - py) <= 14)
      } else {
        setCloseSnap(false)
      }
      return
    }

    if (planTool === 'edit' && room.shape === 'polygon') {
      if (vertexDragRef.current) {
        const idx = vertexDragRef.current.idx
        const { point, guides } = snapWithGuides(pt, room.polygon, idx)
        setAlignGuides(guides)
        setVertexDragInfo({ idx, x: point.x, y: point.y })
        const next = room.polygon.map((p, i) => (i === idx ? point : p))
        onPolygonChange(next)
        return
      }
      setHoverVertex(hitVertex(px, py))
      setHoverMid(hitVertex(px, py) === null ? hitMidpoint(px, py) : null)
      return
    }

    if (dragRef.current) {
      if (dragRef.current.kind === 'sub') {
        const c = clampToRoom(room, pt.x, pt.y)
        dragRef.current.moved = true
        onSubMove(dragRef.current.id, Number(c.x.toFixed(2)), Number(c.y.toFixed(2)))
        setDragInfo({ kind: 'sub', id: dragRef.current.id, x: c.x, y: c.y })
      } else {
        const c = clampToRoom(room, pt.x + dragRef.current.offsetX, pt.y + dragRef.current.offsetY)
        dragRef.current.moved = true
        onObstacleMove?.(dragRef.current.id, Number(c.x.toFixed(2)), Number(c.y.toFixed(2)))
        setDragInfo({ kind: 'obs', id: dragRef.current.id, x: c.x, y: c.y })
      }
      return
    }
    if (e.pointerType === 'mouse') {
      const overGrab = Boolean(hitSub(px, py) || (!hitListening(px, py) && hitObstacle(pt.x, pt.y)))
      setHoverGrab(overGrab)
      if (isInsideRoom(room, pt.x, pt.y)) {
        setHover(pt)
        onProbe(pt)
      } else {
        setHover(null)
        onProbe(null)
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (planTool === 'edit') {
      vertexDragRef.current = null
      lockedBoundsRef.current = null
      setVertexDragInfo(null)
      setAlignGuides({})
      return
    }
    if (planTool === 'draw') return

    const { px, py } = localPos(e)
    if (dragRef.current) {
      dragRef.current = null
      setDragInfo(null)
      return
    }
    const pt = toRoom(px, py)
    if (isInsideRoom(room, pt.x, pt.y)) {
      onListeningChange({ x: Number(pt.x.toFixed(2)), y: Number(pt.y.toFixed(2)) })
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (planTool !== 'edit' || room.shape !== 'polygon' || room.polygon.length <= 3) return
    const rect = e.currentTarget.getBoundingClientRect()
    const vIdx = hitVertex(e.clientX - rect.left, e.clientY - rect.top)
    if (vIdx !== null) {
      const next = room.polygon.filter((_, i) => i !== vIdx)
      onPolygonChange(next)
      onSelectVertex(null)
    }
  }

  const onPointerLeave = () => {
    setHover(null)
    setHoverGrab(false)
    setHoverVertex(null)
    setHoverMid(null)
    setDrawCursor(null)
    setCloseSnap(false)
    onProbe(null)
  }

  const cursor =
    planTool === 'draw'
      ? closeSnap
        ? 'pointer'
        : 'crosshair'
      : planTool === 'edit'
        ? vertexDragInfo
          ? 'grabbing'
          : hoverVertex !== null
            ? 'grab'
            : hoverMid !== null
              ? 'pointer'
              : 'default'
        : dragInfo
          ? 'grabbing'
          : hoverGrab
            ? 'grab'
            : 'crosshair'

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Draufsicht des Raumes, ${room.shape === 'rect' ? 'rechteckig' : room.shape === 'lshape' ? 'L-förmig' : 'Polygon'}, ${bounds.width.toFixed(2)} mal ${bounds.depth.toFixed(2)} Meter, mit ${subs.length} Subwoofern`}
        className="block w-full touch-none rounded-md border border-border"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          if (planTool === 'draw') e.preventDefault()
        }}
      />
    </div>
  )
}
