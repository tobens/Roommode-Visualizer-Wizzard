'use client'

import { useRef, useState } from 'react'
import { Check, Download, FolderOpen, Link2, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { getRoomArea, getRoomPolygon, type AnalysisSettings, type ListeningPoint, type RoomConfig, type Subwoofer } from '@/lib/acoustics'
import { normalizeProjectData, type RoomProject } from '@/lib/room-storage'
import { cn } from '@/lib/utils'

interface ProjectPanelProps {
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
  room: RoomConfig
  subs: Subwoofer[]
  listening: ListeningPoint
  settings: AnalysisSettings
}

export function ProjectPanel({
  projectName,
  onProjectNameChange,
  activeProjectId,
  savedProjects,
  onSaveProject,
  onLoadProject,
  onOverwriteProject,
  onDeleteProject,
  onImportProject,
  onExportJson,
  onCopyShareLink,
}: ProjectPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const flash = (type: 'ok' | 'err', text: string) => {
    setStatus({ type, text })
    window.setTimeout(() => {
      setStatus((cur) => (cur?.text === text ? null : cur))
    }, 3200)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const normalized = normalizeProjectData(parsed)
      if (!normalized) {
        flash('err', 'Ungültiges Raum-JSON: Grundrissdaten fehlen oder sind fehlerhaft.')
        return
      }
      onImportProject(normalized)
      flash('ok', `„${normalized.name}“ geladen`)
    } catch {
      flash('err', 'Datei konnte nicht als JSON gelesen werden.')
    }
  }

  const handleCopy = async () => {
    const ok = await onCopyShareLink()
    if (ok) {
      setCopied(true)
      flash('ok', 'Link in Zwischenablage kopiert')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      flash('ok', 'URL-Hash aktualisiert')
    }
  }

  const activeProject = savedProjects.find((p) => p.id === activeProjectId) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name-input" className="text-xs text-muted-foreground">
          Projektname
        </label>
        <div className="flex gap-1.5">
          <input
            id="project-name-input"
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="z. B. Wohnzimmer L-Form"
            maxLength={60}
            className="min-w-0 flex-1 rounded-md border border-input bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              onSaveProject(false)
              flash('ok', activeProject ? 'Gespeicherten Raum aktualisiert' : 'Raum im Browser gespeichert')
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Save className="h-3.5 w-3.5" />
            {activeProject ? 'Aktualisieren' : 'Speichern'}
          </button>
        </div>
        {activeProject && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">Aktiv: {activeProject.name}</span>
            <button
              type="button"
              onClick={() => {
                onSaveProject(true)
                flash('ok', 'Als neuen Eintrag gespeichert')
              }}
              className="shrink-0 text-primary hover:underline"
            >
              Als Kopie speichern
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => {
            onExportJson()
            flash('ok', 'JSON-Datei exportiert')
          }}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Download className="h-3.5 w-3.5" />
          JSON
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Link2 className="h-3.5 w-3.5" />}
          {copied ? 'Kopiert' : 'Link'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="sr-only"
          aria-label="Raumplan JSON-Datei importieren"
        />
      </div>

      {status && (
        <div
          role="status"
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-[11px]',
            status.type === 'err'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-primary/40 bg-primary/10 text-primary',
          )}
        >
          {status.text}
        </div>
      )}

      {savedProjects.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Gespeicherte Räume ({savedProjects.length})</span>
          <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {savedProjects.map((p) => {
              const isActive = p.id === activeProjectId
              const area = getRoomArea(p.room)
              const polyCount = getRoomPolygon(p.room).length
              const shapeLabel =
                p.room.shape === 'polygon' ? `Raumplan (${polyCount} Ecken)` : p.room.shape === 'lshape' ? 'L-Form' : 'Rechteck'
              return (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md border bg-surface/60 px-2.5 py-2 transition-colors',
                    isActive ? 'border-primary/60 bg-primary/5' : 'border-border',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{p.name}</div>
                    <div className="tabular truncate font-mono text-[10px] text-muted-foreground">
                      {shapeLabel} · {area.toFixed(1)} m² · {p.subs.length} Sub{p.subs.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onLoadProject(p)
                        flash('ok', `„${p.name}“ geladen`)
                      }}
                      title="Raum, Subwoofer & Hörplatz laden"
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      <FolderOpen className="h-3 w-3" />
                      Laden
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onOverwriteProject(p.id)
                        flash('ok', `„${p.name}“ überschrieben`)
                      }}
                      aria-label={`„${p.name}“ mit aktuellem Stand überschreiben`}
                      title="Mit aktuellem Stand überschreiben"
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(p.id)}
                      aria-label={`„${p.name}“ löschen`}
                      title="Löschen"
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Speichert Raumform bzw. alle Eckpunkte zusammen mit Subwoofer-Positionen, Hörplatz und Analyse-Parametern lokal im Browser oder als JSON-Datei.
        </p>
      )}
    </div>
  )
}
