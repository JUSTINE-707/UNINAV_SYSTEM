// ============================================================
// DIJKSTRA — SINGLE SHORTEST PATH
// ============================================================

export const findShortestPath = (nodes, edges, startId, endId) => {
  if (!startId || !endId) return null
  if (startId === endId) return [startId]

  const graph = {}

  nodes.forEach((n) => {
    graph[n.id] = []
  })

  edges.forEach((e) => {
    if (!graph[e.from_node_id]) graph[e.from_node_id] = []
    if (!graph[e.to_node_id]) graph[e.to_node_id] = []

    graph[e.from_node_id].push({
      id: e.to_node_id,
      w: Number(e.distance) || 1,
    })
    graph[e.to_node_id].push({
      id: e.from_node_id,
      w: Number(e.distance) || 1,
    })
  })

  const dist = {}
  const prev = {}
  const visited = new Set()

  nodes.forEach((n) => {
    dist[n.id] = Infinity
    prev[n.id] = null
  })

  dist[startId] = 0

  while (visited.size < nodes.length) {
    let current = null
    let currentDist = Infinity

    for (const id in dist) {
      if (visited.has(id)) continue
      if (dist[id] < currentDist) {
        current = id
        currentDist = dist[id]
      }
    }

    if (current === null || currentDist === Infinity) break
    if (current === endId) break

    visited.add(current)

    for (const neighbor of graph[current] || []) {
      const alt = dist[current] + neighbor.w

      if (alt < dist[neighbor.id]) {
        dist[neighbor.id] = alt
        prev[neighbor.id] = current
      }
    }
  }

  if (dist[endId] === Infinity) return null

  const path = []
  let cur = endId

  while (cur) {
    path.unshift(cur)
    cur = prev[cur]
  }

  return path
}

// ============================================================
// YEN'S K-SHORTEST PATHS
//
// Returns up to K loopless paths from startId to endId,
// ordered from shortest to longest. The first path is the
// same as findShortestPath.
// ============================================================

const buildAdjacency = (nodes, edges) => {
  const graph = {}

  nodes.forEach((n) => {
    graph[n.id] = []
  })

  edges.forEach((e) => {
    if (!graph[e.from_node_id]) graph[e.from_node_id] = []
    if (!graph[e.to_node_id]) graph[e.to_node_id] = []

    const w = Number(e.distance) || 1

    graph[e.from_node_id].push({ id: e.to_node_id, w })
    graph[e.to_node_id].push({ id: e.from_node_id, w })
  })

  return graph
}

const dijkstraOnGraph = (graph, startId, endId) => {
  if (!startId || !endId) return null
  if (startId === endId) return { path: [startId], cost: 0 }

  const dist = {}
  const prev = {}
  const visited = new Set()

  for (const id in graph) {
    dist[id] = Infinity
    prev[id] = null
  }

  if (!(startId in dist)) return null
  if (!(endId in dist)) return null

  dist[startId] = 0

  while (visited.size < Object.keys(graph).length) {
    let current = null
    let currentDist = Infinity

    for (const id in dist) {
      if (visited.has(id)) continue
      if (dist[id] < currentDist) {
        current = id
        currentDist = dist[id]
      }
    }

    if (current === null || currentDist === Infinity) break
    if (current === endId) break

    visited.add(current)

    for (const neighbor of graph[current] || []) {
      if (visited.has(neighbor.id)) continue

      const alt = dist[current] + neighbor.w

      if (alt < dist[neighbor.id]) {
        dist[neighbor.id] = alt
        prev[neighbor.id] = current
      }
    }
  }

  if (dist[endId] === Infinity) return null

  const path = []
  let cur = endId

  while (cur) {
    path.unshift(cur)
    cur = prev[cur]
  }

  return { path, cost: dist[endId] }
}

const arraysEqual = (a, b) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const pathCost = (path, graph) => {
  let total = 0

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]
    const to = path[i + 1]
    const edge = (graph[from] || []).find((n) => n.id === to)
    total += edge ? edge.w : Infinity
  }

  return total
}

export const findKShortestPaths = (
  nodes,
  edges,
  startId,
  endId,
  K = 3
) => {
  if (!startId || !endId) return []

  const graph = buildAdjacency(nodes, edges)

  const first = dijkstraOnGraph(graph, startId, endId)
  if (!first) return []

  const accepted = [first.path]
  const candidates = []

  for (let k = 1; k < K; k++) {
    const prevPath = accepted[k - 1]

    for (let i = 0; i < prevPath.length - 1; i++) {
      const spurNode = prevPath[i]
      const rootPath = prevPath.slice(0, i + 1)

      const removedEdges = new Set()
      const removedNodes = new Set()

      accepted.forEach((p) => {
        if (
          p.length > i &&
          arraysEqual(p.slice(0, i + 1), rootPath)
        ) {
          removedEdges.add(`${p[i]}::${p[i + 1]}`)
        }
      })

      rootPath.slice(0, -1).forEach((id) => removedNodes.add(id))

      const filtered = {}
      for (const id in graph) {
        if (removedNodes.has(id)) continue
        filtered[id] = []
      }

      for (const id in graph) {
        if (removedNodes.has(id)) continue

        for (const neighbor of graph[id]) {
          if (removedNodes.has(neighbor.id)) continue
          if (removedEdges.has(`${id}::${neighbor.id}`)) continue
          filtered[id].push(neighbor)
        }
      }

      const spur = dijkstraOnGraph(filtered, spurNode, endId)

      if (spur) {
        const totalPath = [
          ...rootPath.slice(0, -1),
          ...spur.path,
        ]

        const alreadyAccepted = accepted.some((p) =>
          arraysEqual(p, totalPath)
        )
        const alreadyCandidate = candidates.some((p) =>
          arraysEqual(p, totalPath)
        )

        if (!alreadyAccepted && !alreadyCandidate) {
          candidates.push(totalPath)
        }
      }
    }

    if (candidates.length === 0) break

    candidates.sort(
      (a, b) => pathCost(a, graph) - pathCost(b, graph)
    )

    const next = candidates.shift()
    accepted.push(next)
  }

  return accepted
}