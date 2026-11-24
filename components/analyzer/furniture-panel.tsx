'use client'

import { Armchair, Box, Columns3, LampFloor, Plus, Power, RotateCw, Trash2 } from 'lucide-react'
import type { FurnitureKind, RoomConfig, RoomObstacle } from '@/lib/acoustics'
import {
  FURNITURE_DEFAULT_ABSORPTION,
  clampObstacleToRoom,
  createObstacleFromPreset,
  getBounds,
  getObstacleAbsorption,
  isPorousAbsorberKind,
} from '@/lib/acoustics'
import { FURNITURE_CATALOG, FURNITURE_KIND_LABEL, type FurniturePreset } from '@/lib/furniture'
import { cn } from '@/lib/utils'
import { NumberField } from './controls'

export const FURNITURE_COLORS: Record<FurnitureKind, string> = {
  sofa: '#64748b',
  lsofa: '#6366f1',
  shelf: '#b45309',
  cabinet: '#92400e',
  table: '#78716c',
  pillar: '#94a3b8',
  basstrap: '#0f766e',
}

function FurnitureIcon({ kind, className }: { kind: FurnitureKind; className?: string }) {
  switch (kind) {
    case 'sofa':
    case 'lsofa':
      return <Armchair className={className} />
    case 'shelf':
    case 'cabinet':
      return <Box className={className} />
    case 'pillar':
      return <Columns3 className={className} />
    case 'basstrap':
      return <LampFloor className={className} />
    default:
      return <Box className={className} />
  }
}

interface FurniturePanelProps {
  room: RoomConfig
  obstacles: RoomObstacle[]
  onObstaclesChange: (obstacles: RoomObstacle[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function FurniturePanel({
  room,
  obstacles,
  onObstaclesChange,
  selectedId,
  onSelect,
}: FurniturePanelProps) {
  const bounds = getBounds(room)

  const addPreset = (preset: FurniturePreset) => {
    const obs = createObstacleFromPreset(preset, room, obstacles.length)
    onObstaclesChange([...obstacles, obs])
    onSelect(obs.id)
  }

  const update = (id: string, patch: Partial<RoomObstacle>) => {
    onObstaclesChange(
      obstacles.map((o) => (o.id === id ? clampObstacleToRoom(room, { ...o, ...patch }) : o)),
    )
  }

  const remove = (id: string) => {
    onObstaclesChange(obstacles.filter((o) => o.id !== id))
    if (selectedId === id) onSelect(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Möbel & Hindernisse hinzufügen</span>
        <div className="grid grid-cols-2 gap-1.5">
          {FURNITURE_CATALOG.map((preset) => (
            <button
              key={preset.defaultName}
              type="button"
              onClick={() => addPreset(preset)}
              title={`${preset.defaultName} (${preset.width.toFixed(2)} × ${preset.depth.toFixed(2)} × ${preset.height.toFixed(2)} m · α ${Math.round(FURNITURE_DEFAULT_ABSORPTION[preset.kind] * 100)} %)`}
              className="inline-flex items-center justify-between gap-1.5 rounded-md border border-border bg-surface/80 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                <FurnitureIcon kind={preset.kind} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{preset.label}</span>
              </span>
              <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {obstacles.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Noch keine Möbel platziert. Platzierte Objekte beeinflussen das Raumvolumen und dämpfen Raummoden sowie Wellenfronten automatisch entsprechend ihrem Materialtyp.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Platzierte Objekte ({obstacles.length})</span>
            {obstacles.some((o) => o.enabled) && (
              <span className="font-mono text-primary">
                {obstacles.filter((o) => o.enabled).length} aktiv
              </span>
            )}
          </div>

          {obstacles.map((obs) => {
            const selected = obs.id === selectedId
            const depthRatio = Math.max(0, Math.min(1, (room.H - Math.min(room.H, obs.height)) / room.H))
            const isPorous = isPorousAbsorberKind(obs.kind)
            const isSolidFullHeight = !isPorous && depthRatio <= 0.06
            const heightPct = Math.round((Math.min(room.H, obs.height) / Math.max(0.1, room.H)) * 100)
            const alphaPct = Math.round(getObstacleAbsorption(obs) * 100)

            return (
              <div
                key={obs.id}
                className={cn(
                  'rounded-md border bg-surface/60 p-2.5 transition-colors',
                  selected ? 'border-primary/60 bg-primary/5' : 'border-border',
                  !obs.enabled && 'opacity-60',
                )}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(selected ? null : obs.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: FURNITURE_COLORS[obs.kind] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">{obs.name}</div>
                      <div className="tabular truncate font-mono text-[10px] text-muted-foreground">
                        {obs.width.toFixed(2)}×{obs.depth.toFixed(2)}×{obs.height.toFixed(2)} m · {obs.rotation}° ·{' '}
                        {!obs.enabled
                          ? 'Deaktiviert'
                          : isPorous
                            ? `Porös · α ${alphaPct}%`
                            : isSolidFullHeight
                              ? `Vollhöhe · α ${alphaPct}%`
                              : `${heightPct}% H · α ${alphaPct}%`}
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`${obs.name} um 90° drehen`}
                      title="Um 90° drehen"
                      onClick={() => update(obs.id, { rotation: (obs.rotation + 90) % 360 })}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={obs.enabled ? `${obs.name} deaktivieren` : `${obs.name} aktivieren`}
                      title={obs.enabled ? 'Für A/B-Vergleich deaktivieren' : 'Aktivieren'}
                      aria-pressed={obs.enabled}
                      onClick={() => update(obs.id, { enabled: !obs.enabled })}
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded border border-border transition-colors',
                        obs.enabled ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <Power className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${obs.name} entfernen`}
                      title="Entfernen"
                      onClick={() => remove(obs.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {selected && (
                  <div className="mt-2.5 flex flex-col gap-2 border-t border-border/60 pt-2.5">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground" htmlFor={`obs-name-${obs.id}`}>
                        Bezeichnung
                      </label>
                      <input
                        id={`obs-name-${obs.id}`}
                        type="text"
                        value={obs.name}
                        maxLength={32}
                        onChange={(e) =>
                          onObstaclesChange(
                            obstacles.map((o) => (o.id === obs.id ? { ...o, name: e.target.value } : o)),
                          )
                        }
                        onBlur={() => {
                          if (!obs.name.trim()) update(obs.id, { name: FURNITURE_KIND_LABEL[obs.kind] })
                        }}
                        className="min-w-0 flex-1 rounded border border-input bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="X"
                        value={obs.x}
                        onChange={(x) => update(obs.id, { x })}
                        min={bounds.minX}
                        max={bounds.maxX}
                        unit="m"
                      />
                      <NumberField
                        label="Y"
                        value={obs.y}
                        onChange={(y) => update(obs.id, { y })}
                        min={bounds.minY}
                        max={bounds.maxY}
                        unit="m"
                      />
                      <NumberField
                        label="Z (Boden)"
                        value={obs.z}
                        onChange={(z) => update(obs.id, { z })}
                        min={0}
                        max={Math.max(0, room.H - 0.15)}
                        unit="m"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="Breite"
                        value={obs.width}
                        onChange={(width) => update(obs.id, { width })}
                        min={0.2}
                        max={12}
                        unit="m"
                      />
                      <NumberField
                        label="Tiefe"
                        value={obs.depth}
                        onChange={(depth) => update(obs.id, { depth })}
                        min={0.2}
                        max={12}
                        unit="m"
                      />
                      <NumberField
                        label="Höhe"
                        value={obs.height}
                        onChange={(height) => update(obs.id, { height })}
                        min={0.15}
                        max={Math.max(0.15, room.H - obs.z)}
                        unit="m"
                      />
                    </div>

                    <div className="grid grid-cols-2 items-end gap-2">
                      <NumberField
                        label="Drehung"
                        value={obs.rotation}
                        onChange={(rotation) => update(obs.id, { rotation })}
                        min={0}
                        max={359}
                        step={5}
                        decimals={0}
                        unit="°"
                      />
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Schnellhöhe</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => update(obs.id, { z: 0, height: room.H })}
                            className="flex-1 rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                          >
                            Raumhoch
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
