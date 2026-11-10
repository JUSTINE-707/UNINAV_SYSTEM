import { useEffect, useRef } from 'react'
import { View, Animated, StyleSheet, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

// ============================================================
// Skeleton — animated placeholder block
//
// Matches the web ChairpersonDashboard's shimmer:
//   base:  #ECECEC
//   sweep: #F5F5F7 (a light band sliding across)
//   cycle: ~1.4s
// ============================================================

const BASE_COLOR = '#ECECEC'
const SHIMMER_COLOR = '#F5F5F7'
const SWEEP_DURATION = 1400
const BAND_WIDTH = 220

export const Skeleton = ({
  width,
  height = 14,
  radius = 8,
  style,
  animated = true,
}) => {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!animated) return
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SWEEP_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [animated, progress])

  // Sweep the band from just off the left edge to just off the right.
  // 800px covers the widest card we have (a full-width hero on tablet).
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-BAND_WIDTH, 800],
  })

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: BASE_COLOR,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {animated && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: BAND_WIDTH,
            transform: [{ translateX }],
          }}
        >
          <LinearGradient
            colors={['transparent', SHIMMER_COLOR, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  )
}

// ============================================================
// Convenience variants — keep using the same API as before
// ============================================================

export const SkeletonText = ({ width = '100%', height = 12, style }) => (
  <Skeleton width={width} height={height} radius={4} style={style} />
)

export const SkeletonTitle = ({ width = '60%', style }) => (
  <Skeleton width={width} height={22} radius={6} style={style} />
)

export const SkeletonCircle = ({ size = 44, style }) => (
  <Skeleton width={size} height={size} radius={size / 2} style={style} />
)

export const SkeletonCard = ({ height = 100, style }) => (
  <Skeleton width="100%" height={height} radius={14} style={style} />
)

export default Skeleton