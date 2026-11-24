import type { AnalysisSettings, HeatmapGrid, PreparedField } from './acoustics'
import { getBounds, isInsideRoom } from './acoustics'
import { getObstacleAbsorption, isPointInObstacle2D, isPorousAbsorberKind } from './furniture'

export type WaveSignalType = 'sine' | 'pulse'

export interface WaveSourceKernel {
  cells: Int32Array
  weights: Float32Array
  amp: number
}

export interface WaveSimulationState {
  cols: number
  rows: number
  cell: number
  originX: number
  originY: number
  c: number
  cfl: number
  dt: number
  pDamp: number
  vDamp: number
  /** 1 = rigid/solid wall / outside room / non-porous obstacle at earHeight, 0 = air or porous absorber */
  solid: Uint8Array
  /** Per-cell pressure damping multiplier in (0, 1] */
  pCellDamp: Float32Array
  /** Per-face x-velocity damping multiplier in (0, 1] */
  vxCellDamp: Float32Array
  /** Per-face y-velocity damping multiplier in (0, 1] */
  vyCellDamp: Float32Array
  /** Acoustic pressure at cell centers */
  p: Float32Array
  /** Scaled x particle velocity on vertical faces (cols + 1) * rows */
  vx: Float32Array
  /** Scaled y particle velocity on horizontal faces cols * (rows + 1) */
  vy: Float32Array
  vxActive: Uint8Array
  vyActive: Uint8Array
  sources: WaveSourceKernel[]
  stepCount: number
  timeSec: number
  displayScale: number
  peakSeen: number
}

function buildSourceKernels(
  field: PreparedField,
  cols: number,
  rows: number,
  cell: number,
  originX: number,
  originY: number,
  solid: Uint8Array,
): WaveSourceKernel[] {
  const kernels: WaveSourceKernel[] = []
  for (const src of field.sources) {
    if (!src.sub.enabled) continue
    const gx = (src.sub.x - originX) / cell - 0.5
    const gy = (src.sub.y - originY) / cell - 0.5
    const cx = Math.round(gx)
    const cy = Math.round(gy)

    const cellList: number[] = []
    const weightList: number[] = []
    let wSum = 0

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx
        const iy = cy + dy
        if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) continue
        const idx = iy * cols + ix
        if (solid[idx]) continue
        const dist2 = (ix - gx) * (ix - gx) + (iy - gy) * (iy - gy)
        const w = Math.exp(-dist2 / 0.85)
        cellList.push(idx)
        weightList.push(w)
        wSum += w
      }
    }

    // Fallback to nearest fluid cell if subwoofer lies directly on a wall or obstacle edge
    if (cellList.length === 0) {
      let bestIdx = -1
      let bestD2 = Infinity
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          const idx = iy * cols + ix
          if (solid[idx]) continue
          const d2 = (ix - gx) * (ix - gx) + (iy - gy) * (iy - gy)
          if (d2 < bestD2) {
            bestD2 = d2
            bestIdx = idx
          }
        }
      }
      if (bestIdx >= 0) {
        cellList.push(bestIdx)
        weightList.push(1)
        wSum = 1
      }
    }

    if (wSum > 0) {
      const weights = new Float32Array(weightList.length)
      for (let i = 0; i < weightList.length; i++) weights[i] = weightList[i] / wSum
      kernels.push({
        cells: Int32Array.from(cellList),
        weights,
        amp: src.amp,
      })
    }
  }
  return kernels
}

export function createWaveSimulation(
  field: PreparedField,
  settings: AnalysisSettings,
  targetCols = 96,
): WaveSimulationState {
  const bounds = getBounds(field.room)
  const cols = Math.max(32, Math.min(128, Math.round(targetCols)))
  const cell = bounds.width / cols
  const rows = Math.max(16, Math.ceil(bounds.depth / cell))
  const z = settings.earHeight

  const solid = new Uint8Array(cols * rows)
  const solidAlpha = new Float32Array(cols * rows)
  const porousAlpha = new Float32Array(cols * rows)
  const cutObstacles = field.obstacles.filter(
    (o) => o.enabled && o.z <= z + 1e-4 && o.z + o.height >= z - 1e-4,
  )
  const solidObstacles = cutObstacles.filter((o) => !isPorousAbsorberKind(o.kind))
  const porousObstacles = cutObstacles.filter((o) => isPorousAbsorberKind(o.kind))

  for (let r = 0; r < rows; r++) {
    const y = bounds.minY + (r + 0.5) * cell
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c + 0.5) * cell
      const idx = r * cols + c
      if (!isInsideRoom(field.room, x, y)) {
        solid[idx] = 1
        continue
      }
      let hitSolidAlpha = -1
      for (const o of solidObstacles) {
        if (isPointInObstacle2D(o, x, y)) {
          hitSolidAlpha = Math.max(hitSolidAlpha, getObstacleAbsorption(o))
        }
      }
      if (hitSolidAlpha >= 0) {
        solid[idx] = 1
        solidAlpha[idx] = hitSolidAlpha
        continue
      }
      let hitPorousAlpha = 0
      for (const o of porousObstacles) {
        if (isPointInObstacle2D(o, x, y)) {
          hitPorousAlpha = Math.max(hitPorousAlpha, getObstacleAbsorption(o))
        }
      }
      porousAlpha[idx] = hitPorousAlpha
    }
  }

  const vxActive = new Uint8Array((cols + 1) * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      if (!solid[r * cols + c - 1] && !solid[r * cols + c]) {
        vxActive[r * (cols + 1) + c] = 1
      }
    }
  }

  const vyActive = new Uint8Array(cols * (rows + 1))
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid[(r - 1) * cols + c] && !solid[r * cols + c]) {
        vyActive[r * cols + c] = 1
      }
    }
  }

  const cSpeed = Math.max(250, settings.c)
  const cfl = 0.65 / Math.SQRT2
  const dt = (cfl * cell) / cSpeed

  // Mild physical room/air attenuation derived from modal loss factor eta
  const lossPerSec = Math.max(1.8, settings.eta * 95)
  const pDamp = Math.exp(-lossPerSec * dt)
  const vDamp = Math.exp(-0.25 * lossPerSec * dt)

  const wallTransitSec = (2 * cell) / cSpeed
  const pCellDamp = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (solid[idx]) {
        pCellDamp[idx] = pDamp
        continue
      }
      let extraLoss = 0
      if (porousAlpha[idx] > 0) {
        extraLoss += 260 * porousAlpha[idx]
      }
      // Surface impedance damping on fluid cells immediately adjacent to absorptive solid furniture
      let adjAlpha = 0
      if (c > 0 && solid[idx - 1]) adjAlpha = Math.max(adjAlpha, solidAlpha[idx - 1])
      if (c + 1 < cols && solid[idx + 1]) adjAlpha = Math.max(adjAlpha, solidAlpha[idx + 1])
      if (r > 0 && solid[idx - cols]) adjAlpha = Math.max(adjAlpha, solidAlpha[idx - cols])
      if (r + 1 < rows && solid[idx + cols]) adjAlpha = Math.max(adjAlpha, solidAlpha[idx + cols])
      if (adjAlpha > 0.04) {
        const reflLoss = -Math.log(Math.max(0.25, 1 - 0.65 * adjAlpha)) / wallTransitSec
        extraLoss += 0.55 * reflLoss
      }
      pCellDamp[idx] = Math.exp(-(lossPerSec + extraLoss) * dt)
    }
  }

  const vxCellDamp = new Float32Array((cols + 1) * rows)
  vxCellDamp.fill(vDamp)
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const fIdx = r * (cols + 1) + c
      if (!vxActive[fIdx]) continue
      const pAlpha = Math.max(porousAlpha[r * cols + c - 1], porousAlpha[r * cols + c])
      if (pAlpha > 0) {
        vxCellDamp[fIdx] = Math.exp(-(0.25 * lossPerSec + 180 * pAlpha) * dt)
      }
    }
  }

  const vyCellDamp = new Float32Array(cols * (rows + 1))
  vyCellDamp.fill(vDamp)
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fIdx = r * cols + c
      if (!vyActive[fIdx]) continue
      const pAlpha = Math.max(porousAlpha[(r - 1) * cols + c], porousAlpha[r * cols + c])
      if (pAlpha > 0) {
        vyCellDamp[fIdx] = Math.exp(-(0.25 * lossPerSec + 180 * pAlpha) * dt)
      }
    }
  }

  return {
    cols,
    rows,
    cell,
    originX: bounds.minX,
    originY: bounds.minY,
    c: cSpeed,
    cfl,
    dt,
    pDamp,
    vDamp,
    solid,
    pCellDamp,
    vxCellDamp,
    vyCellDamp,
    p: new Float32Array(cols * rows),
    vx: new Float32Array((cols + 1) * rows),
    vy: new Float32Array(cols * (rows + 1)),
    vxActive,
    vyActive,
    sources: buildSourceKernels(field, cols, rows, cell, bounds.minX, bounds.minY, solid),
    stepCount: 0,
    timeSec: 0,
    displayScale: 0,
    peakSeen: 0,
  }
}

export function resetWaveSimulation(sim: WaveSimulationState) {
  sim.p.fill(0)
  sim.vx.fill(0)
  sim.vy.fill(0)
  sim.stepCount = 0
  sim.timeSec = 0
  sim.displayScale = 0
  sim.peakSeen = 0
}

export function updateWaveSources(sim: WaveSimulationState, field: PreparedField) {
  sim.sources = buildSourceKernels(
    field,
    sim.cols,
    sim.rows,
    sim.cell,
    sim.originX,
    sim.originY,
    sim.solid,
  )
}

function sourceWaveform(t: number, frequency: number, signal: WaveSignalType): number {
  const f = Math.max(10, frequency)
  if (signal === 'pulse') {
    // Crisp zero-mean Ricker wavelet so a sharp circular wavefront propagates without DC drift
    const fc = Math.max(95, f)
    const t0 = 1.25 / fc
    if (t > 2.6 * t0) return 0
    const tau = t - t0
    const a = Math.PI * fc * tau
    const a2 = a * a
    return (1 - 2 * a2) * Math.exp(-a2)
  }
  // Quick half-cosine fade-in avoids startup DC click while keeping t = 1..5 ms wavefronts bright
  const period = 1 / f
  const rampDur = Math.min(0.006, period * 0.25)
  const env = t < rampDur ? 0.5 * (1 - Math.cos((Math.PI * t) / rampDur)) : 1
  return env * Math.sin(2 * Math.PI * f * t)
}

export function stepWaveSimulation(
  sim: WaveSimulationState,
  opts: {
    frequency: number
    signal: WaveSignalType
    targetDeltaSec: number
  },
) {
  const { cols, rows, cfl, dt, solid, pCellDamp, vxCellDamp, vyCellDamp, p, vx, vy, vxActive, vyActive, sources } = sim
  const steps = Math.max(1, Math.min(80, Math.round(opts.targetDeltaSec / dt)))
  const srcGain = dt * 6000 * 0.5

  for (let s = 0; s < steps; s++) {
    // 1. Update staggered velocities from pressure gradient
    for (let r = 0; r < rows; r++) {
      const pRow = r * cols
      const vxRow = r * (cols + 1)
      for (let c = 1; c < cols; c++) {
        const idx = vxRow + c
        if (vxActive[idx]) {
          vx[idx] = vx[idx] * vxCellDamp[idx] - cfl * (p[pRow + c] - p[pRow + c - 1])
        }
      }
    }

    for (let r = 1; r < rows; r++) {
      const pRow = r * cols
      const pPrev = (r - 1) * cols
      for (let c = 0; c < cols; c++) {
        const idx = pRow + c
        if (vyActive[idx]) {
          vy[idx] = vy[idx] * vyCellDamp[idx] - cfl * (p[idx] - p[pPrev + c])
        }
      }
    }

    // 2. Update pressure from velocity divergence
    for (let r = 0; r < rows; r++) {
      const pRow = r * cols
      const vxRow = r * (cols + 1)
      const vyTop = (r + 1) * cols
      for (let c = 0; c < cols; c++) {
        const idx = pRow + c
        if (solid[idx]) continue
        const div = vx[vxRow + c + 1] - vx[vxRow + c] + (vy[vyTop + c] - vy[idx])
        p[idx] = p[idx] * pCellDamp[idx] - cfl * div
      }
    }

    // 3. Inject soft acoustic sources for enabled subwoofers
    const t = sim.timeSec + dt * 0.5
    const wave = sourceWaveform(t, opts.frequency, opts.signal)
    if (wave !== 0) {
      for (let k = 0; k < sources.length; k++) {
        const src = sources[k]
        const drive = wave * src.amp * srcGain
        for (let i = 0; i < src.cells.length; i++) {
          p[src.cells[i]] += drive * src.weights[i]
        }
      }
    }

    sim.stepCount++
    sim.timeSec += dt
  }

  // Update smooth dynamic display envelope so early wavefronts and steady modes both render crisply
  let frameMax = 0
  for (let i = 0; i < p.length; i++) {
    if (solid[i]) continue
    const av = Math.abs(p[i])
    if (av > frameMax) frameMax = av
  }
  if (frameMax > sim.peakSeen) sim.peakSeen = frameMax
  const floorScale = Math.max(1e-6, sim.peakSeen * (opts.signal === 'pulse' ? 0.05 : 0.04))
  if (sim.displayScale <= 1e-7) {
    sim.displayScale = frameMax
  } else if (frameMax > sim.displayScale) {
    sim.displayScale = sim.displayScale * 0.3 + frameMax * 0.7
  } else {
    sim.displayScale = Math.max(floorScale, sim.displayScale * 0.9 + frameMax * 0.1)
  }
}

export function waveSimulationToHeatmap(sim: WaveSimulationState): HeatmapGrid {
  const values = new Float32Array(sim.cols * sim.rows)
  const scale = Math.max(1e-6, sim.displayScale)
  for (let i = 0; i < values.length; i++) {
    if (sim.solid[i]) {
      values[i] = NaN
    } else {
      const clamped = Math.max(-scale, Math.min(scale, sim.p[i]))
      values[i] = clamped
    }
  }
  return {
    cols: sim.cols,
    rows: sim.rows,
    cell: sim.cell,
    values,
    min: -scale,
    max: scale,
    originX: sim.originX,
    originY: sim.originY,
    bipolar: true,
  }
}
