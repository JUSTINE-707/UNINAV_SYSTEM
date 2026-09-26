import { View, Text, StyleSheet } from 'react-native'
import { useSemester } from '../context/SemesterContext'

const SemesterProgressStrip = ({
  accentColor = '#8B0000',
  trackColor = '#ECECEC',
  variant = 'light',
}) => {
  const { semester, progress } = useSemester()

  if (!semester || !progress) return null

  const isDark = variant === 'dark'
  const labelColor = isDark ? '#FFFFFF' : '#0B0B0D'
  const subColor = isDark ? 'rgba(255,255,255,0.65)' : '#71717A'
  const track = isDark ? 'rgba(255,255,255,0.22)' : trackColor
  const fill = accentColor

  const pctLabel = `${Math.round(progress.pct * 100)}%`

  const dayLabel = (() => {
    if (progress.state === 'upcoming') {
      const start = new Date(semester.start_date + 'T00:00:00')
      const days = Math.max(
        0,
        Math.ceil((start - new Date()) / (1000 * 60 * 60 * 24))
      )
      return `Starts in ${days}d`
    }
    if (progress.state === 'ended') return 'Semester ended'
    if (progress.daysLeft === 0) return 'Last day'
    return `${progress.daysLeft}d left`
  })()

  return (
    <View style={[styles.wrap, isDark && styles.wrapDark]}>
      <View style={styles.topRow}>
        <Text
          style={[styles.eyebrow, { color: subColor }]}
          numberOfLines={1}
        >
          SEMESTER PROGRESS
        </Text>
        <Text style={[styles.pct, { color: labelColor }]}>{pctLabel}</Text>
      </View>

      <View style={[styles.track, { backgroundColor: track }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.max(2, progress.pct * 100)}%`,
              backgroundColor: fill,
            },
          ]}
        />
      </View>

      <View style={styles.bottomRow}>
        <Text
          style={[styles.subText, { color: subColor }]}
          numberOfLines={1}
        >
          {semester.name || semester.code || 'Semester'}
        </Text>
        <Text style={[styles.subText, { color: subColor }]}>{dayLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: -18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E7E9',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  wrapDark: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.24)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
  },
  pct: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  subText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
})

export default SemesterProgressStrip