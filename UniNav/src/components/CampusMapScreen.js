import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Keyboard,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native'
import Svg, { Polyline, Circle, Polygon, G, Path } from 'react-native-svg'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDecay,
  runOnJS,
} from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { useRoute, useNavigation } from '@react-navigation/native'
import { supabase } from '../services/supabase'
import { findKShortestPaths } from '../utils/dijkstra'

const RENDER_MULTIPLIER = 1
const DEFAULT_ZOOM = 1
const DEFAULT_OFFSET_X = 0
const DEFAULT_OFFSET_Y = 0
const DEFAULT_ROTATION = 0
const MIN_SCALE = 1
const MAX_SCALE = 5
const ZOOM_STEP = 1.35

const MAX_ROUTES = 1
const FALLBACK_CHROME_HEIGHT = 260

// ============================================================
// MAP PIN ICON
// ============================================================
// Classic teardrop pin defined in a 24×24 viewbox. Tip at (12, 23).

const PIN_PATH =
  'M12 2C7.58 2 4 5.58 4 10c0 5.25 7 11 8 12 1-1 8-6.75 8-12 0-4.42-3.58-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z'

// Scale the 24×24 pin to a target size and shift so its tip
// (originally at 12,23) lands at (0,0).
const pinTransform = (size) => {
  const s = size / 24
  const tx = -12 * s
  const ty = -23 * s
  return `translate(${tx}, ${ty}) scale(${s})`
}

// ============================================================
// HAPTICS
// ============================================================

const hapticLight = () => {
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch {}
}
const hapticMedium = () => {
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch {}
}
const hapticSelection = () => {
  try { Haptics.selectionAsync() } catch {}
}

// ============================================================
// FLOOR NAMES
// ============================================================

const ORDINALS = {
  0: 'Ground Level',
  1: 'First Floor',
  2: 'Second Floor',
  3: 'Third Floor',
  4: 'Fourth Floor',
  5: 'Fifth Floor',
  6: 'Sixth Floor',
  7: 'Seventh Floor',
  8: 'Eighth Floor',
  9: 'Ninth Floor',
  10: 'Tenth Floor',
}

const floorName = (level) => {
  if (level === 0) return 'Ground Level'
  if (level < 0) return `Basement ${Math.abs(level)}`
  return ORDINALS[level] || `Floor ${level}`
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

const sideOf = (label) => {
  if (!label) return ''
  if (label.endsWith('-L')) return 'left'
  if (label.endsWith('-M')) return 'middle'
  if (label.endsWith('-R')) return 'right'
  return ''
}

const buildingShortName = (buildingId, buildings) => {
  if (!buildingId) return ''
  const bldg = buildings?.find((b) => b.id === buildingId)
  if (!bldg?.name) return 'Bldg'
  const words = bldg.name.split(/\s+/)
  const acronym = words.find((w) => /^[A-Z]{2,}$/.test(w))
  if (acronym) return acronym
  return words[0].slice(0, 6)
}

const getFloorShort = (node, buildings) => {
  if (!node) return ''
  if (!node.building_id) return 'Ground Level'
  const short = buildingShortName(node.building_id, buildings)
  return `${short} ${floorName(node.floor_level)}`
}

const getFloorLabel = (buildingId, floorLevel, buildings) => {
  if (!buildingId) return 'Outdoor'
  const short = buildingShortName(buildingId, buildings)
  return `${short} ${floorName(floorLevel)}`
}

// ============================================================
// NODE DESCRIPTIONS
// ============================================================

const describeNode = (node, path, idx) => {
  if (!node) return ''
  if (node.display_label) return node.display_label

  const label = node.label || ''

  if (node.node_type === 'stairs' || /STAIRS/i.test(label)) {
    const side = sideOf(label)
    return side ? `${cap(side)} stairwell` : 'Stairwell'
  }
  if (node.node_type === 'elevator' || /ELEV/i.test(label)) return 'Elevator'
  if (node.node_type === 'entrance' || /ENTRANCE|ENT$/i.test(label))
    return 'Building entrance'
  if (node.node_type === 'gate' || /GATE|^G\d-WP/i.test(label))
    return 'Campus gate'
  if (node.node_type === 'door' || /DOOR/i.test(label)) return 'Room door'
  if (node.node_type === 'landmark') return label

  if (node.node_type === 'waypoint') {
    const prev = path?.[idx - 1]
    const next = path?.[idx + 1]
    if (next && next.node_type === 'landmark') return `Approaching ${next.label}`
    if (prev && prev.node_type === 'landmark') return `Leaving ${prev.label}`
    return ''
  }

  return ''
}

// ============================================================
// TURN DETECTION
// ============================================================

const getBearing = (a, b) => {
  const dx = Number(b.coord_x) - Number(a.coord_x)
  const dy = Number(b.coord_y) - Number(a.coord_y)
  return Math.atan2(dy, dx)
}

const turnDirection = (path, i) => {
  if (i === 0 || i + 2 >= path.length) return 'straight'
  const a = path[i]
  const b = path[i + 1]
  const c = path[i + 2]
  const b1 = getBearing(a, b)
  const b2 = getBearing(b, c)
  let d = b2 - b1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  if (d > 0.4) return 'right'
  if (d < -0.4) return 'left'
  return 'straight'
}

// ============================================================
// ROUTE ARROWS
// ============================================================

const dist = (a, b) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

const lerpPoint = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

const arrowTriangle = (from, to, point, size) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return null

  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux

  const tip = {
    x: point.x + ux * (size * 0.5),
    y: point.y + uy * (size * 0.5),
  }
  const baseCx = point.x - ux * (size * 0.5)
  const baseCy = point.y - uy * (size * 0.5)
  const left = {
    x: baseCx + px * (size * 0.4),
    y: baseCy + py * (size * 0.4),
  }
  const right = {
    x: baseCx - px * (size * 0.4),
    y: baseCy - py * (size * 0.4),
  }

  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`
}

const computeArrows = (points, spacing) => {
  if (!points || points.length < 2) return []
  const arrows = []
  let accumulated = 0
  let nextArrow = spacing * 0.5

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const segLen = dist(a, b)
    if (segLen === 0) continue

    while (nextArrow <= accumulated + segLen) {
      const t = (nextArrow - accumulated) / segLen
      const p = lerpPoint(a, b, t)
      arrows.push({ point: p, from: a, to: b })
      nextArrow += spacing
    }
    accumulated += segLen
  }

  return arrows
}

// ============================================================
// STEP GENERATION
// ============================================================

const generateSteps = (path, buildings, destinationName) => {
  if (!path || path.length < 2) return []

  const steps = []
  let pendingStraight = 0

  const flushStraight = (from, to) => {
    if (pendingStraight <= 0) return
    const contextName = describeNode(to, path, path.indexOf(to))
    steps.push({
      icon: '↑',
      title: 'Continue straight',
      subtitle: contextName || 'Follow the highlighted route',
      floor: from.floor_level,
      buildingId: from.building_id,
      nodeId: from.id,
    })
    pendingStraight = 0
  }

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]
    const to = path[i + 1]

    const isFloorUp =
      to.node_type === 'stairs' && to.floor_level > from.floor_level
    const isFloorDown =
      to.node_type === 'stairs' && to.floor_level < from.floor_level
    const isElevator = to.node_type === 'elevator'
    const isFloorChange = from.floor_level !== to.floor_level
    const isDestination = i === path.length - 2

    if (isDestination) {
      flushStraight(from, to)
      steps.push({
        icon: '🏁',
        title:
          destinationName && destinationName !== to.label
            ? `Arrive at ${destinationName}`
            : 'Arrive at your destination',
        subtitle: 'You have reached the end of the highlighted route',
        floor: to.floor_level,
        buildingId: to.building_id,
        nodeId: to.id,
        isDestination: true,
      })
      continue
    }

    if (isFloorUp || isElevator) {
      flushStraight(from, to)
      const side = sideOf(to.label)
      steps.push({
        icon: isElevator ? '🛗' : '🔼',
        title: isElevator
          ? `Take the elevator to ${getFloorShort(to, buildings)}`
          : `Go up to ${getFloorShort(to, buildings)}`,
        subtitle: side ? `Take the ${side} stairs` : 'Follow the stairs',
        floor: to.floor_level,
        buildingId: to.building_id,
        nodeId: to.id,
      })
      continue
    }

    if (isFloorDown) {
      flushStraight(from, to)
      const side = sideOf(to.label)
      steps.push({
        icon: '🔽',
        title: `Go down to ${getFloorShort(to, buildings)}`,
        subtitle: side ? `Take the ${side} stairs` : 'Follow the stairs',
        floor: to.floor_level,
        buildingId: to.building_id,
        nodeId: to.id,
      })
      continue
    }

    if (isFloorChange) {
      flushStraight(from, to)
      steps.push({
        icon: '⇅',
        title: `Continue to ${getFloorShort(to, buildings)}`,
        subtitle: describeNode(to, path, i + 1),
        floor: to.floor_level,
        buildingId: to.building_id,
        nodeId: to.id,
      })
      continue
    }

    const turn = turnDirection(path, i)

    if (turn === 'straight') {
      pendingStraight += 1
      continue
    }

    flushStraight(from, to)

    steps.push({
      icon: turn === 'left' ? '↰' : '↱',
      title: turn === 'left' ? 'Turn left' : 'Turn right',
      subtitle: describeNode(to, path, i + 1),
      floor: to.floor_level,
      buildingId: to.building_id,
      nodeId: to.id,
    })
  }

  return steps
}

// ============================================================

const CampusMapScreen = ({
  defaultStartLabel = 'G1-WP1',
  showDebugPanel = false,
  headerEyebrow = 'CAMPUS MAP',
  showScanQRAfterRoute = false,
}) => {
  const route = useRoute()
  const navigation = useNavigation()

  const { width: screenW, height: screenH } = useWindowDimensions()

  const [mapSize, setMapSize] = useState({
    w: screenW,
    h: screenH - FALLBACK_CHROME_HEIGHT,
  })

  const [targetRoomName, setTargetRoomName] = useState(route.params?.roomName || null)
  const [activeScheduleId] = useState(route.params?.scheduleId || null)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [error, setError] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [paths, setPaths] = useState([])
  const [floorPlan, setFloorPlan] = useState(null)
  const [rooms, setRooms] = useState([])
  const [buildings, setBuildings] = useState([])
  const [imageDimensions, setImageDimensions] = useState({ width: 1535, height: 1657 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const [currentBuildingId, setCurrentBuildingId] = useState(null)
  const [currentFloor, setCurrentFloor] = useState(0)
  const [availableFloors, setAvailableFloors] = useState([])

  const [pinnedLocation, setPinnedLocation] = useState(null)

  const [debugOpen, setDebugOpen] = useState(false)
  const [debugStartLabel, setDebugStartLabel] = useState('')
  const [debugEndLabel, setDebugEndLabel] = useState('')
  const [pickingFor, setPickingFor] = useState(null)
  const [pickerQuery, setPickerQuery] = useState('')

  const [isRotated, setIsRotated] = useState(false)

  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  const scale = useSharedValue(DEFAULT_ZOOM)
  const savedScale = useSharedValue(DEFAULT_ZOOM)
  const pinchStartScale = useSharedValue(DEFAULT_ZOOM)
  const translateX = useSharedValue(DEFAULT_OFFSET_X)
  const translateY = useSharedValue(DEFAULT_OFFSET_Y)
  const panStartX = useSharedValue(DEFAULT_OFFSET_X)
  const panStartY = useSharedValue(DEFAULT_OFFSET_Y)
  const rotation = useSharedValue(DEFAULT_ROTATION)
  const savedRotation = useSharedValue(DEFAULT_ROTATION)
  const imgW = useSharedValue(1535)
  const imgH = useSharedValue(1657)
  const fs = useSharedValue(1)

  const areaW = useSharedValue(screenW)
  const areaH = useSharedValue(screenH - FALLBACK_CHROME_HEIGHT)

  const path = paths[0] || []

  const steps = useMemo(
    () => generateSteps(path, buildings, targetRoomName),
    [path, buildings, targetRoomName]
  )

  // ============================================================
  // MAP AREA LAYOUT HANDLER
  // ============================================================

  const onMapAreaLayout = useCallback(
    (e) => {
      const { width, height } = e.nativeEvent.layout
      if (width <= 0 || height <= 0) return

      areaW.value = width
      areaH.value = height

      setMapSize((prev) =>
        prev.w === width && prev.h === height ? prev : { w: width, h: height }
      )
    },
    [areaW, areaH]
  )

  // ============================================================
  // ROUTE INFO
  // ============================================================

  const routeInfo = useMemo(() => {
    if (!path.length) return { floors: [], transitions: [] }

    const floorMap = new Map()
    const transitions = []

    path.forEach((node, idx) => {
      const key = `${node.building_id || 'outdoor'}|${node.floor_level}`
      if (!floorMap.has(key)) {
        floorMap.set(key, {
          key,
          building_id: node.building_id || null,
          floor_level: node.floor_level,
        })
      }
      if (idx < path.length - 1) {
        const next = path[idx + 1]
        const nextKey = `${next.building_id || 'outdoor'}|${next.floor_level}`
        if (nextKey !== key) {
          transitions.push({
            fromKey: key,
            toKey: nextKey,
            toBuildingId: next.building_id || null,
            toFloorLevel: next.floor_level,
          })
        }
      }
    })

    return { floors: [...floorMap.values()], transitions }
  }, [path])

  const { floors: routeFloors, transitions: routeTransitions } = routeInfo

  const currentFloorKey = `${currentBuildingId || 'outdoor'}|${currentFloor}`
  const currentTransition = routeTransitions.find((t) => t.fromKey === currentFloorKey)

  const currentFloorPath = useMemo(() => {
    return path.filter((node) => {
      const nodeBuilding = node.building_id || null
      const targetBuilding = currentBuildingId || null
      return node.floor_level === currentFloor && nodeBuilding === targetBuilding
    })
  }, [path, currentFloor, currentBuildingId])

  const hasRoute = currentFloorPath.length > 0

  const computeRoute = (startId, endId, nodesArr, edgesArr) => {
    if (!startId || !endId) return 'Missing start or end node.'

    const allPaths = findKShortestPaths(
      nodesArr,
      edgesArr,
      startId,
      endId,
      MAX_ROUTES
    )

    if (!allPaths || allPaths.length === 0) {
      setPaths([])
      return 'No path found between these two nodes.'
    }

    const pathsWithNodes = allPaths.map((ids) =>
      ids.map((id) => nodesArr.find((n) => n.id === id)).filter(Boolean)
    )

    setPaths(pathsWithNodes)
    return null
  }

  // ============================================================
  // LOAD AVAILABLE FLOORS
  // ============================================================

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('floor_plans')
        .select('building_id, floor_level')

      const seen = new Map()
      seen.set('outdoor|0', { key: 'outdoor|0', building_id: null, floor_level: 0 })

      ;(data || []).forEach((p) => {
        const key = `${p.building_id || 'outdoor'}|${p.floor_level}`
        if (!seen.has(key)) {
          seen.set(key, {
            key,
            building_id: p.building_id || null,
            floor_level: p.floor_level,
          })
        }
      })

      setAvailableFloors([...seen.values()])
    }
    load()
  }, [refreshKey])

  // ============================================================
  // MAIN DATA LOAD
  // ============================================================

  useEffect(() => {
    const load = async () => {
      try {
        if (!refreshing) setLoading(true)
        setError(null)

        const { data: nodeData, error: nodeErr } = await supabase
          .from('nav_nodes')
          .select('id, label, coord_x, coord_y, node_type, floor_level, building_id')
        if (nodeErr) throw nodeErr

        const { data: edgeData, error: edgeErr } = await supabase
          .from('nav_edges')
          .select('id, from_node_id, to_node_id, distance')
        if (edgeErr) throw edgeErr

        let planQuery = supabase
          .from('floor_plans')
          .select('*')
          .eq('floor_level', currentFloor)

        if (currentBuildingId) {
          planQuery = planQuery.eq('building_id', currentBuildingId)
        } else {
          planQuery = planQuery.is('building_id', null)
        }

        const { data: planData, error: planErr } = await planQuery.maybeSingle()
        if (planErr) console.warn('floor_plans:', planErr.message)

        const { data: roomData } = await supabase
          .from('rooms')
          .select('id, room_code, room_type, floor_level, building_id, nav_node_id')
          .order('room_code')

        const { data: buildingData } = await supabase
          .from('buildings')
          .select('id, name, coord_x, coord_y, status')

        setNodes(nodeData || [])
        setEdges(edgeData || [])
        setFloorPlan(planData || null)
        setRooms(roomData || [])
        setBuildings(buildingData || [])

        if (planData?.image_width && planData?.image_height) {
          const w = Number(planData.image_width)
          const h = Number(planData.image_height)
          setImageDimensions({ width: w, height: h })
          imgW.value = w
          imgH.value = h
        }

        if (!targetRoomName) {
          setLoading(false)
          setRefreshing(false)
          return
        }

        const safeNodes = nodeData || []
        const safeEdges = edgeData || []

        const startNode = safeNodes.find((n) => n.label === defaultStartLabel)
        if (!startNode) {
          setError(`Start node "${defaultStartLabel}" not found.`)
          setLoading(false)
          setRefreshing(false)
          return
        }

        let endNode = null

        // 1. Try to match as a room
        const { data: roomLookup } = await supabase
          .from('rooms')
          .select('id, nav_node_id, room_code')
          .eq('room_code', targetRoomName)
          .maybeSingle()

        if (roomLookup?.nav_node_id) {
          endNode = safeNodes.find((n) => n.id === roomLookup.nav_node_id)
        }

        // 2. Try to match directly by node label (used by long-press pin routing)
        if (!endNode) {
          endNode = safeNodes.find(
            (n) => n.label?.toUpperCase() === targetRoomName?.toUpperCase()
          )
        }

        // 3. Fallback map
        if (!endNode) {
          const upper = targetRoomName.toUpperCase()
          const fallbackMap = [
            { match: /GYM/, label: 'JGYM-WP' },
            { match: /CAFE|CAFETERIA/, label: 'CAF-WP' },
            { match: /HOSTEL/, label: 'HST-WP1' },
            { match: /IBAA/, label: 'IBAA-WP1' },
            { match: /MINI FOREST|MF/, label: 'MF-WP' },
            { match: /HEB|LAB|CISCO|MAC/, label: 'HEB-WP1' },
            { match: /LIPA/, label: 'LIPA-WP1' },
            { match: /IMT/, label: 'IMT-WP' },
            { match: /LIB/, label: 'LIB-WP' },
          ]
          const hit = fallbackMap.find((f) => f.match.test(upper))
          if (hit) {
            endNode = safeNodes.find((n) => n.label === hit.label)
          }
        }

        if (!endNode) {
          setError(`No route available to "${targetRoomName}" yet.`)
          setLoading(false)
          setRefreshing(false)
          return
        }

        setPinnedLocation((prev) => {
          // If the user just dropped a pin, keep their pin at the tap
          // point (not moved to the destination node). Otherwise move
          // the pin to the destination.
          if (prev?.isDroppedPin) {
            return {
              ...prev,
              floor_level: endNode.floor_level,
              building_id: endNode.building_id || null,
            }
          }
          return {
            coord_x: Number(endNode.coord_x),
            coord_y: Number(endNode.coord_y),
            label: targetRoomName || endNode.label,
            floor_level: endNode.floor_level,
            building_id: endNode.building_id || null,
          }
        })

        const routeError = computeRoute(startNode.id, endNode.id, safeNodes, safeEdges)
        if (routeError) setError(routeError)
      } catch (err) {
        console.error('Map load error:', err)
        setError(err.message || 'Failed to load the map.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }

    load()
  }, [targetRoomName, currentBuildingId, currentFloor, defaultStartLabel, refreshKey])

  // ============================================================
  // STEP SHEET SIDE EFFECTS
  // ============================================================

  useEffect(() => {
    setCurrentStepIdx(0)
    setSheetOpen(false)
  }, [path])

  useEffect(() => {
    if (!steps.length) return

    const cur = steps[currentStepIdx]
    if (
      cur &&
      cur.floor === currentFloor &&
      (cur.buildingId || null) === (currentBuildingId || null)
    ) {
      return
    }

    for (let i = currentStepIdx; i < steps.length; i++) {
      if (
        steps[i].floor === currentFloor &&
        (steps[i].buildingId || null) === (currentBuildingId || null)
      ) {
        setCurrentStepIdx(i)
        return
      }
    }
    for (let i = currentStepIdx - 1; i >= 0; i--) {
      if (
        steps[i].floor === currentFloor &&
        (steps[i].buildingId || null) === (currentBuildingId || null)
      ) {
        setCurrentStepIdx(i)
        return
      }
    }
  }, [currentFloor, currentBuildingId, steps])

  // ============================================================
  // FIT SCALE
  // ============================================================

  const fitScale = useMemo(() => {
    const { width: iw, height: ih } = imageDimensions
    const maxW = Math.max(mapSize.w - 32, 100)
    const maxH = Math.max(mapSize.h - 32, 100)
    return Math.min(maxW / iw, maxH / ih)
  }, [imageDimensions, mapSize.w, mapSize.h])

  useEffect(() => {
    fs.value = fitScale
  }, [fitScale, fs])

  // ============================================================
  // BOUNDS
  // ============================================================

  const getBounds = (s, r) => {
    'worklet'
    const W = imgW.value * fs.value * s
    const H = imgH.value * fs.value * s
    const c = Math.abs(Math.cos(r))
    const sn = Math.abs(Math.sin(r))
    const rotatedW = W * c + H * sn
    const rotatedH = W * sn + H * c
    return {
      maxX: Math.max((rotatedW - areaW.value) / 2, 0),
      maxY: Math.max((rotatedH - areaH.value) / 2, 0),
    }
  }

  // ============================================================
  // INTERACTIVE CONTROLS
  // ============================================================

  const resetView = () => {
    hapticMedium()
    scale.value = withTiming(DEFAULT_ZOOM, { duration: 250 })
    savedScale.value = DEFAULT_ZOOM
    rotation.value = withTiming(DEFAULT_ROTATION, { duration: 250 })
    savedRotation.value = DEFAULT_ROTATION
    translateX.value = withTiming(DEFAULT_OFFSET_X, { duration: 250 })
    translateY.value = withTiming(DEFAULT_OFFSET_Y, { duration: 250 })
    setIsRotated(false)
  }

  const zoomIn = () => {
    hapticLight()
    const next = Math.min(scale.value * ZOOM_STEP, MAX_SCALE)
    scale.value = withTiming(next, { duration: 220 })
    savedScale.value = next
  }

  const zoomOut = () => {
    hapticLight()
    const next = Math.max(scale.value / ZOOM_STEP, MIN_SCALE)
    scale.value = withTiming(next, { duration: 220 })
    savedScale.value = next
  }

  const resetRotation = () => {
    hapticLight()
    rotation.value = withTiming(0, { duration: 280 })
    savedRotation.value = 0
    setIsRotated(false)
  }

  // ============================================================
  // REFRESH
  // ============================================================

  const handleRefresh = () => {
    if (refreshing) return
    hapticMedium()

    setPaths([])
    setTargetRoomName(null)
    setPinnedLocation(null)
    setError(null)
    setCurrentStepIdx(0)
    setSheetOpen(false)

    setCurrentBuildingId(null)
    setCurrentFloor(0)

    scale.value = withTiming(DEFAULT_ZOOM, { duration: 250 })
    savedScale.value = DEFAULT_ZOOM
    rotation.value = withTiming(DEFAULT_ROTATION, { duration: 250 })
    savedRotation.value = DEFAULT_ROTATION
    translateX.value = withTiming(DEFAULT_OFFSET_X, { duration: 250 })
    translateY.value = withTiming(DEFAULT_OFFSET_Y, { duration: 250 })
    setIsRotated(false)

    setRefreshing(true)
    setRefreshKey((k) => k + 1)
  }

  const goToFloor = (f) => {
    hapticSelection()
    setCurrentBuildingId(f.building_id)
    setCurrentFloor(f.floor_level)
  }

  const goToTransitionTarget = () => {
    if (!currentTransition) return
    hapticMedium()
    setCurrentBuildingId(currentTransition.toBuildingId)
    setCurrentFloor(currentTransition.toFloorLevel)
  }

  // ============================================================
  // LONG-PRESS PIN — snaps to nearest node
  // ============================================================

  const handleLongPressPin = (x, y) => {
    hapticMedium()
    const imageX = x / RENDER_MULTIPLIER
    const imageY = y / RENDER_MULTIPLIER

    // Find nearest node on the current floor/building
    const candidates = nodes.filter((n) => {
      const nB = n.building_id || null
      const tB = currentBuildingId || null
      return n.floor_level === currentFloor && nB === tB
    })

    let nearest = null
    let nearestDist = Infinity
    for (const n of candidates) {
      const dx = Number(n.coord_x) - imageX
      const dy = Number(n.coord_y) - imageY
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < nearestDist) {
        nearestDist = d
        nearest = n
      }
    }

    setPaths([])
    setError(null)
    setTargetRoomName(null)
    setCurrentStepIdx(0)
    setSheetOpen(false)

    setPinnedLocation({
      coord_x: imageX,
      coord_y: imageY,
      label: 'Dropped Pin',
      floor_level: currentFloor,
      building_id: currentBuildingId || null,
      isDroppedPin: true,
      nearestNodeId: nearest?.id || null,
      nearestNodeLabel: nearest?.label || null,
      nearestDistance: nearestDist,
    })
  }

  // AUTO-CENTER on pin
  useEffect(() => {
    const pinMatchesView =
      pinnedLocation &&
      pinnedLocation.floor_level === currentFloor &&
      (pinnedLocation.building_id || null) === (currentBuildingId || null)

    if (pinMatchesView) {
      const timer = setTimeout(() => {
        const w = imgW.value
        const h = imgH.value
        const fit = fs.value
        const viewW = areaW.value
        const viewH = areaH.value
        if (!w || !h || !fit || !viewW || !viewH) return

        let offsetX = -(pinnedLocation.coord_x - w / 2) * fit
        let offsetY = -(pinnedLocation.coord_y - h / 2) * fit

        const W = w * fit
        const H = h * fit
        const maxX = Math.max((W - viewW) / 2, 0)
        const maxY = Math.max((H - viewH) / 2, 0)

        offsetX = Math.min(Math.max(offsetX, -maxX), maxX)
        offsetY = Math.min(Math.max(offsetY, -maxY), maxY)

        rotation.value = withTiming(0, { duration: 300 })
        savedRotation.value = 0
        scale.value = withTiming(1, { duration: 300 })
        savedScale.value = 1
        translateX.value = withTiming(offsetX, { duration: 300 })
        translateY.value = withTiming(offsetY, { duration: 300 })
        setIsRotated(false)
      }, 400)

      return () => clearTimeout(timer)
    } else {
      resetView()
    }
  }, [
    currentFloor,
    currentBuildingId,
    pinnedLocation,
    imageDimensions,
    mapSize.w,
    mapSize.h,
  ])

  // ============================================================
  // GESTURES
  // ============================================================

  const pinchGesture = Gesture.Pinch()
    .onStart(() => { pinchStartScale.value = scale.value })
    .onUpdate((e) => {
      let next = pinchStartScale.value * e.scale
      if (next < MIN_SCALE) next = MIN_SCALE
      if (next > MAX_SCALE) next = MAX_SCALE
      scale.value = next
    })
    .onEnd(() => {
      savedScale.value = scale.value
      runOnJS(hapticLight)()
      const bounds = getBounds(scale.value, rotation.value)
      translateX.value = withTiming(
        Math.min(Math.max(translateX.value, -bounds.maxX), bounds.maxX),
        { duration: 180 }
      )
      translateY.value = withTiming(
        Math.min(Math.max(translateY.value, -bounds.maxY), bounds.maxY),
        { duration: 180 }
      )
    })

  const rotationGesture = Gesture.Rotation()
    .onUpdate((e) => { rotation.value = savedRotation.value + e.rotation })
    .onEnd(() => {
      savedRotation.value = rotation.value
      const bounds = getBounds(scale.value, rotation.value)
      translateX.value = withTiming(
        Math.min(Math.max(translateX.value, -bounds.maxX), bounds.maxX),
        { duration: 180 }
      )
      translateY.value = withTiming(
        Math.min(Math.max(translateY.value, -bounds.maxY), bounds.maxY),
        { duration: 180 }
      )
      const rotated = Math.abs(rotation.value) > 0.08
      runOnJS(setIsRotated)(rotated)
    })

  const panGesture = Gesture.Pan()
    .averageTouches(true)
    .minDistance(8)
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onStart(() => {
      panStartX.value = translateX.value
      panStartY.value = translateY.value
    })
    .onUpdate((e) => {
      translateX.value = panStartX.value + e.translationX
      translateY.value = panStartY.value + e.translationY
    })
    .onEnd((e) => {
      const bounds = getBounds(scale.value, rotation.value)
      translateX.value = withDecay({
        velocity: e.velocityX,
        clamp: [-bounds.maxX, bounds.maxX],
        rubberBandEffect: true,
        rubberBandFactor: 0.6,
      })
      translateY.value = withDecay({
        velocity: e.velocityY,
        clamp: [-bounds.maxY, bounds.maxY],
        rubberBandEffect: true,
        rubberBandFactor: 0.6,
      })
    })

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => { runOnJS(resetView)() })

  const longPressGesture = Gesture.LongPress()
    .numberOfPointers(1)
    .minDuration(400)
    .maxDistance(8)
    .onStart((e) => { runOnJS(handleLongPressPin)(e.x, e.y) })

  const panOrLongPress = Gesture.Exclusive(longPressGesture, panGesture)

  const combinedGestures = Gesture.Simultaneous(
    pinchGesture,
    rotationGesture,
    doubleTapGesture,
    panOrLongPress
  )

  const animatedMapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}rad` },
      { scale: fs.value * scale.value },
    ],
  }))

  const compassStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-rotation.value}rad` }],
  }))

  // ============================================================
  // SEARCH
  // ============================================================

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()

    const matchedBuildings = buildings
      .filter((b) => b.name?.toLowerCase().includes(q) && b.status !== 'inactive')
      .slice(0, 4)
      .map((b) => ({ ...b, type: 'building' }))

    const matchedRooms = rooms
      .filter((r) => r.room_code?.toLowerCase().includes(q))
      .slice(0, 6)
      .map((r) => ({ ...r, type: 'room' }))

    return [...matchedBuildings, ...matchedRooms]
  }, [searchQuery, rooms, buildings])

  const handleSearchSelect = (item) => {
    hapticSelection()
    setSearchOpen(false)
    setSearchQuery('')
    Keyboard.dismiss()

    setPaths([])
    setError(null)
    setPinnedLocation(null)
    setCurrentStepIdx(0)
    setSheetOpen(false)

    if (item.type === 'building') {
      setCurrentBuildingId(null)
      setCurrentFloor(0)
      setTargetRoomName(null)
      setPinnedLocation({
        coord_x: Number(item.coord_x),
        coord_y: Number(item.coord_y),
        label: item.name,
        floor_level: 0,
        building_id: null,
        isDroppedPin: false,
      })
    } else {
      setCurrentBuildingId(null)
      setCurrentFloor(0)
      setTargetRoomName(item.room_code)
    }
  }

  const handleGetDirections = () => {
    if (!pinnedLocation) return
    hapticMedium()

    // If the pin snapped to a node, use that as the destination
    if (pinnedLocation.nearestNodeLabel) {
      setTargetRoomName(pinnedLocation.nearestNodeLabel)
      return
    }

    // Otherwise, try to route to the pin's label (best-effort)
    setTargetRoomName(pinnedLocation.label)
  }

  const handleClearPin = () => {
    hapticLight()
    setPinnedLocation(null)
    setTargetRoomName(null)
    setPaths([])
    setError(null)
    setCurrentStepIdx(0)
    setSheetOpen(false)
  }

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [nodes]
  )

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return sortedNodes
    return sortedNodes.filter((n) => (n.label || '').toLowerCase().includes(q))
  }, [pickerQuery, sortedNodes])

  const handleOpenPicker = (which) => {
    hapticLight()
    setPickerQuery('')
    setPickingFor(which)
  }

  const handlePickNode = (node) => {
    hapticSelection()
    if (pickingFor === 'start') setDebugStartLabel(node.label)
    else if (pickingFor === 'end') setDebugEndLabel(node.label)
    setPickingFor(null)
    setPickerQuery('')
  }

  const handleRunDebugRoute = () => {
    const startNode = nodes.find((n) => n.label === debugStartLabel)
    const endNode = nodes.find((n) => n.label === debugEndLabel)
    if (!startNode || !endNode) {
      setError('Pick both a start and an end node.')
      return
    }
    hapticMedium()
    const routeError = computeRoute(startNode.id, endNode.id, nodes, edges)
    setError(routeError)
  }

  const handleClearDebugRoute = () => {
    hapticLight()
    setDebugStartLabel('')
    setDebugEndLabel('')
    setPaths([])
    setError(null)
    setCurrentStepIdx(0)
    setSheetOpen(false)
  }

  const handleScanQRFromRoute = () => {
    if (!activeScheduleId) return
    hapticMedium()
    navigation.navigate('QRScanner', {
      scheduleId: activeScheduleId,
      roomName: targetRoomName || pinnedLocation?.label,
    })
  }

  const handleStepPress = (idx) => {
    hapticSelection()
    setCurrentStepIdx(idx)
    const s = steps[idx]
    if (!s) return
    if (
      s.floor !== currentFloor ||
      (s.buildingId || null) !== (currentBuildingId || null)
    ) {
      setCurrentBuildingId(s.buildingId || null)
      setCurrentFloor(s.floor)
    }
  }

  // ============================================================
  // FLOOR SWITCHER VISIBILITY
  // ============================================================

  const floorsToShow = routeFloors
  const showSwitcher = hasRoute && routeFloors.length > 1
  const isRoutingSwitcher = true

  // ============================================================
  // POLYLINE POINTS + ARROWS
  // ============================================================

  const currentRoutePoints = currentFloorPath
    .map(
      (n) =>
        `${n.coord_x * RENDER_MULTIPLIER},${n.coord_y * RENDER_MULTIPLIER}`
    )
    .join(' ')

  const ARROW_SPACING = 120
  const ARROW_SIZE = 14

  const currentFloorArrowPositions = useMemo(() => {
    if (!hasRoute || currentFloorPath.length < 2) return []
    const pts = currentFloorPath.map((n) => ({
      x: Number(n.coord_x) * RENDER_MULTIPLIER,
      y: Number(n.coord_y) * RENDER_MULTIPLIER,
    }))
    return computeArrows(pts, ARROW_SPACING)
  }, [currentFloorPath, hasRoute])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8B0000" />
        <Text style={styles.loadingText}>Loading map…</Text>
      </View>
    )
  }

  const isBrowsing = !targetRoomName && !hasRoute

  const showScanQRFab = showScanQRAfterRoute && hasRoute && activeScheduleId
  const sheetBottomOffset = showScanQRFab ? 80 : 12

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
          <Text style={styles.headerBackText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerEyebrow}>
            {isBrowsing ? headerEyebrow : 'CAMPUS ROUTE'}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {targetRoomName ||
              (hasRoute && debugEndLabel
                ? `${debugStartLabel} → ${debugEndLabel}`
                : pinnedLocation
                ? pinnedLocation.label
                : 'Browse buildings')}
          </Text>
        </View>
        {showDebugPanel ? (
          <TouchableOpacity
            onPress={() => setDebugOpen((v) => !v)}
            style={styles.headerReset}
          >
            <Text style={[styles.headerResetText, debugOpen && styles.headerResetTextActive]}>
              {debugOpen ? 'Close' : 'Debug'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerReset} />
        )}
      </View>

      {/* SEARCH BAR */}
      {!debugOpen && (
        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              value={searchQuery}
              onChangeText={(t) => {
                setSearchQuery(t)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search buildings or rooms…"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('')
                  setSearchOpen(false)
                }}
              >
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {searchOpen && searchResults.length > 0 && (
            <View style={styles.searchResultsAbsolute}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.searchResultsScroll}
              >
                {searchResults.map((item) => (
                  <TouchableOpacity
                    key={`${item.type}-${item.id}`}
                    style={styles.searchResultItem}
                    onPress={() => handleSearchSelect(item)}
                  >
                    <View style={styles.searchResultLeft}>
                      <Text style={styles.searchResultIcon}>
                        {item.type === 'building' ? '🏢' : '📍'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.searchResultText}>
                          {item.type === 'building' ? item.name : item.room_code}
                        </Text>
                        {item.type === 'room' && (
                          <Text style={styles.searchResultSubtext}>
                            {item.room_type || 'Room'} · Floor {item.floor_level}
                          </Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
            <View style={styles.searchResultsAbsolute}>
              <View style={styles.searchResultItem}>
                <Text style={styles.searchResultSubtext}>
                  No results for "{searchQuery}"
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* DEBUG PANEL */}
      {showDebugPanel && debugOpen && (
        <View style={styles.debugPanel}>
          <Text style={styles.debugTitle}>Route Checker</Text>
          <TouchableOpacity style={styles.debugRow} onPress={() => handleOpenPicker('start')}>
            <Text style={styles.debugRowLabel}>Start</Text>
            <Text
              style={[styles.debugRowValue, !debugStartLabel && styles.debugRowPlaceholder]}
              numberOfLines={1}
            >
              {debugStartLabel || 'Tap to pick'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.debugRow} onPress={() => handleOpenPicker('end')}>
            <Text style={styles.debugRowLabel}>End</Text>
            <Text
              style={[styles.debugRowValue, !debugEndLabel && styles.debugRowPlaceholder]}
              numberOfLines={1}
            >
              {debugEndLabel || 'Tap to pick'}
            </Text>
          </TouchableOpacity>
          <View style={styles.debugButtonRow}>
            <TouchableOpacity
              onPress={handleRunDebugRoute}
              style={styles.debugRunButton}
              disabled={!debugStartLabel || !debugEndLabel}
            >
              <Text style={styles.debugRunText}>Run</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClearDebugRoute} style={styles.debugClearButton}>
              <Text style={styles.debugClearText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MAP AREA */}
      <View style={styles.mapArea} onLayout={onMapAreaLayout}>
        {/* FLOOR SWITCHER */}
        {showSwitcher && !debugOpen && (
          <View style={styles.floorSwitcher} pointerEvents="box-none">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.floorSwitcherContent}
            >
              {floorsToShow.map((f, idx) => {
                const isActive =
                  (currentBuildingId || null) === f.building_id &&
                  currentFloor === f.floor_level
                return (
                  <View key={f.key} style={styles.floorChipGroup}>
                    <TouchableOpacity
                      style={[styles.floorBtn, isActive && styles.floorBtnActive]}
                      onPress={() => goToFloor(f)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.floorBtnText, isActive && styles.floorBtnTextActive]}
                        numberOfLines={1}
                      >
                        {getFloorLabel(f.building_id, f.floor_level, buildings)}
                      </Text>
                    </TouchableOpacity>
                    {isRoutingSwitcher && idx < floorsToShow.length - 1 && (
                      <Text style={styles.floorArrow}>›</Text>
                    )}
                  </View>
                )
              })}
            </ScrollView>
          </View>
        )}

        {/* REFRESH FAB */}
        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.refreshFab}
          activeOpacity={0.7}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#8B0000" />
          ) : (
            <Text style={styles.refreshIcon}>⟳</Text>
          )}
        </TouchableOpacity>

        {pinnedLocation && !debugOpen && !hasRoute && (
          <TouchableOpacity onPress={handleClearPin} style={styles.clearPinFab}>
            <Text style={styles.clearPinText}>✕ Clear Pin</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        <GestureDetector gesture={combinedGestures}>
          <Animated.View
            style={[
              {
                width: imageDimensions.width * RENDER_MULTIPLIER,
                height: imageDimensions.height * RENDER_MULTIPLIER,
              },
              animatedMapStyle,
            ]}
          >
            {floorPlan?.image_url ? (
              <Image
                key={floorPlan.image_url}
                source={{ uri: floorPlan.image_url }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.noImageBox}>
                <Text style={styles.noImageText}>Map image not uploaded yet</Text>
              </View>
            )}

            <Svg
              style={StyleSheet.absoluteFill}
              viewBox={`0 0 ${imageDimensions.width * RENDER_MULTIPLIER} ${
                imageDimensions.height * RENDER_MULTIPLIER
              }`}
              preserveAspectRatio="xMidYMid meet"
            >
              {showDebugPanel &&
                debugOpen &&
                nodes
                  .filter((n) => {
                    const nodeBuilding = n.building_id || null
                    const targetBuilding = currentBuildingId || null
                    return n.floor_level === currentFloor && nodeBuilding === targetBuilding
                  })
                  .map((n) => (
                    <Circle
                      key={`dot-${n.id}`}
                      cx={n.coord_x * RENDER_MULTIPLIER}
                      cy={n.coord_y * RENDER_MULTIPLIER}
                      r={2 * RENDER_MULTIPLIER}
                      fill={
                        n.label === debugStartLabel
                          ? '#059669'
                          : n.label === debugEndLabel
                          ? '#8B0000'
                          : '#1E88E5'
                      }
                      opacity={0.5}
                    />
                  ))}

              {/* PIN — classic teardrop map pin, tip anchored at coord */}
              {pinnedLocation &&
                pinnedLocation.floor_level === currentFloor &&
                (pinnedLocation.building_id || null) === (currentBuildingId || null) && (
                  <G
                    transform={`translate(${
                      pinnedLocation.coord_x * RENDER_MULTIPLIER
                    }, ${pinnedLocation.coord_y * RENDER_MULTIPLIER})`}
                  >
                    {/* soft ground glow */}
                    <Circle
                      cx={0}
                      cy={0}
                      r={20 * RENDER_MULTIPLIER}
                      fill="#F59E0B"
                      opacity={0.18}
                    />
                    {/* pin body — tip lands exactly at (0,0) */}
                    <G transform={pinTransform(44 * RENDER_MULTIPLIER)}>
                      <Path d={PIN_PATH} fill="#F59E0B" />
                      <Path
                        d={PIN_PATH}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={1.4}
                      />
                    </G>
                  </G>
                )}

              {/* MAIN ROUTE — 3-layer for visibility */}
              {hasRoute && currentFloorPath.length > 1 && (
                <>
                  <Polyline
                    points={currentRoutePoints}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={11 * RENDER_MULTIPLIER}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                  <Polyline
                    points={currentRoutePoints}
                    fill="none"
                    stroke="#8B0000"
                    strokeWidth={6 * RENDER_MULTIPLIER}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Polyline
                    points={currentRoutePoints}
                    fill="none"
                    stroke="#F87171"
                    strokeWidth={2 * RENDER_MULTIPLIER}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                  />

                  {/* DIRECTION ARROWS */}
                  {currentFloorArrowPositions.map((arrow, idx) => {
                    const tri = arrowTriangle(
                      arrow.from,
                      arrow.to,
                      arrow.point,
                      ARROW_SIZE * RENDER_MULTIPLIER
                    )
                    if (!tri) return null
                    return (
                      <Polygon
                        key={`arrow-${idx}`}
                        points={tri}
                        fill="#FFFFFF"
                        stroke="#8B0000"
                        strokeWidth={1.5 * RENDER_MULTIPLIER}
                        strokeLinejoin="round"
                      />
                    )
                  })}
                </>
              )}

              {/* INTERMEDIATE NODES */}
              {hasRoute &&
                currentFloorPath.slice(1, -1).map((n) => (
                  <Circle
                    key={n.id}
                    cx={n.coord_x * RENDER_MULTIPLIER}
                    cy={n.coord_y * RENDER_MULTIPLIER}
                    r={3 * RENDER_MULTIPLIER}
                    fill="#FFFFFF"
                    stroke="#8B0000"
                    strokeWidth={1.5 * RENDER_MULTIPLIER}
                  />
                ))}

              {/* START MARKER */}
              {hasRoute &&
                currentFloorPath[0] &&
                path[0] &&
                currentFloorPath[0].id === path[0].id && (
                  <>
                    <Circle
                      cx={currentFloorPath[0].coord_x * RENDER_MULTIPLIER}
                      cy={currentFloorPath[0].coord_y * RENDER_MULTIPLIER}
                      r={7 * RENDER_MULTIPLIER}
                      fill="#059669"
                      stroke="#FFFFFF"
                      strokeWidth={2.5 * RENDER_MULTIPLIER}
                    />
                    <Circle
                      cx={currentFloorPath[0].coord_x * RENDER_MULTIPLIER}
                      cy={currentFloorPath[0].coord_y * RENDER_MULTIPLIER}
                      r={12 * RENDER_MULTIPLIER}
                      fill="none"
                      stroke="#059669"
                      strokeWidth={1.5 * RENDER_MULTIPLIER}
                      opacity={0.4}
                    />
                  </>
                )}

              {/* DESTINATION MARKER */}
              {hasRoute &&
                currentFloorPath[currentFloorPath.length - 1] &&
                path[path.length - 1] &&
                currentFloorPath[currentFloorPath.length - 1].id ===
                  path[path.length - 1].id && (
                  <>
                    <Circle
                      cx={
                        currentFloorPath[currentFloorPath.length - 1].coord_x *
                        RENDER_MULTIPLIER
                      }
                      cy={
                        currentFloorPath[currentFloorPath.length - 1].coord_y *
                        RENDER_MULTIPLIER
                      }
                      r={7 * RENDER_MULTIPLIER}
                      fill="#8B0000"
                      stroke="#FFFFFF"
                      strokeWidth={2.5 * RENDER_MULTIPLIER}
                    />
                    <Circle
                      cx={
                        currentFloorPath[currentFloorPath.length - 1].coord_x *
                        RENDER_MULTIPLIER
                      }
                      cy={
                        currentFloorPath[currentFloorPath.length - 1].coord_y *
                        RENDER_MULTIPLIER
                      }
                      r={13 * RENDER_MULTIPLIER}
                      fill="none"
                      stroke="#8B0000"
                      strokeWidth={1.5 * RENDER_MULTIPLIER}
                      opacity={0.5}
                    />
                  </>
                )}
            </Svg>
          </Animated.View>
        </GestureDetector>

        {/* TRANSITION BANNER */}
        {currentTransition && !debugOpen && !sheetOpen && (
          <TouchableOpacity
            style={styles.transitionBanner}
            onPress={goToTransitionTarget}
            activeOpacity={0.85}
          >
            <View style={styles.transitionBannerLeft}>
              <Text style={styles.transitionBannerLabel}>Continue to</Text>
              <Text style={styles.transitionBannerTarget}>
                {getFloorLabel(
                  currentTransition.toBuildingId,
                  currentTransition.toFloorLevel,
                  buildings
                )}
              </Text>
            </View>
            <Text style={styles.transitionBannerArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* MAP CONTROLS */}
        <View style={styles.mapControls}>
          <TouchableOpacity style={styles.mapControlBtn} onPress={zoomIn} activeOpacity={0.7}>
            <Text style={styles.mapControlIcon}>+</Text>
          </TouchableOpacity>
          <View style={styles.mapControlDivider} />
          <TouchableOpacity style={styles.mapControlBtn} onPress={zoomOut} activeOpacity={0.7}>
            <Text style={styles.mapControlIcon}>−</Text>
          </TouchableOpacity>
          <View style={styles.mapControlDivider} />
          <TouchableOpacity
            style={[styles.mapControlBtn, isRotated && styles.mapControlBtnActive]}
            onPress={resetRotation}
            activeOpacity={0.7}
          >
            <Animated.View style={compassStyle}>
              <Text style={styles.mapControlCompass}>▲</Text>
            </Animated.View>
          </TouchableOpacity>
          <View style={styles.mapControlDivider} />
          <TouchableOpacity style={styles.mapControlBtn} onPress={resetView} activeOpacity={0.7}>
            <Text style={styles.mapControlIconSmall}>⤢</Text>
          </TouchableOpacity>
        </View>

        {pinnedLocation && !debugOpen && !hasRoute && (
          <TouchableOpacity
            onPress={handleGetDirections}
            activeOpacity={0.85}
            style={styles.directionsFab}
          >
            <Text style={styles.directionsFabText}>↗ Directions</Text>
          </TouchableOpacity>
        )}

        {showScanQRFab && (
          <TouchableOpacity
            onPress={handleScanQRFromRoute}
            activeOpacity={0.85}
            style={styles.scanQRFab}
          >
            <Text style={styles.scanQRFabText}>▣ Scan QR at this room</Text>
          </TouchableOpacity>
        )}

        {/* STEP SHEET */}
        {hasRoute && steps.length > 0 && (
          <View
            style={[
              styles.stepSheet,
              sheetOpen && styles.stepSheetOpen,
              { bottom: sheetBottomOffset },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                hapticLight()
                setSheetOpen((v) => !v)
              }}
              style={styles.stepSheetHeader}
            >
              <View style={styles.stepSheetIconBox}>
                <Text style={styles.stepSheetIcon}>
                  {steps[currentStepIdx]?.icon || '↑'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepSheetTitle} numberOfLines={2}>
                  {steps[currentStepIdx]?.title || ''}
                </Text>
                <Text style={styles.stepSheetSubtitle} numberOfLines={2}>
                  {steps[currentStepIdx]?.subtitle || ''}
                </Text>
              </View>
              <Text style={styles.stepSheetCount}>
                {currentStepIdx + 1}/{steps.length}
              </Text>
              <Text style={styles.stepSheetChevron}>
                {sheetOpen ? '▾' : '▴'}
              </Text>
            </TouchableOpacity>

            {sheetOpen && (
              <ScrollView
                style={styles.stepList}
                showsVerticalScrollIndicator={false}
              >
                {steps.map((s, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.stepRow,
                      idx === currentStepIdx && styles.stepRowActive,
                    ]}
                    onPress={() => handleStepPress(idx)}
                  >
                    <Text style={styles.stepRowIcon}>{s.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepRowTitle} numberOfLines={2}>
                        {s.title}
                      </Text>
                      {!!s.subtitle && (
                        <Text style={styles.stepRowSub} numberOfLines={2}>
                          {s.subtitle}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>

      {/* FOOTER */}
      {!sheetOpen && (
        <View style={styles.footer}>
          {hasRoute ? (
            <>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#059669' }]} />
                <Text style={styles.legendLabel}>Start</Text>
                <View
                  style={[styles.legendDot, { backgroundColor: '#8B0000', marginLeft: 16 }]}
                />
                <Text style={styles.legendLabel}>Destination</Text>
                <View
                  style={[styles.legendDot, { backgroundColor: '#F59E0B', marginLeft: 16 }]}
                />
                <Text style={styles.legendLabel}>Pinned</Text>
              </View>
              <Text style={styles.routeSummary} numberOfLines={2}>
                {path.length} steps ·{' '}
                {targetRoomName ||
                  (debugEndLabel ? `${debugStartLabel} → ${debugEndLabel}` : '')}
              </Text>
            </>
          ) : (
            <Text style={styles.browseHint} numberOfLines={2}>
              {error
                ? 'No route available'
                : debugOpen
                ? 'Pick a start and end node, then press Run'
                : pinnedLocation
                ? `Pinned: ${pinnedLocation.label} — tap Directions to route`
                : 'Tap a class in Schedule, or search above'}
            </Text>
          )}
          <Text style={styles.hint} numberOfLines={2}>
            Pinch · Drag · Twist · Double-tap to reset · Long-press to pin
          </Text>
        </View>
      )}

      {/* NODE PICKER MODAL */}
      <Modal
        visible={pickingFor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickingFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: screenH * 0.8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Pick {pickingFor === 'start' ? 'start' : 'end'} node
              </Text>
              <TouchableOpacity onPress={() => setPickingFor(null)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchBox}>
              <Text style={styles.modalSearchIcon}>🔍</Text>
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder="Search nodes…"
                placeholderTextColor="#9CA3AF"
                style={styles.modalSearchInput}
                autoFocus
              />
            </View>
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {pickerResults.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={styles.modalItem}
                  onPress={() => handlePickNode(n)}
                >
                  <Text style={styles.modalItemLabel} numberOfLines={1}>
                    {n.label}
                  </Text>
                  <Text style={styles.modalItemCoord} numberOfLines={1}>
                    {n.coord_x},{n.coord_y}
                  </Text>
                </TouchableOpacity>
              ))}
              {pickerResults.length === 0 && (
                <Text style={styles.modalEmpty}>No matching nodes</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: '#F5F5F7',
  },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
  },
  headerBack: { width: 70 },
  headerBackText: { color: '#8B0000', fontWeight: '600', fontSize: 15 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#8B0000',
    marginBottom: 2,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  headerReset: { width: 70, alignItems: 'flex-end' },
  headerResetText: { color: '#8B0000', fontWeight: '600', fontSize: 14 },
  headerResetTextActive: { color: '#059669' },

  debugPanel: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  debugTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#059669',
    marginBottom: 10,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  debugRowLabel: {
    width: 60,
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  debugRowValue: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  debugRowPlaceholder: { color: '#9CA3AF', fontStyle: 'italic', fontWeight: '500' },
  debugButtonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  debugRunButton: {
    flex: 1,
    backgroundColor: '#8B0000',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  debugRunText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  debugClearButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  debugClearText: { color: '#1A1A1A', fontWeight: '600', fontSize: 14 },

  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    zIndex: 100,
    elevation: 100,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A', padding: 0 },
  searchClear: { fontSize: 16, color: '#9CA3AF', paddingHorizontal: 8 },
  searchResultsAbsolute: {
    position: 'absolute',
    top: 58,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ECECEC',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 1000,
  },
  searchResultsScroll: { maxHeight: 300 },
  searchResultItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  searchResultLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchResultIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  searchResultText: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  searchResultSubtext: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  mapArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#F5F5F7',
  },

  floorSwitcher: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  floorSwitcherContent: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  floorChipGroup: { flexDirection: 'row', alignItems: 'center' },
  floorBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    maxWidth: 160,
  },
  floorBtnActive: { backgroundColor: '#8B0000' },
  floorBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.2,
  },
  floorBtnTextActive: { color: '#FFFFFF' },
  floorArrow: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C7C7C7',
    marginHorizontal: 2,
  },

  refreshFab: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  refreshIcon: {
    fontSize: 20,
    color: '#8B0000',
    fontWeight: '800',
    lineHeight: 22,
    marginTop: -1,
  },

  transitionBanner: {
    position: 'absolute',
    left: 16,
    right: 82,
    bottom: 90,
    backgroundColor: '#8B0000',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 22,
    shadowColor: '#8B0000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  transitionBannerLeft: { flexDirection: 'column', flex: 1 },
  transitionBannerLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  transitionBannerTarget: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  transitionBannerArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 10,
  },

  clearPinFab: {
    position: 'absolute',
    top: 108,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    zIndex: 11,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  clearPinText: { fontSize: 12, fontWeight: '700', color: '#8B0000' },
  errorBanner: {
    position: 'absolute',
    top: 155,
    left: 16,
    right: 16,
    padding: 10,
    backgroundColor: '#FFF4D6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F0D58C',
    zIndex: 5,
  },
  errorBannerText: { color: '#7A5200', fontSize: 12, fontWeight: '600' },
  noImageBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECECEC',
    borderRadius: 12,
  },
  noImageText: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },

  mapControls: {
    position: 'absolute',
    right: 20,
    bottom: 90,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 14,
    paddingVertical: 4,
    zIndex: 25,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  mapControlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapControlBtnActive: { backgroundColor: '#FFF5F5' },
  mapControlDivider: {
    height: 1,
    backgroundColor: '#ECECEC',
    marginHorizontal: 10,
  },
  mapControlIcon: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 24,
  },
  mapControlIconSmall: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  mapControlCompass: {
    fontSize: 18,
    color: '#8B0000',
    fontWeight: '900',
  },

  directionsFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E88E5',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    gap: 8,
    shadowColor: '#1E88E5',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    zIndex: 20,
    maxWidth: '80%',
  },
  directionsFabText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  scanQRFab: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: '#059669',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: '#059669',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    zIndex: 20,
  },
  scanQRFabText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  stepSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    maxHeight: 92,
    overflow: 'hidden',
    zIndex: 30,
  },
  stepSheetOpen: {
    maxHeight: '60%',
  },
  stepSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  stepSheetIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepSheetIcon: { fontSize: 18, color: '#8B0000', fontWeight: '800' },
  stepSheetTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  stepSheetSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  stepSheetCount: { fontSize: 11, color: '#9CA3AF', fontWeight: '700' },
  stepSheetChevron: { fontSize: 12, color: '#9CA3AF', marginLeft: 4 },
  stepList: { maxHeight: 320 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  stepRowActive: { backgroundColor: '#FFF5F5' },
  stepRowIcon: {
    fontSize: 16,
    color: '#8B0000',
    width: 24,
    textAlign: 'center',
  },
  stepRowTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A1A' },
  stepRowSub: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECECEC',
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendLabel: { fontSize: 13, color: '#4B5563', fontWeight: '500' },
  routeSummary: { marginTop: 6, fontSize: 12, color: '#9CA3AF' },
  browseHint: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  hint: { marginTop: 6, fontSize: 11, color: '#C7C7C7', fontStyle: 'italic' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  modalClose: { paddingHorizontal: 8, paddingVertical: 4 },
  modalCloseText: { fontSize: 18, color: '#6B7280' },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 42,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
  },
  modalSearchIcon: { fontSize: 14, marginRight: 8 },
  modalSearchInput: { flex: 1, fontSize: 14, color: '#1A1A1A', padding: 0 },
  modalList: { paddingHorizontal: 20 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  modalItemLabel: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', flex: 1 },
  modalItemCoord: { fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' },
  modalEmpty: { textAlign: 'center', paddingVertical: 30, color: '#9CA3AF', fontSize: 13 },
})

export default CampusMapScreen