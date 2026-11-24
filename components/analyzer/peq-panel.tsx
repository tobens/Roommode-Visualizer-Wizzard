'use client'

import { useState } from 'react'
import { Check, Copy, Download, Eye } from 'lucide-react'
import { formatEqualizerApo, type PeqFilter, type PeqMetrics, type PeqOptions } from '@/lib/peq'
import { cn } from '@/lib/utils'
import { Segmented } from './controls'

interface PeqPanelProps {
  filters: PeqFilter[]
  metrics: PeqMetrics
  options: PeqOptions
  onOptionsChange: (next: PeqOptions) => void
  onToggleFilter: (id: string) => void
  onInspectFrequency: (freq: number) => void
  showOverlay: boolean
  onToggleOverlay: () => void
}

export function PeqPanel({
  filters,
  metrics,
  options,
  onOptionsChange,
  onToggleFilter,
  onInspectFrequency,
  showOverlay,
  onToggleOverlay,
}: PeqPanelProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyApo = async () => {
    const text = formatEqualizerApo(filters)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked in some embedded contexts
    }
  }

  const handleDownloadApo = () => {
    const text = formatEqualizerApo(filters)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `raummoden-peq-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Filter</span>
            <Segmented
              ariaLabel="Maximale Filteranzahl"
              size="sm"
              value={String(options.maxFilters)}
              onChange={(v) => onOptionsChange({ ...options, maxFilters: Number(v) })}
              options={[
                { value: '3', label: '3' },
                { value: '5', label: '5' },
                { value: '8', label: '8' },
              ]}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Max Cut</span>
            <Segmented
              ariaLabel="Maximale Absenkung"
              size="sm"
              value={String(options.maxCutDb)}
              onChange={(v) => onOptionsChange({ ...options, maxCutDb: Number(v) })}
              options={[
                { value: '9', label: '-9 dB' },
                { value: '12', label: '-12 dB' },
                { value: '18', label: '-18 dB' },
              ]}
            />
          </div>
          <Segmented
            ariaLabel="PEQ-Modus"
            size="sm"
            value={options.allowBoost ? 'both' : 'cut'}
            onChange={(v) => onOptionsChange({ ...options, allowBoost: v === 'both' })}
            options={[
              { value: 'cut', label: 'Nur Cut' },
              { value: 'both', label: 'Cut + Boost' },
            ]}
          />
        </div>

        <button
          type="button"
          aria-pressed={showOverlay}
          onClick={onToggleOverlay}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
            showOverlay ? 'border-chart-3/50 bg-chart-3/15 text-chart-3' : 'border-border text-muted-foreground',
          )}
        >
          <Eye className="h-3 w-3" />
          Im Diagramm
        </button>
      </div>

      {/* Before / After metrics */}
      <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Streuung (σ)</div>
          <div className="tabular font-mono text-foreground">
            {metrics.stdBefore.toFixed(1)} → <span className="text-chart-3">{metrics.stdAfter.toFixed(1)} dB</span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Max. Überhöhung</div>
          <div className="tabular font-mono text-foreground">
            +{metrics.peakBefore.toFixed(1)} →{' '}
            <span className="text-chart-3">
              {metrics.peakAfter >= 0 ? '+' : ''}
              {metrics.peakAfter.toFixed(1)} dB
            </span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Spanne (Peak–Dip)</div>
          <div className="tabular font-mono text-foreground">
            {metrics.spanBefore.toFixed(1)} → <span className="text-chart-3">{metrics.spanAfter.toFixed(1)} dB</span>
          </div>
        </div>
      </div>

      {/* Filter list */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface/40">
        {filters.length > 0 ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-2.5 py-1.5 font-medium">Aktiv</th>
                <th className="px-2 py-1.5 font-medium">Typ</th>
                <th className="px-2 py-1.5 font-medium">Frequenz</th>
                <th className="px-2 py-1.5 font-medium text-right">Gain</th>
                <th className="px-2.5 py-1.5 font-medium text-right">Q</th>
              </tr>
            </thead>
            <tbody>
              {filters.map((flt, idx) => (
                <tr
                  key={flt.id}
                  className={cn(
                    'border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/30',
                    !flt.enabled && 'opacity-45',
                  )}
                >
                  <td className="px-2.5 py-1.5">
                    <button
                      type="button"
                      aria-pressed={flt.enabled}
                      onClick={() => onToggleFilter(flt.id)}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors',
                        flt.enabled
                          ? 'border-chart-3/40 bg-chart-3/15 text-chart-3'
                          : 'border-border bg-background text-muted-foreground',
                      )}
                    >
                      #{idx + 1}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{flt.type}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onInspectFrequency(flt.freq)}
                      title={`Heatmap auf ${flt.freq.toFixed(1)} Hz setzen`}
                      className="tabular font-mono text-xs text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary"
                    >
                      {flt.freq.toFixed(1)} Hz
                    </button>
                  </td>
                  <td
                    className={cn(
                      'tabular px-2 py-1.5 text-right font-mono text-xs font-medium',
                      flt.gain < 0 ? 'text-primary' : 'text-accent',
                    )}
                  >
                    {flt.gain > 0 ? '+' : ''}
                    {flt.gain.toFixed(1)} dB
                  </td>
                  <td className="tabular px-2.5 py-1.5 text-right font-mono text-xs text-muted-foreground">
                    {flt.q.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Keine ausgeprägten Moden-Überhöhungen über dem Zielpegel gefunden.
          </div>
        )}
      </div>

      {/* Export row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Klick auf Frequenz zeigt die Mode auf der Heatmap</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={filters.length === 0}
            onClick={handleCopyApo}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Kopiert' : 'Filter kopieren'}
          </button>
          <button
            type="button"
            disabled={filters.length === 0}
            onClick={handleDownloadApo}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            Equalizer APO (.txt)
          </button>
        </div>
      </div>
    </div>
  )
}
