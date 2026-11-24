'use client'

import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FrequencyResponsePoint, RoomMode, SweetSpotEnvelopePoint } from '@/lib/acoustics'
import { MODE_TYPE_LABEL } from '@/lib/acoustics'

interface FrequencyResponseChartProps {
  listeningData: FrequencyResponsePoint[]
  baselineData?: FrequencyResponsePoint[] | null
  probeData: FrequencyResponsePoint[] | null
  peqData?: FrequencyResponsePoint[] | null
  previewData?: FrequencyResponsePoint[] | null
  previewLabel?: string
  sweetSpotEnvelope?: SweetSpotEnvelopePoint[] | null
  modes: RoomMode[]
  fMin: number
  fMax: number
  highlightFrequency?: number | null
  markerTypes: Set<RoomMode['type']>
}

const MODE_COLORS: Record<RoomMode['type'], string> = {
  axial: 'rgba(245,185,66,0.75)',
  tangential: 'rgba(79,179,232,0.5)',
  oblique: 'rgba(160,160,170,0.35)',
}

/** Ordinal position of marker i among the axial markers, used to stagger label rows. */
function axialIndex(markers: RoomMode[], i: number) {
  let n = 0
  for (let k = 0; k < i; k++) if (markers[k].type === 'axial') n++
  return n
}

function buildTicks(fMin: number, fMax: number) {
  const candidates = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 125, 150, 200, 250, 300]
  return candidates.filter((t) => t >= fMin && t <= fMax)
}

export function FrequencyResponseChart({
  listeningData,
  baselineData,
  probeData,
  peqData,
  previewData,
  previewLabel = 'Vorschlag',
  sweetSpotEnvelope,
  modes,
  fMin,
  fMax,
  highlightFrequency,
  markerTypes,
}: FrequencyResponseChartProps) {
  const data = useMemo(() => {
    return listeningData.map((p, i) => {
      const env = sweetSpotEnvelope?.[i]
      return {
        f: p.f,
        lp: Number(p.db.toFixed(2)),
        baseline: baselineData ? Number(baselineData[i]?.db.toFixed(2)) : undefined,
        probe: probeData ? Number(probeData[i]?.db.toFixed(2)) : undefined,
        peq: peqData ? Number(peqData[i]?.db.toFixed(2)) : undefined,
        preview: previewData ? Number(previewData[i]?.db.toFixed(2)) : undefined,
        zoneRange: env ? ([Number(env.minDb.toFixed(2)), Number(env.maxDb.toFixed(2))] as [number, number]) : undefined,
      }
    })
  }, [listeningData, baselineData, probeData, peqData, previewData, sweetSpotEnvelope])

  const yDomain = useMemo(() => {
    const vals = data
      .flatMap((d) => [
        d.lp,
        d.baseline ?? d.lp,
        d.probe ?? d.lp,
        d.peq ?? d.lp,
        d.preview ?? d.lp,
        d.zoneRange?.[0] ?? d.lp,
        d.zoneRange?.[1] ?? d.lp,
      ])
      .filter((v) => Number.isFinite(v))
    const lo = Math.floor((Math.min(...vals, -6) - 2) / 6) * 6
    const hi = Math.ceil((Math.max(...vals, 6) + 2) / 6) * 6
    return [Math.max(lo, -48), Math.min(hi, 36)]
  }, [data])

  const markers = modes.filter((m) => markerTypes.has(m.type))

  return (
    <div className="min-h-0 w-full flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" />
          <XAxis
            dataKey="f"
            type="number"
            scale="log"
            domain={[fMin, fMax]}
            ticks={buildTicks(fMin, fMax)}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            stroke="var(--border)"
            tickFormatter={(v) => `${v}`}
            label={{ value: 'Hz', position: 'insideBottomRight', fill: 'var(--muted-foreground)', fontSize: 11, dy: -4 }}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            stroke="var(--border)"
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
            width={44}
            label={{ value: 'dB rel.', angle: -90, position: 'insideLeft', fill: 'var(--muted-foreground)', fontSize: 11, dx: 14 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--muted-foreground)' }}
            labelFormatter={(v) => `${Number(v).toFixed(1)} Hz`}
            formatter={(value, name) => {
              if (name === 'zoneRange' && Array.isArray(value) && value.length === 2) {
                const lo = Number(value[0])
                const hi = Number(value[1])
                return [`${lo > 0 ? '+' : ''}${lo.toFixed(1)} bis ${hi > 0 ? '+' : ''}${hi.toFixed(1)} dB`, 'Hörzone']
              }
              return [
                `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)} dB`,
                name === 'lp'
                  ? 'Hörplatz'
                  : name === 'baseline'
                    ? 'Ohne Möbeldämpfung'
                    : name === 'peq'
                      ? 'Mit PEQ'
                      : name === 'preview'
                        ? previewLabel
                        : 'Mauszeiger',
              ]
            }}
          />
          {markers.map((m, i) => (
            <ReferenceLine
              key={m.id}
              x={m.f}
              stroke={MODE_COLORS[m.type]}
              strokeWidth={m.type === 'axial' ? 1.25 : 1}
              strokeDasharray={m.type === 'axial' ? undefined : '3 3'}
              label={
                m.type === 'axial'
                  ? {
                      value: `${m.nx}${m.ny}${m.nz}`,
                      position: 'insideTop',
                      dy: (axialIndex(markers, i) % 3) * 10,
                      fill: MODE_COLORS.axial,
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)',
                    }
                  : undefined
              }
            />
          ))}
          {highlightFrequency && (
            <ReferenceLine x={highlightFrequency} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="6 3" />
          )}
          <ReferenceLine y={0} stroke="var(--border)" />
          {sweetSpotEnvelope && (
            <Area
              type="monotone"
              dataKey="zoneRange"
              name="zoneRange"
              stroke="rgba(79,179,232,0.35)"
              strokeWidth={1}
              fill="rgba(79,179,232,0.14)"
              isAnimationActive={false}
            />
          )}
          {baselineData && (
            <Line
              type="monotone"
              dataKey="baseline"
              name="baseline"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.75}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="lp"
            name="lp"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {peqData && (
            <Line
              type="monotone"
              dataKey="peq"
              name="peq"
              stroke="var(--chart-3)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {previewData && (
            <Line
              type="monotone"
              dataKey="preview"
              name="preview"
              stroke="#5fd68a"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {probeData && (
            <Line
              type="monotone"
              dataKey="probe"
              name="probe"
              stroke="var(--foreground)"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ModeMarkerLegend({
  showBaseline = false,
  showPeq = false,
  showZone = false,
  showPreview = false,
}: {
  showBaseline?: boolean
  showPeq?: boolean
  showZone?: boolean
  showPreview?: boolean
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {(Object.keys(MODE_COLORS) as RoomMode['type'][]).map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5" style={{ backgroundColor: MODE_COLORS[t] }} aria-hidden />
          {MODE_TYPE_LABEL[t]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-chart-2" aria-hidden />
        Hörplatz
      </li>
      {showBaseline && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" aria-hidden />
          Ohne Möbeldämpfung
        </li>
      )}
      {showZone && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-[2px] border border-sky-400/50 bg-sky-400/20" aria-hidden />
          Hörzone (Min–Max)
        </li>
      )}
      {showPeq && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-chart-3" aria-hidden />
          Mit PEQ
        </li>
      )}
      {showPreview && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#5fd68a]" aria-hidden />
          Vorschlag-Vorschau
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 border-t border-dashed border-foreground" aria-hidden />
        Mauszeiger
      </li>
    </ul>
  )
}
