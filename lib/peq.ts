import type { FrequencyResponsePoint } from './acoustics'

export interface PeqFilter {
  id: string
  enabled: boolean
  type: 'PK'
  freq: number
  gain: number
  q: number
}

export interface PeqOptions {
  maxFilters: number
  maxCutDb: number
  allowBoost: boolean
  maxBoostDb?: number
}

export interface PeqMetrics {
  stdBefore: number
  stdAfter: number
  peakBefore: number
  peakAfter: number
  spanBefore: number
  spanAfter: number
}

export interface PeqSuggestionResult {
  filters: PeqFilter[]
  corrected: FrequencyResponsePoint[]
  metrics: PeqMetrics
}

const SAMPLE_RATE = 48000

/**
 * Exact 2nd-order digital peaking EQ magnitude response (in dB) at frequency f (RBJ Audio EQ Cookbook).
 */
export function biquadPeakDb(f: number, freq: number, gainDb: number, q: number, fs = SAMPLE_RATE): number {
  if (Math.abs(gainDb) < 1e-4 || f <= 0 || freq <= 0 || q <= 0) return 0
  const clampedFreq = Math.min(freq, fs * 0.45)
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * clampedFreq) / fs
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * q)

  const b0 = 1 + alpha * A
  const b1 = -2 * cosW0
  const b2 = 1 - alpha * A
  const a0 = 1 + alpha / A
  const a1 = -2 * cosW0
  const a2 = 1 - alpha / A

  const w = (2 * Math.PI * f) / fs
  const cosW = Math.cos(w)
  const sinW = Math.sin(w)
  const cos2W = Math.cos(2 * w)
  const sin2W = Math.sin(2 * w)

  const numRe = b0 + b1 * cosW + b2 * cos2W
  const numIm = -b1 * sinW - b2 * sin2W
  const denRe = a0 + a1 * cosW + a2 * cos2W
  const denIm = -a1 * sinW - a2 * sin2W

  const mag2 = (numRe * numRe + numIm * numIm) / Math.max(1e-24, denRe * denRe + denIm * denIm)
  return 10 * Math.log10(Math.max(1e-12, mag2))
}

export function applyPeqFilters(
  response: FrequencyResponsePoint[],
  filters: PeqFilter[],
): FrequencyResponsePoint[] {
  const active = filters.filter((flt) => flt.enabled)
  if (active.length === 0) return response.map((p) => ({ ...p }))
  return response.map((pt) => {
    let delta = 0
    for (const flt of active) {
      delta += biquadPeakDb(pt.f, flt.freq, flt.gain, flt.q)
    }
    return { f: pt.f, db: pt.db + delta }
  })
}

function computeStats(pts: FrequencyResponsePoint[]): { std: number; peak: number; span: number } {
  if (pts.length === 0) return { std: 0, peak: 0, span: 0 }
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    sum += p.db
    if (p.db < min) min = p.db
    if (p.db > max) max = p.db
  }
  const mean = sum / pts.length
  let varSum = 0
  for (const p of pts) {
    const d = p.db - mean
    varSum += d * d
  }
  return {
    std: Math.sqrt(varSum / pts.length),
    peak: max,
    span: max - min,
  }
}

function estimateQFromCurve(pts: FrequencyResponsePoint[], peakIdx: number, targetLevel: number): number {
  const f0 = pts[peakIdx].f
  const peakVal = pts[peakIdx].db - targetLevel
  if (peakVal <= 0.5) return 5
  const halfLevel = targetLevel + peakVal * 0.5

  let fLow = f0 * 0.85
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (pts[i].db <= halfLevel) {
      const prev = pts[i + 1]
      const frac = Math.max(0, Math.min(1, (halfLevel - pts[i].db) / Math.max(1e-6, prev.db - pts[i].db)))
      fLow = pts[i].f + frac * (prev.f - pts[i].f)
      break
    }
    if (pts[i].db > pts[i + 1].db + 0.5) {
      fLow = pts[i].f
      break
    }
  }

  let fHigh = f0 * 1.15
  for (let i = peakIdx + 1; i < pts.length; i++) {
    if (pts[i].db <= halfLevel) {
      const prev = pts[i - 1]
      const frac = Math.max(0, Math.min(1, (halfLevel - pts[i].db) / Math.max(1e-6, prev.db - pts[i].db)))
      fHigh = pts[i].f - frac * (pts[i].f - prev.f)
      break
    }
    if (pts[i].db > pts[i - 1].db + 0.5) {
      fHigh = pts[i].f
      break
    }
  }

  const bw = Math.max(2, fHigh - fLow)
  const rawQ = f0 / bw
  return Math.min(16, Math.max(1.2, rawQ))
}

/**
 * Automatically suggests up to `maxFilters` Parametric EQ peaking filters
 * to flatten modal peaks (and optionally moderate dips) in the listening response.
 */
export function suggestPeqFilters(
  response: FrequencyResponsePoint[],
  opts: PeqOptions,
): PeqSuggestionResult {
  if (response.length < 5 || opts.maxFilters <= 0) {
    const s = computeStats(response)
    return {
      filters: [],
      corrected: response.map((p) => ({ ...p })),
      metrics: { stdBefore: s.std, stdAfter: s.std, peakBefore: s.peak, peakAfter: s.peak, spanBefore: s.span, spanAfter: s.span },
    }
  }

  const maxCut = -Math.abs(opts.maxCutDb)
  const maxBoost = opts.allowBoost ? Math.abs(opts.maxBoostDb ?? 5) : 0
  const work = response.map((p) => ({ ...p }))
  const chosen: PeqFilter[] = []

  const fMin = response[0].f
  const fMax = response[response.length - 1].f

  // Reference target level: slightly below 0 dB when cut-only so we shave peaks down smoothly
  const sorted = [...response].map((p) => p.db).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length * 0.45)]
  const targetLevel = opts.allowBoost ? 0 : Math.min(0, Math.max(-3.5, median))

  for (let iter = 0; iter < opts.maxFilters; iter++) {
    let bestIdx = -1
    let bestScore = 0
    let bestIsCut = true

    for (let i = 1; i < work.length - 1; i++) {
      const f = work[i].f
      if (f <= fMin * 1.02 || f >= fMax * 0.98) continue
      const tooClose = chosen.some((c) => Math.abs(Math.log2(c.freq / f)) < 0.09)
      if (tooClose) continue

      const err = work[i].db - targetLevel
      // Local peak check for cuts
      if (err > 1.2 && work[i].db >= work[i - 1].db && work[i].db >= work[i + 1].db) {
        if (err > bestScore) {
          bestScore = err
          bestIdx = i
          bestIsCut = true
        }
      }
      // Moderate wide dips only when boost is enabled (skip deep sharp cancellations)
      if (opts.allowBoost && err < -2.0 && err > -10.0 && work[i].db <= work[i - 1].db && work[i].db <= work[i + 1].db) {
        const boostScore = Math.abs(err) * 0.55
        if (boostScore > bestScore) {
          bestScore = boostScore
          bestIdx = i
          bestIsCut = false
        }
      }
    }

    if (bestIdx === -1) break

    let bestFreq = work[bestIdx].f
    const rawGain = -(work[bestIdx].db - targetLevel)
    let bestGain = bestIsCut
      ? Math.max(maxCut, Math.min(-0.8, rawGain))
      : Math.min(maxBoost, Math.max(0.8, rawGain * 0.7))
    let bestQ = bestIsCut
      ? estimateQFromCurve(work, bestIdx, targetLevel)
      : Math.min(6, estimateQFromCurve(work, bestIdx, targetLevel))

    // Refine (freq, gain, Q) locally against weighted MSE around the mode
    const localWindow = work
      .map((pt, idx) => ({ pt, idx }))
      .filter(({ pt }) => pt.f >= bestFreq / 1.45 && pt.f <= bestFreq * 1.45)

    const evalLoss = (f0: number, g: number, q: number) => {
      let loss = 0
      for (const { pt } of localWindow) {
        const after = pt.db + biquadPeakDb(pt.f, f0, g, q) - targetLevel
        // Penalize remaining positive peaks more strongly than dips when cut-only
        const weight = !opts.allowBoost && after > 0 ? 1.5 : 1.0
        loss += weight * after * after
      }
      return loss
    }

    let bestLoss = evalLoss(bestFreq, bestGain, bestQ)
    const freqSteps = [0.97, 0.99, 1.0, 1.01, 1.03]
    const gainSteps = [0.85, 0.95, 1.0, 1.05, 1.15]
    const qSteps = [0.75, 0.9, 1.0, 1.15, 1.35]

    for (const fs of freqSteps) {
      const fCand = Math.min(fMax * 0.98, Math.max(fMin * 1.02, bestFreq * fs))
      for (const gs of gainSteps) {
        const gCand = bestIsCut
          ? Math.max(maxCut, Math.min(-0.5, bestGain * gs))
          : Math.min(maxBoost, Math.max(0.5, bestGain * gs))
        for (const qs of qSteps) {
          const qCand = Math.min(16, Math.max(1.0, bestQ * qs))
          const l = evalLoss(fCand, gCand, qCand)
          if (l < bestLoss) {
            bestLoss = l
            bestFreq = fCand
            bestGain = gCand
            bestQ = qCand
          }
        }
      }
    }

    const filter: PeqFilter = {
      id: `peq-${iter + 1}`,
      enabled: true,
      type: 'PK',
      freq: Number(bestFreq.toFixed(1)),
      gain: Number(bestGain.toFixed(1)),
      q: Number(bestQ.toFixed(2)),
    }
    chosen.push(filter)

    for (let i = 0; i < work.length; i++) {
      work[i].db += biquadPeakDb(work[i].f, filter.freq, filter.gain, filter.q)
    }
  }

  chosen.sort((a, b) => a.freq - b.freq)
  chosen.forEach((f, i) => {
    f.id = `peq-${i + 1}`
  })

  const corrected = applyPeqFilters(response, chosen)
  const beforeStats = computeStats(response)
  const afterStats = computeStats(corrected)

  return {
    filters: chosen,
    corrected,
    metrics: {
      stdBefore: beforeStats.std,
      stdAfter: afterStats.std,
      peakBefore: beforeStats.peak,
      peakAfter: afterStats.peak,
      spanBefore: beforeStats.span,
      spanAfter: afterStats.span,
    },
  }
}

export function formatEqualizerApo(filters: PeqFilter[]): string {
  const lines = [
    '# Raummoden-Analyse – Parametric EQ Export (Equalizer APO / REW Generic)',
    'Preamp: 0.0 dB',
  ]
  filters.forEach((f, i) => {
    lines.push(
      `Filter ${i + 1}: ${f.enabled ? 'ON' : 'OFF'} PK Fc ${f.freq.toFixed(1)} Hz Gain ${f.gain.toFixed(1)} dB Q ${f.q.toFixed(2)}`,
    )
  })
  return lines.join('\n')
}
