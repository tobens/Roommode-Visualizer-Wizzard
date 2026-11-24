export interface Point2D {
  x: number
  y: number
}

export interface FemMesh {
  nodes: Point2D[]
  /** Flat index triples [i0, i1, i2, ...] */
  triangles: Int32Array
  /** Bounding box of each triangle for fast point lookup */
  area: number
}

export interface FemMode2D {
  /** 0-based index (0 = Helmholtz constant DC mode) */
  index: number
  /** 2D horizontal cutoff frequency in Hz */
  fxy: number
  /** Node values normalised so (1/A) * integral(psi^2 dA) = 1 */
  values: Float64Array
}

export interface FemObstacleInput {
  polygon: Point2D[]
  /** Effective air-column depth ratio (H - h) / H in [0, 1]; <= 0.06 acts as full-height rigid obstacle */
  depthRatio: number
}

export interface FemSolution {
  polygon: Point2D[]
  mesh: FemMesh
  modes: FemMode2D[]
  c: number
}

export function polygonSignedArea(pts: readonly Point2D[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s * 0.5
}

export function polygonArea(pts: readonly Point2D[]): number {
  return Math.abs(polygonSignedArea(pts))
}

export function polygonPerimeter(pts: readonly Point2D[]): number {
  let p = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    p += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return p
}

export function ensureCCW(pts: readonly Point2D[]): Point2D[] {
  const clean: Point2D[] = []
  for (const p of pts) {
    const prev = clean[clean.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) {
      clean.push({ x: p.x, y: p.y })
    }
  }
  if (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) <= 1e-6) {
    clean.pop()
  }
  if (clean.length < 3) return clean
  return polygonSignedArea(clean) < 0 ? clean.reverse() : clean
}

export function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function closestPointOnSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): Point2D {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: x1, y: y1 }
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / len2))
  return { x: x1 + t * dx, y: y1 + t * dy }
}

export function pointInPolygon(pts: readonly Point2D[], x: number, y: number): boolean {
  if (pts.length < 3) return false
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (distPointToSegment(x, y, a.x, a.y, b.x, b.y) <= 1e-6) return true
  }
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function clampToPolygon(pts: readonly Point2D[], x: number, y: number): Point2D {
  if (pts.length < 3) return { x, y }
  if (pointInPolygon(pts, x, y)) return { x, y }
  let best = { x: pts[0].x, y: pts[0].y }
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const cp = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y)
    const d = (cp.x - x) ** 2 + (cp.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = cp
    }
  }
  return best
}

function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function properSegmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orient2d(a.x, a.y, b.x, b.y, c.x, c.y)
  const o2 = orient2d(a.x, a.y, b.x, b.y, d.x, d.y)
  const o3 = orient2d(c.x, c.y, d.x, d.y, a.x, a.y)
  const o4 = orient2d(c.x, c.y, d.x, d.y, b.x, b.y)
  if (((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9))) {
    return true
  }
  return false
}

export function isSimplePolygon(pts: readonly Point2D[]): boolean {
  if (pts.length < 3) return false
  if (polygonArea(pts) < 0.05) return false
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) return false
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      if (properSegmentsIntersect(a, b, c, d)) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Constrained Delaunay Triangulation (Bowyer-Watson + Cavity Ear-Clipping)
// ---------------------------------------------------------------------------

interface Tri {
  a: number
  b: number
  c: number
}

function circumcircleContains(pts: readonly Point2D[], t: Tri, p: Point2D): boolean {
  const ax = pts[t.a].x - p.x
  const ay = pts[t.a].y - p.y
  const bx = pts[t.b].x - p.x
  const by = pts[t.b].y - p.y
  const cx = pts[t.c].x - p.x
  const cy = pts[t.c].y - p.y
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)
  const ccw = orient2d(pts[t.a].x, pts[t.a].y, pts[t.b].x, pts[t.b].y, pts[t.c].x, pts[t.c].y)
  return ccw > 0 ? det > 1e-12 : det < -1e-12
}

function earClipChain(pts: readonly Point2D[], ring: number[]): Tri[] {
  const out: Tri[] = []
  if (ring.length < 3) return out
  // Ensure CCW order for ear-clipping
  let signed = 0
  for (let i = 0; i < ring.length; i++) {
    const u = pts[ring[i]]
    const v = pts[ring[(i + 1) % ring.length]]
    signed += u.x * v.y - v.x * u.y
  }
  const indices = signed < 0 ? [...ring].reverse() : [...ring]
  let guard = 0
  while (indices.length > 3 && guard < indices.length * indices.length + 10) {
    guard++
    let clipped = false
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length]
      const i1 = indices[i]
      const i2 = indices[(i + 1) % indices.length]
      const p0 = pts[i0]
      const p1 = pts[i1]
      const p2 = pts[i2]
      if (orient2d(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y) <= 1e-10) continue
      let contains = false
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j]
        if (idx === i0 || idx === i1 || idx === i2) continue
        const p = pts[idx]
        const o1 = orient2d(p0.x, p0.y, p1.x, p1.y, p.x, p.y)
        const o2 = orient2d(p1.x, p1.y, p2.x, p2.y, p.x, p.y)
        const o3 = orient2d(p2.x, p2.y, p0.x, p0.y, p.x, p.y)
        if (o1 >= -1e-10 && o2 >= -1e-10 && o3 >= -1e-10) {
          contains = true
          break
        }
      }
      if (!contains) {
        out.push({ a: i0, b: i1, c: i2 })
        indices.splice(i, 1)
        clipped = true
        break
      }
    }
    if (!clipped) break
  }
  if (indices.length === 3) {
    out.push({ a: indices[0], b: indices[1], c: indices[2] })
  }
  return out
}

function edgeKey(u: number, v: number): string {
  return u < v ? `${u}_${v}` : `${v}_${u}`
}

export function triangulatePolygon(
  rawPoly: readonly Point2D[],
  targetNodes = 110,
  obstaclePolygons: readonly Point2D[][] = [],
): FemMesh {
  const poly = ensureCCW(rawPoly)
  const area = polygonArea(poly)
  if (poly.length < 3 || area < 1e-4) {
    return { nodes: [], triangles: new Int32Array(0), area: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  const h = Math.max(0.18, Math.sqrt(area / Math.max(24, targetNodes)))
  const nodes: Point2D[] = []
  const constraints: [number, number][] = []

  // 1. Subdivide boundary edges
  const boundaryIdx: number[] = []
  for (let i = 0; i < poly.length; i++) {
    boundaryIdx.push(nodes.length)
    nodes.push({ x: poly[i].x, y: poly[i].y })
  }

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const iA = boundaryIdx[i]
    const iB = boundaryIdx[(i + 1) % poly.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const segs = Math.max(1, Math.round(len / h))
    let prevIdx = iA
    for (let s = 1; s < segs; s++) {
      const t = s / segs
      const idx = nodes.length
      nodes.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      constraints.push([prevIdx, idx])
      prevIdx = idx
    }
    constraints.push([prevIdx, iB])
  }

  // 1b. Seed interior mesh points along obstacle perimeters so triangles follow furniture edges
  const obsMinSpacing = Math.max(0.08, h * 0.28)
  const pushIfClear = (x: number, y: number, minDist: number) => {
    if (!pointInPolygon(poly, x, y)) return
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      if (distPointToSegment(x, y, a.x, a.y, b.x, b.y) < minDist * 0.75) return
    }
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < minDist) return
    }
    nodes.push({ x, y })
  }

  for (const obsPoly of obstaclePolygons) {
    if (obsPoly.length < 3) continue
    for (let i = 0; i < obsPoly.length; i++) {
      const a = obsPoly[i]
      const b = obsPoly[(i + 1) % obsPoly.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const segs = Math.max(1, Math.round(len / Math.max(0.22, h * 0.7)))
      for (let s = 0; s < segs; s++) {
        const t = s / segs
        pushIfClear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, obsMinSpacing)
      }
    }
  }

  // 2. Interior points on a staggered grid with clearance from walls and existing points
  const rowStep = h * 0.8660254
  const minClear = h * 0.42
  let row = 0
  for (let y = minY + rowStep * 0.5; y < maxY - rowStep * 0.25; y += rowStep, row++) {
    const xOff = (row % 2) * (h * 0.5)
    for (let x = minX + h * 0.5 + xOff; x < maxX - h * 0.25; x += h) {
      if (!pointInPolygon(poly, x, y)) continue
      let tooClose = false
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        if (distPointToSegment(x, y, a.x, a.y, b.x, b.y) < minClear) {
          tooClose = true
          break
        }
      }
      if (!tooClose && obstaclePolygons.length > 0) {
        for (let i = 0; i < nodes.length; i++) {
          if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < obsMinSpacing) {
            tooClose = true
            break
          }
        }
      }
      if (!tooClose) nodes.push({ x, y })
    }
  }

  // 3. Bowyer-Watson Delaunay triangulation
  const dx = maxX - minX
  const dy = maxY - minY
  const dmax = Math.max(dx, dy, 1) * 10
  const midX = (minX + maxX) * 0.5
  const midY = (minY + maxY) * 0.5
  const s0 = nodes.length
  const s1 = nodes.length + 1
  const s2 = nodes.length + 2
  const workPts = [
    ...nodes,
    { x: midX - 2 * dmax, y: midY - dmax },
    { x: midX, y: midY + 2 * dmax },
    { x: midX + 2 * dmax, y: midY - dmax },
  ]
  let tris: Tri[] = [{ a: s0, b: s1, c: s2 }]

  for (let pIdx = 0; pIdx < nodes.length; pIdx++) {
    const p = workPts[pIdx]
    const bad: Tri[] = []
    const good: Tri[] = []
    for (const t of tris) {
      if (circumcircleContains(workPts, t, p)) bad.push(t)
      else good.push(t)
    }
    const edgeCount = new Map<string, [number, number, number]>()
    for (const t of bad) {
      const edges: [number, number][] = [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ]
      for (const [u, v] of edges) {
        const k = edgeKey(u, v)
        const cur = edgeCount.get(k)
        if (cur) cur[2]++
        else edgeCount.set(k, [u, v, 1])
      }
    }
    for (const [, [u, v, cnt]] of edgeCount) {
      if (cnt === 1) {
        if (orient2d(workPts[u].x, workPts[u].y, workPts[v].x, workPts[v].y, p.x, p.y) >= 0) {
          good.push({ a: u, b: v, c: pIdx })
        } else {
          good.push({ a: v, b: u, c: pIdx })
        }
      }
    }
    tris = good
  }

  // Drop super-triangle vertices
  tris = tris.filter((t) => t.a < s0 && t.b < s0 && t.c < s0)

  // 4. Enforce constrained boundary edges via cavity retriangulation
  for (const [ca, cb] of constraints) {
    const key = edgeKey(ca, cb)
    let exists = false
    for (const t of tris) {
      if (edgeKey(t.a, t.b) === key || edgeKey(t.b, t.c) === key || edgeKey(t.c, t.a) === key) {
        exists = true
        break
      }
    }
    if (exists) continue

    const pa = nodes[ca]
    const pb = nodes[cb]
    const intersecting: Tri[] = []
    const remaining: Tri[] = []
    for (const t of tris) {
      const edges: [number, number][] = [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ]
      const hits = edges.some(([u, v]) => {
        if (u === ca || u === cb || v === ca || v === cb) return false
        return properSegmentsIntersect(pa, pb, nodes[u], nodes[v])
      })
      if (hits) intersecting.push(t)
      else remaining.push(t)
    }

    if (intersecting.length === 0) continue

    // Collect boundary of the cavity formed by intersecting triangles
    const boundaryEdges = new Map<string, [number, number]>()
    for (const t of intersecting) {
      const edges: [number, number][] = [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ]
      for (const [u, v] of edges) {
        const k = edgeKey(u, v)
        if (boundaryEdges.has(k)) boundaryEdges.delete(k)
        else boundaryEdges.set(k, [u, v])
      }
    }

    // Order the cavity boundary into a closed ring
    const adj = new Map<number, number[]>()
    for (const [, [u, v]] of boundaryEdges) {
      if (!adj.has(u)) adj.set(u, [])
      if (!adj.has(v)) adj.set(v, [])
      adj.get(u)!.push(v)
      adj.get(v)!.push(u)
    }
    const ring: number[] = [ca]
    let prev = -1
    let curr = ca
    let safety = 0
    while (safety++ < boundaryEdges.size + 5) {
      const nbrs = adj.get(curr) ?? []
      const next = nbrs.find((n) => n !== prev)
      if (next === undefined || next === ca) break
      ring.push(next)
      prev = curr
      curr = next
    }

    const posB = ring.indexOf(cb)
    if (posB > 0) {
      const upper = ring.slice(0, posB + 1)
      const lower = [...ring.slice(posB), ring[0]]
      tris = [...remaining, ...earClipChain(nodes, upper), ...earClipChain(nodes, lower)]
    }
  }

  // 5. Filter out triangles outside the polygon
  const insideTris: number[] = []
  for (const t of tris) {
    const a2 = orient2d(nodes[t.a].x, nodes[t.a].y, nodes[t.b].x, nodes[t.b].y, nodes[t.c].x, nodes[t.c].y)
    if (Math.abs(a2) < 1e-10) continue
    const cx = (nodes[t.a].x + nodes[t.b].x + nodes[t.c].x) / 3
    const cy = (nodes[t.a].y + nodes[t.b].y + nodes[t.c].y) / 3
    if (pointInPolygon(poly, cx, cy)) {
      if (a2 > 0) insideTris.push(t.a, t.b, t.c)
      else insideTris.push(t.a, t.c, t.b)
    }
  }

  return {
    nodes,
    triangles: Int32Array.from(insideTris),
    area,
  }
}

// ---------------------------------------------------------------------------
// Dense Symmetric Generalized Eigenvalue Solver: K * v = lambda * M * v
// ---------------------------------------------------------------------------

/** Householder reduction of real symmetric N x N matrix A to tridiagonal form (d, e). */
function tred2(n: number, z: Float64Array, d: Float64Array, e: Float64Array) {
  for (let i = n - 1; i > 0; i--) {
    const l = i - 1
    let h = 0
    let scale = 0
    if (l > 0) {
      for (let k = 0; k <= l; k++) scale += Math.abs(z[i * n + k])
      if (scale === 0) {
        e[i] = z[i * n + l]
      } else {
        for (let k = 0; k <= l; k++) {
          z[i * n + k] /= scale
          h += z[i * n + k] * z[i * n + k]
        }
        let f = z[i * n + l]
        let g = f >= 0 ? -Math.sqrt(h) : Math.sqrt(h)
        e[i] = scale * g
        h -= f * g
        z[i * n + l] = f - g
        f = 0
        for (let j = 0; j <= l; j++) {
          z[j * n + i] = z[i * n + j] / h
          g = 0
          for (let k = 0; k <= j; k++) g += z[j * n + k] * z[i * n + k]
          for (let k = j + 1; k <= l; k++) g += z[k * n + j] * z[i * n + k]
          e[j] = g / h
          f += e[j] * z[i * n + j]
        }
        const hh = f / (h + h)
        for (let j = 0; j <= l; j++) {
          f = z[i * n + j]
          g = e[j] - hh * f
          e[j] = g
          for (let k = 0; k <= j; k++) z[j * n + k] -= f * e[k] + g * z[i * n + k]
        }
      }
    } else {
      e[i] = z[i * n + l]
    }
    d[i] = h
  }
  d[0] = 0
  e[0] = 0
  for (let i = 0; i < n; i++) {
    const l = i - 1
    if (d[i] !== 0) {
      for (let j = 0; j <= l; j++) {
        let g = 0
        for (let k = 0; k <= l; k++) g += z[i * n + k] * z[k * n + j]
        for (let k = 0; k <= l; k++) z[k * n + j] -= g * z[k * n + i]
      }
    }
    d[i] = z[i * n + i]
    z[i * n + i] = 1
    for (let j = 0; j <= l; j++) {
      z[j * n + i] = 0
      z[i * n + j] = 0
    }
  }
}

/** Implicit QL algorithm on symmetric tridiagonal matrix (d, e), accumulating eigenvectors in z. */
function tql2(n: number, d: Float64Array, e: Float64Array, z: Float64Array) {
  for (let i = 1; i < n; i++) e[i - 1] = e[i]
  e[n - 1] = 0

  for (let l = 0; l < n; l++) {
    let iter = 0
    let m: number
    do {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1])
        if (Math.abs(e[m]) + dd === dd) break
      }
      if (m !== l) {
        if (iter++ === 60) break
        let g = (d[l + 1] - d[l]) / (2 * e[l])
        let r = Math.hypot(g, 1)
        g = d[m] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)))
        let s = 1
        let c = 1
        let p = 0
        let i: number
        for (i = m - 1; i >= l; i--) {
          let f = s * e[i]
          const b = c * e[i]
          r = Math.hypot(f, g)
          e[i + 1] = r
          if (r === 0) {
            d[i + 1] -= p
            e[m] = 0
            break
          }
          s = f / r
          c = g / r
          g = d[i + 1] - p
          r = (d[i] - g) * s + 2 * c * b
          p = s * r
          d[i + 1] = g + p
          g = c * r - b
          for (let k = 0; k < n; k++) {
            f = z[k * n + i + 1]
            z[k * n + i + 1] = s * z[k * n + i] + c * f
            z[k * n + i] = c * z[k * n + i] - s * f
          }
        }
        if (r === 0 && i >= l) continue
        d[l] -= p
        e[l] = g
        e[m] = 0
      }
    } while (m !== l)
  }
}

export function solvePolygonModes2D(
  polyInput: readonly Point2D[],
  c: number,
  fLimit: number,
  obstacles: readonly FemObstacleInput[] = [],
): FemSolution | null {
  const polygon = ensureCCW(polyInput)
  if (!isSimplePolygon(polygon)) return null
  const obsPolys = obstacles.map((o) => o.polygon).filter((p) => p.length >= 3)
  const rawMesh = triangulatePolygon(polygon, obsPolys.length > 0 ? 110 : 85, obsPolys)
  const rawTriCount = rawMesh.triangles.length / 3
  if (rawMesh.nodes.length < 3 || rawTriCount < 1) return null

  // Compute local air-column depth ratio per triangle
  const rawDepths = new Float64Array(rawTriCount)
  let excludedCount = 0
  for (let t = 0; t < rawTriCount; t++) {
    const i0 = rawMesh.triangles[t * 3]
    const i1 = rawMesh.triangles[t * 3 + 1]
    const i2 = rawMesh.triangles[t * 3 + 2]
    const cx = (rawMesh.nodes[i0].x + rawMesh.nodes[i1].x + rawMesh.nodes[i2].x) / 3
    const cy = (rawMesh.nodes[i0].y + rawMesh.nodes[i1].y + rawMesh.nodes[i2].y) / 3
    let dRatio = 1
    for (const obs of obstacles) {
      if (obs.polygon.length >= 3 && pointInPolygon(obs.polygon, cx, cy)) {
        dRatio = Math.min(dRatio, Math.max(0, Math.min(1, obs.depthRatio)))
      }
    }
    rawDepths[t] = dRatio
    if (dRatio <= 0.06) excludedCount++
  }

  // Exclude full-height solid obstacles when the remaining free domain stays large enough;
  // otherwise keep a low air-depth floor so Cholesky factorization always stays well-conditioned.
  let mesh = rawMesh
  let triDepths = rawDepths
  if (excludedCount > 0 && rawTriCount - excludedCount >= 6) {
    const keptTris: number[] = []
    const keptDepths: number[] = []
    const nodeRemap = new Int32Array(rawMesh.nodes.length)
    nodeRemap.fill(-1)
    const activeNodes: Point2D[] = []

    for (let t = 0; t < rawTriCount; t++) {
      if (rawDepths[t] <= 0.06) continue
      const verts = [rawMesh.triangles[t * 3], rawMesh.triangles[t * 3 + 1], rawMesh.triangles[t * 3 + 2]]
      for (let k = 0; k < 3; k++) {
        const oldIdx = verts[k]
        if (nodeRemap[oldIdx] === -1) {
          nodeRemap[oldIdx] = activeNodes.length
          activeNodes.push(rawMesh.nodes[oldIdx])
        }
        keptTris.push(nodeRemap[oldIdx])
      }
      keptDepths.push(rawDepths[t])
    }

    let keptArea = 0
    for (let t = 0; t < keptDepths.length; t++) {
      const p0 = activeNodes[keptTris[t * 3]]
      const p1 = activeNodes[keptTris[t * 3 + 1]]
      const p2 = activeNodes[keptTris[t * 3 + 2]]
      keptArea += Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) * 0.5
    }
    if (activeNodes.length >= 3 && keptDepths.length >= 6 && keptArea > 0.05) {
      mesh = { nodes: activeNodes, triangles: Int32Array.from(keptTris), area: keptArea }
      triDepths = Float64Array.from(keptDepths)
    }
  }

  const n = mesh.nodes.length
  const triCount = mesh.triangles.length / 3
  const K = new Float64Array(n * n)
  const M = new Float64Array(n * n)
  let effArea = 0

  // Assemble variable-depth P1 linear element stiffness and consistent mass matrices:
  // -div(d * grad(p)) = (w/c)^2 * d * p
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.triangles[t * 3]
    const i1 = mesh.triangles[t * 3 + 1]
    const i2 = mesh.triangles[t * 3 + 2]
    const p0 = mesh.nodes[i0]
    const p1 = mesh.nodes[i1]
    const p2 = mesh.nodes[i2]
    const area2 = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
    const ae = Math.abs(area2) * 0.5
    if (ae < 1e-12) continue

    const dScale = Math.max(0.03, triDepths[t])
    effArea += ae * dScale

    const b = [p1.y - p2.y, p2.y - p0.y, p0.y - p1.y]
    const g = [p2.x - p1.x, p0.x - p2.x, p1.x - p0.x]
    const idx = [i0, i1, i2]
    const inv4A = dScale / (4 * ae)
    const mOff = (ae * dScale) / 12

    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const ir = idx[r]
        const ic = idx[col]
        K[ir * n + ic] += (b[r] * b[col] + g[r] * g[col]) * inv4A
        M[ir * n + ic] += r === col ? mOff * 2 : mOff
      }
    }
  }
  const normArea = effArea > 1e-6 ? effArea : mesh.area

  // Cholesky factorization M = L * L^T (stored in L)
  const L = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i * n + j]
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k]
      if (i === j) {
        if (sum <= 1e-14) return null
        L[i * n + j] = Math.sqrt(sum)
      } else {
        L[i * n + j] = sum / L[j * n + j]
      }
    }
  }

  // Compute Y = L^-1 * K (solve L * Y = K column by column)
  const Y = new Float64Array(n * n)
  for (let col = 0; col < n; col++) {
    for (let i = 0; i < n; i++) {
      let sum = K[i * n + col]
      for (let k = 0; k < i; k++) sum -= L[i * n + k] * Y[k * n + col]
      Y[i * n + col] = sum / L[i * n + i]
    }
  }

  // Compute symmetric S = Y * L^-T (solve L * S^T = Y^T row by row)
  const S = new Float64Array(n * n)
  for (let row = 0; row < n; row++) {
    for (let j = 0; j < n; j++) {
      let sum = Y[row * n + j]
      for (let k = 0; k < j; k++) sum -= L[j * n + k] * S[row * n + k]
      S[row * n + j] = sum / L[j * n + j]
    }
  }
  // Enforce exact symmetry on S before Householder
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const avg = 0.5 * (S[i * n + j] + S[j * n + i])
      S[i * n + j] = avg
      S[j * n + i] = avg
    }
  }

  const d = new Float64Array(n)
  const e = new Float64Array(n)
  tred2(n, S, d, e)
  tql2(n, d, e, S)

  // Sort eigenpairs ascending
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b])
  const lambdaLimit = ((2 * Math.PI * fLimit) / c) ** 2
  const modes: FemMode2D[] = []

  for (let mIdx = 0; mIdx < order.length; mIdx++) {
    const col = order[mIdx]
    const lam = d[col]
    if (lam > lambdaLimit && modes.length > 0) break
    const cleanLam = lam < 1e-6 ? 0 : lam
    const fxy = (c / (2 * Math.PI)) * Math.sqrt(cleanLam)
    const v = new Float64Array(n)

    if (cleanLam === 0) {
      v.fill(1)
    } else {
      // Back-substitute L^T * v = u
      for (let i = n - 1; i >= 0; i--) {
        let sum = S[i * n + col]
        for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * v[k]
        v[i] = sum / L[i * n + i]
      }
      // Normalise so (1/A_eff) * v^T * M * v = 1
      let norm2 = 0
      for (let i = 0; i < n; i++) {
        let mv = 0
        for (let j = 0; j < n; j++) mv += M[i * n + j] * v[j]
        norm2 += v[i] * mv
      }
      const scale = norm2 > 0 ? Math.sqrt(normArea / norm2) : 1
      for (let i = 0; i < n; i++) v[i] *= scale
    }

    modes.push({ index: mIdx, fxy, values: v })
  }

  return { polygon, mesh, modes, c }
}

/**
 * Evaluate barycentric interpolation of all needed 2D eigenfunctions at (x, y).
 * Returns triangle indices & weights so caller can evaluate all modes quickly.
 */
export function locatePointInMesh(
  mesh: FemMesh,
  x: number,
  y: number,
): { i0: number; i1: number; i2: number; w0: number; w1: number; w2: number } | null {
  const triCount = mesh.triangles.length / 3
  let bestDist = Infinity
  let best: { i0: number; i1: number; i2: number; w0: number; w1: number; w2: number } | null = null

  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.triangles[t * 3]
    const i1 = mesh.triangles[t * 3 + 1]
    const i2 = mesh.triangles[t * 3 + 2]
    const a = mesh.nodes[i0]
    const b = mesh.nodes[i1]
    const c = mesh.nodes[i2]

    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(denom) < 1e-12) continue
    const w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom
    const w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom
    const w2 = 1 - w0 - w1

    if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
      return {
        i0,
        i1,
        i2,
        w0: Math.max(0, w0),
        w1: Math.max(0, w1),
        w2: Math.max(0, w2),
      }
    }

    // Track nearest triangle in case of boundary rounding
    const minW = Math.min(w0, w1, w2)
    if (-minW < bestDist) {
      bestDist = -minW
      const cw0 = Math.max(0, w0)
      const cw1 = Math.max(0, w1)
      const cw2 = Math.max(0, w2)
      const s = cw0 + cw1 + cw2 || 1
      best = { i0, i1, i2, w0: cw0 / s, w1: cw1 / s, w2: cw2 / s }
    }
  }

  return bestDist < 0.05 ? best : null
}
