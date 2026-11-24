'use client'

import { PenTool, Plus, RotateCw, Trash2 } from 'lucide-react'
import type { AnalysisSettings, Point2D, RoomConfig, RoomShape } from '@/lib/acoustics'
import {
  getRoomArea,
  getRoomPerimeter,
  getRoomPolygon,
  isRoomGeometryValid,
  makeLShapePolygon,
  makeRectPolygon,
  makeTrapezoidPolygon,
  makeUShapePolygon,
} from '@/lib/acoustics'
import { cn } from '@/lib/utils'
import { NumberField, RangeField, Segmented } from './controls'

export type PlanTool = 'analyze' | 'edit' | 'draw'

interface RoomFormProps {
  room: RoomConfig
  onRoomChange: (room: RoomConfig) => void
  settings: AnalysisSettings
  onSettingsChange: (s: AnalysisSettings) => void
  planTool: PlanTool
  onPlanToolChange: (tool: PlanTool) => void
  snapStep: number
  onSnapStepChange: (step: number) => void
  selectedVertexIdx: number | null
  onSelectVertex: (idx: number | null) => void
}

export function RoomForm({
  room,
  onRoomChange,
  settings,
  onSettingsChange,
  planTool,
  onPlanToolChange,
  snapStep,
  onSnapStepChange,
  selectedVertexIdx,
  onSelectVertex,
}: RoomFormProps) {
  const set = (patch: Partial<RoomConfig>) => onRoomChange({ ...room, ...patch })
  const setS = (patch: Partial<AnalysisSettings>) => onSettingsChange({ ...settings, ...patch })

  const handleShapeChange = (shape: RoomShape) => {
    if (shape === 'polygon' && room.shape !== 'polygon') {
      const converted = getRoomPolygon(room)
      onRoomChange({ ...room, shape: 'polygon', polygon: converted })
      onPlanToolChange('edit')
      onSelectVertex(null)
    } else {
      onRoomChange({ ...room, shape })
      if (shape !== 'polygon') {
        onPlanToolChange('analyze')
        onSelectVertex(null)
      }
    }
  }

  const applyPreset = (pts: Point2D[]) => {
    onRoomChange({ ...room, shape: 'polygon', polygon: pts })
    onSelectVertex(null)
    if (planTool === 'draw') onPlanToolChange('edit')
  }

  const rotatePolygon90 = () => {
    const pts = room.polygon
    if (pts.length < 3) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const rotated = pts.map((p) => ({
      x: Number((cx - (p.y - cy)).toFixed(2)),
      y: Number((cy + (p.x - cx)).toFixed(2)),
    }))
    // Shift so minX >= 0 and minY >= 0 when starting near origin
    const rMinX = Math.min(...rotated.map((p) => p.x))
    const rMinY = Math.min(...rotated.map((p) => p.y))
    const shifted = rotated.map((p) => ({
      x: Number((p.x - rMinX).toFixed(2)),
      y: Number((p.y - rMinY).toFixed(2)),
    }))
    onRoomChange({ ...room, polygon: shifted })
  }

  const updateVertex = (idx: number, patch: Partial<Point2D>) => {
    const next = room.polygon.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    set({ polygon: next })
  }

  const addVertexAfter = (idx: number) => {
    const pts = room.polygon
    if (pts.length < 3) return
    const i = Math.min(Math.max(idx, 0), pts.length - 1)
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const mid = { x: Number(((a.x + b.x) / 2).toFixed(2)), y: Number(((a.y + b.y) / 2).toFixed(2)) }
    const next = [...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)]
    set({ polygon: next })
    onSelectVertex(i + 1)
  }

  const removeVertex = (idx: number) => {
    if (room.polygon.length <= 3) return
    const next = room.polygon.filter((_, i) => i !== idx)
    set({ polygon: next })
    if (selectedVertexIdx === idx) onSelectVertex(null)
    else if (selectedVertexIdx !== null && selectedVertexIdx > idx) onSelectVertex(selectedVertexIdx - 1)
  }

  const valid = isRoomGeometryValid(room)
  const area = getRoomArea(room)
  const perimeter = getRoomPerimeter(room)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Grundriss</span>
        <Segmented
          ariaLabel="Raumform"
          value={room.shape}
          onChange={handleShapeChange}
          options={[
            { value: 'rect', label: 'Rechteck' },
            { value: 'lshape', label: 'L-Form' },
            { value: 'polygon', label: 'Raumplan' },
          ]}
        />
      </div>

      {room.shape !== 'polygon' && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {room.shape === 'lshape' ? 'Segment A (Basis)' : 'Abmessungen'}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Länge (x)" value={room.L1} onChange={(L1) => set({ L1 })} min={1} max={40} unit="m" />
            <NumberField label="Breite (y)" value={room.W1} onChange={(W1) => set({ W1 })} min={1} max={40} unit="m" />
            <NumberField label="Höhe (z)" value={room.H} onChange={(H) => set({ H })} min={1.5} max={15} unit="m" />
          </div>
        </fieldset>
      )}

      {room.shape === 'lshape' && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Segment B (Anbau)
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Länge (x)" value={room.L2} onChange={(L2) => set({ L2 })} min={0.5} max={40} unit="m" />
            <NumberField label="Tiefe (y)" value={room.W2} onChange={(W2) => set({ W2 })} min={0.5} max={40} unit="m" />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Segment B schließt bündig an Kante y = {room.W1.toFixed(2)} m an (2D-FEM Helmholtz-Berechnung).
          </p>
          <button
            type="button"
            onClick={() => handleShapeChange('polygon')}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <PenTool className="h-3.5 w-3.5" />
            Im Raumplan-Editor frei anpassen
          </button>
        </fieldset>
      )}

      {room.shape === 'polygon' && (
        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Raumplan-Editor
          </legend>

          {!valid && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
              Ungültiger Grundriss: Wände dürfen sich nicht schneiden und die Fläche muss mindestens 0,05 m² betragen.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Höhe (z)" value={room.H} onChange={(H) => set({ H })} min={1.5} max={15} unit="m" />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Raster-Snap</span>
              <Segmented
                ariaLabel="Raster-Snap"
                size="sm"
                value={String(snapStep)}
                onChange={(v) => onSnapStepChange(Number(v))}
                options={[
                  { value: '0', label: 'Aus' },
                  { value: '0.05', label: '5cm' },
                  { value: '0.1', label: '10cm' },
                  { value: '0.25', label: '25cm' },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Vorlagen</span>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset(makeRectPolygon(6.2, 4.35))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Rechteck
              </button>
              <button
                type="button"
                onClick={() => applyPreset(makeLShapePolygon(6.2, 4.35, 3.0, 2.5))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                L-Form
              </button>
              <button
                type="button"
                onClick={() => applyPreset(makeUShapePolygon())}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                U-Form
              </button>
              <button
                type="button"
                onClick={() => applyPreset(makeTrapezoidPolygon())}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Trapez
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onPlanToolChange(planTool === 'draw' ? 'edit' : 'draw')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                planTool === 'draw'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-foreground hover:border-primary/50',
              )}
            >
              <PenTool className="h-3.5 w-3.5" />
              {planTool === 'draw' ? 'Zeichnen aktiv' : 'Neu zeichnen'}
            </button>
            <button
              type="button"
              onClick={rotatePolygon90}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <RotateCw className="h-3.5 w-3.5" />
              90° drehen
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-2 text-[11px]">
            <div>
              <div className="text-muted-foreground">Fläche</div>
              <div className="tabular font-mono text-foreground">{area.toFixed(2)} m²</div>
            </div>
            <div>
              <div className="text-muted-foreground">Volumen</div>
              <div className="tabular font-mono text-foreground">{(area * room.H).toFixed(1)} m³</div>
            </div>
            <div>
              <div className="text-muted-foreground">Umfang</div>
              <div className="tabular font-mono text-foreground">{perimeter.toFixed(2)} m</div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Eckpunkte ({room.polygon.length})</span>
              <button
                type="button"
                onClick={() => addVertexAfter(selectedVertexIdx ?? room.polygon.length - 1)}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Punkt
              </button>
            </div>
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
              {room.polygon.map((pt, idx) => {
                const selected = idx === selectedVertexIdx
                return (
                  <div
                    key={idx}
                    onPointerDown={() => onSelectVertex(idx)}
                    className={cn(
                      'grid grid-cols-[28px_1fr_1fr_24px] items-end gap-1.5 rounded-md border bg-surface/50 p-1.5 transition-colors',
                      selected ? 'border-primary/60 bg-primary/5' : 'border-border',
                    )}
                  >
                    <span className="pb-1.5 text-center font-mono text-[11px] font-medium text-muted-foreground">
                      P{idx + 1}
                    </span>
                    <NumberField
                      label="X"
                      value={pt.x}
                      onChange={(x) => updateVertex(idx, { x })}
                      min={-30}
                      max={40}
                      unit="m"
                    />
                    <NumberField
                      label="Y"
                      value={pt.y}
                      onChange={(y) => updateVertex(idx, { y })}
                      min={-30}
                      max={40}
                      unit="m"
                    />
                    <button
                      type="button"
                      aria-label={`Eckpunkt P${idx + 1} entfernen`}
                      disabled={room.polygon.length <= 3}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeVertex(idx)
                      }}
                      className="mb-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Analyse-Parameter
        </legend>
        <RangeField
          label="Ohrhöhe (Schnittebene)"
          value={settings.earHeight}
          onChange={(earHeight) => setS({ earHeight })}
          min={0.3}
          max={Math.max(0.4, room.H - 0.1)}
          step={0.05}
          unit="m"
          decimals={2}
        />
        <RangeField
          label="Schallgeschwindigkeit"
          value={settings.c}
          onChange={(c) => setS({ c })}
          min={330}
          max={355}
          step={0.5}
          unit="m/s"
          decimals={1}
        />
        <RangeField
          label="Modale Dämpfung η"
          value={settings.eta}
          onChange={(eta) => setS({ eta })}
          min={0.01}
          max={0.2}
          step={0.005}
          decimals={3}
          format={(v) => `${v.toFixed(3)} · Q≈${Math.round(1 / v)}`}
        />
        <RangeField
          label="Max. Modenindex n"
          value={settings.nMax}
          onChange={(nMax) => setS({ nMax })}
          min={2}
          max={12}
          step={1}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="f min"
            value={settings.fMin}
            onChange={(fMin) => setS({ fMin: Math.min(fMin, settings.fMax - 5) })}
            min={10}
            max={190}
            step={1}
            decimals={0}
            unit="Hz"
          />
          <NumberField
            label="f max"
            value={settings.fMax}
            onChange={(fMax) => setS({ fMax: Math.max(fMax, settings.fMin + 5) })}
            min={30}
            max={300}
            step={1}
            decimals={0}
            unit="Hz"
          />
        </div>
      </fieldset>
    </div>
  )
}
