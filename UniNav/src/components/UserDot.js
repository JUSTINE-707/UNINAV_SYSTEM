// >>> GPS-FIX: new file, save as src/components/UserDot.js (keep)
import { useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated'

// Place this INSIDE the Animated.View that holds the map image + Svg,
// after the <Svg>. Coordinates are in map-image pixels, so it pans,
// zooms and rotates together with the map.
//
// Props:
//   x, y      : position in image pixels
//   heading   : degrees clockwise from map-up (or null to hide the cone)
//   radius    : accuracy ring radius in image pixels (optional)

const DOT = 16

export default function UserDot({ x, y, heading = null, radius = 0 }) {
  const px = useSharedValue(x)
  const py = useSharedValue(y)
  const rot = useSharedValue(heading ?? 0)
  const rotRef = useRef(heading ?? 0)

  // Glide to each new position instead of teleporting.
  useEffect(() => {
    const cfg = { duration: 800, easing: Easing.out(Easing.cubic) }
    px.value = withTiming(x, cfg)
    py.value = withTiming(y, cfg)
  }, [x, y])

  // Rotate along the shortest arc (no 350° -> 10° spin).
  useEffect(() => {
    if (heading == null) return
    const d = ((heading - (rotRef.current % 360) + 540) % 360) - 180
    rotRef.current += d
    rot.value = withTiming(rotRef.current, { duration: 300 })
  }, [heading])

  const moveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: px.value }, { translateY: py.value }],
  }))
  const coneStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }))

  const ring = Math.min(Math.max(radius, 14), 140)

  return (
    <Animated.View pointerEvents="none" style={[styles.anchor, moveStyle]}>
      {radius > 0 && (
        <View
          style={{
            position: 'absolute',
            left: -ring,
            top: -ring,
            width: ring * 2,
            height: ring * 2,
            borderRadius: ring,
            backgroundColor: 'rgba(30,136,229,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(30,136,229,0.35)',
          }}
        />
      )}
      {heading != null && (
        <Animated.View style={[styles.coneWrap, coneStyle]}>
          <View style={styles.cone} />
        </Animated.View>
      )}
      <View style={styles.dot} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  coneWrap: {
    position: 'absolute',
    left: -26,
    top: -26,
    width: 52,
    height: 52,
    alignItems: 'center',
  },
  cone: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(30,136,229,0.7)',
  },
  dot: {
    position: 'absolute',
    left: -DOT / 2,
    top: -DOT / 2,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#1E88E5',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
})