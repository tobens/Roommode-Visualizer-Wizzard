'use client'

import { Check, Crosshair, Loader2, Plus, Power, RotateCcw, Trash2 } from 'lucide-react'
import type { ListeningPoint, RoomConfig, Subwoofer } from '@/lib/acoustics'
import { clampToRoom, getBounds } from '@/lib/acoustics'
import type { PlacementMetrics, PlacementSuggestion } from '@/lib/subwoofer-optimizer'
import { cn } from '@/lib/utils'
import { NumberField, Segmented } from './controls'

export const SUB_COLORS = ['#f5b942', '#4fb3e8', '#5fd68a', '#ef6fa8'] as const
export const MAX_SUBS = 4

interface SubwooferPanelProps {
  room: RoomConfig
  subs: Subwoofer[]
  onSubsChange: (subs: Subwoofer[]) => void
  listening: ListeningPoint
  onListeningChange: (p: ListeningPoint) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  optimizerCount?: 1 | 2 | 3 | 4
  onOptimizerCountChange?: (n: 1 | 2 | 3 | 4) => void
  suggestions?: PlacementSuggestion[]
  optimizing?: boolean
  optimizerStale?: boolean
  currentMetrics?: PlacementMetrics | null
  activePreviewId?: string | null
  onHoverPreview?: (id: string | null) => void
  onSelectPreview?: (id: string | null) => void
  onOptimize?: () => void
  onApplySuggestion?: (suggestion: PlacementSuggestion) => void
  canRestorePrevious?: boolean
  onRestorePrevious?: () => void
}

export function SubwooferPanel({
  room,
  subs,
  onSubsChange,
  listening,
  onListeningChange,
  selectedId,
  onSelect,
  optimizerCount = 2,
  onOptimizerCountChange,
  suggestions = [],
  optimizing = false,
  optimizerStale = false,
  currentMetrics = null,
  activePreviewId = null,
  onHoverPreview,
  onSelectPreview,
  onOptimize,
  onApplySuggestion,
  canRestorePrevious = false,
  onRestorePrevious,
}: SubwooferPanelProps) {
  const bounds = getBounds(room)
  const safeSubs = Array.isArray(subs) ? subs.filter((s): s is Subwoofer => Boolean(s && typeof s.id === 'string')) : []

  const update = (id: string, patch: Partial<Subwoofer>) => {
    onSubsChange(
      safeSubs.map((s) => {
        if (s.id !== id) return s
        const next = { ...s, ...patch }
        const c = clampToRoom(room, next.x, next.y)
        return { ...next, x: c.x, y: c.y, z: Math.min(Math.max(next.z, 0), room.H) }
      }),
    )
  }

  const add = () => {
    if (safeSubs.length >= MAX_SUBS) return
    const usedIdx = new Set(safeSubs.map((s) => Number.parseInt(s.id.replace('sub-', ''), 10)))
    let idx = 0
    while (usedIdx.has(idx)) idx++
    const pos = clampToRoom(room, 0.4 + idx * 0.6, 0.4)
    onSubsChange([
      ...safeSubs,
      { id: `sub-${idx}`, name: `Sub ${idx + 1}`, x: pos.x, y: pos.y, z: 0, gain: 0, phase: 0, enabled: true },
    ])
    onSelect(`sub-${idx}`)
  }

  const remove = (id: string) => {
    onSubsChange(safeSubs.filter((s) => s.id !== id))
    if (selectedId === id) onSelect(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {safeSubs.map((sub) => {
          const color = subColor(sub.id)
          const selected = sub.id === selectedId
          return (
            <div
              key={sub.id}
              className={cn(
                'rounded-md border bg-surface/60 p-3 transition-colors',
                selected ? 'border-primary/50' : 'border-border',
                !sub.enabled && 'opacity-60',
              )}
              onPointerDown={() => onSelect(sub.id)}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium">{sub.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={sub.enabled ? `${sub.name} stummschalten` : `${sub.name} aktivieren`}
                    aria-pressed={sub.enabled}
                    onClick={() => update(sub.id, { enabled: !sub.enabled })}
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded border border-border',
                      sub.enabled ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${sub.name} entfernen`}
                    onClick={() => remove(sub.id)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumberField label="X" value={sub.x} onChange={(x) => update(sub.id, { x })} min={bounds.minX} max={bounds.maxX} unit="m" />
                <NumberField label="Y" value={sub.y} onChange={(y) => update(sub.id, { y })} min={bounds.minY} max={bounds.maxY} unit="m" />
                <NumberField label="Z" value={sub.z} onChange={(z) => update(sub.id, { z })} min={0} max={room.H} unit="m" />
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <NumberField
                  label="Pegel"
                  value={sub.gain}
                  onChange={(gain) => update(sub.id, { gain })}
                  min={-24}
                  max={12}
                  step={0.5}
                  decimals={1}
                  unit="dB"
                  className="w-28"
                />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Phase</span>
                  <Segmented
                    ariaLabel={`Phase ${sub.name}`}
                    size="sm"
                    value={String(sub.phase) as '0' | '180'}
                    onChange={(v) => update(sub.id, { phase: v === '180' ? 180 : 0 })}
                    options={[
                      { value: '0', label: '0°' },
                      { value: '180', label: '180°' },
                    ]}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={safeSubs.length >= MAX_SUBS}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Subwoofer hinzufügen ({safeSubs.length}/{MAX_SUBS})
      </button>

      {onOptimize && onOptimizerCountChange && (
        <section aria-label="Positions-Optimierung" className="flex flex-col gap-2.5 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-foreground">
                Positions-Optimierung
              </h3>
              <p className="text-[11px] text-muted-foreground">Wandnah & Raumecken · minimiert Moden-Spitzen</p>
            </div>
            <Segmented
              ariaLabel="Zielanzahl Subwoofer"
              size="sm"
              value={String(optimizerCount) as '1' | '2' | '3' | '4'}
              onChange={(v) => onOptimizerCountChange(Number(v) as 1 | 2 | 3 | 4)}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
                { value: '4', label: '4' },
              ]}
            />
          </div>

          <button
            type="button"
            onClick={onOptimize}
            disabled={optimizing}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            Beste Positionen berechnen
          </button>

          {currentMetrics && (
            <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground tabular-nums">
              <span>Aktuell</span>
              <span aria-hidden>·</span>
              <span>+{Math.max(0, currentMetrics.maxPeakDb).toFixed(1)} dB Spitze</span>
              <span aria-hidden>·</span>
              <span>{currentMetrics.spanDb.toFixed(1)} dB Spanne</span>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {optimizerStale && (
                <p className="py-1.5 text-[11px] text-primary">
                  Raum oder Hörplatz geändert – Vorschläge bei Bedarf neu berechnen.
                </p>
              )}
              {suggestions.map((s) => {
                const isPreviewing = activePreviewId === s.id
                const peakDelta = currentMetrics ? s.metrics.maxPeakDb - currentMetrics.maxPeakDb : null
                return (
                  <div
                    key={s.id}
                    onMouseEnter={() => onHoverPreview?.(s.id)}
                    onMouseLeave={() => onHoverPreview?.(null)}
                    className={cn(
                      'flex flex-col gap-1.5 py-2.5 transition-colors',
                      isPreviewing && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectPreview?.(isPreviewing ? null : s.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-xs font-semibold text-primary tabular-nums">{s.rank}.</span>
                          <span className="truncate text-xs font-medium text-foreground">{s.title}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                          <span>+{Math.max(0, s.metrics.maxPeakDb).toFixed(1)} dB Spitze</span>
                          <span aria-hidden>·</span>
                          <span>{s.metrics.spanDb.toFixed(1)} dB Spanne</span>
                          <span aria-hidden>·</span>
                          <span>σ {s.metrics.stdDb.toFixed(1)} dB</span>
                          {peakDelta !== null && Math.abs(peakDelta) >= 0.1 && (
                            <>
                              <span aria-hidden>·</span>
                              <span className={peakDelta < 0 ? 'text-[#5fd68a]' : 'text-muted-foreground'}>
                                {peakDelta > 0 ? `+${peakDelta.toFixed(1)}` : peakDelta.toFixed(1)} dB
                              </span>
                            </>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => onApplySuggestion?.(s)}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      >
                        <Check className="h-3 w-3" />
                        Übernehmen
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {s.subs.map((sub, idx) => (
                        <span key={sub.id}>
                          V{idx + 1} ({sub.x.toFixed(2)}, {sub.y.toFixed(2)} m{sub.phase === 180 ? ', 180°' : ''})
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {canRestorePrevious && onRestorePrevious && (
            <button
              type="button"
              onClick={onRestorePrevious}
              className="inline-flex items-center justify-center gap-1.5 self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <RotateCcw className="h-3 w-3" />
              Vorherige Aufstellung wiederherstellen
            </button>
          )}
        </section>
      )}

      <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
        <legend className="sr-only">Hörposition</legend>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Hörposition</span>
          <span className="text-[11px] text-muted-foreground">Klick in der Draufsicht setzt sie</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={listening.x}
            onChange={(x) => onListeningChange(clampToRoom(room, x, listening.y))}
            min={bounds.minX}
            max={bounds.maxX}
            unit="m"
          />
          <NumberField
            label="Y"
            value={listening.y}
            onChange={(y) => onListeningChange(clampToRoom(room, listening.x, y))}
            min={bounds.minY}
            max={bounds.maxY}
            unit="m"
          />
        </div>
      </fieldset>
    </div>
  )
}

export function subColor(id: string) {
  const idx = Number.parseInt(id.replace('sub-', ''), 10)
  return SUB_COLORS[(Number.isFinite(idx) ? idx : 0) % SUB_COLORS.length]
}
