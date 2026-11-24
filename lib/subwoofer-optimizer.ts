import {
  frequencyResponse,
  getBounds,
  getRoomPolygon,
  isInsideRoom,
  prepareField,
  pressureAt,
  type AnalysisSettings,
  type FemSolution,
  type FrequencyResponsePoint,
  type ListeningPoint,
  type Point2D,
  type RoomConfig,
  type RoomMode,
  type RoomObstacle,
  type Subwoofer,
} from './acoustics'
import { ensureCCW } from './fem2d'
import { isPointInObstacle2D } from './furniture'

export interface PlacementCandidate {
  id: number
  x: number
  y: number
  z: number
  kind: 'corner' | 'wall'
  label: string
}

export interface PlacementMetrics {
  maxPeakDb: number
  minDipDb: number
  spanDb: number
  stdDb: number
  score: number
}

export interface PlacementSuggestion {
  id: string
  rank: number
  title: string
  subs: Subwoofer[]
  metrics: PlacementMetrics
  response: FrequencyResponsePoint[]
}

export interface OptimizePlacementInput {
  room: RoomConfig
  listening: ListeningPoint
  modes: RoomMode[]
  settings: AnalysisSettings
  fem: FemSolution | null
  obstacles: readonly RoomObstacle[]
  targetCount: 1 | 2 | 3 | 4
  subHeight?: number
}

interface CandidateTransfer {
  cand: PlacementCandidate
  re: Float64Array
  im: Float64Array
  meanEnergy: number
}

function describePosition(x: number, y: number, bounds: ReturnType<typeof getBounds>, kind: 'corner' | 'wall'): string {
  const rx = (x - bounds.minX) / Math.max(0.1, bounds.width)
  const ry = (y - bounds.minY) / Math.max(0.1, bounds.depth)
  const hPos = rx < 0.28 ? 'links' : rx > 0.72 ? 'rechts' : 'Mitte'
  const vPos = ry < 0.28 ? 'vorn' : ry > 0.72 ? 'hinten' : 'Mitte'
  if (kind === 'corner') {
    if (vPos !== 'Mitte' && hPos !== 'Mitte') return `Ecke ${vPos}-${hPos}`
    return 'Raumecke'
  }
  if (vPos === 'vorn') return `Frontwand (${hPos})`
  if (vPos === 'hinten') return `Rückwand (${hPos})`
  if (hPos === 'links') return `Seitenwand links (${vPos})`
  if (hPos === 'rechts') return `Seitenwand rechts (${vPos})`
  return 'Wandnah'
}

export function generateWallCandidates(
  room: RoomConfig,
  listening: ListeningPoint,
  obstacles: readonly RoomObstacle[],
  subZ = 0,
): PlacementCandidate[] {
  const poly = ensureCCW(getRoomPolygon(room))
  if (poly.length < 3) return []
  const bounds = getBounds(room)
  const minDim = Math.min(bounds.width, bounds.depth)
  const wallOffset = Math.min(0.28, Math.max(0.12, minDim * 0.1))
  const cornerOffset = Math.min(0.32, Math.max(0.14, minDim * 0.12))
  const minListenerDist = Math.min(0.55, minDim * 0.22)
  const minSpacing = 0.42

  const activeFloorObstacles = obstacles.filter(
    (o) => o.enabled && o.z <= subZ + 0.35 && o.z + o.height >= 0,
  )

  const raw: { x: number; y: number; kind: 'corner' | 'wall' }[] = []

  // 1. Corner candidates along inward bisectors
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    const e1x = curr.x - prev.x
    const e1y = curr.y - prev.y
    const l1 = Math.hypot(e1x, e1y)
    const e2x = next.x - curr.x
    const e2y = next.y - curr.y
    const l2 = Math.hypot(e2x, e2y)
    if (l1 < 0.05 || l2 < 0.05) continue
    // CCW polygon: inward normal of edge (dx, dy) is (-dy, dx)
    const n1x = -e1y / l1
    const n1y = e1x / l1
    const n2x = -e2y / l2
    const n2y = e2x / l2
    let bx = n1x + n2x
    let by = n1y + n2y
    const bl = Math.hypot(bx, by)
    if (bl > 1e-4) {
      bx /= bl
      by /= bl
      raw.push({
        x: curr.x + bx * cornerOffset * Math.SQRT2,
        y: curr.y + by * cornerOffset * Math.SQRT2,
        kind: 'corner',
      })
    }
  }

  // 2. Wall-adjacent candidates along every edge (including 1/4, 1/2, 3/4 acoustic positions)
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    const nx = -dy / len
    const ny = dx / len

    const fractions = len >= 3.2 ? [0.18, 0.25, 0.38, 0.5, 0.62, 0.75, 0.82] : len >= 1.8 ? [0.25, 0.5, 0.75] : [0.5]
    for (const t of fractions) {
      raw.push({
        x: a.x + dx * t + nx * wallOffset,
        y: a.y + dy * t + ny * wallOffset,
        kind: 'wall',
      })
    }
  }

  const accepted: PlacementCandidate[] = []
  for (const pt of raw) {
    const x = Number(pt.x.toFixed(2))
    const y = Number(pt.y.toFixed(2))
    if (!isInsideRoom(room, x, y)) continue
    if (Math.hypot(x - listening.x, y - listening.y) < minListenerDist) continue
    if (activeFloorObstacles.some((o) => isPointInObstacle2D(o, x, y))) continue
    // Keep corners over wall points if they are very close
    const tooClose = accepted.some((c) => Math.hypot(c.x - x, c.y - y) < minSpacing)
    if (tooClose) continue
    accepted.push({
      id: accepted.length,
      x,
      y,
      z: Number(subZ.toFixed(2)),
      kind: pt.kind,
      label: describePosition(x, y, bounds, pt.kind),
    })
  }

  return accepted
}

export function evaluateResponseMetrics(points: readonly FrequencyResponsePoint[]): PlacementMetrics {
  const finite = points.filter((p) => Number.isFinite(p.db))
  if (finite.length === 0) {
    return { maxPeakDb: 0, minDipDb: 0, spanDb: 0, stdDb: 0, score: 0 }
  }
  let mean = 0
  for (const p of finite) mean += p.db
  mean /= finite.length

  let maxPeakDb = -Infinity
  let minDipDb = Infinity
  let varSum = 0
  for (const p of finite) {
    const d = p.db - mean
    if (d > maxPeakDb) maxPeakDb = d
    if (d < minDipDb) minDipDb = d
    varSum += d * d
  }
  const stdDb = Math.sqrt(varSum / finite.length)
  const spanDb = maxPeakDb - minDipDb
  const score = 1.6 * Math.max(0, maxPeakDb) + 0.9 * stdDb + 0.35 * spanDb
  return { maxPeakDb, minDipDb, spanDb, stdDb, score }
}

function evaluateCombinedVectors(
  transfers: readonly CandidateTransfer[],
  indices: readonly number[],
  phases: readonly (0 | 180)[],
  nFreq: number,
  singleMeanEnergy: number,
  scratchDb: Float64Array,
): PlacementMetrics | null {
  let rawEnergySum = 0
  let sumDb = 0
  let validCount = 0

  for (let k = 0; k < nFreq; k++) {
    let re = 0
    let im = 0
    for (let m = 0; m < indices.length; m++) {
      const tr = transfers[indices[m]]
      const s = phases[m] === 180 ? -1 : 1
      re += s * tr.re[k]
      im += s * tr.im[k]
    }
    const mag2 = re * re + im * im
    rawEnergySum += mag2
    if (mag2 > 1e-18) {
      const db = 10 * Math.log10(mag2)
      scratchDb[k] = db
      sumDb += db
      validCount++
    } else {
      scratchDb[k] = -60
      sumDb += -60
      validCount++
    }
  }

  if (validCount === 0) return null
  // Reject degenerate solutions where opposing phases cancel almost all bass output
  const meanEnergy = rawEnergySum / nFreq
  if (singleMeanEnergy > 0 && meanEnergy < singleMeanEnergy * 0.12) {
    return null
  }

  const meanDb = sumDb / validCount
  let maxPeakDb = -Infinity
  let minDipDb = Infinity
  let varSum = 0
  for (let k = 0; k < nFreq; k++) {
    const d = scratchDb[k] - meanDb
    if (d > maxPeakDb) maxPeakDb = d
    if (d < minDipDb) minDipDb = d
    varSum += d * d
  }
  const stdDb = Math.sqrt(varSum / validCount)
  const spanDb = maxPeakDb - minDipDb
  const score = 1.6 * Math.max(0, maxPeakDb) + 0.9 * stdDb + 0.35 * spanDb
  return { maxPeakDb, minDipDb, spanDb, stdDb, score }
}

function buildComboKey(indices: readonly number[], phases: readonly (0 | 180)[]): string {
  return indices
    .map((idx, i) => `${idx}:${phases[i]}`)
    .sort()
    .join('|')
}

function minInterSubDist(
  transfers: readonly CandidateTransfer[],
  indices: readonly number[],
  candidateIdx: number,
): number {
  const cNew = transfers[candidateIdx].cand
  let minD = Infinity
  for (const idx of indices) {
    if (idx === candidateIdx) return 0
    const c = transfers[idx].cand
    const d = Math.hypot(c.x - cNew.x, c.y - cNew.y)
    if (d < minD) minD = d
  }
  return minD
}

function layoutDistance(a: readonly Point2D[], b: readonly Point2D[]): number {
  if (a.length !== b.length || a.length === 0) return Infinity
  // Greedy symmetric Hausdorff-like average minimum distance
  let sum = 0
  for (const pa of a) {
    let best = Infinity
    for (const pb of b) {
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
      if (d < best) best = d
    }
    sum += best
  }
  return sum / a.length
}

function shortLabel(label: string): string {
  return label.replace(/\s*\(.*?\)/, '')
}

function describeLayoutTitle(cands: readonly PlacementCandidate[], phases: readonly (0 | 180)[]): string {
  const hasInverted = phases.some((p) => p === 180)
  const corners = cands.filter((c) => c.kind === 'corner').length
  let base: string
  if (cands.length === 1) {
    base = cands[0].label
  } else if (cands.length === 2) {
    const a = shortLabel(cands[0].label)
    const b = shortLabel(cands[1].label)
    base = a === b ? `2× ${a}` : `${a} + ${b}`
  } else if (corners === cands.length) {
    base = `${cands.length} Raumecken`
  } else if (corners === 0) {
    base = `${cands.length} Wandpositionen`
  } else {
    base = `${corners} Eck- & ${cands.length - corners} Wandpositionen`
  }
  return hasInverted ? `${base} (inkl. 180°)` : base
}

export function optimizeSubwooferPlacements(input: OptimizePlacementInput): PlacementSuggestion[] {
  const { room, listening, modes, settings, fem, obstacles, targetCount } = input
  const subZ = Math.min(Math.max(0, input.subHeight ?? 0), Math.max(0, room.H - 0.1))
  const candidates = generateWallCandidates(room, listening, obstacles, subZ)
  if (candidates.length === 0) return []

  const effectiveCount = Math.min(targetCount, candidates.length) as 1 | 2 | 3 | 4
  const fMin = Math.max(10, settings.fMin)
  const fMax = Math.max(fMin + 5, settings.fMax)
  const step = Math.max(1.0, (fMax - fMin) / 80)
  const freqs: number[] = []
  for (let f = fMin; f <= fMax + 1e-6; f += step) freqs.push(f)
  const nFreq = freqs.length

  const transfers: CandidateTransfer[] = []
  let energyAcc = 0

  for (const cand of candidates) {
    const tempSub: Subwoofer = {
      id: 'opt-0',
      name: 'Opt',
      x: cand.x,
      y: cand.y,
      z: cand.z,
      gain: 0,
      phase: 0,
      enabled: true,
    }
    const field = prepareField(room, [tempSub], modes, settings, fem, obstacles)
    const re = new Float64Array(nFreq)
    const im = new Float64Array(nFreq)
    let eSum = 0
    for (let k = 0; k < nFreq; k++) {
      const [r, i] = pressureAt(field, listening.x, listening.y, settings.earHeight, freqs[k])
      re[k] = Number.isFinite(r) ? r : 0
      im[k] = Number.isFinite(i) ? i : 0
      eSum += re[k] * re[k] + im[k] * im[k]
    }
    const meanEnergy = eSum / Math.max(1, nFreq)
    if (meanEnergy > 0) {
      transfers.push({ cand, re, im, meanEnergy })
      energyAcc += meanEnergy
    }
  }

  if (transfers.length === 0) return []
  const singleMeanEnergy = energyAcc / transfers.length
  const scratchDb = new Float64Array(nFreq)
  const minSubSpacing = 0.65

  interface RawCandidateResult {
    indices: number[]
    phases: (0 | 180)[]
    metrics: PlacementMetrics
  }

  const seen = new Set<string>()
  const results: RawCandidateResult[] = []

  const record = (indices: number[], phases: (0 | 180)[]) => {
    const key = buildComboKey(indices, phases)
    if (seen.has(key)) return
    seen.add(key)
    const metrics = evaluateCombinedVectors(transfers, indices, phases, nFreq, singleMeanEnergy, scratchDb)
    if (metrics) {
      results.push({ indices: [...indices], phases: [...phases], metrics })
    }
  }

  if (effectiveCount === 1) {
    for (let i = 0; i < transfers.length; i++) {
      record([i], [0])
    }
  } else if (effectiveCount === 2) {
    for (let i = 0; i < transfers.length; i++) {
      for (let j = i + 1; j < transfers.length; j++) {
        const d = Math.hypot(
          transfers[i].cand.x - transfers[j].cand.x,
          transfers[i].cand.y - transfers[j].cand.y,
        )
        if (d < minSubSpacing) continue
        record([i, j], [0, 0])
        record([i, j], [0, 180])
      }
    }
  } else {
    // Beam search + coordinate refinement for 3 or 4 subwoofers
    const singles: RawCandidateResult[] = []
    for (let i = 0; i < transfers.length; i++) {
      const m = evaluateCombinedVectors(transfers, [i], [0], nFreq, singleMeanEnergy, scratchDb)
      if (m) singles.push({ indices: [i], phases: [0], metrics: m })
    }
    singles.sort((a, b) => a.metrics.score - b.metrics.score)

    const pairs: RawCandidateResult[] = []
    for (let i = 0; i < transfers.length; i++) {
      for (let j = i + 1; j < transfers.length; j++) {
        const d = Math.hypot(
          transfers[i].cand.x - transfers[j].cand.x,
          transfers[i].cand.y - transfers[j].cand.y,
        )
        if (d < minSubSpacing) continue
        for (const ph of [0, 180] as const) {
          const m = evaluateCombinedVectors(transfers, [i, j], [0, ph], nFreq, singleMeanEnergy, scratchDb)
          if (m) pairs.push({ indices: [i, j], phases: [0, ph], metrics: m })
        }
      }
    }
    pairs.sort((a, b) => a.metrics.score - b.metrics.score)

    let beam: RawCandidateResult[] = pairs.slice(0, 32)
    if (beam.length === 0) beam = singles.slice(0, 16)

    while (beam.length > 0 && beam[0].indices.length < effectiveCount) {
      const nextBeam: RawCandidateResult[] = []
      const stageSeen = new Set<string>()
      for (const state of beam) {
        for (let c = 0; c < transfers.length; c++) {
          if (minInterSubDist(transfers, state.indices, c) < minSubSpacing) continue
          for (const ph of [0, 180] as const) {
            const nextIdx = [...state.indices, c]
            const nextPh = [...state.phases, ph]
            const key = buildComboKey(nextIdx, nextPh)
            if (stageSeen.has(key)) continue
            stageSeen.add(key)
            const m = evaluateCombinedVectors(transfers, nextIdx, nextPh, nFreq, singleMeanEnergy, scratchDb)
            if (m) nextBeam.push({ indices: nextIdx, phases: nextPh, metrics: m })
          }
        }
      }
      nextBeam.sort((a, b) => a.metrics.score - b.metrics.score)
      beam = nextBeam.slice(0, 32)
    }

    // Coordinate refinement on top beam states
    for (const seed of beam.slice(0, 12)) {
      let curIdx = [...seed.indices]
      let curPh = [...seed.phases]
      let curMetrics = seed.metrics
      record(curIdx, curPh)

      for (let pass = 0; pass < 2; pass++) {
        let improved = false
        for (let slot = 0; slot < curIdx.length; slot++) {
          const others = curIdx.filter((_, k) => k !== slot)
          for (let c = 0; c < transfers.length; c++) {
            if (minInterSubDist(transfers, others, c) < minSubSpacing) continue
            for (const ph of [0, 180] as const) {
              const candIdx = [...curIdx]
              const candPh = [...curPh]
              candIdx[slot] = c
              candPh[slot] = ph
              record(candIdx, candPh)
              const m = evaluateCombinedVectors(transfers, candIdx, candPh, nFreq, singleMeanEnergy, scratchDb)
              if (m && m.score < curMetrics.score - 1e-4) {
                curIdx = candIdx
                curPh = candPh
                curMetrics = m
                improved = true
              }
            }
          }
        }
        if (!improved) break
      }
    }
  }

  results.sort((a, b) => a.metrics.score - b.metrics.score)

  // Pick up to 8 spatially diverse layouts, evaluate at exact 0.5 Hz resolution, and return final Top 3
  const picked: RawCandidateResult[] = []
  const diversityThreshold = 0.7
  for (const res of results) {
    const pts = res.indices.map((idx) => ({ x: transfers[idx].cand.x, y: transfers[idx].cand.y }))
    const tooSimilar = picked.some((p) => {
      const pPts = p.indices.map((idx) => ({ x: transfers[idx].cand.x, y: transfers[idx].cand.y }))
      return layoutDistance(pts, pPts) < diversityThreshold
    })
    if (!tooSimilar) {
      picked.push(res)
      if (picked.length >= 8) break
    }
  }
  // Fallback if room is very small and fewer than 3 diverse layouts existed
  if (picked.length < 3) {
    for (const res of results) {
      if (!picked.includes(res)) {
        picked.push(res)
        if (picked.length >= 3) break
      }
    }
  }

  const refined = picked.map((res) => {
    const chosenCands = res.indices.map((idx) => transfers[idx].cand)
    const subs: Subwoofer[] = chosenCands.map((c, mIdx) => ({
      id: `sub-${mIdx}`,
      name: `Sub ${mIdx + 1}`,
      x: c.x,
      y: c.y,
      z: c.z,
      gain: 0,
      phase: res.phases[mIdx],
      enabled: true,
    }))
    const fullField = prepareField(room, subs, modes, settings, fem, obstacles)
    const response = frequencyResponse(
      fullField,
      listening.x,
      listening.y,
      settings.earHeight,
      settings.fMin,
      settings.fMax,
    )
    const metrics = evaluateResponseMetrics(response)
    return {
      title: describeLayoutTitle(chosenCands, res.phases),
      subs,
      metrics,
      response,
    }
  })

  refined.sort((a, b) => a.metrics.score - b.metrics.score)

  return refined.slice(0, 3).map((item, rankIdx) => ({
    id: `opt-rank-${rankIdx + 1}`,
    rank: rankIdx + 1,
    title: item.title,
    subs: item.subs,
    metrics: item.metrics,
    response: item.response,
  }))
}
