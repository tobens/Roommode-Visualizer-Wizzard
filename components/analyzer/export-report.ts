import type {
  AnalysisSettings,
  FrequencyResponsePoint,
  HeatmapGrid,
  ListeningPoint,
  RoomConfig,
  RoomMode,
  Subwoofer,
} from '@/lib/acoustics'
import { MODE_TYPE_LABEL, bipolarColor, getRoomArea, getRoomPerimeter, heatColor, paintHeatmap } from '@/lib/acoustics'

export interface ReportInput {
  room: RoomConfig
  subs: Subwoofer[]
  listening: ListeningPoint
  settings: AnalysisSettings
  modes: RoomMode[]
  grid: HeatmapGrid | null
  heatRangeDb: number
  heatmapDescription: string
  topViewCanvas: HTMLCanvasElement | null
  response: FrequencyResponsePoint[]
}

function upscaledHeatmap(grid: HeatmapGrid, rangeDb: number) {
  const small = document.createElement('canvas')
  paintHeatmap(grid, small, rangeDb)
  const out = document.createElement('canvas')
  const scale = Math.max(1, Math.floor(1200 / grid.cols))
  out.width = grid.cols * scale
  out.height = grid.rows * scale
  const ctx = out.getContext('2d')
  if (!ctx) return out
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, out.width, out.height)
  return out
}

function legendCanvas(bipolar = false) {
  const c = document.createElement('canvas')
  c.width = 600
  c.height = 24
  const ctx = c.getContext('2d')
  if (!ctx) return c
  for (let i = 0; i < c.width; i++) {
    const t = i / (c.width - 1)
    const [r, g, b] = bipolar ? bipolarColor(t) : heatColor(t)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(i, 0, 1, c.height)
  }
  return c
}

function responseCanvas(points: FrequencyResponsePoint[], modes: RoomMode[], fMin: number, fMax: number) {
  const W = 1400
  const H = 520
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const padL = 70
  const padR = 20
  const padT = 20
  const padB = 50
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  const finite = points.filter((p) => Number.isFinite(p.db))
  const yMin = Math.floor(Math.min(-12, ...finite.map((p) => p.db)) / 6) * 6
  const yMax = Math.ceil(Math.max(12, ...finite.map((p) => p.db)) / 6) * 6
  const xOf = (f: number) => padL + ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * (W - padL - padR)
  const yOf = (db: number) => padT + ((yMax - db) / (yMax - yMin)) * (H - padT - padB)

  ctx.strokeStyle = '#e2e2e6'
  ctx.lineWidth = 1
  ctx.font = '18px Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#555'
  ctx.textAlign = 'right'
  for (let db = yMin; db <= yMax; db += 6) {
    ctx.beginPath()
    ctx.moveTo(padL, yOf(db))
    ctx.lineTo(W - padR, yOf(db))
    ctx.stroke()
    ctx.fillText(`${db > 0 ? '+' : ''}${db}`, padL - 8, yOf(db) + 6)
  }
  ctx.textAlign = 'center'
  for (const f of [20, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 300]) {
    if (f < fMin || f > fMax) continue
    ctx.beginPath()
    ctx.moveTo(xOf(f), padT)
    ctx.lineTo(xOf(f), H - padB)
    ctx.stroke()
    ctx.fillText(`${f}`, xOf(f), H - padB + 24)
  }
  ctx.fillText('Hz', W - padR, H - 8)

  for (const m of modes) {
    if (m.type !== 'axial') continue
    ctx.strokeStyle = 'rgba(214,140,20,0.6)'
    ctx.beginPath()
    ctx.moveTo(xOf(m.f), padT)
    ctx.lineTo(xOf(m.f), H - padB)
    ctx.stroke()
  }

  ctx.strokeStyle = '#1b6fb3'
  ctx.lineWidth = 3
  ctx.beginPath()
  points.forEach((p, i) => {
    const y = yOf(Math.max(yMin, Math.min(yMax, p.db)))
    if (i === 0) ctx.moveTo(xOf(p.f), y)
    else ctx.lineTo(xOf(p.f), y)
  })
  ctx.stroke()
  return c
}

export async function exportReport(input: ReportInput) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageW - margin * 2
  let y = margin

  const ensure = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage()
      y = margin
    }
  }

  const heading = (text: string, size = 13) => {
    ensure(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(20)
    doc.text(text, margin, y)
    y += size * 0.55
    doc.setDrawColor(200)
    doc.line(margin, y, pageW - margin, y)
    y += 4
  }

  const row = (label: string, value: string) => {
    ensure(6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(90)
    doc.text(label, margin, y)
    doc.setTextColor(20)
    doc.text(value, margin + 62, y)
    y += 5.5
  }

  // Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(20)
  doc.text('Raummoden-Analyse', margin, y + 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110)
  doc.text(
    `Bericht erstellt am ${new Date().toLocaleString('de-DE')} · Frequenzbereich ${input.settings.fMin}–${input.settings.fMax} Hz`,
    margin,
    y + 10,
  )
  y += 20

  heading('1. Raumgeometrie')
  const { room } = input
  row(
    'Grundriss',
    room.shape === 'rect'
      ? 'Rechteck'
      : room.shape === 'lshape'
        ? 'L-Form (2D-FEM Helmholtz)'
        : `Freier Raumplan (${room.polygon.length} Eckpunkte, 2D-FEM)`,
  )
  if (room.shape === 'rect') {
    row('Länge × Breite × Höhe', `${room.L1.toFixed(2)} m × ${room.W1.toFixed(2)} m × ${room.H.toFixed(2)} m`)
  } else if (room.shape === 'lshape') {
    row('Segment A (L × B × H)', `${room.L1.toFixed(2)} m × ${room.W1.toFixed(2)} m × ${room.H.toFixed(2)} m`)
    row('Segment B (L × T × H)', `${room.L2.toFixed(2)} m × ${room.W2.toFixed(2)} m × ${room.H.toFixed(2)} m`)
    row('Anschluss Segment B', `an Kante y = ${room.W1.toFixed(2)} m, beginnend bei x = 0`)
  } else {
    row('Raumhöhe', `${room.H.toFixed(2)} m`)
    row('Eckpunkte', room.polygon.map((p, i) => `P${i + 1}(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).join(' · '))
  }
  const area = getRoomArea(room)
  const volume = area * room.H
  row('Grundfläche / Umfang', `${area.toFixed(2)} m² · ${getRoomPerimeter(room).toFixed(2)} m`)
  row('Volumen', `${volume.toFixed(2)} m³`)
  row('Schallgeschwindigkeit', `${input.settings.c.toFixed(1)} m/s`)
  row('Modale Dämpfung η', `${input.settings.eta.toFixed(3)} (Q ≈ ${Math.round(1 / input.settings.eta)})`)
  row('Ohrhöhe / Schnittebene', `${input.settings.earHeight.toFixed(2)} m`)
  row('Hörposition', `x ${input.listening.x.toFixed(2)} m · y ${input.listening.y.toFixed(2)} m · z ${input.settings.earHeight.toFixed(2)} m`)
  y += 3

  heading('2. Subwoofer-Positionen')
  if (input.subs.length === 0) row('–', 'Keine Subwoofer platziert')
  for (const s of input.subs) {
    row(
      s.name,
      `x ${s.x.toFixed(2)} m · y ${s.y.toFixed(2)} m · z ${s.z.toFixed(2)} m · ${s.gain >= 0 ? '+' : ''}${s.gain.toFixed(1)} dB · ${s.phase}°${s.enabled ? '' : ' · stumm'}`,
    )
  }
  y += 3

  if (input.topViewCanvas) {
    heading('3. Draufsicht mit Subwoofer-Positionen und Bemaßung')
    const img = input.topViewCanvas.toDataURL('image/png')
    const ratio = input.topViewCanvas.height / input.topViewCanvas.width
    const w = contentW
    const h = w * ratio
    ensure(h + 4)
    doc.addImage(img, 'PNG', margin, y, w, h)
    y += h + 6
  }

  if (input.grid) {
    heading('4. Schalldruckverteilung auf der Hörebene')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(90)
    const desc = doc.splitTextToSize(input.heatmapDescription, contentW)
    ensure(desc.length * 4.5)
    doc.text(desc, margin, y)
    y += desc.length * 4.5 + 2
    const heat = upscaledHeatmap(input.grid, input.heatRangeDb)
    const ratio = heat.height / heat.width
    const w = Math.min(contentW, (pageH - margin - y - 24) / ratio)
    const h = w * ratio
    ensure(h + 18)
    doc.addImage(heat.toDataURL('image/png'), 'PNG', margin, y, w, h)
    doc.setDrawColor(60)
    doc.rect(margin, y, w, h)
    y += h + 4
    const legend = legendCanvas(Boolean(input.grid.bipolar))
    doc.addImage(legend.toDataURL('image/png'), 'PNG', margin, y, contentW, 4)
    y += 7
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    if (input.grid.bipolar) {
      doc.text('-1,0 (-Phase)', margin, y)
      doc.text('0 (Druckknoten)', pageW / 2, y, { align: 'center' })
      doc.text('+1,0 (+Phase)', pageW - margin, y, { align: 'right' })
    } else {
      const bottom = Math.max(input.grid.min, input.grid.max - input.heatRangeDb) - input.grid.max
      doc.text(`${bottom.toFixed(0)} dB (Minimum)`, margin, y)
      doc.text('0 dB (Maximum)', pageW - margin, y, { align: 'right' })
    }
    y += 6
  }

  heading('5. Frequenzgang am Hörplatz')
  {
    const rc = responseCanvas(input.response, input.modes, input.settings.fMin, input.settings.fMax)
    const ratio = rc.height / rc.width
    const h = contentW * ratio
    ensure(h + 4)
    doc.addImage(rc.toDataURL('image/png'), 'PNG', margin, y, contentW, h)
    y += h + 2
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    doc.text('Pegel relativ zum Bandmittelwert (0 dB). Orange Linien: axiale Raummoden.', margin, y + 3)
    y += 8
  }

  heading('6. Raummoden-Übersicht')
  const isFem = room.shape !== 'rect'
  const cols = isFem
    ? [
        { label: 'f [Hz]', w: 24 },
        { label: 'Typ', w: 32 },
        { label: '2D-Mode', w: 22 },
        { label: 'nz', w: 14 },
        { label: 'Δf [Hz]', w: 24 },
      ]
    : [
        { label: 'f [Hz]', w: 22 },
        { label: 'Typ', w: 30 },
        { label: 'nx', w: 12 },
        { label: 'ny', w: 12 },
        { label: 'nz', w: 12 },
        { label: 'Δf [Hz]', w: 22 },
      ]
  const drawHeader = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(60)
    let x = margin
    for (const c of cols) {
      doc.text(c.label, x, y)
      x += c.w
    }
    y += 2
    doc.setDrawColor(180)
    doc.line(margin, y, pageW - margin, y)
    y += 4
  }
  ensure(12)
  drawHeader()
  doc.setFont('helvetica', 'normal')
  input.modes.forEach((m, i) => {
    if (y + 5 > pageH - margin) {
      doc.addPage()
      y = margin
      drawHeader()
      doc.setFont('helvetica', 'normal')
    }
    doc.setFontSize(9)
    doc.setTextColor(m.type === 'axial' ? 20 : 80)
    const next = input.modes[i + 1]
    const vals = isFem
      ? [
          m.f.toFixed(1),
          MODE_TYPE_LABEL[m.type],
          `M${m.femIndex ?? 0}`,
          String(m.nz),
          next ? (next.f - m.f).toFixed(1) : '–',
        ]
      : [
          m.f.toFixed(1),
          MODE_TYPE_LABEL[m.type],
          String(m.nx),
          String(m.ny),
          String(m.nz),
          next ? (next.f - m.f).toFixed(1) : '–',
        ]
    let x = margin
    vals.forEach((v, j) => {
      doc.text(v, x, y)
      x += cols[j].w
    })
    y += 5
  })

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`Seite ${p} / ${pages}`, pageW - margin, pageH - 8, { align: 'right' })
    doc.text(
      isFem
        ? 'Raummoden-Analyse · 2D-FEM Helmholtz-Eigenmoden + vertikale z-Moden'
        : 'Raummoden-Analyse · modale Superposition, Rechteckraum',
      margin,
      pageH - 8,
    )
  }

  doc.save(`raummoden-bericht-${new Date().toISOString().slice(0, 10)}.pdf`)
}
