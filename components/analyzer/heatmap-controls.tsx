'use client'

import { Pause, Play, Repeat, RotateCcw } from 'lucide-react'
import type { HeatmapGrid, HeatmapMode, RoomMode } from '@/lib/acoustics'
import { bipolarColor, heatColor, MODE_TYPE_LABEL } from '@/lib/acoustics'
import type { WaveSignalType } from '@/lib/wave2d'
import { cn } from '@/lib/utils'
import { RangeField, Segmented } from './controls'

interface HeatmapControlsProps {
  mode: HeatmapMode
  onModeChange: (m: HeatmapMode) => void
  frequency: number
  onFrequencyChange: (f: number) => void
  fMin: number
  fMax: number
  rangeDb: number
  onRangeDbChange: (v: number) => void
  selectedMode: RoomMode | null
  grid: HeatmapGrid | null
  earHeight: number
  soundSpeed?: number
  sweepActive: boolean
  onToggleSweep: () => void
  onResetSweep: () => void
  sweepSpeed: number
  onSweepSpeedChange: (speed: number) => void
  sweepLoop: boolean
  onSweepLoopChange: (loop: boolean) => void
  wavePlaying?: boolean
  onToggleWave?: () => void
  onResetWave?: () => void
  waveTimeMs?: number
  waveSpeed?: number
  onWaveSpeedChange?: (speed: number) => void
  waveSignal?: WaveSignalType
  onWaveSignalChange?: (signal: WaveSignalType) => void
  volumeTransparency?: number
  onVolumeTransparencyChange?: (v: number) => void
  showVolumeTransparency?: boolean
}

export function HeatmapControls({
  mode,
  onModeChange,
  frequency,
  onFrequencyChange,
  fMin,
  fMax,
  rangeDb,
  onRangeDbChange,
  selectedMode,
  grid,
  earHeight,
  soundSpeed = 343,
  sweepActive,
  onToggleSweep,
  onResetSweep,
  sweepSpeed,
  onSweepSpeedChange,
  sweepLoop,
  onSweepLoopChange,
  wavePlaying = false,
  onToggleWave,
  onResetWave,
  waveTimeMs = 0,
  waveSpeed = 0.5,
  onWaveSpeedChange,
  waveSignal = 'sine',
  onWaveSignalChange,
  volumeTransparency = 0.25,
  onVolumeTransparencyChange,
  showVolumeTransparency = false,
}: HeatmapControlsProps) {
  const wavePathMeters = (waveTimeMs / 1000) * soundSpeed

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel="Heatmap-Modus"
          size="sm"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'frequency', label: 'Einzelfrequenz' },
            { value: 'band', label: 'Bandmittel' },
            { value: 'single', label: 'Einzelmode' },
            { value: 'wave', label: 'Wellenfront' },
          ]}
        />
        <span className="font-mono text-[11px] text-muted-foreground">Schnittebene z = {earHeight.toFixed(2)} m</span>
      </div>

      {mode === 'wave' ? (
        <>
          {/* Wavefront time-domain player bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleWave}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                  wavePlaying
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-foreground hover:border-primary/50 hover:text-primary',
                )}
              >
                {wavePlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {wavePlaying ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                onClick={onResetWave}
                title="Wellenausbreitung auf t = 0 ms zurücksetzen"
                aria-label="Wellenausbreitung auf t = 0 ms zurücksetzen"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <span className="tabular ml-1 font-mono text-[11px] text-foreground">
                t = {waveTimeMs.toFixed(1)} ms
              </span>
              <span className="tabular hidden font-mono text-[10px] text-muted-foreground sm:inline">
                · {wavePathMeters.toFixed(1)} m Laufweg
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {onWaveSignalChange && (
                <div className="flex rounded border border-border bg-background p-0.5 text-[10px]" role="group" aria-label="Anregungssignal">
                  {(
                    [
                      { value: 'sine', label: 'Sinus' },
                      { value: 'pulse', label: 'Impuls' },
                    ] as const
                  ).map((sig) => (
                    <button
                      key={sig.value}
                      type="button"
                      onClick={() => onWaveSignalChange(sig.value)}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-medium transition-colors',
                        waveSignal === sig.value
                          ? 'bg-primary/20 text-primary'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {sig.label}
                    </button>
                  ))}
                </div>
              )}
              {onWaveSpeedChange && (
                <div className="flex rounded border border-border bg-background p-0.5 text-[10px]" role="group" aria-label="Animationsgeschwindigkeit">
                  {[0.25, 0.5, 1].map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => onWaveSpeedChange(sp)}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono transition-colors',
                        waveSpeed === sp ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {sp}×
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <RangeField
            label={waveSignal === 'pulse' ? 'Impuls-Mittenfrequenz' : 'Anregungsfrequenz'}
            value={frequency}
            onChange={onFrequencyChange}
            min={fMin}
            max={fMax}
            step={0.5}
            unit="Hz"
            decimals={1}
          />

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {waveSignal === 'pulse'
              ? 'Einzelner Schallimpuls von jedem aktiven Subwoofer: zeigt die sphärische Wellenfront und deren Reflexion an Wänden und Möbeln in Zeitlupe.'
              : `Kontinuierliche Anregung bei ${frequency.toFixed(1)} Hz: beobachtet die Überlagerung hin- und rücklaufender Wellenfronten bis zur Ausbildung stehender Raummoden.`}
          </p>
        </>
      ) : (
        <>
          {/* Frequency sweep player bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleSweep}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                  sweepActive
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-foreground hover:border-primary/50 hover:text-primary',
                )}
              >
                {sweepActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {sweepActive ? 'Pause' : 'Sweep'}
              </button>
              <button
                type="button"
                onClick={onResetSweep}
                title={`Auf ${fMin} Hz zurücksetzen`}
                aria-label={`Sweep auf ${fMin} Hz zurücksetzen`}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <span className="tabular ml-1 font-mono text-[11px] text-foreground">
                {mode === 'frequency' ? `${frequency.toFixed(1)} Hz` : `${fMin}–${fMax} Hz`}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex rounded border border-border bg-background p-0.5 text-[10px]" role="group" aria-label="Sweep-Geschwindigkeit">
                {[0.5, 1, 2].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => onSweepSpeedChange(sp)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono transition-colors',
                      sweepSpeed === sp ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {sp}×
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={sweepLoop}
                onClick={() => onSweepLoopChange(!sweepLoop)}
                title="Sweep endlos wiederholen"
                aria-label="Sweep endlos wiederholen"
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-colors',
                  sweepLoop
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <Repeat className="h-3 w-3" />
                Loop
              </button>
            </div>
          </div>

          {mode === 'frequency' && (
            <RangeField
              label="Analysefrequenz"
              value={frequency}
              onChange={onFrequencyChange}
              min={fMin}
              max={fMax}
              step={0.5}
              unit="Hz"
              decimals={1}
            />
          )}
          {mode === 'band' && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Energetisches Mittel des Schalldrucks über {fMin}–{fMax} Hz. Zeigt, wo Subwoofer die Hörebene im gesamten
              Bassbereich am gleichmäßigsten anregen.
            </p>
          )}
          {mode === 'single' && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {selectedMode ? (
                <>
                  Mode <span className="font-mono text-foreground">({selectedMode.nx},{selectedMode.ny},{selectedMode.nz})</span>{' '}
                  {MODE_TYPE_LABEL[selectedMode.type].toLowerCase()} bei{' '}
                  <span className="font-mono text-foreground">{selectedMode.f.toFixed(1)} Hz</span> – gewichtet mit der
                  Anregung durch die Subwoofer-Positionen.
                </>
              ) : (
                'Wähle eine Mode in der Tabelle aus, um ihre Druckverteilung zu zeigen.'
              )}
            </p>
          )}

          {mode !== 'single' && (
            <RangeField
              label="Dynamikbereich der Farbskala"
              value={rangeDb}
              onChange={onRangeDbChange}
              min={6}
              max={60}
              step={1}
              unit="dB"
            />
          )}
          {showVolumeTransparency && onVolumeTransparencyChange && (
            <RangeField
              label="Transparenz 3D-Isoflächen"
              value={Math.round(volumeTransparency * 100)}
              onChange={(pct) => onVolumeTransparencyChange(Math.min(1, Math.max(0, pct / 100)))}
              min={0}
              max={100}
              step={1}
              unit="%"
            />
          )}
        </>
      )}

      <HeatLegend grid={grid} rangeDb={rangeDb} mode={mode} />
    </div>
  )
}

export function HeatLegend({
  grid,
  rangeDb,
  mode,
}: {
  grid: HeatmapGrid | null
  rangeDb: number
  mode?: HeatmapMode
}) {
  const isBipolar = Boolean(grid?.bipolar || mode === 'wave' || mode === 'single')
  const stops = Array.from({ length: 17 }, (_, i) => {
    const [r, g, b] = isBipolar ? bipolarColor(i / 16) : heatColor(i / 16)
    return `rgb(${r},${g},${b})`
  })
  const top = grid ? grid.max : 0
  const bottom = grid ? Math.max(grid.min, grid.max - rangeDb) : -rangeDb
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2.5 w-full rounded-sm"
        style={{ background: `linear-gradient(to right, ${stops.join(',')})` }}
        role="img"
        aria-label={
          isBipolar
            ? 'Farbskala: blau negative Phase, weiß Druckknoten, rot positive Phase'
            : 'Farbskala: dunkelblau Druckminimum über cyan, grün und gelb bis rot Druckmaximum'
        }
      />
      {isBipolar ? (
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>−1,0 · −Phase</span>
          <span>{mode === 'wave' ? '0 · Nulldurchgang' : '0 · Druckknoten'}</span>
          <span>+1,0 · +Phase</span>
        </div>
      ) : (
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{(bottom - top).toFixed(0)} dB · Minimum</span>
          <span>{((bottom - top) / 2).toFixed(0)} dB</span>
          <span>0 dB · Maximum</span>
        </div>
      )}
    </div>
  )
}
