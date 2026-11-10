// >>> GPS-FIX: whole file replaces src/hooks/useUserLocation.js (keep)
import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

// ------------------------------------------------------------
// Tunables
// ------------------------------------------------------------
const FIRST_FIX_MAX_ACCURACY = 30 // m: don't start the filter from a bad fix
const MAX_ACCURACY = 40 // m: ignore any fix worse than this
const MIN_ACCURACY = 3 // m: GPS never really knows better than this
const MAX_WALK_SPEED = 3 // m/s: faster than this = outlier
const MAX_REJECTS = 3 // consecutive outliers before we re-seed (avoids getting stuck)
const Q_MOVING = 3 // m/s process noise while walking (follows quickly)
const Q_UNKNOWN = 2 // m/s when the OS gives no speed
const Q_STILL = 0.4 // m/s when standing still (dot barely moves)
const PUBLISH_MIN_MOVE = 0.5 // m: don't re-render for tiny changes

const toRad = (d) => (d * Math.PI) / 180

const distanceBetween = (a, b) => {
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLat = lat2 - lat1
  const dLng = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export const useUserLocation = (enabled = true) => {
  const [coords, setCoords] = useState(null) // filtered { latitude, longitude, accuracy }
  const [rawCoords, setRawCoords] = useState(null) // unfiltered, for the debug dot
  const [heading, setHeading] = useState(null) // degrees from north, smoothed
  const [permission, setPermission] = useState('unknown')

  const filterRef = useRef(null) // { lat, lng, variance, ts }
  const publishedRef = useRef(null)
  const rejectRef = useRef(0)
  const headingRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    let posSub = null
    let headSub = null
    let cancelled = false
    filterRef.current = null
    publishedRef.current = null
    rejectRef.current = 0
    headingRef.current = null

    const publish = (f) => {
      const next = {
        latitude: f.lat,
        longitude: f.lng,
        accuracy: Math.sqrt(f.variance),
        timestamp: f.ts,
      }
      const last = publishedRef.current
      if (last && distanceBetween(last, next) < PUBLISH_MIN_MOVE) return
      publishedRef.current = next
      setCoords(next)
    }

    const handleFix = (loc) => {
      if (cancelled) return
      const { latitude, longitude, accuracy: rawAcc, speed } = loc.coords
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

      const ts = Number.isFinite(loc.timestamp) ? loc.timestamp : Date.now()
      const acc = Math.max(Number.isFinite(rawAcc) ? rawAcc : 20, MIN_ACCURACY)

      setRawCoords({ latitude, longitude, accuracy: acc })

      const f = filterRef.current

      // ---- First fix: wait for a decent one ----
      if (!f) {
        if (acc > FIRST_FIX_MAX_ACCURACY) return
        const seed = { lat: latitude, lng: longitude, variance: acc * acc, ts }
        filterRef.current = seed
        publish(seed)
        return
      }

      if (acc > MAX_ACCURACY) return

      const dt = Math.max((ts - f.ts) / 1000, 0.001)

      // ---- Outlier gate ----
      const jump = distanceBetween(
        { latitude: f.lat, longitude: f.lng },
        { latitude, longitude }
      )
      const maxJump = MAX_WALK_SPEED * dt + acc + Math.sqrt(f.variance)
      if (jump > maxJump) {
        rejectRef.current += 1
        if (rejectRef.current < MAX_REJECTS) return
        // Several "outliers" in a row = we were wrong, not them. Re-seed.
        rejectRef.current = 0
        const seed = { lat: latitude, lng: longitude, variance: acc * acc, ts }
        filterRef.current = seed
        publish(seed)
        return
      }
      rejectRef.current = 0

      // ---- Kalman update (position only) ----
      // Process noise depends on whether the user is actually moving.
      const q =
        speed == null || speed < 0
          ? Q_UNKNOWN
          : speed > 0.7
            ? Q_MOVING
            : Q_STILL
      const predictedVar = f.variance + dt * q * q
      const k = predictedVar / (predictedVar + acc * acc) // 0..1
      const updated = {
        lat: f.lat + k * (latitude - f.lat),
        lng: f.lng + k * (longitude - f.lng),
        variance: (1 - k) * predictedVar,
        ts,
      }
      filterRef.current = updated
      publish(updated)
    }

    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        setPermission(status)
        if (status !== 'granted') return

        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 1,
            timeInterval: 1000,
          },
          handleFix
        )
        if (cancelled) {
          posSub.remove()
          return
        }

        headSub = await Location.watchHeadingAsync((h) => {
          const val = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          if (!Number.isFinite(val)) return
          const prev = headingRef.current
          if (prev == null) {
            headingRef.current = val
            setHeading(val)
            return
          }
          // shortest angular difference, then low-pass + deadband
          const d = ((val - prev + 540) % 360) - 180
          if (Math.abs(d) < 4) return
          const next = (prev + d * 0.25 + 360) % 360
          headingRef.current = next
          setHeading(next)
        })
        if (cancelled) headSub.remove()
      } catch (err) {
        console.warn('Location error:', err?.message)
      }
    })()

    return () => {
      cancelled = true
      posSub?.remove()
      headSub?.remove()
    }
  }, [enabled])

  return { coords, rawCoords, heading, permission }
}