'use client'

import dynamic from 'next/dynamic'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  AudioLines,
  Box,
  Check,
  Download,
  FileDown,
  LayoutGrid,
  LineChart,
  Link2,
  Loader2,
  Map,
  SlidersHorizontal,
  Table2,
  Undo2,
  X,
} from 'lucide-react'
import {
  DEFAULT_ROOM,
  DEFAULT_SETTINGS,
  clampObstacleToRoom,
  clampToRoom,
  computeHeatmap,
  computeModes,
  evaluateHeatmapPlane,
  evaluateHeatmapVolumeAtFrequency,
  evaluateHeatmapVolumeBand,
  evaluateHeatmapVolumeSingle,
  frequencyResponse,
  getObstacleAbsorption,
  isRoomGeometryValid,
  listedModes,
  prepareField,
  prepareHeatmapPlane,
  prepareHeatmapVolume,
  solveRoomFem,
  type AnalysisSettings,
  type HeatmapGrid,
  type HeatmapMode,
  type ListeningPoint,
  type ModeType,
  type Point2D,
  type RoomConfig,
  type RoomMode,
  type RoomObstacle,
  type Subwoofer,
} from '@/lib/acoustics'
import {
  createWaveSimulation,
  resetWaveSimulation,
  stepWaveSimulation,
  updateWaveSources,
  waveSimulationToHeatmap,
  type WaveSignalType,
  type WaveSimulationState,
} from '@/lib/wave2d'
import {
  evaluateResponseMetrics,
  optimizeSubwooferPlacements,
  type PlacementMetrics,
  type PlacementSuggestion,
} from '@/lib/subwoofer-optimizer'
import { applyPeqFilters, suggestPeqFilters, type PeqMetrics, type PeqOptions } from '@/lib/peq'
import {
  decodeProjectHash,
  deleteSavedProject,
  downloadProjectJson,
  encodeProjectHash,
  listSavedProjects,
  saveSavedProject,
  type RoomProject,
} from '@/lib/room-storage'
import { cn } from '@/lib/utils'
import { IconButton, Panel, Segmented } from './controls'
import { RoomForm, type PlanTool } from './room-form'
import { SubwooferPanel } from './subwoofer-panel'
import { FurniturePanel } from './furniture-panel'
import { ProjectPanel } from './project-panel'
import { TopView } from './top-view'
import { FrequencyResponseChart, ModeMarkerLegend } from './frequency-response-chart'
import { ModeTable } from './mode-table'
import { HeatmapControls } from './heatmap-controls'
import { PeqPanel } from './peq-panel'
import { exportReport } from './export-report'
import type { View3dMode } from './room-3d'

const Room3D = dynamic(() => import('./room-3d'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">3D-Ansicht wird geladen…</div>
  ),
})

type PanelKey = 'top' | 'three' | 'response' | 'modes' | 'peq'

const INITIAL_SUBS: Subwoofer[] = [
  { id: 'sub-0', name: 'Sub 1', x: 0.35, y: 0.35, z: 0, gain: 0, phase: 0, enabled: true },
  { id: 'sub-1', name: 'Sub 2', x: DEFAULT_ROOM.L1 - 0.35, y: 0.35, z: 0, gain: 0, phase: 0, enabled: true },
]

export function RoomModeAnalyzer() {
  const [room, setRoom] = useState<RoomConfig>(DEFAULT_ROOM)
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS)
  const [subs, setSubs] = useState<Subwoofer[]>(INITIAL_SUBS)
  const [obstacles, setObstacles] = useState<RoomObstacle[]>([])
  const [listening, setListening] = useState<ListeningPoint>({ x: DEFAULT_ROOM.L1 / 2, y: DEFAULT_ROOM.W1 * 0.62 })
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null)
  const [probe, setProbe] = useState<ListeningPoint | null>(null)

  const [planTool, setPlanTool] = useState<PlanTool>('analyze')
  const [snapStep, setSnapStep] = useState<number>(0.1)
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(null)
  const [drawPoints, setDrawPoints] = useState<Point2D[]>([])

  const [heatMode, setHeatMode] = useState<HeatmapMode>('band')
  const [heatFrequency, setHeatFrequency] = useState(45)
  const [heatRangeDb, setHeatRangeDb] = useState(24)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [view3dMode, setView3dMode] = useState<View3dMode>('iso')
  const [volumeTransparency, setVolumeTransparency] = useState(0.28)
  const [showMaxima, setShowMaxima] = useState(true)
  const [showNulls, setShowNulls] = useState(true)
  const [sweepActive, setSweepActive] = useState(false)
  const [sweepSpeed, setSweepSpeed] = useState(1)
  const [sweepLoop, setSweepLoop] = useState(true)
  const [wavePlaying, setWavePlaying] = useState(false)
  const [waveSpeed, setWaveSpeed] = useState(0.5)
  const [waveSignal, setWaveSignal] = useState<WaveSignalType>('sine')
  const [waveTimeMs, setWaveTimeMs] = useState(0)
  const [waveGrid, setWaveGrid] = useState<HeatmapGrid | null>(null)
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<Set<ModeType>>(new Set(['axial', 'tangential', 'oblique']))
  const [markerTypes, setMarkerTypes] = useState<Set<ModeType>>(new Set(['axial', 'tangential']))

  const [peqOptions, setPeqOptions] = useState<PeqOptions>({ maxFilters: 5, maxCutDb: 12, allowBoost: false })
  const [disabledPeqIds, setDisabledPeqIds] = useState<Set<string>>(new Set())
  const [showPeqOverlay, setShowPeqOverlay] = useState(true)
  const [showUndampedBaseline, setShowUndampedBaseline] = useState(true)

  const [optimizerCount, setOptimizerCount] = useState<1 | 2 | 3 | 4>(2)
  const [suggestions, setSuggestions] = useState<PlacementSuggestion[]>([])
  const [optimizing, setOptimizing] = useState(false)
  const [optimizerContextKey, setOptimizerContextKey] = useState<string | null>(null)
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null)
  const [pinnedPreviewId, setPinnedPreviewId] = useState<string | null>(null)
  const [previousSubsSnapshot, setPreviousSubsSnapshot] = useState<Subwoofer[] | null>(null)

  const [visible, setVisible] = useState<Record<PanelKey, boolean>>({
    top: true,
    three: true,
    response: true,
    modes: true,
    peq: true,
  })
  const [swapViews, setSwapViews] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [projectName, setProjectName] = useState('Mein Raum')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState<RoomProject[]>([])
  const [headerCopied, setHeaderCopied] = useState(false)

  const topCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const deferredRoom = useDeferredValue(room)
  const deferredSettings = useDeferredValue(settings)
  const deferredObstacles = useDeferredValue(obstacles)

  const femSolution = useMemo(
    () => solveRoomFem(deferredRoom, deferredSettings, deferredSettings.fMax * 1.3, deferredObstacles),
    [deferredRoom, deferredSettings, deferredObstacles],
  )
  const allModes = useMemo(
    () => computeModes(deferredRoom, deferredSettings, deferredSettings.fMax * 1.3, femSolution, deferredObstacles),
    [deferredRoom, deferredSettings, femSolution, deferredObstacles],
  )
  const modes = useMemo(() => listedModes(allModes, deferredSettings), [allModes, deferredSettings])
  const field = useMemo(
    () => prepareField(deferredRoom, subs, allModes, deferredSettings, femSolution, deferredObstacles),
    [deferredRoom, subs, allModes, deferredSettings, femSolution, deferredObstacles],
  )

  const activeMode = useMemo(() => allModes.find((m) => m.id === selectedModeId) ?? null, [allModes, selectedModeId])
  const clampedHeatFrequency = Math.min(settings.fMax, Math.max(settings.fMin, heatFrequency))

  const deferredField = useDeferredValue(field)
  const effectiveView3dMode: View3dMode = heatMode === 'wave' ? 'plane' : view3dMode

  const heatmapPlane = useMemo(
    () => (heatMode === 'frequency' ? prepareHeatmapPlane(deferredField, deferredSettings, 80) : null),
    [heatMode, deferredField, deferredSettings],
  )
  const staticGrid = useMemo(() => {
    if (heatMode === 'wave') return null
    if (heatMode === 'frequency' && heatmapPlane) {
      return evaluateHeatmapPlane(heatmapPlane, clampedHeatFrequency)
    }
    return computeHeatmap(deferredField, deferredSettings, {
      mode: heatMode,
      frequency: clampedHeatFrequency,
      singleMode: activeMode,
      cols: heatMode === 'band' ? 44 : 80,
    })
  }, [heatMode, heatmapPlane, deferredField, deferredSettings, clampedHeatFrequency, activeMode])

  const grid = heatMode === 'wave' ? (waveGrid ?? staticGrid) : staticGrid

  const volumePlane = useMemo(
    () => (visible.three && effectiveView3dMode !== 'plane' ? prepareHeatmapVolume(deferredField, 4200) : null),
    [visible.three, effectiveView3dMode, deferredField],
  )
  const volumeBandGrid = useMemo(
    () =>
      volumePlane && heatMode === 'band'
        ? evaluateHeatmapVolumeBand(volumePlane, deferredSettings.fMin, deferredSettings.fMax, 28)
        : null,
    [volumePlane, heatMode, deferredSettings.fMin, deferredSettings.fMax],
  )
  const volumeGrid = useMemo(() => {
    if (!volumePlane || heatMode === 'wave') return null
    if (heatMode === 'frequency') return evaluateHeatmapVolumeAtFrequency(volumePlane, clampedHeatFrequency)
    if (heatMode === 'single') return evaluateHeatmapVolumeSingle(volumePlane, activeMode)
    return volumeBandGrid
  }, [volumePlane, heatMode, clampedHeatFrequency, activeMode, volumeBandGrid])

  const listeningResponse = useMemo(
    () => frequencyResponse(field, listening.x, listening.y, deferredSettings.earHeight, deferredSettings.fMin, deferredSettings.fMax),
    [field, listening, deferredSettings],
  )
  const currentMetrics = useMemo(() => evaluateResponseMetrics(listeningResponse), [listeningResponse])
  const hasDampedObstacles = useMemo(
    () => deferredObstacles.some((o) => o.enabled && getObstacleAbsorption(o) > 0),
    [deferredObstacles],
  )
  const undampedField = useMemo(
    () =>
      hasDampedObstacles && showUndampedBaseline
        ? prepareField(deferredRoom, subs, allModes, deferredSettings, femSolution, deferredObstacles, {
            ignoreObstacleDamping: true,
          })
        : null,
    [hasDampedObstacles, showUndampedBaseline, deferredRoom, subs, allModes, deferredSettings, femSolution, deferredObstacles],
  )
  const undampedResponse = useMemo(
    () =>
      undampedField
        ? frequencyResponse(undampedField, listening.x, listening.y, deferredSettings.earHeight, deferredSettings.fMin, deferredSettings.fMax)
        : null,
    [undampedField, listening, deferredSettings],
  )
  const peakReductionDb = useMemo(() => {
    if (!undampedResponse) return 0
    const baseMetrics = evaluateResponseMetrics(undampedResponse)
    return Math.max(0, baseMetrics.maxPeakDb - currentMetrics.maxPeakDb)
  }, [undampedResponse, currentMetrics])
  const currentOptimizerContextKey = useMemo(
    () =>
      JSON.stringify([
        deferredRoom,
        deferredObstacles.filter((o) => o.enabled),
        listening,
        deferredSettings.fMin,
        deferredSettings.fMax,
        deferredSettings.earHeight,
        deferredSettings.c,
        deferredSettings.eta,
      ]),
    [deferredRoom, deferredObstacles, listening, deferredSettings],
  )
  const optimizerStale = Boolean(
    suggestions.length > 0 && optimizerContextKey && optimizerContextKey !== currentOptimizerContextKey,
  )
  const activePreviewId = hoveredPreviewId ?? pinnedPreviewId
  const activePreview = useMemo(
    () => suggestions.find((s) => s.id === activePreviewId) ?? null,
    [suggestions, activePreviewId],
  )

  const probeResponse = useMemo(
    () => (probe ? frequencyResponse(field, probe.x, probe.y, deferredSettings.earHeight, deferredSettings.fMin, deferredSettings.fMax) : null),
    [field, probe, deferredSettings],
  )

  const peqSuggestion = useMemo(
    () => suggestPeqFilters(listeningResponse, peqOptions),
    [listeningResponse, peqOptions],
  )
  const effectivePeqFilters = useMemo(
    () => peqSuggestion.filters.map((f) => ({ ...f, enabled: !disabledPeqIds.has(f.id) })),
    [peqSuggestion.filters, disabledPeqIds],
  )
  const peqCorrectedResponse = useMemo(
    () => applyPeqFilters(listeningResponse, effectivePeqFilters),
    [listeningResponse, effectivePeqFilters],
  )
  const peqMetrics = useMemo<PeqMetrics>(() => {
    if (peqCorrectedResponse.length === 0) return peqSuggestion.metrics
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (const p of peqCorrectedResponse) {
      sum += p.db
      if (p.db < min) min = p.db
      if (p.db > max) max = p.db
    }
    const mean = sum / peqCorrectedResponse.length
    let varSum = 0
    for (const p of peqCorrectedResponse) varSum += (p.db - mean) * (p.db - mean)
    return {
      ...peqSuggestion.metrics,
      stdAfter: Math.sqrt(varSum / peqCorrectedResponse.length),
      peakAfter: max,
      spanAfter: max - min,
    }
  }, [peqCorrectedResponse, peqSuggestion.metrics])

  // Logarithmic heatmap sweep animation between fMin and fMax
  const heatFreqRef = useRef(clampedHeatFrequency)
  heatFreqRef.current = clampedHeatFrequency
  useEffect(() => {
    if (!sweepActive) return
    if (heatMode !== 'frequency') {
      setSweepActive(false)
      return
    }
    const fMin = Math.max(1, settings.fMin)
    const fMax = Math.max(fMin + 1, settings.fMax)
    const logSpan = Math.log(fMax / fMin)
    const durationMs = 14000 / Math.max(0.25, sweepSpeed)
    let u = Math.max(0, Math.min(1, Math.log(Math.max(fMin, heatFreqRef.current) / fMin) / logSpan))
    let lastTime = performance.now()
    let lastCommit = lastTime
    let rafId = 0

    const tick = (now: number) => {
      const dt = Math.min(100, now - lastTime)
      lastTime = now
      u += dt / durationMs
      if (u >= 1) {
        if (sweepLoop) {
          u = u % 1
        } else {
          setHeatFrequency(fMax)
          setSweepActive(false)
          return
        }
      }
      if (now - lastCommit >= 28) {
        lastCommit = now
        const fNext = fMin * Math.exp(u * logSpan)
        setHeatFrequency(Number(fNext.toFixed(1)))
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [sweepActive, sweepSpeed, sweepLoop, heatMode, settings.fMin, settings.fMax])

  const handleToggleSweep = useCallback(() => {
    if (sweepActive) {
      setSweepActive(false)
      return
    }
    setHeatMode('frequency')
    setShowHeatmap(true)
    if (heatFreqRef.current >= settings.fMax - 0.5 || heatMode !== 'frequency') {
      setHeatFrequency(settings.fMin)
    }
    setSweepActive(true)
  }, [sweepActive, heatMode, settings.fMin, settings.fMax])

  const handleResetSweep = useCallback(() => {
    setSweepActive(false)
    setHeatMode('frequency')
    setShowHeatmap(true)
    setHeatFrequency(settings.fMin)
  }, [settings.fMin])

  // Time-domain wavefront propagation simulation (2D staggered FDTD at earHeight)
  const waveSimRef = useRef<WaveSimulationState | null>(null)
  const waveSpeedRef = useRef(waveSpeed)
  waveSpeedRef.current = waveSpeed
  const waveSignalRef = useRef(waveSignal)
  waveSignalRef.current = waveSignal

  const waveGeomKey = useMemo(
    () =>
      JSON.stringify([
        deferredRoom,
        deferredObstacles.filter((o) => o.enabled),
        deferredSettings.earHeight,
        deferredSettings.c,
        deferredSettings.eta,
      ]),
    [deferredRoom, deferredObstacles, deferredSettings.earHeight, deferredSettings.c, deferredSettings.eta],
  )

  useEffect(() => {
    if (heatMode !== 'wave') {
      waveSimRef.current = null
      return
    }
    const sim = createWaveSimulation(deferredField, deferredSettings, 96)
    waveSimRef.current = sim
    setWaveTimeMs(0)
    setWaveGrid(waveSimulationToHeatmap(sim))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatMode, waveGeomKey])

  useEffect(() => {
    if (heatMode === 'wave' && waveSimRef.current) {
      updateWaveSources(waveSimRef.current, deferredField)
    }
  }, [heatMode, deferredField])

  const deferredFieldRef = useRef(deferredField)
  deferredFieldRef.current = deferredField
  const deferredSettingsRef = useRef(deferredSettings)
  deferredSettingsRef.current = deferredSettings

  useEffect(() => {
    if (heatMode !== 'wave' || !wavePlaying) return
    if (!waveSimRef.current) {
      waveSimRef.current = createWaveSimulation(deferredFieldRef.current, deferredSettingsRef.current, 96)
    }
    let lastTime = performance.now()
    let lastCommit = 0
    let rafId = 0

    const tick = (now: number) => {
      const realDtSec = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
      lastTime = now
      const currentSim = waveSimRef.current
      if (!currentSim) return

      // Slow-motion factor: at 1x speed, 20 ms of sound propagation happens per 1 s real time
      const simDeltaSec = realDtSec * 0.02 * waveSpeedRef.current
      stepWaveSimulation(currentSim, {
        frequency: heatFreqRef.current,
        signal: waveSignalRef.current,
        targetDeltaSec: simDeltaSec,
      })

      if (now - lastCommit >= 25) {
        lastCommit = now
        setWaveTimeMs(currentSim.timeSec * 1000)
        setWaveGrid(waveSimulationToHeatmap(currentSim))
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [heatMode, wavePlaying])

  const handleToggleWave = useCallback(() => {
    setShowHeatmap(true)
    setWavePlaying((p) => !p)
  }, [])

  const handleResetWave = useCallback(() => {
    const sim = waveSimRef.current
    if (sim) {
      resetWaveSimulation(sim)
      setWaveTimeMs(0)
      setWaveGrid(waveSimulationToHeatmap(sim))
    } else {
      const fresh = createWaveSimulation(deferredField, deferredSettings, 96)
      waveSimRef.current = fresh
      setWaveTimeMs(0)
      setWaveGrid(waveSimulationToHeatmap(fresh))
    }
  }, [deferredField, deferredSettings])

  const handleWaveSignalChange = useCallback(
    (sig: WaveSignalType) => {
      setWaveSignal(sig)
      if (waveSimRef.current) {
        resetWaveSimulation(waveSimRef.current)
        setWaveTimeMs(0)
        setWaveGrid(waveSimulationToHeatmap(waveSimRef.current))
      }
      setWavePlaying(true)
    },
    [],
  )

  const handleOptimizePlacements = useCallback(() => {
    setOptimizing(true)
    const contextKey = currentOptimizerContextKey
    const firstActiveSub = subs.find((s) => s.enabled)
    window.requestAnimationFrame(() => {
      try {
        const next = optimizeSubwooferPlacements({
          room: deferredRoom,
          listening,
          modes: allModes,
          settings: deferredSettings,
          fem: femSolution,
          obstacles: deferredObstacles,
          targetCount: optimizerCount,
          subHeight: firstActiveSub?.z ?? 0,
        })
        setSuggestions(next)
        setOptimizerContextKey(contextKey)
        setPinnedPreviewId(next[0]?.id ?? null)
        setHoveredPreviewId(null)
      } finally {
        setOptimizing(false)
      }
    })
  }, [
    currentOptimizerContextKey,
    subs,
    deferredRoom,
    listening,
    allModes,
    deferredSettings,
    femSolution,
    deferredObstacles,
    optimizerCount,
  ])

  const handleApplySuggestion = useCallback(
    (suggestion: PlacementSuggestion) => {
      setPreviousSubsSnapshot(subs)
      setSubs(suggestion.subs.map((s) => ({ ...s })))
      setSelectedSubId(null)
      setPinnedPreviewId(null)
      setHoveredPreviewId(null)
    },
    [subs],
  )

  const handleRestorePreviousSubs = useCallback(() => {
    if (!previousSubsSnapshot) return
    setSubs(previousSubsSnapshot)
    setPreviousSubsSnapshot(null)
    setSelectedSubId(null)
  }, [previousSubsSnapshot])

  const handleRoomChange = useCallback((next: RoomConfig) => {
    setRoom(next)
    if (isRoomGeometryValid(next)) {
      setSubs((prev) => prev.map((s) => ({ ...s, ...clampToRoom(next, s.x, s.y), z: Math.min(s.z, next.H) })))
      setObstacles((prev) => prev.map((o) => clampObstacleToRoom(next, o)))
      setListening((prev) => clampToRoom(next, prev.x, prev.y))
    }
    setSettings((prev) => ({ ...prev, earHeight: Math.min(prev.earHeight, Math.max(0.3, next.H - 0.1)) }))
  }, [])

  const handlePlanToolChange = useCallback((tool: PlanTool) => {
    setPlanTool(tool)
    setDrawPoints([])
    if (tool !== 'edit') setSelectedVertexIdx(null)
    if (tool !== 'analyze') setProbe(null)
  }, [])

  const handlePolygonChange = useCallback(
    (pts: Point2D[]) => {
      handleRoomChange({ ...room, polygon: pts })
    },
    [room, handleRoomChange],
  )

  const handleFinishDraw = useCallback(
    (pts: Point2D[]) => {
      if (pts.length < 3) return
      handleRoomChange({ ...room, shape: 'polygon', polygon: pts })
      setPlanTool('edit')
      setDrawPoints([])
      setSelectedVertexIdx(null)
    },
    [room, handleRoomChange],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') {
        if (planTool === 'draw') {
          setDrawPoints([])
          setPlanTool(room.shape === 'polygon' ? 'edit' : 'analyze')
        } else if (planTool === 'edit') {
          setSelectedVertexIdx(null)
        }
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        planTool === 'edit' &&
        room.shape === 'polygon' &&
        selectedVertexIdx !== null &&
        room.polygon.length > 3
      ) {
        e.preventDefault()
        const next = room.polygon.filter((_, i) => i !== selectedVertexIdx)
        handlePolygonChange(next)
        setSelectedVertexIdx(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [planTool, room.shape, room.polygon, selectedVertexIdx, handlePolygonChange])

  const applySnapshot = useCallback((snap: Omit<RoomProject, 'id' | 'updatedAt'>, id: string | null) => {
    setRoom(snap.room)
    setSubs(snap.subs)
    setObstacles(snap.obstacles ?? [])
    setListening(snap.listening)
    setSettings(snap.settings)
    setProjectName(snap.name)
    setActiveProjectId(id)
    setSelectedSubId(null)
    setSelectedObstacleId(null)
    setSelectedVertexIdx(null)
    setDrawPoints([])
    setProbe(null)
    setSelectedModeId(null)
    setPlanTool('analyze')
  }, [])

  useEffect(() => {
    setSavedProjects(listSavedProjects())
    const fromHash = decodeProjectHash(window.location.hash)
    if (fromHash) applySnapshot(fromHash, null)
    const onHashChange = () => {
      const next = decodeProjectHash(window.location.hash)
      if (next) applySnapshot(next, null)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [applySnapshot])

  const handleSaveProject = useCallback(
    (asNew = false) => {
      const useExisting = !asNew && activeProjectId
      const id = useExisting ? activeProjectId : `proj-${Date.now()}`
      const defaultName =
        room.shape === 'polygon'
          ? `Raumplan (${room.polygon.length} Ecken)`
          : room.shape === 'lshape'
            ? 'L-Form Raum'
            : 'Rechteck-Raum'
      const cleanName = projectName.trim() || defaultName
      const entry: RoomProject = {
        version: 1,
        id,
        name: cleanName,
        updatedAt: new Date().toISOString(),
        room,
        subs,
        listening,
        settings,
        obstacles,
      }
      setSavedProjects(saveSavedProject(entry))
      setProjectName(cleanName)
      setActiveProjectId(id)
    },
    [activeProjectId, projectName, room, subs, listening, settings, obstacles],
  )

  const handleOverwriteProject = useCallback(
    (id: string) => {
      const target = savedProjects.find((p) => p.id === id)
      const entry: RoomProject = {
        version: 1,
        id,
        name: target?.name ?? (projectName.trim() || 'Raumplan'),
        updatedAt: new Date().toISOString(),
        room,
        subs,
        listening,
        settings,
        obstacles,
      }
      setSavedProjects(saveSavedProject(entry))
      setActiveProjectId(id)
      setProjectName(entry.name)
    },
    [savedProjects, projectName, room, subs, listening, settings, obstacles],
  )

  const handleDeleteProject = useCallback(
    (id: string) => {
      setSavedProjects(deleteSavedProject(id))
      if (activeProjectId === id) setActiveProjectId(null)
    },
    [activeProjectId],
  )

  const handleExportJson = useCallback(() => {
    downloadProjectJson({
      version: 1,
      id: activeProjectId ?? undefined,
      name: projectName.trim() || 'Raumplan',
      room,
      subs,
      listening,
      settings,
      obstacles,
    })
  }, [activeProjectId, projectName, room, subs, listening, settings, obstacles])

  const handleCopyShareLink = useCallback(async () => {
    const hash = encodeProjectHash({
      name: projectName.trim() || 'Raumplan',
      room,
      subs,
      listening,
      settings,
      obstacles,
    })
    window.history.replaceState(null, '', hash)
    try {
      await navigator.clipboard.writeText(window.location.href)
      return true
    } catch {
      return false
    }
  }, [projectName, room, subs, listening, settings, obstacles])

  const handleSubMove = useCallback((id: string, x: number, y: number) => {
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)))
  }, [])

  const handleObstacleMove = useCallback(
    (id: string, x: number, y: number) => {
      setObstacles((prev) => prev.map((o) => (o.id === id ? clampObstacleToRoom(room, { ...o, x, y }) : o)))
    },
    [room],
  )

  const handleSelectMode = (m: RoomMode | null) => {
    setSelectedModeId(m?.id ?? null)
    if (m) {
      setWavePlaying(false)
      setHeatMode('single')
    } else if (heatMode === 'single') {
      setHeatMode('band')
    }
  }

  const heatmapDescription =
    heatMode === 'band'
      ? `Energetisches Mittel des Schalldrucks über ${settings.fMin}–${settings.fMax} Hz auf Ohrhöhe ${settings.earHeight.toFixed(2)} m, Summe aller relevanten Moden, angeregt durch die platzierten Subwoofer. Farbskala relativ zum Maximum (${heatRangeDb} dB Dynamik).`
      : heatMode === 'frequency'
        ? `Schalldruckverteilung bei ${clampedHeatFrequency.toFixed(1)} Hz auf Ohrhöhe ${settings.earHeight.toFixed(2)} m (Überlagerung aller Moden). Farbskala relativ zum Maximum (${heatRangeDb} dB Dynamik).`
        : heatMode === 'wave'
          ? `Zeitbereichs-Wellenausbreitung (${waveSignal === 'pulse' ? 'Impuls' : `${clampedHeatFrequency.toFixed(1)} Hz Sinus`}) bei t = ${waveTimeMs.toFixed(1)} ms auf Ohrhöhe ${settings.earHeight.toFixed(2)} m (Blau/Rot = gegenphasiger Schalldruck, Weiß = Nulldurchgang).`
          : activeMode
            ? activeMode.segment === 'FEM'
              ? `Bipolare Druckverteilung der FEM-Mode M${activeMode.femIndex ?? activeMode.nx} (z${activeMode.nz}) bei ${activeMode.f.toFixed(1)} Hz auf Ohrhöhe ${settings.earHeight.toFixed(2)} m (Blau/Rot = gegenphasige Druckbäuche, Weiß = Druckknoten).`
              : `Bipolare Druckverteilung der Einzelmode (${activeMode.nx},${activeMode.ny},${activeMode.nz}) bei ${activeMode.f.toFixed(1)} Hz auf Ohrhöhe ${settings.earHeight.toFixed(2)} m (Blau/Rot = gegenphasige Druckbäuche, Weiß = Druckknoten).`
            : 'Keine Mode ausgewählt.'

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportReport({
        room,
        subs,
        listening,
        settings,
        modes,
        grid,
        heatRangeDb,
        heatmapDescription,
        topViewCanvas: topCanvasRef.current,
        response: listeningResponse,
      })
    } finally {
      setExporting(false)
    }
  }

  const togglePanel = (k: PanelKey) => setVisible((v) => ({ ...v, [k]: !v[k] }))

  const probeInfo = useMemo(() => {
    if (!probe || !grid) return null
    const c = Math.floor((probe.x - grid.originX) / grid.cell)
    const r = Math.floor((probe.y - grid.originY) / grid.cell)
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null
    const v = grid.values[r * grid.cols + c]
    if (!Number.isFinite(v)) return null
    if (grid.bipolar) {
      const rel = grid.max > 0 ? v / grid.max : 0
      const db = Math.abs(v) > 0 && grid.max > 0 ? 20 * Math.log10(Math.abs(v) / grid.max) : -60
      return { db, rel }
    }
    return { db: v - grid.max, rel: null }
  }, [probe, grid])

  const roomValid = isRoomGeometryValid(room)
  const topSubtitle =
    planTool === 'draw'
      ? 'Klick setzt Eckpunkt · Klick auf P1 schließt · Rechtsklick macht rückgängig'
      : planTool === 'edit'
        ? 'Ecken ziehen · + auf Kante fügt Ecke hinzu · Doppelklick auf Ecke löscht'
        : 'Subwoofer ziehen · Klick setzt Hörplatz · Mauszeiger zeigt Frequenzgang'

  const topPanel = visible.top && (
    <Panel
      key="top"
      title="2D-Draufsicht"
      subtitle={topSubtitle}
      actions={
        <div className="flex items-center gap-1.5">
          {room.shape === 'polygon' && (
            <Segmented
              ariaLabel="2D-Werkzeugmodus"
              size="sm"
              value={planTool === 'analyze' ? 'analyze' : 'edit'}
              onChange={(m) => handlePlanToolChange(m)}
              options={[
                { value: 'analyze', label: 'Analyse' },
                { value: 'edit', label: 'Wände' },
              ]}
            />
          )}
          <button
            type="button"
            aria-pressed={showHeatmap}
            onClick={() => setShowHeatmap((v) => !v)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
              showHeatmap ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground',
            )}
          >
            Heatmap
          </button>
        </div>
      }
      bodyClassName="flex flex-col gap-3"
    >
      <TopView
        room={room}
        subs={subs}
        listening={listening}
        grid={grid}
        showHeatmap={showHeatmap}
        heatRangeDb={heatRangeDb}
        selectedId={selectedSubId}
        onSelect={setSelectedSubId}
        onSubMove={handleSubMove}
        onListeningChange={setListening}
        onProbe={setProbe}
        canvasRef={topCanvasRef}
        planTool={planTool}
        snapStep={snapStep}
        selectedVertexIdx={selectedVertexIdx}
        onSelectVertex={setSelectedVertexIdx}
        onPolygonChange={handlePolygonChange}
        drawPoints={drawPoints}
        onDrawPointsChange={setDrawPoints}
        onFinishDraw={handleFinishDraw}
        obstacles={obstacles}
        selectedObstacleId={selectedObstacleId}
        onSelectObstacle={setSelectedObstacleId}
        onObstacleMove={handleObstacleMove}
        previewSubs={activePreview?.subs ?? null}
      />

      {planTool === 'draw' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs">
          <span className="font-mono text-[11px] text-foreground">
            Zeichenmodus · {drawPoints.length} {drawPoints.length === 1 ? 'Punkt' : 'Punkte'} gesetzt
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={drawPoints.length === 0}
              onClick={() => setDrawPoints((pts) => pts.slice(0, -1))}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Undo2 className="h-3 w-3" />
              Zurück
            </button>
            <button
              type="button"
              disabled={drawPoints.length < 3}
              onClick={() => handleFinishDraw(drawPoints)}
              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Check className="h-3 w-3" />
              Fertig
            </button>
            <button
              type="button"
              onClick={() => handlePlanToolChange('edit')}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-5 items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span className={!roomValid ? 'text-destructive' : undefined}>
          {!roomValid
            ? 'Ungültiger Grundriss – Wände überschneiden sich'
            : probe
              ? `Sonde x ${probe.x.toFixed(2)} · y ${probe.y.toFixed(2)} · z ${settings.earHeight.toFixed(2)} m${
                  probeInfo !== null
                    ? heatMode === 'wave' && probeInfo.rel !== null
                      ? ` · ${probeInfo.rel >= 0 ? '+' : ''}${probeInfo.rel.toFixed(2)} rel.`
                      : ` · ${probeInfo.db.toFixed(1)} dB`
                    : ''
                }`
              : `Hörplatz x ${listening.x.toFixed(2)} · y ${listening.y.toFixed(2)} · z ${settings.earHeight.toFixed(2)} m`}
        </span>
        <span>{modes.length} Moden · {settings.fMin}–{settings.fMax} Hz</span>
      </div>
      <HeatmapControls
        mode={heatMode}
        onModeChange={(m) => {
          if (m !== 'frequency') setSweepActive(false)
          if (m === 'wave') {
            setShowHeatmap(true)
            setWavePlaying(true)
          } else {
            setWavePlaying(false)
          }
          setHeatMode(m)
        }}
        frequency={clampedHeatFrequency}
        onFrequencyChange={(f) => {
          setSweepActive(false)
          setHeatFrequency(f)
        }}
        fMin={settings.fMin}
        fMax={settings.fMax}
        rangeDb={heatRangeDb}
        onRangeDbChange={setHeatRangeDb}
        selectedMode={activeMode}
        grid={grid}
        earHeight={settings.earHeight}
        soundSpeed={settings.c}
        sweepActive={sweepActive}
        onToggleSweep={handleToggleSweep}
        onResetSweep={handleResetSweep}
        sweepSpeed={sweepSpeed}
        onSweepSpeedChange={setSweepSpeed}
        sweepLoop={sweepLoop}
        onSweepLoopChange={setSweepLoop}
        wavePlaying={wavePlaying}
        onToggleWave={handleToggleWave}
        onResetWave={handleResetWave}
        waveTimeMs={waveTimeMs}
        waveSpeed={waveSpeed}
        onWaveSpeedChange={setWaveSpeed}
        waveSignal={waveSignal}
        onWaveSignalChange={handleWaveSignalChange}
        volumeTransparency={volumeTransparency}
        onVolumeTransparencyChange={setVolumeTransparency}
        showVolumeTransparency={visible.three && effectiveView3dMode !== 'plane'}
      />
    </Panel>
  )

  const threePanel = visible.three && (
    <Panel
      key="three"
      title="3D-Raummodell"
      subtitle="Drehen: Ziehen · Zoom: Rad/Pinch · Schwenken: Rechtsklick/Zwei Finger"
      actions={
        <Segmented<View3dMode>
          ariaLabel="3D-Darstellungsmodus"
          size="sm"
          value={effectiveView3dMode}
          onChange={(m) => {
            if (heatMode === 'wave' && m !== 'plane') {
              setWavePlaying(false)
              setHeatMode('frequency')
            }
            setView3dMode(m)
          }}
          options={[
            { value: 'iso', label: 'Isoflächen' },
            { value: 'plane', label: '2D-Ebene' },
            { value: 'both', label: 'Beide' },
          ]}
        />
      }
      bodyClassName="flex flex-col p-0"
    >
      <div className="min-h-[420px] w-full flex-1 overflow-hidden bg-surface">
        <Room3D
          room={room}
          subs={subs}
          listening={listening}
          earHeight={settings.earHeight}
          grid={grid}
          volume={volumeGrid}
          view3dMode={effectiveView3dMode}
          volumeOpacity={Math.max(0, Math.min(1, 1 - volumeTransparency))}
          showMaxima={showMaxima}
          showNulls={showNulls}
          showHeatmap={showHeatmap}
          heatRangeDb={heatRangeDb}
          selectedId={selectedSubId}
          obstacles={obstacles}
          selectedObstacleId={selectedObstacleId}
          previewSubs={activePreview?.subs ?? null}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          {!showHeatmap ? (
            <span className="font-mono">Heatmap ausgeblendet</span>
          ) : effectiveView3dMode === 'plane' ? (
            <span className="font-mono">
              {heatMode === 'wave'
                ? `Wellenfront-Ebene z = ${settings.earHeight.toFixed(2)} m · t = ${waveTimeMs.toFixed(1)} ms`
                : `Schnittebene z = ${settings.earHeight.toFixed(2)} m`}
            </span>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={showMaxima}
                onClick={() => setShowMaxima((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium transition-colors',
                  showMaxima
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                {heatMode === 'single' ? '+Phase' : 'Maxima'}
              </button>
              <button
                type="button"
                aria-pressed={showNulls}
                onClick={() => setShowNulls((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium transition-colors',
                  showNulls
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                {heatMode === 'single' ? '−Phase' : 'Auslöschungen'}
              </button>
            </>
          )}
        </div>
        {showHeatmap && effectiveView3dMode !== 'plane' && (
          <label className="flex items-center gap-2 font-mono">
            <span>Transparenz</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volumeTransparency * 100)}
              onChange={(e) => setVolumeTransparency(Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
              aria-label="3D-Isoflächen Transparenz"
              className="h-1.5 w-28 cursor-pointer accent-primary"
            />
            <span className="w-9 text-right text-foreground">{Math.round(volumeTransparency * 100)}%</span>
          </label>
        )}
      </div>
    </Panel>
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LayoutGrid className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight">Raummoden-Analyse</h1>
            <p className="text-[11px] text-muted-foreground">Modale Superposition · Subwoofer-Positionierung</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-1 md:flex" role="group" aria-label="Panels ein- und ausblenden">
            <IconButton label="Eingaben" active={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="2D-Draufsicht" active={visible.top} onClick={() => togglePanel('top')}>
              <Map className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="3D-Modell" active={visible.three} onClick={() => togglePanel('three')}>
              <Box className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Frequenzgang" active={visible.response} onClick={() => togglePanel('response')}>
              <LineChart className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Modentabelle" active={visible.modes} onClick={() => togglePanel('modes')}>
              <Table2 className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="PEQ-Filter" active={visible.peq} onClick={() => togglePanel('peq')}>
              <AudioLines className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="2D und 3D tauschen" active={swapViews} onClick={() => setSwapViews((v) => !v)}>
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <button
            type="button"
            onClick={handleExportJson}
            title="Raum, Eckpunkte, Subwoofer & Hörplatz als JSON exportieren"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">JSON</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await handleCopyShareLink()
              if (ok) {
                setHeaderCopied(true)
                window.setTimeout(() => setHeaderCopied(false), 2000)
              }
            }}
            title="Teilbaren Link mit Raum, Subwoofern und Hörplatz kopieren"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {headerCopied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{headerCopied ? 'Kopiert' : 'Teilen'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            PDF-Bericht
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside
          className={cn(
            'border-b border-border bg-sidebar lg:w-[340px] lg:shrink-0 lg:border-b-0 lg:border-r',
            !sidebarOpen && 'lg:hidden',
          )}
        >
          <details className="group lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Eingaben
              <span className="text-[11px] normal-case tracking-normal group-open:hidden">anzeigen</span>
              <span className="hidden text-[11px] normal-case tracking-normal group-open:inline">ausblenden</span>
            </summary>
            <SidebarContent
              room={room}
              onRoomChange={handleRoomChange}
              settings={settings}
              onSettingsChange={setSettings}
              subs={subs}
              onSubsChange={setSubs}
              obstacles={obstacles}
              onObstaclesChange={setObstacles}
              selectedObstacleId={selectedObstacleId}
              onSelectObstacle={setSelectedObstacleId}
              listening={listening}
              onListeningChange={setListening}
              selectedId={selectedSubId}
              onSelect={setSelectedSubId}
              planTool={planTool}
              onPlanToolChange={handlePlanToolChange}
              snapStep={snapStep}
              onSnapStepChange={setSnapStep}
              selectedVertexIdx={selectedVertexIdx}
              onSelectVertex={setSelectedVertexIdx}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              activeProjectId={activeProjectId}
              savedProjects={savedProjects}
              onSaveProject={handleSaveProject}
              onLoadProject={(p) => applySnapshot(p, p.id)}
              onOverwriteProject={handleOverwriteProject}
              onDeleteProject={handleDeleteProject}
              onImportProject={(d) => applySnapshot(d, null)}
              onExportJson={handleExportJson}
              onCopyShareLink={handleCopyShareLink}
              optimizerCount={optimizerCount}
              onOptimizerCountChange={(n) => {
                setOptimizerCount(n)
                setSuggestions([])
                setPinnedPreviewId(null)
                setHoveredPreviewId(null)
              }}
              suggestions={suggestions}
              optimizing={optimizing}
              optimizerStale={optimizerStale}
              currentMetrics={currentMetrics}
              activePreviewId={activePreviewId}
              onHoverPreview={setHoveredPreviewId}
              onSelectPreview={setPinnedPreviewId}
              onOptimize={handleOptimizePlacements}
              onApplySuggestion={handleApplySuggestion}
              canRestorePrevious={Boolean(previousSubsSnapshot)}
              onRestorePrevious={handleRestorePreviousSubs}
            />
          </details>
          <div className="hidden lg:sticky lg:top-[53px] lg:block lg:max-h-[calc(100svh-53px)] lg:overflow-y-auto">
            <SidebarContent
              room={room}
              onRoomChange={handleRoomChange}
              settings={settings}
              onSettingsChange={setSettings}
              subs={subs}
              onSubsChange={setSubs}
              obstacles={obstacles}
              onObstaclesChange={setObstacles}
              selectedObstacleId={selectedObstacleId}
              onSelectObstacle={setSelectedObstacleId}
              listening={listening}
              onListeningChange={setListening}
              selectedId={selectedSubId}
              onSelect={setSelectedSubId}
              planTool={planTool}
              onPlanToolChange={handlePlanToolChange}
              snapStep={snapStep}
              onSnapStepChange={setSnapStep}
              selectedVertexIdx={selectedVertexIdx}
              onSelectVertex={setSelectedVertexIdx}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              activeProjectId={activeProjectId}
              savedProjects={savedProjects}
              onSaveProject={handleSaveProject}
              onLoadProject={(p) => applySnapshot(p, p.id)}
              onOverwriteProject={handleOverwriteProject}
              onDeleteProject={handleDeleteProject}
              onImportProject={(d) => applySnapshot(d, null)}
              onExportJson={handleExportJson}
              onCopyShareLink={handleCopyShareLink}
              optimizerCount={optimizerCount}
              onOptimizerCountChange={(n) => {
                setOptimizerCount(n)
                setSuggestions([])
                setPinnedPreviewId(null)
                setHoveredPreviewId(null)
              }}
              suggestions={suggestions}
              optimizing={optimizing}
              optimizerStale={optimizerStale}
              currentMetrics={currentMetrics}
              activePreviewId={activePreviewId}
              onHoverPreview={setHoveredPreviewId}
              onSelectPreview={setPinnedPreviewId}
              onOptimize={handleOptimizePlacements}
              onApplySuggestion={handleApplySuggestion}
              canRestorePrevious={Boolean(previousSubsSnapshot)}
              onRestorePrevious={handleRestorePreviousSubs}
            />
          </div>
        </aside>

        <main className="grid flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-2">
          {swapViews ? (
            <>
              {threePanel}
              {topPanel}
            </>
          ) : (
            <>
              {topPanel}
              {threePanel}
            </>
          )}

          {visible.response && (
            <Panel
              title="Frequenzgang"
              subtitle={
                probe
                  ? 'Mauszeiger-Position (gestrichelt) vs. Hörplatz'
                  : undampedResponse && peakReductionDb >= 0.1
                    ? `Am Hörplatz · Möbeldämpfung −${peakReductionDb.toFixed(1)} dB Peak`
                    : 'Am definierten Hörplatz'
              }
              actions={
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Modenmarker im Diagramm">
                  {hasDampedObstacles && (
                    <button
                      type="button"
                      aria-pressed={showUndampedBaseline}
                      onClick={() => setShowUndampedBaseline((v) => !v)}
                      title="Referenzkurve ohne Möbeldämpfung ein-/ausblenden"
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                        showUndampedBaseline
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Ohne Dämpfung
                    </button>
                  )}
                  {(['axial', 'tangential', 'oblique'] as ModeType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={markerTypes.has(t)}
                      onClick={() =>
                        setMarkerTypes((prev) => {
                          const n = new Set(prev)
                          if (n.has(t)) n.delete(t)
                          else n.add(t)
                          return n
                        })
                      }
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize transition-colors',
                        markerTypes.has(t) ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground',
                      )}
                    >
                      {t === 'oblique' ? 'schräg' : t}
                    </button>
                  ))}
                </div>
              }
              className="h-[460px]"
              bodyClassName="flex flex-col gap-2"
            >
              <FrequencyResponseChart
                listeningData={listeningResponse}
                baselineData={undampedResponse}
                probeData={probeResponse}
                peqData={showPeqOverlay && visible.peq ? peqCorrectedResponse : null}
                previewData={activePreview?.response ?? null}
                previewLabel={activePreview ? `Vorschlag ${activePreview.rank}` : 'Vorschlag'}
                modes={modes}
                fMin={settings.fMin}
                fMax={settings.fMax}
                highlightFrequency={
                  heatMode === 'frequency' || heatMode === 'wave' ? clampedHeatFrequency : activeMode?.f ?? null
                }
                markerTypes={markerTypes}
              />
              <ModeMarkerLegend
                showBaseline={Boolean(undampedResponse)}
                showPeq={showPeqOverlay && visible.peq}
                showPreview={Boolean(activePreview)}
              />
            </Panel>
          )}

          {visible.modes && (
            <Panel
              title="Modenübersicht"
              subtitle={`${modes.length} Moden zwischen ${settings.fMin} und ${settings.fMax} Hz`}
              className="h-[460px]"
            >
              <ModeTable
                modes={modes}
                roomShape={room.shape}
                baseEta={deferredSettings.eta}
                selectedModeId={activeMode?.id ?? null}
                onSelectMode={(m) => {
                  if (m) setSweepActive(false)
                  handleSelectMode(m)
                }}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
              />
            </Panel>
          )}

          {visible.peq && (
            <Panel
              title="PEQ-Filter-Vorschläge"
              subtitle="Automatische Entzerrung am Hörplatz · Equalizer APO / miniDSP Export"
              className="min-h-[360px] xl:col-span-2"
            >
              <PeqPanel
                filters={effectivePeqFilters}
                metrics={peqMetrics}
                options={peqOptions}
                onOptionsChange={(next) => {
                  setDisabledPeqIds(new Set())
                  setPeqOptions(next)
                }}
                onToggleFilter={(id) =>
                  setDisabledPeqIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                onInspectFrequency={(freq) => {
                  setSweepActive(false)
                  setWavePlaying(false)
                  setHeatMode('frequency')
                  setShowHeatmap(true)
                  setHeatFrequency(freq)
                }}
                showOverlay={showPeqOverlay}
                onToggleOverlay={() => setShowPeqOverlay((v) => !v)}
              />
            </Panel>
          )}
        </main>
      </div>
    </div>
  )
}

interface SidebarContentProps {
  room: RoomConfig
  onRoomChange: (r: RoomConfig) => void
  settings: AnalysisSettings
  onSettingsChange: (s: AnalysisSettings) => void
  subs: Subwoofer[]
  onSubsChange: (s: Subwoofer[]) => void
  obstacles: RoomObstacle[]
  onObstaclesChange: (o: RoomObstacle[]) => void
  selectedObstacleId: string | null
  onSelectObstacle: (id: string | null) => void
  listening: ListeningPoint
  onListeningChange: (p: ListeningPoint) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  planTool: PlanTool
  onPlanToolChange: (tool: PlanTool) => void
  snapStep: number
  onSnapStepChange: (step: number) => void
  selectedVertexIdx: number | null
  onSelectVertex: (idx: number | null) => void
  projectName: string
  onProjectNameChange: (name: string) => void
  activeProjectId: string | null
  savedProjects: RoomProject[]
  onSaveProject: (asNew?: boolean) => void
  onLoadProject: (project: RoomProject) => void
  onOverwriteProject: (id: string) => void
  onDeleteProject: (id: string) => void
  onImportProject: (data: Omit<RoomProject, 'id' | 'updatedAt'>) => void
  onExportJson: () => void
  onCopyShareLink: () => Promise<boolean>
  optimizerCount: 1 | 2 | 3 | 4
  onOptimizerCountChange: (n: 1 | 2 | 3 | 4) => void
  suggestions: PlacementSuggestion[]
  optimizing: boolean
  optimizerStale: boolean
  currentMetrics: PlacementMetrics | null
  activePreviewId: string | null
  onHoverPreview: (id: string | null) => void
  onSelectPreview: (id: string | null) => void
  onOptimize: () => void
  onApplySuggestion: (suggestion: PlacementSuggestion) => void
  canRestorePrevious: boolean
  onRestorePrevious: () => void
}

function SidebarContent(props: SidebarContentProps) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Panel key="room" title="Raum" subtitle="Numerische Eingabe, 2 Dezimalstellen">
        <RoomForm
          room={props.room}
          onRoomChange={props.onRoomChange}
          settings={props.settings}
          onSettingsChange={props.onSettingsChange}
          planTool={props.planTool}
          onPlanToolChange={props.onPlanToolChange}
          snapStep={props.snapStep}
          onSnapStepChange={props.onSnapStepChange}
          selectedVertexIdx={props.selectedVertexIdx}
          onSelectVertex={props.onSelectVertex}
        />
      </Panel>
      <Panel key="furniture" title="Einrichtung & Hindernisse" subtitle="Möbel & Absorber · automatische Modendämpfung & 3D-Feld">
        <FurniturePanel
          room={props.room}
          obstacles={props.obstacles}
          onObstaclesChange={props.onObstaclesChange}
          selectedId={props.selectedObstacleId}
          onSelect={props.onSelectObstacle}
        />
      </Panel>
      <Panel key="subwoofers" title="Subwoofer" subtitle="Bis zu 4 Quellen · Position, Pegel, Phase">
        <SubwooferPanel
          room={props.room}
          subs={props.subs}
          onSubsChange={props.onSubsChange}
          listening={props.listening}
          onListeningChange={props.onListeningChange}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          optimizerCount={props.optimizerCount}
          onOptimizerCountChange={props.onOptimizerCountChange}
          suggestions={props.suggestions}
          optimizing={props.optimizing}
          optimizerStale={props.optimizerStale}
          currentMetrics={props.currentMetrics}
          activePreviewId={props.activePreviewId}
          onHoverPreview={props.onHoverPreview}
          onSelectPreview={props.onSelectPreview}
          onOptimize={props.onOptimize}
          onApplySuggestion={props.onApplySuggestion}
          canRestorePrevious={props.canRestorePrevious}
          onRestorePrevious={props.onRestorePrevious}
        />
      </Panel>
      <Panel key="project" title="Speichern & Export" subtitle="Eckpunkte, Subwoofer & Hörplatz">
        <ProjectPanel
          projectName={props.projectName}
          onProjectNameChange={props.onProjectNameChange}
          activeProjectId={props.activeProjectId}
          savedProjects={props.savedProjects}
          onSaveProject={props.onSaveProject}
          onLoadProject={props.onLoadProject}
          onOverwriteProject={props.onOverwriteProject}
          onDeleteProject={props.onDeleteProject}
          onImportProject={props.onImportProject}
          onExportJson={props.onExportJson}
          onCopyShareLink={props.onCopyShareLink}
          room={props.room}
          subs={props.subs}
          listening={props.listening}
          settings={props.settings}
        />
      </Panel>
    </div>
  )
}
