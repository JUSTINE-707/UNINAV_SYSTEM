import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'
import Papa from 'papaparse'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useSemester } from '../../context/SemesterContext'
import {
  buildRoomAvailability,
  getInitialSelectedDay,
  HOURS,
  WEEK_DAYS,
} from '../../utils/roomAvailability'

const COLORS = {
  crimson: '#D0112B',
  ink: '#0B0B0D',
  inkSoft: '#3F3F46',
  muted: '#71717A',
  faint: '#A1A1AA',
  border: '#E7E7E9',
  canvas: '#F2F2F4',
  white: '#FFFFFF',
  green: '#0F7A4A',
  greenSoft: '#ECFDF5',
  red: '#9F1239',
  redSoft: '#FCE7F3',
}

const PAGE_SIZE = 500

const formatHour = (hour) => {
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:00 ${period}`
}

const RoomAvailabilityScreen = ({ navigation }) => {
  const { role, loading: authLoading } = useAuth()
  const { semester, loading: semesterLoading } = useSemester()
  const isProfessor = role === 'faculty' || role === 'professor'
  const [schedules, setSchedules] = useState([])
  const [loadedSemesterId, setLoadedSemesterId] = useState(null)
  const [selectedDay, setSelectedDay] = useState('M')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const report = useMemo(() => buildRoomAvailability(schedules), [schedules])
  const reportIsCurrent = loadedSemesterId === (semester?.id || null)
  const selectedDayInfo = WEEK_DAYS.find(({ code }) => code === selectedDay)
  const scheduledDaySet = useMemo(
    () => new Set(report.scheduledDays),
    [report.scheduledDays]
  )

  useFocusEffect(
    useCallback(() => {
      let isActive = true

      const loadSchedules = async () => {
        if (authLoading || semesterLoading) return
        setLoading(true)
        setError('')

        if (!isProfessor) {
          setSchedules([])
          setLoadedSemesterId(null)
          setLoading(false)
          setRefreshing(false)
          return
        }

        if (!semester?.id) {
          setSchedules([])
          setLoadedSemesterId(null)
          setLoading(false)
          setRefreshing(false)
          return
        }

        try {
          const allSchedules = []
          let offset = 0

          while (true) {
            const { data, error: queryError } = await supabase
              .from('schedules')
              .select('room_name, day, start_time, end_time')
              .eq('semester_id', semester.id)
              .order('id', { ascending: true })
              .range(offset, offset + PAGE_SIZE - 1)

            if (queryError) throw queryError
            if (!isActive) return

            const page = data || []
            allSchedules.push(...page)
            if (page.length < PAGE_SIZE) break
            offset += PAGE_SIZE
          }

          if (!isActive) return
          const nextReport = buildRoomAvailability(allSchedules)
          setSchedules(allSchedules)
          setLoadedSemesterId(semester.id)
          setSelectedDay(getInitialSelectedDay(nextReport.scheduledDays))
        } catch (loadError) {
          console.error('Room availability load error:', loadError)
          if (isActive) {
            setSchedules([])
            setError(
              loadError?.message ||
                'Unable to load schedules for the active semester.'
            )
          }
        } finally {
          if (isActive) {
            setLoading(false)
            setRefreshing(false)
          }
        }
      }

      loadSchedules()
      return () => {
        isActive = false
      }
    }, [authLoading, isProfessor, semester?.id, semesterLoading, refreshKey])
  )

  const exportCsv = async () => {
    if (
      !isProfessor ||
      !report.totalRooms ||
      exporting ||
      loading ||
      error ||
      !reportIsCurrent
    ) {
      return
    }

    setExporting(true)
    try {
      const rows = [
        ['Day', 'Time Slot', 'Available Rooms'],
        ...WEEK_DAYS.flatMap(({ code, name }) =>
          HOURS.map((hour) => {
            const availableNames =
              report.availability[`${code}-${hour}`]?.availableNames || []
            return [
              name,
              `${formatHour(hour)} - ${formatHour(hour + 1)}`,
              availableNames.length
                ? availableNames.join('; ')
                : 'No rooms available',
            ]
          })
        ),
      ]
      const csv = Papa.unparse(rows, { newline: '\r\n' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File(
        Paths.cache,
        `room-availability-${timestamp}.csv`
      )
      file.write(csv)

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('File sharing is not available on this device.')
      }

      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Share room availability report',
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      })
    } catch (exportError) {
      console.error('Room availability CSV export error:', exportError)
      Alert.alert(
        'Unable to export report',
        exportError?.message || 'Please try again.'
      )
    } finally {
      setExporting(false)
    }
  }

  const refresh = () => {
    setRefreshing(true)
    setRefreshKey((key) => key + 1)
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.canvas} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={COLORS.crimson}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={20} color={COLORS.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Text style={styles.eyebrow}>REPORTS</Text>
            <Text style={styles.title}>Room availability</Text>
            <Text style={styles.semesterLabel}>
              {semester?.name || 'Active semester'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.exportButton,
              (!report.totalRooms ||
                !isProfessor ||
                exporting ||
                loading ||
                error ||
                !reportIsCurrent) &&
                styles.disabledButton,
            ]}
            onPress={exportCsv}
            disabled={
              !report.totalRooms ||
              !isProfessor ||
              exporting ||
              loading ||
              !!error ||
              !reportIsCurrent
            }
            accessibilityRole="button"
            accessibilityLabel="Export room availability as CSV"
            accessibilityState={{
              disabled:
                !report.totalRooms ||
                !isProfessor ||
                exporting ||
                loading ||
                !!error ||
                !reportIsCurrent,
            }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Feather name="share" size={16} color={COLORS.white} />
                <Text style={styles.exportButtonText}>CSV</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {authLoading || loading ? (
          <View style={styles.messageCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={COLORS.crimson} />
            <Text style={styles.messageText}>Loading room availability...</Text>
          </View>
        ) : !isProfessor ? (
          <View style={styles.messageCard}>
            <View style={styles.messageIconError}>
              <Feather name="lock" size={22} color={COLORS.red} />
            </View>
            <Text style={styles.messageTitle}>Professor access only</Text>
            <Text style={styles.messageText}>
              This room availability report is available to professor accounts
              only.
            </Text>
          </View>
        ) : error ? (
          <View style={styles.messageCard}>
            <View style={styles.messageIconError}>
              <Feather name="alert-circle" size={22} color={COLORS.red} />
            </View>
            <Text style={styles.messageTitle}>Could not load schedules</Text>
            <Text style={styles.messageText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={refresh}
              accessibilityRole="button"
              accessibilityLabel="Retry loading schedules"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !reportIsCurrent ? (
          <View style={styles.messageCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={COLORS.crimson} />
            <Text style={styles.messageText}>Loading room availability...</Text>
          </View>
        ) : !semester?.id ? (
          <View style={styles.messageCard}>
            <View style={styles.messageIcon}>
              <Feather name="calendar" size={22} color={COLORS.crimson} />
            </View>
            <Text style={styles.messageTitle}>No active semester</Text>
            <Text style={styles.messageText}>
              Room availability will appear when a semester is active.
            </Text>
          </View>
        ) : report.totalRooms === 0 ? (
          <View style={styles.messageCard}>
            <View style={styles.messageIcon}>
              <Feather name="map-pin" size={22} color={COLORS.crimson} />
            </View>
            <Text style={styles.messageTitle}>No physical rooms found</Text>
            <Text style={styles.messageText}>
              The active semester&apos;s schedules do not include any physical
              rooms.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryIcon}>
                <Feather name="check-circle" size={19} color={COLORS.green} />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryTitle}>
                  {report.totalRooms} physical{' '}
                  {report.totalRooms === 1 ? 'room' : 'rooms'} tracked
                </Text>
                <Text style={styles.summarySubtitle}>
                  Hourly availability from 7:00 AM to 9:00 PM
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>SELECT A DAY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.daySelector}
              accessibilityLabel="Weekday selectors"
            >
              {WEEK_DAYS.map(({ code, label, name }) => {
                const isSelected = selectedDay === code
                const hasClasses = scheduledDaySet.has(code)
                return (
                  <TouchableOpacity
                    key={code}
                    style={[
                      styles.dayButton,
                      isSelected && styles.dayButtonSelected,
                    ]}
                    onPress={() => setSelectedDay(code)}
                    accessibilityRole="button"
                    accessibilityLabel={`${name}${
                      hasClasses ? ', scheduled classes' : ', no scheduled classes'
                    }`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[
                        styles.dayButtonText,
                        isSelected && styles.dayButtonTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                    <View
                      style={[
                        styles.dayDot,
                        hasClasses && styles.dayDotScheduled,
                        isSelected && styles.dayDotSelected,
                      ]}
                    />
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            <View style={styles.dayHeading}>
              <View>
                <Text style={styles.dayName}>{selectedDayInfo?.name}</Text>
                <Text style={styles.dayHint}>
                  Rooms with no overlapping class are listed as available.
                </Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{HOURS.length} slots</Text>
              </View>
            </View>

            <View style={styles.slotList}>
              {HOURS.map((hour) => {
                const slot =
                  report.availability[`${selectedDay}-${hour}`] || {
                    availableNames: [],
                    freeCount: 0,
                  }
                return (
                  <View key={hour} style={styles.slotCard}>
                    <View style={styles.slotHeading}>
                      <Text style={styles.slotTime}>
                        {formatHour(hour)} - {formatHour(hour + 1)}
                      </Text>
                      <Text
                        style={[
                          styles.slotCount,
                          slot.freeCount > 0 && styles.slotCountAvailable,
                        ]}
                      >
                        {slot.freeCount} free
                      </Text>
                    </View>
                    {slot.availableNames.length ? (
                      <View style={styles.roomPills}>
                        {slot.availableNames.map((roomName, index) => (
                          <View
                            key={`${roomName}-${index}`}
                            style={styles.roomPill}
                          >
                            <Feather
                              name="check"
                              size={13}
                              color={COLORS.green}
                            />
                            <Text style={styles.roomPillText}>{roomName}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.noRoomsText}>
                        No rooms available
                      </Text>
                    )}
                  </View>
                )
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.canvas,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
  },
  eyebrow: {
    color: COLORS.crimson,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  title: {
    color: COLORS.ink,
    fontSize: 21,
    fontWeight: '800',
  },
  semesterLabel: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 3,
  },
  exportButton: {
    minWidth: 60,
    height: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.crimson,
    borderRadius: 12,
    marginLeft: 8,
  },
  disabledButton: {
    opacity: 0.45,
  },
  exportButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    marginBottom: 24,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.greenSoft,
    borderRadius: 13,
    marginRight: 12,
  },
  summaryCopy: {
    flex: 1,
  },
  summaryTitle: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  summarySubtitle: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  sectionLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  daySelector: {
    gap: 8,
    paddingBottom: 2,
  },
  dayButton: {
    width: 52,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dayButtonSelected: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  dayButtonText: {
    color: COLORS.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  dayButtonTextSelected: {
    color: COLORS.white,
  },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'transparent',
    marginTop: 5,
  },
  dayDotScheduled: {
    backgroundColor: COLORS.crimson,
  },
  dayDotSelected: {
    backgroundColor: COLORS.white,
  },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  dayName: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  dayHint: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  countBadgeText: {
    color: COLORS.inkSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  slotList: {
    gap: 10,
  },
  slotCard: {
    padding: 15,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
  },
  slotHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  slotTime: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  slotCount: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  slotCountAvailable: {
    color: COLORS.green,
  },
  roomPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: COLORS.greenSoft,
  },
  roomPillText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
  },
  noRoomsText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  messageCard: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 34,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    marginTop: 12,
  },
  messageIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#FCEBEC',
    marginBottom: 13,
  },
  messageIconError: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: COLORS.redSoft,
    marginBottom: 13,
  },
  messageTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  messageText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.crimson,
    borderRadius: 12,
    marginTop: 18,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
})

export default RoomAvailabilityScreen
