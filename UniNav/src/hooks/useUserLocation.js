import { useEffect, useState } from 'react'
import * as Location from 'expo-location'

export const useUserLocation = (enabled = true) => {
  const [coords, setCoords] = useState(null) // { latitude, longitude, accuracy }
  const [heading, setHeading] = useState(null) // degrees from north
  const [permission, setPermission] = useState('unknown')

  useEffect(() => {
    if (!enabled) return
    let posSub = null
    let headSub = null
    let cancelled = false

    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        setPermission(status)
        if (status !== 'granted') return

        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 2,
            timeInterval: 1000,
          },
          (loc) => setCoords(loc.coords)
        )
        if (cancelled) {
          posSub.remove()
          return
        }
        headSub = await Location.watchHeadingAsync((h) =>
          setHeading(h.trueHeading >= 0 ? h.trueHeading : h.magHeading)
        )
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

  return { coords, heading, permission }
}