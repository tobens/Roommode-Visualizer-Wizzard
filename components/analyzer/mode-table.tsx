'use client'

import { useMemo, useState } from 'react'
import type { ModeType, RoomMode, RoomShape } from '@/lib/acoustics'
import { MODE_TYPE_LABEL } from '@/lib/acoustics'
import { cn } from '@/lib/utils'

interface ModeTableProps {
  modes: RoomMode[]
  roomShape: RoomShape
  baseEta?: number
  selectedModeId: string | null
  onSelectMode: (mode: RoomMode | null) => void
  typeFilter: Set<ModeType>
  onTypeFilterChange: (s: Set<ModeType>) => void
}

const TYPE_BADGE: Record<ModeType, string> = {
  axial: 'bg-primary/15 text-primary',
  tangential: 'bg-accent/15 text-accent',
  oblique: 'bg-muted text-muted-foreground',
}

export function ModeTable({ modes, roomShape, baseEta, selectedModeId, onSelectMode, typeFilter, onTypeFilterChange }: ModeTableProps) {
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const isFem = roomShape !== 'rect' || modes.some((m) => m.segment === 'FEM')
  const hasDampedModes = useMemo(
    () => Boolean(baseEta && modes.some((m) => typeof m.eta === 'number' && m.eta > baseEta + 1e-4)),
    [modes, baseEta],
  )

  const filtered = useMemo(() => {
    const lo = Number.parseFloat(fFrom)
    const hi = Number.parseFloat(fTo)
    return modes.filter(
      (m) =>
        typeFilter.has(m.type) &&
        (!Number.isFinite(lo) || m.f >= lo) &&
        (!Number.isFinite(hi) || m.f <= hi),
    )
  }, [modes, typeFilter, fFrom, fTo])

  const counts = useMemo(() => {
    const c: Record<ModeType, number> = { axial: 0, tangential: 0, oblique: 0 }
    for (const m of modes) c[m.type]++
    return c
  }, [modes])

  const toggleType = (t: ModeType) => {
    const next = new Set(typeFilter)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    onTypeFilterChange(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nach Modentyp filtern">
          {(['axial', 'tangential', 'oblique'] as ModeType[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={typeFilter.has(t)}
              onClick={() => toggleType(t)}
              className={cn(
                'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                typeFilter.has(t) ? `border-transparent ${TYPE_BADGE[t]}` : 'border-border text-muted-foreground/60',
              )}
            >
              {MODE_TYPE_LABEL[t]} <span className="font-mono">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <input
            aria-label="Frequenz von"
            inputMode="decimal"
            placeholder="von"
            value={fFrom}
            onChange={(e) => setFFrom(e.target.value)}
            className="w-14 rounded border border-input bg-surface px-1.5 py-0.5 text-foreground outline-none focus:border-ring"
          />
          –
          <input
            aria-label="Frequenz bis"
            inputMode="decimal"
            placeholder="bis"
            value={fTo}
            onChange={(e) => setFTo(e.target.value)}
            className="w-14 rounded border border-input bg-surface px-1.5 py-0.5 text-foreground outline-none focus:border-ring"
          />
          Hz
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">f [Hz]</th>
              <th className="px-3 py-2 font-medium">Typ</th>
              <th className="px-3 py-2 font-medium">
                {isFem ? (
                  <>
                    2D-Mode · n<sub>z</sub>
                  </>
                ) : (
                  <>
                    n<sub>x</sub> n<sub>y</sub> n<sub>z</sub>
                  </>
                )}
              </th>
              <th className="px-3 py-2 text-right font-medium">Δf zur nächsten</th>
              {hasDampedModes && (
                <th className="px-3 py-2 text-right font-medium" title="Effektive Modengüte inkl. Möbeldämpfung">
                  Q
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={hasDampedModes ? 5 : 4} className="px-3 py-6 text-center text-muted-foreground">
                  Keine Moden im gewählten Filter.
                </td>
              </tr>
            )}
            {filtered.map((m, i) => {
              const next = filtered[i + 1]
              const gap = next ? next.f - m.f : null
              const selected = m.id === selectedModeId
              return (
                <tr
                  key={m.id}
                  onClick={() => onSelectMode(selected ? null : m)}
                  className={cn(
                    'cursor-pointer border-t border-border/60 transition-colors hover:bg-muted/50',
                    selected && 'bg-primary/10 hover:bg-primary/15',
                  )}
                  aria-selected={selected}
                >
                  <td className="tabular px-3 py-1.5 font-mono">{m.f.toFixed(1)}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TYPE_BADGE[m.type])}>
                      {MODE_TYPE_LABEL[m.type]}
                    </span>
                  </td>
                  <td className="tabular px-3 py-1.5 font-mono text-muted-foreground">
                    {m.segment === 'FEM' ? `M${m.femIndex ?? 0} · z${m.nz}` : `${m.nx} ${m.ny} ${m.nz}`}
                  </td>
                  <td
                    className={cn(
                      'tabular px-3 py-1.5 text-right font-mono',
                      gap !== null && gap < 3 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {gap !== null ? `${gap.toFixed(1)}` : '–'}
                  </td>
                  {hasDampedModes && (
                    <td
                      className={cn(
                        'tabular px-3 py-1.5 text-right font-mono',
                        baseEta && m.eta && m.eta > baseEta * 1.15 ? 'text-primary' : 'text-muted-foreground',
                      )}
                      title={
                        baseEta && m.eta && m.eta > baseEta + 1e-4
                          ? `Basis Q ${(1 / baseEta).toFixed(1)} → Q ${(1 / m.eta).toFixed(1)}`
                          : undefined
                      }
                    >
                      {m.eta && m.eta > 0 ? (1 / m.eta).toFixed(1) : '–'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Zeile anklicken, um die Druckverteilung dieser einzelnen Mode auf der Schnittebene anzuzeigen.
        {isFem
          ? ' L-Form und Raumplan werden mit 2D-FEM (Helmholtz-Solver) exakt berechnet.'
          : ' Rot markierte Abstände < 3 Hz kennzeichnen Modenhäufungen (Überhöhungsgefahr).'}
      </p>
    </div>
  )
}
