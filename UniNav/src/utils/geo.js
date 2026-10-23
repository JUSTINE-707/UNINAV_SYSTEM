// GPS (lat/lng) -> map image pixels, plus snapping to your path edges.

const R = 6378137

const toLocal = (lat, lng, o) => ({
  e: (((lng - o.lng) * Math.PI) / 180) * R * Math.cos((o.lat * Math.PI) / 180),
  n: (((lat - o.lat) * Math.PI) / 180) * R,
})

// Solve a 3x3 linear system with Gaussian elimination
const solve3 = (A, b) => {
  const M = A.map((row, i) => [...row, b[i]])
  for (let i = 0; i < 3; i++) {
    let p = i
    for (let r = i + 1; r < 3; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r
    }
    ;[M[i], M[p]] = [M[p], M[i]]
    for (let r = i + 1; r < 3; r++) {
      const f = M[r][i] / M[i][i]
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]
    }
  }
  const x = [0, 0, 0]
  for (let i = 2; i >= 0; i--) {
    let s = M[i][3]
    for (let c = i + 1; c < 3; c++) s -= M[i][c] * x[c]
    x[i] = s / M[i][i]
  }
  return x
}

// points: [{ lat, lng, x, y }, ...]  (>= 3, not in a straight line)
export const buildGeoTransform = (points) => {
  const origin = { lat: points[0].lat, lng: points[0].lng }
  const rows = points.map((p) => {
    const { e, n } = toLocal(p.lat, p.lng, origin)
    return { e, n, x: p.x, y: p.y }
  })

  // Least squares: x = a*e + b*n + c ; y = d*e + f*n + g
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const Atx = [0, 0, 0]
  const Aty = [0, 0, 0]
  rows.forEach(({ e, n, x, y }) => {
    const v = [e, n, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) AtA[i][j] += v[i] * v[j]
      Atx[i] += v[i] * x
      Aty[i] += v[i] * y
    }
  })
  const [a, b, c] = solve3(AtA, Atx)
  const [d, f, g] = solve3(AtA, Aty)

  const pxPerMeter = (Math.hypot(a, d) + Math.hypot(b, f)) / 2

  const toImage = (lat, lng) => {
    const { e, n } = toLocal(lat, lng, origin)
    return { x: a * e + b * n + c, y: d * e + f * n + g }
  }

  return { toImage, pxPerMeter }
}

// Project a point onto the nearest edge segment so the dot stays on paths.
export const snapToEdges = (pt, nodes, edges, maxDist = 60) => {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let best = null
  for (const e of edges) {
    const A = byId.get(e.from_node_id)
    const B = byId.get(e.to_node_id)
    if (!A || !B) continue
    const ax = +A.coord_x, ay = +A.coord_y
    const bx = +B.coord_x, by = +B.coord_y
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    let t = ((pt.x - ax) * dx + (pt.y - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = ax + t * dx, py = ay + t * dy
    const d = Math.hypot(pt.x - px, pt.y - py)
    if (!best || d < best.dist) {
      best = { x: px, y: py, dist: d, nearestNode: t < 0.5 ? A : B }
    }
  }
  return best && best.dist <= maxDist ? best : null
}