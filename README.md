# Raummoden-Visualisierer / Room Mode Visualizer

Ein interaktives Webtool zur Analyse und Visualisierung von Raummoden, Schalldruckverteilungen und Subwoofer-Positionen.

An interactive web application for analyzing and visualizing room modes, sound-pressure distributions, and subwoofer placement.

**Live-Demo / Live demo:** https://v0-roommode-visualizer-wizzard-omega.vercel.app/
---

# 🇩🇪 Deutsch

## Überblick

Der **Raummoden-Visualisierer** unterstützt bei der Untersuchung tieffrequenter akustischer Probleme in Hör- und Heimkinoräumen. Raumgeometrie, Hörposition, Subwoofer, Möbel und Analyseparameter können direkt im Browser definiert und anschließend visualisiert werden.

Die Anwendung unterstützt rechteckige Räume ebenso wie L-förmige und frei gezeichnete Raumpläne. Für nicht rechteckige Geometrien steht eine 2D-FEM-Berechnung auf Basis eines Helmholtz-Solvers zur Verfügung.

Die Anwendung ist als **Next.js-/React-/TypeScript-Webanwendung** umgesetzt und läuft für die normalen Berechnungen vollständig im Browser.

## Funktionen

- Analyse von **axialen, tangentialen und obliquen Raummoden**
- Rechteckige Räume
- L-förmige Räume
- Freie Raumpläne mit Polygon-Editor
- Vorlagen für Rechteck, L-Form, U-Form und Trapez
- Raster-Snap beim Bearbeiten von Raumplänen
- 2D-FEM-Analyse für nicht rechteckige Räume
- 3D-Darstellung des Raumes
- Draufsicht des Raumes
- Interaktive **Schalldruck-/Heatmap-Darstellung**
- Frequenzgang am Hörplatz
- Anzeige einzelner Moden und ihrer Druckverteilung
- Moden-Tabelle mit Filterung nach Modentyp und Frequenzbereich
- Bis zu **vier Subwoofer**
- Einstellbare Position, Höhe, Pegel und Phase der Subwoofer
- Frei definierbare Hörposition
- Automatische **Subwoofer-Positionsoptimierung**
- Vergleich alternativer Subwoofer-Aufstellungen
- Möbel und akustisch relevante Objekte
- Berücksichtigung von Möbel-/Absorber-Dämpfung
- PEQ-Vorschläge zur Reduzierung von Überhöhungen
- Export von Equalizer-APO-Filtern
- Speichern von Raumprojekten im Browser
- JSON-Export und JSON-Import
- Teilen eines Raumplans über einen URL-Link
- PDF-Bericht mit Raumdaten, Heatmap, Frequenzgang und Modenübersicht

## Voraussetzungen

Benötigt werden:

- **Node.js 20.9 oder neuer**
- **pnpm** (empfohlen)
- Ein moderner Browser wie Chrome, Edge, Firefox oder Safari
- Git zum Klonen des Repositories

Für den normalen lokalen Betrieb ist keine Datenbank und kein separater Backend-Server erforderlich.

## Installation

### 1. Repository klonen

~~~bash
git clone https://github.com/tobens/Raummoden-Visualisierer.git
cd Raummoden-Visualisierer
~~~

### 2. Abhängigkeiten installieren

~~~bash
pnpm install
~~~

Falls pnpm noch nicht installiert ist:

~~~bash
corepack enable
corepack prepare pnpm@latest --activate
~~~

Danach:

~~~bash
pnpm install
~~~

### 3. Entwicklungsserver starten

~~~bash
pnpm dev
~~~

Anschließend im Browser öffnen:

**http://localhost:3000**

Der Entwicklungsserver bindet auf allen Interfaces, sodass die Anwendung bei Bedarf auch von einem anderen Gerät im lokalen Netzwerk erreichbar sein kann.

## Produktionsversion

Produktions-Build erstellen:

~~~bash
pnpm build
~~~

Produktionsserver starten:

~~~bash
pnpm start
~~~

Danach ist die Anwendung standardmäßig unter **http://localhost:3000** erreichbar.

## Bedienung

### 1. Raum definieren

Im Bereich **Grundriss** kann zwischen folgenden Geometrien gewählt werden:

- **Rechteck** – Länge, Breite und Höhe eingeben
- **L-Form** – zwei Raumsegmente definieren
- **Raumplan** – einen freien Polygon-Grundriss bearbeiten oder zeichnen

Der Raumplan-Editor bietet:

- Eckpunkte verschieben
- X-/Y-Koordinaten numerisch bearbeiten
- Eckpunkte hinzufügen oder entfernen
- Raster-Snap mit 5 cm, 10 cm oder 25 cm
- 90°-Drehung
- Vorlagen für Rechteck, L-Form, U-Form und Trapez

Die Anwendung prüft die Geometrie und weist auf ungültige bzw. sich überschneidende Wände hin.

### 2. Analyseparameter

Wichtige Parameter sind:

| Parameter | Bedeutung |
|---|---|
| Ohrhöhe | Höhe der betrachteten horizontalen Schnittebene |
| Schallgeschwindigkeit | Schallgeschwindigkeit in m/s |
| Modale Dämpfung η | Dämpfungsparameter der Moden |
| Max. Modenindex n | Maximale Ordnung der berechneten Moden |
| f min / f max | Frequenzbereich der Analyse |

### 3. Hörposition

Die Hörposition kann direkt in der Draufsicht gesetzt oder über X-/Y-Koordinaten eingegeben werden.

Die Frequenzantwort bezieht sich auf diese Hörposition und die eingestellte Ohrhöhe.

### 4. Subwoofer

Es können bis zu vier Subwoofer definiert werden.

Für jeden Subwoofer können eingestellt werden:

- X-Position
- Y-Position
- Z-Position
- Pegel/Gain
- Phase 0° oder 180°
- Aktiv/deaktiviert

Die Positionen werden automatisch innerhalb der Raumgeometrie begrenzt.

### 5. Subwoofer-Optimierung

Über **Beste Positionen berechnen** kann die Anwendung alternative Aufstellungen untersuchen.

Als Zielanzahl können 1 bis 4 Subwoofer gewählt werden. Die Vorschläge werden anhand der resultierenden Pegelverteilung bewertet.

Angezeigt werden unter anderem:

- maximale Überhöhung
- Pegelspanne
- Standardabweichung
- Positionen und Phasen der Subwoofer

Eine vorgeschlagene Aufstellung kann übernommen oder die vorherige Aufstellung wiederhergestellt werden.

### 6. Möbel und akustische Objekte

Unterstützte Objekte umfassen unter anderem:

- Sofa
- L-Sofa
- Regal
- Schrank
- Tisch
- Säule
- Bass Trap

Position und Abmessungen können angepasst werden. Möbel und Absorber können bei der Modellierung der Modendämpfung berücksichtigt werden.

### 7. Heatmap

Die Heatmap zeigt die berechnete Schalldruckverteilung auf der eingestellten horizontalen Schnittebene.

Eine bestimmte Frequenz kann ausgewählt werden, um deren räumliche Druckverteilung zu untersuchen. Einzelne Moden können ebenfalls direkt visualisiert werden.

### 8. Moden-Tabelle

Die Moden-Tabelle listet die berechneten Moden nach Frequenz.

Filter:

- Axial
- Tangential
- Oblique
- frei wählbarer Frequenzbereich

Bei rechteckigen Räumen werden die Moden über nx, ny und nz beschrieben.

Bei L-förmigen und freien Raumplänen werden die nicht rechteckigen Moden über die 2D-FEM-Berechnung bestimmt.

Ein Klick auf eine Mode zeigt deren Druckverteilung auf der Schnittebene.

### 9. Frequenzgang

Der Frequenzgang zeigt den relativen Pegel am Hörplatz über den analysierten Frequenzbereich und hilft dabei, problematische Überhöhungen und Einbrüche im Bassbereich zu erkennen.

### 10. PEQ / Equalizer APO

Aus analysierten Überhöhungen können parametrische EQ-Filter abgeleitet werden.

Angezeigt werden:

- Filtertyp
- Frequenz
- Gain
- Q-Faktor

Die Filter können kopiert oder als **Equalizer-APO-.txt-Datei** exportiert werden.

> Die vorgeschlagenen EQ-Filter sollten als Ausgangspunkt betrachtet und idealerweise mit realen Messungen, z. B. aus REW, überprüft werden.

## Projekte speichern und teilen

Raumprojekte können direkt im Browser gespeichert werden.

Gespeichert werden unter anderem:

- Raumgeometrie
- Raumhöhe
- Subwoofer
- Hörposition
- Analyseparameter
- Möbel/Objekte
- Sweet-Spot-Einstellungen

### JSON-Export

Ein Projekt kann als JSON-Datei exportiert und später wieder importiert werden.

### Teilen per Link

Die Anwendung kann die aktuellen Projektdaten in einem URL-Hash codieren. Dadurch kann ein Raumplan über einen Link weitergegeben werden, ohne dass ein Serverprojekt angelegt werden muss.

## PDF-Bericht

Die Berichtsfunktion erzeugt ein PDF mit:

1. Raumgeometrie
2. Raumfläche und Volumen
3. Schallgeschwindigkeit und Dämpfung
4. Subwoofer-Positionen
5. Draufsicht
6. Schalldruck-Heatmap
7. Frequenzgang
8. Raummoden-Tabelle

## Technischer Hintergrund

Für rechteckige Räume werden die Raummoden anhand der Raumabmessungen und Modenindizes berechnet:

~~~text
f = (c / 2) · √((nx / L)² + (ny / W)² + (nz / H)²)
~~~

mit:

- f = Modenfrequenz
- c = Schallgeschwindigkeit
- L = Raumlänge
- W = Raumbreite
- H = Raumhöhe
- nx, ny, nz = Modenindizes

Für L-förmige und frei gezeichnete Grundrisse verwendet die Anwendung eine **2D-FEM-Helmholtz-Berechnung**, da die einfache Rechteckformel für solche Geometrien nicht ausreicht.

Die Anwendung enthält außerdem Berechnungen für:

- modale Superposition
- Frequenzantworten
- Schalldruckfelder
- 2D-Wellen-/FEM-Berechnungen
- Subwoofer-Optimierung
- PEQ-Berechnung
- Möbel-/Absorbermodellierung

## Projektstruktur

~~~text
Raummoden-Visualisierer/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── analyzer/
│   │   ├── controls.tsx
│   │   ├── export-report.ts
│   │   ├── frequency-response-chart.tsx
│   │   ├── furniture-panel.tsx
│   │   ├── heatmap-controls.tsx
│   │   ├── mode-table.tsx
│   │   ├── peq-panel.tsx
│   │   ├── project-panel.tsx
│   │   ├── room-3d.tsx
│   │   ├── room-form.tsx
│   │   ├── room-mode-analyzer.tsx
│   │   ├── subwoofer-panel.tsx
│   │   └── top-view.tsx
│   └── ui/
├── lib/
│   ├── acoustics.ts
│   ├── fem2d.ts
│   ├── furniture.ts
│   ├── marching-cubes.ts
│   ├── peq.ts
│   ├── room-storage.ts
│   ├── subwoofer-optimizer.ts
│   ├── utils.ts
│   └── wave2d.ts
├── public/
├── next.config.mjs
├── package.json
├── pnpm-lock.yaml
├── postcss.config.mjs
└── tsconfig.json
~~~

## Verwendete Technologien

- Next.js
- React
- TypeScript
- Tailwind CSS
- Three.js
- React Three Fiber
- Recharts
- jsPDF
- Lucide React
- pnpm

## Fehlerbehebung

### pnpm wird nicht gefunden

~~~bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
~~~

### Port 3000 ist bereits belegt

~~~bash
pnpm exec next dev -p 3001 -H 0.0.0.0
~~~

### Abhängigkeiten sind beschädigt

Den Ordner node_modules löschen und anschließend neu installieren:

~~~bash
rm -rf node_modules
pnpm install
~~~

Unter Windows kann der Ordner node_modules alternativ manuell gelöscht werden.

### Build schlägt fehl

~~~bash
node --version
pnpm --version
pnpm install
pnpm build
~~~

## Hinweis zur Genauigkeit

Der Raummoden-Visualisierer ist ein **Berechnungs- und Visualisierungswerkzeug** und ersetzt keine akustische Messung.

Die tatsächliche Wiedergabe kann unter anderem durch Wand- und Deckenaufbau, Türen, Fenster, Absorption, Diffusion, Möbel, Lautsprechercharakteristik, Subwoofer-Laufzeiten und reale Aufstellung beeinflusst werden.

Für die praktische Optimierung empfiehlt sich daher die Kombination aus Simulation und Messungen, beispielsweise mit **Room EQ Wizard (REW)**.

## Lizenz

Im Repository ist derzeit keine Open-Source-Lizenz hinterlegt. Die Nutzung und Weitergabe des Quellcodes richtet sich daher nach den Rechten des Repository-Eigentümers.

---

# 🇬🇧 English

## Overview

**Room Mode Visualizer** is an interactive web application for analyzing and visualizing low-frequency room acoustics, room modes, sound-pressure distributions, and subwoofer placement.

Room geometry, listening position, subwoofers, furniture, and analysis parameters can be configured directly in the browser.

The application supports rectangular rooms as well as L-shaped and custom polygon room plans. Non-rectangular geometries can be analyzed using a 2D FEM Helmholtz solver.

The application is implemented as a **Next.js / React / TypeScript web application** and normally runs entirely in the browser.

## Features

- Analysis of **axial, tangential, and oblique room modes**
- Rectangular rooms
- L-shaped rooms
- Free polygon-based room plans
- Rectangle, L-shape, U-shape, and trapezoid presets
- Grid snapping while editing room plans
- 2D FEM analysis for non-rectangular rooms
- 3D room visualization
- Top-down room view
- Interactive **sound-pressure heatmaps**
- Frequency-response analysis at the listening position
- Individual room-mode visualization
- Mode table with mode-type and frequency filtering
- Up to **four subwoofers**
- Adjustable subwoofer position, height, gain, and phase
- Configurable listening position
- Automatic **subwoofer placement optimization**
- Comparison of alternative subwoofer layouts
- Furniture and acoustically relevant room objects
- Furniture/absorber damping
- PEQ suggestions for reducing modal peaks
- Equalizer APO filter export
- Browser-based project storage
- JSON import/export
- Shareable room-plan links
- PDF reports containing room data, heatmaps, frequency response, and mode information

## Requirements

You need:

- **Node.js 20.9 or newer**
- **pnpm** (recommended)
- A modern browser such as Chrome, Edge, Firefox, or Safari
- Git for cloning the repository

No database or separate backend server is required for normal local operation.

## Installation

### 1. Clone the repository

~~~bash
git clone https://github.com/tobens/Raummoden-Visualisierer.git
cd Raummoden-Visualisierer
~~~

### 2. Install dependencies

~~~bash
pnpm install
~~~

If pnpm is not installed yet:

~~~bash
corepack enable
corepack prepare pnpm@latest --activate
~~~

Then run:

~~~bash
pnpm install
~~~

### 3. Start the development server

~~~bash
pnpm dev
~~~

Open:

**http://localhost:3000**

The development server listens on all interfaces, so the application can also be accessed from another device on the local network if required.

## Production build

Create a production build:

~~~bash
pnpm build
~~~

Start the production server:

~~~bash
pnpm start
~~~

The application will normally be available at **http://localhost:3000**.

## Usage

### 1. Define the room

Under **Room Plan**, choose:

- **Rectangle** – enter length, width, and height
- **L-shape** – define two room segments
- **Room Plan** – create or edit a custom polygon

The editor provides:

- Vertex editing
- Numeric X/Y coordinate input
- Adding and removing vertices
- 5 cm, 10 cm, or 25 cm grid snapping
- 90° rotation
- Rectangle, L-shape, U-shape, and trapezoid presets

The application validates the geometry and reports invalid or self-intersecting room plans.

### 2. Configure analysis parameters

Available parameters include:

| Parameter | Description |
|---|---|
| Ear height | Height of the horizontal analysis plane |
| Speed of sound | Speed of sound in m/s |
| Modal damping η | Modal damping parameter |
| Maximum mode index n | Maximum calculated mode order |
| f min / f max | Analysis frequency range |

### 3. Set the listening position

The listening position can be placed directly in the top view or entered numerically using X/Y coordinates.

The frequency response is calculated for this position and the configured ear height.

### 4. Add subwoofers

Up to four subwoofers can be configured.

For each subwoofer you can set:

- X position
- Y position
- Z position
- Gain
- Phase (0° / 180°)
- Enabled/disabled state

Positions are constrained to the room geometry.

### 5. Optimize subwoofer placement

Use **Calculate Best Positions** to evaluate alternative layouts.

The target number of subwoofers can be set from 1 to 4. Suggestions are evaluated based on the resulting level distribution.

The results include metrics such as:

- maximum peak
- peak-to-dip span
- standard deviation
- subwoofer positions and phases

Suggested layouts can be previewed and applied, and the previous configuration can be restored.

### 6. Add furniture and acoustic objects

Supported objects include:

- Sofa
- L-shaped sofa
- Shelf
- Cabinet
- Table
- Pillar
- Bass trap

Position and dimensions can be adjusted. Furniture and absorber objects can contribute to the modal damping model.

### 7. Analyze the heatmap

The heatmap visualizes the calculated sound-pressure distribution on the selected horizontal plane.

A specific frequency can be selected to inspect its spatial pressure distribution. Individual room modes can also be visualized directly.

### 8. Inspect the mode table

The mode table lists calculated modes by frequency.

Modes can be filtered by:

- Axial
- Tangential
- Oblique
- Frequency range

For rectangular rooms, modes are described using nx, ny, and nz indices.

For L-shaped and custom room plans, non-rectangular modes are calculated using the 2D FEM solver.

Clicking a mode displays its pressure distribution on the analysis plane.

### 9. Frequency response

The frequency-response chart shows the relative level at the selected listening position across the configured frequency range and helps identify problematic low-frequency peaks and dips.

### 10. PEQ / Equalizer APO

Parametric EQ filters can be derived from analyzed peaks.

The application displays:

- Filter type
- Frequency
- Gain
- Q factor

Filters can be copied or exported as an **Equalizer APO .txt file**.

> Treat calculated EQ filters as a starting point and verify them against real measurements, for example with REW.

## Saving and sharing projects

Projects can be saved locally in the browser.

Stored project data includes:

- Room geometry
- Room height
- Subwoofer positions
- Listening position
- Analysis parameters
- Furniture/room objects
- Sweet-spot settings

### JSON export

A project can be exported as a JSON file and imported again later.

### Share links

The application can encode the current project into a URL hash, allowing a room configuration to be shared without creating a server-side project.

## PDF reports

The report function creates a PDF containing:

1. Room geometry
2. Room area and volume
3. Acoustic parameters
4. Subwoofer positions
5. Top view
6. Sound-pressure heatmap
7. Frequency response
8. Room-mode table

## Technical background

For rectangular rooms, room modes are calculated from the room dimensions and modal indices:

~~~text
f = (c / 2) · √((nx / L)² + (ny / W)² + (nz / H)²)
~~~

where:

- f = modal frequency
- c = speed of sound
- L = room length
- W = room width
- H = room height
- nx, ny, nz = modal indices

For L-shaped and custom polygon geometries, the application uses a **2D FEM Helmholtz calculation**, since the simple rectangular-room equation is not sufficient for those geometries.

The application also contains calculations for:

- modal superposition
- frequency responses
- sound-pressure fields
- 2D wave/FEM calculations
- subwoofer optimization
- PEQ calculation
- furniture/absorber modeling

## Project structure

~~~text
Raummoden-Visualisierer/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── analyzer/
│   │   ├── controls.tsx
│   │   ├── export-report.ts
│   │   ├── frequency-response-chart.tsx
│   │   ├── furniture-panel.tsx
│   │   ├── heatmap-controls.tsx
│   │   ├── mode-table.tsx
│   │   ├── peq-panel.tsx
│   │   ├── project-panel.tsx
│   │   ├── room-3d.tsx
│   │   ├── room-form.tsx
│   │   ├── room-mode-analyzer.tsx
│   │   ├── subwoofer-panel.tsx
│   │   └── top-view.tsx
│   └── ui/
├── lib/
│   ├── acoustics.ts
│   ├── fem2d.ts
│   ├── furniture.ts
│   ├── marching-cubes.ts
│   ├── peq.ts
│   ├── room-storage.ts
│   ├── subwoofer-optimizer.ts
│   ├── utils.ts
│   └── wave2d.ts
├── public/
├── next.config.mjs
├── package.json
├── pnpm-lock.yaml
├── postcss.config.mjs
└── tsconfig.json
~~~

## Technologies

- Next.js
- React
- TypeScript
- Tailwind CSS
- Three.js
- React Three Fiber
- Recharts
- jsPDF
- Lucide React
- pnpm

## Troubleshooting

### pnpm command not found

~~~bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
~~~

### Port 3000 is already in use

~~~bash
pnpm exec next dev -p 3001 -H 0.0.0.0
~~~

### Broken dependencies

Remove node_modules and reinstall:

~~~bash
rm -rf node_modules
pnpm install
~~~

On Windows, the node_modules directory can be deleted manually.

### Build errors

~~~bash
node --version
pnpm --version
pnpm install
pnpm build
~~~

## Accuracy and limitations

The Room Mode Visualizer is a **calculation and visualization tool**, not a replacement for acoustic measurements.

Real-world results can be affected by wall and ceiling construction, doors, windows, absorption, diffusion, furniture, loudspeaker characteristics, subwoofer timing and phase, room losses, and actual placement.

For practical optimization, simulation should therefore be combined with measurements, for example using **Room EQ Wizard (REW)**.

## License

No open-source license is currently included in the repository. Use and redistribution of the source code are therefore subject to the rights of the repository owner.

---

## Development

Main development commands:

~~~bash
pnpm install
pnpm dev
pnpm build
pnpm start
~~~

The project uses the main branch as its default branch.

## Repository

https://github.com/tobens/Raummoden-Visualisierer
