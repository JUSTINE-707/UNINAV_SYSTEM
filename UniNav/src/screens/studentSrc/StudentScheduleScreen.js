import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'

import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useSemester } from '../../context/SemesterContext'
import Skeleton, { SkeletonCircle } from '../../components/Skeleton'

// ============================================================
// CONSTANTS
// ============================================================

const DAY_ORDER = ['M', 'T', 'W', 'Th', 'F', 'Sat', 'Sun']

const DAY_LABELS = {
  M: 'Monday', T: 'Tuesday', W: 'Wednesday', Th: 'Thursday',
  F: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}

const DAY_SHORT = {
  M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu',
  F: 'Fri', Sat: 'Sat', Sun: 'Sun',
}

// ------------------------------------------------------------
// Student-facing cancellation reasons
// ------------------------------------------------------------

const STUDENT_REASON_LABELS = {
  official_duty: 'Your professor had an official university commitment.',
  medical: 'Your professor was on medical or sick leave.',
  emergency: 'Your professor had a personal emergency.',
  personal: 'Your professor was unavailable due to a personal matter.',
  other_prof: 'This class was cancelled by your professor.',

  class_cancelled: 'This class was cancelled.',
  no_students: 'No students attended, so the class did not push through.',
  room_unavailable: 'The assigned room was not available.',
  moved_online: 'This class was moved to an online session.',

  other: 'This class was cancelled.',
}

const buildCancelReason = (ghost) => {
  if (!ghost) return 'This class was cancelled.'

  const reason =
    STUDENT_REASON_LABELS[ghost.reason] ||
    STUDENT_REASON_LABELS[ghost.excused_reason] ||
    null

  if (reason) return reason

  const causeFallback = {
    professor: 'Your professor was not available.',
    students: 'No students attended.',
    room: 'The assigned room was not available.',
    admin: 'The class was moved or cancelled by the administration.',
    other: 'This class was cancelled.',
  }

  return causeFallback[ghost.cause] || 'This class was cancelled.'
}

// ============================================================
// HELPERS
// ============================================================

const isOnlineRoom = (roomName) => {
  if (!roomName) return false
  const n = roomName.trim().toUpperCase()
  return (
    n.includes('ONLINE') ||
    n.includes('ASYNCHRONOUS') ||
    n.includes('GOOGLE CLASSROOM') ||
    n === 'ZOOM' ||
    n === 'GOOGLE MEET' ||
    n === 'GMEET'
  )
}

const getTodayCode = () => {
  const map = { 0: 'Sun', 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sat' }
  return map[new Date().getDay()]
}

const toLocalDateString = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const getWeekRange = () => {
  const now = new Date()
  const dow = now.getDay()
  const diffToMonday = dow === 0 ? -6 : 1 - dow

  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return {
    start: toLocalDateString(monday),
    end: toLocalDateString(sunday),
  }
}

const formatTime = (time) => {
  if (!time) return ''
  const [h, m] = time.split(':')
  let hour = Number(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12
  if (hour === 0) hour = 12
  return `${hour}:${m} ${ampm}`
}

const timeToMinutes = (time) => {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const nowInMinutes = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

const formatVerifiedTime = (isoString) => {
  if (!isoString) return ''
  try {
    const t = new Date(isoString)
    return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

const getClassStatus = (item, todayCode) => {
  if (!item || item.day !== todayCode) return 'other'
  const now = nowInMinutes()
  const start = timeToMinutes(item.start_time)
  const end = timeToMinutes(item.end_time)
  if (start === null || end === null) return 'other'
  if (now >= start && now < end) return 'now'
  if (now < start && start - now <= 60) return 'soon'
  if (now < start) return 'next'
  return 'done'
}

// ============================================================
// LIVE STATUS
// ============================================================

const getLiveStatus = (cls, nowMin) => {
  const todayCode = getTodayCode()
  if (cls.day !== todayCode) return null

  const start = timeToMinutes(cls.start_time)
  const end = timeToMinutes(cls.end_time)

  const hasSession = !!cls.liveSession
  const isOnline = cls.liveSession
    ? cls.liveSession.class_type === 'online'
    : isOnlineRoom(cls.room_name)

  if (cls.ghostReport) {
    return {
      roomState: 'cancelled',
      icon: '⚠',
      headline: 'CLASS CANCELLED',
      subline: buildCancelReason(cls.ghostReport),
    }
  }

  if (isOnline) {
    return {
      roomState: 'online',
      icon: '🌐',
      headline: 'ONLINE CLASS',
      subline: hasSession
        ? 'Professor confirmed session online'
        : 'No physical room — join virtually',
    }
  }

  if (start === null || end === null) return null

  if (nowMin > end) {
    return {
      roomState: 'ended',
      icon: '·',
      headline: 'CLASS ENDED',
      subline: hasSession
        ? `Professor checked in at ${formatVerifiedTime(cls.liveSession.scanned_at)}`
        : 'Room was never verified',
    }
  }

  if (nowMin < start) {
    return {
      roomState: 'upcoming',
      icon: '🕐',
      headline: 'NOT STARTED YET',
      subline: `Starts at ${formatTime(cls.start_time)}`,
    }
  }

  if (hasSession) {
    const t = formatVerifiedTime(cls.liveSession.scanned_at)
    return {
      roomState: 'occupied',
      icon: '✓',
      headline: 'ROOM OCCUPIED',
      subline: t ? `Professor checked in at ${t}` : 'Professor is present in the room',
    }
  }

  return {
    roomState: 'vacant',
    icon: '⏳',
    headline: 'ROOM NOT OCCUPIED',
    subline: 'Professor has not scanned in yet',
  }
}

const stateAccent = (state) => {
  switch (state) {
    case 'occupied': return '#059669'
    case 'vacant': return '#D97706'
    case 'online': return '#3B82F6'
    case 'cancelled': return '#B00020'
    case 'ended': return '#9CA3AF'
    case 'upcoming': return '#8B0000'
    default: return '#9CA3AF'
  }
}

const getTodayLabel = () => {
  const d = new Date()
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
}

// ============================================================
// SCREEN
// ============================================================

const StudentScheduleScreen = () => {
  const { session } = useAuth()
  const { semester } = useSemester()
  const navigation = useNavigation()

  const [loading, setLoading] = useState(true)
  const [classes, setClasses] = useState([])
  const [errorMessage, setErrorMessage] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const [selectedDay, setSelectedDay] = useState(() => getTodayCode())

  // Modal
  const [detailClass, setDetailClass] = useState(null)

  const listRef = useRef(null)
  const didMountRef = useRef(false)

  // ============================================================
  // LOAD
  // ============================================================

  const loadSchedule = useCallback(async () => {
    try {
      setErrorMessage(null)

      if (!session?.user?.id) {
        setErrorMessage('No logged-in student was found.')
        return
      }

      if (!semester?.id) {
        setClasses([])
        return
      }

      const userId = session.user.id
      const { start: weekStartStr, end: weekEndStr } = getWeekRange()

      const { data: rosterRow, error: rosterErr } = await supabase
        .from('students_roster')
        .select('id, sr_code, full_name, user_id')
        .eq('user_id', userId)
        .maybeSingle()

      if (rosterErr) {
        setErrorMessage(`Roster error:\n${rosterErr.message}`)
        return
      }

      if (!rosterRow) {
        setErrorMessage(
          'Your roster record was not found. Please contact the admin.'
        )
        return
      }

      const { data: enrollments, error: enrollmentError } = await supabase
        .from('enrollments')
        .select(`
          id,
          student_id,
          schedule_id,
          semester_id,
          schedules (
            id,
            subject_code,
            course_title,
            professor_name,
            room_name,
            day,
            start_time,
            end_time
          )
        `)
        .eq('student_id', rosterRow.id)
        .eq('semester_id', semester.id)

      if (enrollmentError) {
        setErrorMessage(`Enrollment error:\n${enrollmentError.message}`)
        return
      }

      const baseList = (enrollments || [])
        .map((e) => e.schedules)
        .filter(Boolean)

      const scheduleIds = baseList.map((s) => s.id)

      if (scheduleIds.length === 0) {
        setClasses([])
        return
      }

      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)

      const [sessionsRes, ghostsRes] = await Promise.all([
        supabase
          .from('room_sessions')
          .select('schedule_id, status, class_type, scanned_at')
          .in('schedule_id', scheduleIds)
          .gte('scanned_at', startOfDay.toISOString())
          .lte('scanned_at', endOfDay.toISOString()),

        supabase
          .from('ghost_reports')
          .select(
            'schedule_id, reason, cause, is_excused, excused_reason, notes, report_date, created_at'
          )
          .in('schedule_id', scheduleIds)
          .gte('report_date', weekStartStr)
          .lte('report_date', weekEndStr)
          .order('created_at', { ascending: false }),
      ])

      if (sessionsRes.error)
        console.warn('[Schedule] room_sessions fetch:', sessionsRes.error.message)
      if (ghostsRes.error)
        console.warn('[Schedule] ghost_reports fetch:', ghostsRes.error.message)

      const sessionMap = {}
      ;(sessionsRes.data || []).forEach((s) => {
        sessionMap[s.schedule_id] = s
      })

      const ghostMap = {}
      ;(ghostsRes.data || []).forEach((g) => {
        if (!ghostMap[g.schedule_id]) {
          ghostMap[g.schedule_id] = g
        }
      })

      const merged = baseList.map((s) => ({
        ...s,
        liveSession: sessionMap[s.id] || null,
        ghostReport: ghostMap[s.id] || null,
      }))

      setClasses(merged)
    } catch (error) {
      console.error('[Schedule] Unexpected error:', error)
      setErrorMessage(`Unexpected error:\n${error.message}`)
    }
  }, [session, semester])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      await loadSchedule()
      setLoading(false)
    }
    run()
  }, [loadSchedule])

  // ============================================================
  // REALTIME
  // ============================================================

  const scheduleIdsRef = useRef(new Set())

  useEffect(() => {
    scheduleIdsRef.current = new Set(classes.map((c) => c.id))
  }, [classes])

  const realtimeChannelRef = useRef(null)

  useEffect(() => {
    if (realtimeChannelRef.current) {
      try {
        supabase.removeChannel(realtimeChannelRef.current)
      } catch (_) {}
      realtimeChannelRef.current = null
    }

    const channelName = `student_schedule_live_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_sessions' },
        (payload) => {
          const sid = payload.new?.schedule_id || payload.old?.schedule_id
          if (!sid || !scheduleIdsRef.current.has(sid)) return
          loadSchedule()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ghost_reports' },
        (payload) => {
          const sid = payload.new?.schedule_id || payload.old?.schedule_id
          if (!sid || !scheduleIdsRef.current.has(sid)) return
          loadSchedule()
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel

    return () => {
      try {
        supabase.removeChannel(channel)
      } catch (_) {}
      if (realtimeChannelRef.current === channel) {
        realtimeChannelRef.current = null
      }
    }
  }, [loadSchedule])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadSchedule()
    setRefreshing(false)
  }

  // ============================================================
  // DERIVED
  // ============================================================

  const todayCode = getTodayCode()

  const classesByDay = useMemo(() => {
    const groups = {}
    classes.forEach((item) => {
      if (!item.day) return
      if (!groups[item.day]) groups[item.day] = []
      groups[item.day].push(item)
    })
    Object.keys(groups).forEach((day) => {
      groups[day].sort((a, b) => {
        const aMin = timeToMinutes(a.start_time) ?? 0
        const bMin = timeToMinutes(b.start_time) ?? 0
        return aMin - bMin
      })
    })
    return groups
  }, [classes])

  const effectiveSelectedDay = useMemo(() => {
    const daysWithClasses = new Set(classes.map((c) => c.day).filter(Boolean))
    if (daysWithClasses.size === 0) return todayCode
    if (daysWithClasses.has(selectedDay)) return selectedDay
    const todayIndex = DAY_ORDER.indexOf(todayCode)
    for (let offset = 0; offset < 7; offset++) {
      const day = DAY_ORDER[(todayIndex + offset) % 7]
      if (daysWithClasses.has(day)) return day
    }
    return todayCode
  }, [classes, selectedDay, todayCode])

  const sections = useMemo(() => {
    if (classes.length === 0) return []
    const anchorIndex = DAY_ORDER.indexOf(effectiveSelectedDay)
    if (anchorIndex < 0) return []
    const rotatedOrder = [
      ...DAY_ORDER.slice(anchorIndex),
      ...DAY_ORDER.slice(0, anchorIndex),
    ]
    return rotatedOrder
      .filter((day) => {
        const has = classesByDay[day]?.length > 0
        const isTodayEmpty = day === todayCode && !has
        return has || isTodayEmpty
      })
      .map((day) => {
        const isEmpty = !classesByDay[day]?.length
        return {
          title: day,
          label: DAY_LABELS[day] || day,
          short: DAY_SHORT[day] || day,
          isToday: day === todayCode,
          isSelected: day === effectiveSelectedDay,
          isEmpty,
          data: isEmpty ? [] : classesByDay[day],
        }
      })
  }, [classes, classesByDay, effectiveSelectedDay, todayCode])

  const stats = useMemo(() => {
    const subjects = new Set(classes.map((c) => c.subject_code))
    const rooms = new Set(classes.map((c) => c.room_name).filter(Boolean))
    let minutes = 0
    classes.forEach((c) => {
      const s = timeToMinutes(c.start_time)
      const e = timeToMinutes(c.end_time)
      if (s !== null && e !== null && e > s) minutes += e - s
    })
    const hours = Math.round((minutes / 60) * 10) / 10
    return { classes: classes.length, subjects: subjects.size, rooms: rooms.size, hours }
  }, [classes])

  const nextClass = useMemo(() => {
    const todayClasses = classesByDay[todayCode] || []
    const now = nowInMinutes()
    const upcomingToday = todayClasses.find((c) => {
      const end = timeToMinutes(c.end_time)
      return end !== null && end > now
    })
    if (upcomingToday) return upcomingToday
    if (sections.length === 0) return null
    for (const section of sections) {
      if (section.isToday) continue
      return section.data[0]
    }
    return null
  }, [classesByDay, sections, todayCode])

  const handleSelectDay = (dayCode) => {
    if (!dayCode) return
    if (dayCode === effectiveSelectedDay) return
    setSelectedDay(dayCode)
  }

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToLocation({
          sectionIndex: 0, itemIndex: 0, viewOffset: 0, animated: true,
        })
      } catch (err) {
        setTimeout(() => {
          try {
            listRef.current?.scrollToLocation({
              sectionIndex: 0, itemIndex: 0, viewOffset: 0, animated: true,
            })
          } catch (_) {}
        }, 200)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [effectiveSelectedDay])

  // ============================================================
  // MODAL / NAV
  // ============================================================

  const closeDetail = () => setDetailClass(null)

  const openMapForRoom = (roomName) => {
    if (!roomName) return
    if (isOnlineRoom(roomName)) return
    closeDetail()
    navigation.navigate('StudentMap', { roomName })
  }

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return <StudentScheduleSkeleton />
  }

  // ============================================================
  // ERROR
  // ============================================================

  if (errorMessage) {
    return (
      <View style={styles.center}>
        <View style={styles.errorIconWrap}>
          <Text style={styles.errorIcon}>!</Text>
        </View>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    )
  }

  // ============================================================
  // NO SEMESTER
  // ============================================================

  if (!semester) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIconWrap}>
          <Text style={styles.emptyIcon}>📚</Text>
        </View>
        <Text style={styles.emptyTitle}>No active semester</Text>
        <Text style={styles.emptyText}>
          There's no semester open right now. Please contact your program chair
          or the admin.
        </Text>
      </View>
    )
  }

  // ============================================================
  // NO CLASSES
  // ============================================================

  if (classes.length === 0) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIconWrap}>
          <Text style={styles.emptyIcon}>📭</Text>
        </View>
        <Text style={styles.emptyTitle}>No classes yet</Text>
        <Text style={styles.emptyText}>
          No enrollment records found for {semester.name}. Check with your
          program chair or academic office.
        </Text>
      </View>
    )
  }

  // ============================================================
  // RENDER
  // ============================================================

  const nowMin = nowInMinutes()
  const nextLive = nextClass ? getLiveStatus(nextClass, nowMin) : null

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        ref={listRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}

        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <Text style={styles.heroEyebrow}>MY SCHEDULE</Text>
              <Text style={styles.heroDate}>{getTodayLabel()}</Text>
              {semester && (
                <Text style={styles.heroSemester}>{semester.name}</Text>
              )}
              <View style={styles.statsRow}>
                <Stat label="Classes" value={stats.classes} />
                <View style={styles.statDivider} />
                <Stat label="Subjects" value={stats.subjects} />
                <View style={styles.statDivider} />
                <Stat label="Hours" value={stats.hours} />
                <View style={styles.statDivider} />
                <Stat label="Rooms" value={stats.rooms} />
              </View>
            </View>

            {nextClass && nextLive && (
              <View style={styles.spotlight}>
                <View style={styles.spotlightTop}>
                  <Text style={styles.spotlightLabel}>UP NEXT</Text>
                  <TouchableOpacity
                    onPress={() => handleSelectDay(nextClass.day)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={({ pressed }) => [
                      styles.spotlightDayPill,
                      pressed && styles.spotlightDayPillPressed,
                    ]}
                  >
                    <Text style={styles.spotlightDayText}>
                      {DAY_SHORT[nextClass.day] || nextClass.day}
                    </Text>
                    <Text style={styles.spotlightDayChevron}>›</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.spotlightSubject}>{nextClass.subject_code}</Text>
                <Text style={styles.spotlightTitle} numberOfLines={2}>
                  {nextClass.course_title}
                </Text>

                <View style={styles.spotlightMetaRow}>
                  <Text style={styles.spotlightMeta}>
                    🕐  {formatTime(nextClass.start_time)} – {formatTime(nextClass.end_time)}
                  </Text>
                </View>
                <View style={styles.spotlightMetaRow}>
                  <Text style={styles.spotlightMeta}>
                    📍  {nextClass.room_name || 'Not assigned'}
                  </Text>
                </View>
                <View style={styles.spotlightMetaRow}>
                  <Text style={styles.spotlightMeta}>
                    👤  {nextClass.professor_name || 'Not assigned'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.spotlightStatusBlock,
                    { borderLeftColor: stateAccent(nextLive.roomState) },
                  ]}
                >
                  <Text style={styles.spotlightStatusHeadline}>
                    {nextLive.icon}  {nextLive.headline}
                  </Text>
                  <Text style={styles.spotlightStatusSub}>{nextLive.subline}</Text>
                </View>

                <TouchableOpacity
                  onPress={() => setDetailClass(nextClass)}
                  activeOpacity={0.8}
                  style={styles.spotlightRouteButton}
                >
                  <Text style={styles.spotlightRouteButtonText}>
                    View details →
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayStrip}
            >
              {sections.map((section) => (
                <TouchableOpacity
                  key={section.title}
                  activeOpacity={0.7}
                  onPress={() => handleSelectDay(section.title)}
                  style={[
                    styles.dayChip,
                    section.isSelected && styles.dayChipSelected,
                    section.isToday && !section.isSelected && styles.dayChipTodayOutline,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayChipText,
                      section.isSelected && styles.dayChipTextSelected,
                    ]}
                  >
                    {section.short}
                  </Text>
                  {section.isToday && !section.isSelected && (
                    <View style={styles.todayIndicator} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.sectionListHeading}>Weekly schedule</Text>
          </View>
        }

        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionDot, section.isToday && styles.sectionDotToday]} />
              <Text style={[styles.sectionTitle, section.isToday && styles.sectionTitleToday]}>
                {section.isToday ? 'Today' : section.label}
              </Text>
            </View>
            {section.isToday && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>{section.title}</Text>
              </View>
            )}
            <Text style={styles.sectionCount}>
              {section.data.length} {section.data.length === 1 ? 'class' : 'classes'}
            </Text>
          </View>
        )}

        renderItem={({ item, section }) => {
          const status = getClassStatus(item, todayCode)
          const live = getLiveStatus(item, nowMin)
          const isGhost = !!item.ghostReport

          const accent =
            isGhost ? '#B00020'
            : status === 'now' ? '#059669'
            : status === 'soon' ? '#D97706'
            : status === 'next' && section.isToday ? '#8B0000'
            : '#9CA3AF'

          const online = isOnlineRoom(item.room_name)

          return (
            <View style={styles.row}>
              <View style={styles.rail}>
                <Text style={styles.railTime}>
                  {formatTime(item.start_time).replace(' ', '\n')}
                </Text>
                <View style={[styles.railDot, { backgroundColor: accent }]} />
                <View style={[styles.railLine, { backgroundColor: accent + '40' }]} />
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setDetailClass(item)}
                style={[
                  styles.card,
                  section.isToday && styles.cardToday,
                  online && styles.cardOnline,
                  isGhost && styles.cardGhost,
                ]}
              >
                <View style={[styles.cardAccent, { backgroundColor: accent }]} />

                <View style={styles.cardBody}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.subject}>{item.subject_code}</Text>

                    {isGhost ? (
                      <View style={styles.badgeCancelled}>
                        <Text style={styles.badgeCancelledText}>CANCELLED</Text>
                      </View>
                    ) : (
                      <>
                        {status === 'now' && (
                          <View style={styles.badgeNow}>
                            <Text style={styles.badgeNowText}>NOW</Text>
                          </View>
                        )}
                        {status === 'soon' && (
                          <View style={styles.badgeSoon}>
                            <Text style={styles.badgeSoonText}>SOON</Text>
                          </View>
                        )}
                        {status === 'done' && (
                          <View style={styles.badgeDone}>
                            <Text style={styles.badgeDoneText}>DONE</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  <Text
                    style={[styles.title, isGhost && styles.titleGhost]}
                    numberOfLines={2}
                  >
                    {item.course_title}
                  </Text>

                  <Text style={[styles.time, isGhost && styles.timeGhost]}>
                    {formatTime(item.start_time)} – {formatTime(item.end_time)}
                  </Text>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaIcon}>📍</Text>
                    <Text
                      style={[styles.metaText, isGhost && styles.metaTextGhost]}
                      numberOfLines={1}
                    >
                      {item.room_name || 'Room not assigned'}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaIcon}>👤</Text>
                    <Text
                      style={[styles.metaText, isGhost && styles.metaTextGhost]}
                      numberOfLines={1}
                    >
                      {item.professor_name || 'Professor not assigned'}
                    </Text>
                  </View>

                  {isGhost && (
                    <View style={styles.reasonChip}>
                      <Text style={styles.reasonChipIcon}>📋</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reasonChipTitle}>Why is this cancelled?</Text>
                        <Text style={styles.reasonChipText} numberOfLines={4}>
                          {buildCancelReason(item.ghostReport)}
                        </Text>
                      </View>
                    </View>
                  )}

                  {isGhost && !!item.ghostReport?.notes && (
                    <View style={styles.notesBox}>
                      <Text style={styles.notesLabel}>NOTE FROM PROFESSOR</Text>
                      <Text style={styles.notesText} numberOfLines={4}>
                        "{item.ghostReport.notes}"
                      </Text>
                    </View>
                  )}

                  {live && (
                    <View
                      style={[
                        styles.statusBlock,
                        {
                          borderLeftColor: stateAccent(live.roomState),
                          backgroundColor: stateAccent(live.roomState) + '14',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusHeadline,
                          { color: stateAccent(live.roomState) },
                        ]}
                      >
                        {live.icon}  {live.headline}
                      </Text>
                      <Text style={styles.statusSubline}>{live.subline}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>
          )
        }}

        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#8B0000"
          />
        }
      />

      {/* ============================================================
          CLASS DETAIL MODAL
          ============================================================ */}
      <Modal
        visible={!!detailClass}
        transparent
        animationType="slide"
        onRequestClose={closeDetail}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeDetail}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalGrabber} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {detailClass &&
                (() => {
                  const live = getLiveStatus(detailClass, nowMin)
                  const isGhost = !!detailClass.ghostReport
                  const isOnline = isOnlineRoom(detailClass.room_name)
                  const accent = live ? stateAccent(live.roomState) : '#9CA3AF'
                  const dayFull =
                    DAY_LABELS[detailClass.day] || detailClass.day || ''

                  const canViewRoute = !isGhost && !isOnline

                  return (
                    <>
                      {/* HEADER */}
                      <View style={styles.modalHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalEyebrow}>CLASS DETAILS</Text>
                          <Text style={styles.modalSubject}>
                            {detailClass.subject_code}
                          </Text>
                          <Text style={styles.modalTitle} numberOfLines={2}>
                            {detailClass.course_title}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={closeDetail}
                          style={styles.modalCloseBtn}
                        >
                          <Text style={styles.modalCloseText}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      {/* BADGES */}
                      <View style={styles.modalBadgesRow}>
                        {isGhost ? (
                          <View
                            style={[styles.modalBadge, styles.modalBadgeCancelled]}
                          >
                            <Text
                              style={[
                                styles.modalBadgeText,
                                styles.modalBadgeTextCancelled,
                              ]}
                            >
                              ! CANCELLED
                            </Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.modalBadge,
                              isOnline
                                ? styles.modalBadgeOnline
                                : styles.modalBadgeF2F,
                            ]}
                          >
                            <Text
                              style={[
                                styles.modalBadgeText,
                                isOnline
                                  ? styles.modalBadgeTextOnline
                                  : styles.modalBadgeTextF2F,
                              ]}
                            >
                              {isOnline
                                ? '🌐 ONLINE'
                                : '● FACE-TO-FACE'}
                            </Text>
                          </View>
                        )}

                        {live && (
                          <View style={styles.modalStatusPill}>
                            <Text
                              style={[
                                styles.modalStatusPillText,
                                { color: accent },
                              ]}
                            >
                              ● {live.headline}
                            </Text>
                          </View>
                        )}

                        {!!dayFull && (
                          <View style={styles.modalDayPill}>
                            <Text style={styles.modalDayPillText}>
                              {dayFull}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* INFO GRID */}
                      <View style={styles.modalGrid}>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>PROFESSOR</Text>
                          <Text
                            style={styles.modalGridValue}
                            numberOfLines={1}
                          >
                            {detailClass.professor_name || '—'}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>ROOM</Text>
                          <Text
                            style={styles.modalGridValue}
                            numberOfLines={1}
                          >
                            {isOnline
                              ? 'Online'
                              : detailClass.room_name || '—'}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>START</Text>
                          <Text
                            style={styles.modalGridValue}
                            numberOfLines={1}
                          >
                            {formatTime(detailClass.start_time)}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>END</Text>
                          <Text
                            style={styles.modalGridValue}
                            numberOfLines={1}
                          >
                            {formatTime(detailClass.end_time)}
                          </Text>
                        </View>
                      </View>

                      {/* UNIFIED STATUS BLOCK — cancellation reason folded in */}
                      {live && (
                        <View
                          style={[
                            styles.modalLiveBlock,
                            {
                              borderLeftColor: accent,
                              backgroundColor: accent + '14',
                            },
                          ]}
                        >
                          <View style={styles.modalLiveHeader}>
                            <Text
                              style={[
                                styles.modalLiveHeadline,
                                { color: accent },
                              ]}
                            >
                              {isGhost
                                ? '⚠  CLASS CANCELLED'
                                : `${live.icon}  ${live.headline}`}
                            </Text>
                            {!isGhost && detailClass.liveSession?.scanned_at && (
                              <Text
                                style={[
                                  styles.modalLiveTime,
                                  { color: accent },
                                ]}
                              >
                                {formatVerifiedTime(
                                  detailClass.liveSession.scanned_at
                                )}
                              </Text>
                            )}
                          </View>

                          <Text style={styles.modalLiveSubline}>
                            {isGhost
                              ? buildCancelReason(detailClass.ghostReport)
                              : live.subline}
                          </Text>
                        </View>
                      )}

                      {/* PROFESSOR NOTE */}
                      {isGhost && !!detailClass.ghostReport?.notes && (
                        <View style={styles.modalNotesBox}>
                          <Text style={styles.modalNotesLabel}>
                            NOTE FROM PROFESSOR
                          </Text>
                          <Text style={styles.modalNotesText}>
                            "{detailClass.ghostReport.notes}"
                          </Text>
                        </View>
                      )}

                      {/* ACTIONS */}
                      <View style={styles.modalActions}>
                        {canViewRoute && (
                          <TouchableOpacity
                            style={styles.modalPrimaryBtn}
                            onPress={() => openMapForRoom(detailClass.room_name)}
                          >
                            <Text style={styles.modalPrimaryBtnText}>
                              ↗ View Route to Room
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={
                            canViewRoute
                              ? styles.modalSecondaryBtn
                              : styles.modalPrimaryBtn
                          }
                          onPress={closeDetail}
                        >
                          <Text
                            style={
                              canViewRoute
                                ? styles.modalSecondaryBtnText
                                : styles.modalPrimaryBtnText
                            }
                          >
                            Close
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )
                })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// ============================================================
// LOADING SKELETON
// ============================================================

const StudentScheduleSkeleton = () => (
  <View style={styles.container}>
    <View style={styles.content}>
      <View style={styles.hero}>
        <Skeleton width={90} height={11} radius={4} />
        <Skeleton width="75%" height={26} radius={6} style={{ marginTop: 10 }} />
        <Skeleton width={140} height={12} radius={4} style={{ marginTop: 8 }} />

        <View style={styles.statsRow}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.stat}>
              <Skeleton width={34} height={22} radius={6} />
              <Skeleton width={52} height={9} radius={3} style={{ marginTop: 8 }} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.spotlight}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Skeleton width={80} height={11} radius={4} />
          <Skeleton width={60} height={22} radius={999} />
        </View>
        <Skeleton width="40%" height={14} radius={4} style={{ marginTop: 16 }} />
        <Skeleton width="80%" height={22} radius={6} style={{ marginTop: 8 }} />
        <Skeleton width="60%" height={14} radius={4} style={{ marginTop: 16 }} />
        <Skeleton width="55%" height={14} radius={4} style={{ marginTop: 8 }} />
        <Skeleton width="65%" height={14} radius={4} style={{ marginTop: 8 }} />
        <Skeleton width="100%" height={62} radius={10} style={{ marginTop: 18 }} />
        <Skeleton width="100%" height={44} radius={12} style={{ marginTop: 16 }} />
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 8 }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton
            key={i}
            width={60}
            height={34}
            radius={999}
            style={{ marginRight: 8 }}
          />
        ))}
      </View>

      <Skeleton width={140} height={13} radius={4} style={{ marginTop: 20 }} />

      {[1, 2].map((sectionIdx) => (
        <View key={sectionIdx}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <SkeletonCircle size={8} />
              <Skeleton
                width={100}
                height={18}
                radius={6}
                style={{ marginLeft: 10, flex: 1 }}
              />
            </View>
            <Skeleton width={70} height={12} radius={4} />
          </View>

          {[1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <View style={styles.rail}>
                <Skeleton width={34} height={20} radius={4} />
                <SkeletonCircle size={10} style={{ marginTop: 6 }} />
              </View>
              <View style={styles.card}>
                <Skeleton width={4} height={140} radius={0} />
                <View style={styles.cardBody}>
                  <Skeleton width={70} height={14} radius={4} />
                  <Skeleton
                    width="85%"
                    height={16}
                    radius={4}
                    style={{ marginTop: 8 }}
                  />
                  <Skeleton
                    width="55%"
                    height={13}
                    radius={4}
                    style={{ marginTop: 10 }}
                  />
                  <Skeleton
                    width="70%"
                    height={12}
                    radius={4}
                    style={{ marginTop: 12 }}
                  />
                  <Skeleton
                    width="60%"
                    height={12}
                    radius={4}
                    style={{ marginTop: 6 }}
                  />
                  <Skeleton
                    width="100%"
                    height={56}
                    radius={10}
                    style={{ marginTop: 12 }}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  </View>
)

// ============================================================
// SUB-COMPONENT
// ============================================================

const Stat = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
)

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  content: { padding: 20, paddingBottom: 60 },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 30, backgroundColor: '#F5F5F7',
  },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14, fontWeight: '500' },

  errorIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  errorIcon: { fontSize: 28, fontWeight: '700', color: '#8B0000' },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginBottom: 8, textAlign: 'center' },
  errorText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },

  hero: { marginBottom: 20 },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#8B0000', marginBottom: 4 },
  heroDate: { fontSize: 24, fontWeight: '700', color: '#1A1A1A', marginBottom: 4, letterSpacing: -0.3 },
  heroSemester: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 20,
    letterSpacing: 0.2,
  },

  statsRow: {
    flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 8,
    borderWidth: 1, borderColor: '#ECECEC',
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  statDivider: { width: 1, backgroundColor: '#ECECEC', marginVertical: 6 },

  spotlight: {
    backgroundColor: '#8B0000', borderRadius: 20, padding: 20,
    marginTop: 20, marginBottom: 24,
    shadowColor: '#8B0000', shadowOpacity: 0.25, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  spotlightTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  spotlightLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#FFD5D5' },
  spotlightDayPill: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  spotlightDayPillPressed: { backgroundColor: 'rgba(255,255,255,0.34)' },
  spotlightDayText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  spotlightDayChevron: { color: '#FFD5D5', fontSize: 14, fontWeight: '700', marginTop: -2 },

  spotlightSubject: { fontSize: 14, fontWeight: '700', color: '#FFD5D5', marginBottom: 4 },
  spotlightTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 14, lineHeight: 26 },
  spotlightMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  spotlightMeta: { color: '#FFE8E8', fontSize: 13, fontWeight: '500' },

  spotlightStatusBlock: {
    marginTop: 16,
    paddingLeft: 14, paddingVertical: 12, paddingRight: 12,
    borderLeftWidth: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
  },
  spotlightStatusHeadline: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  spotlightStatusSub: { color: '#FFE8E8', fontSize: 12, marginTop: 4, fontWeight: '500' },

  spotlightRouteButton: {
    marginTop: 16, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  spotlightRouteButtonText: { color: '#8B0000', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },

  dayStrip: { gap: 8, paddingVertical: 4, marginBottom: 8 },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECECEC',
    marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  dayChipSelected: { backgroundColor: '#8B0000', borderColor: '#8B0000' },
  dayChipTodayOutline: { borderColor: '#F3C6C6', backgroundColor: '#FFF5F5' },
  dayChipText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  dayChipTextSelected: { color: '#FFFFFF' },
  todayIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B0000' },

  sectionListHeading: {
    fontSize: 13, fontWeight: '700', color: '#9CA3AF',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 20, marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 20, marginBottom: 12,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  sectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C7C7C7', marginRight: 10 },
  sectionDotToday: { backgroundColor: '#8B0000' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  sectionTitleToday: { color: '#8B0000' },
  todayBadge: {
    backgroundColor: '#FDECEC', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, marginRight: 10,
  },
  todayBadgeText: { color: '#8B0000', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  sectionCount: { fontSize: 12, fontWeight: '600', color: '#9CA3AF' },

  row: { flexDirection: 'row', marginBottom: 4 },
  rail: { width: 56, alignItems: 'center', paddingTop: 2 },
  railTime: { fontSize: 10, fontWeight: '700', color: '#6B7280', textAlign: 'center', marginBottom: 6, lineHeight: 12 },
  railDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#9CA3AF' },
  railLine: { width: 2, flex: 1, marginTop: 4, borderRadius: 1 },

  card: {
    flex: 1, flexDirection: 'row', backgroundColor: '#FFFFFF',
    borderRadius: 16, marginBottom: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: '#ECECEC',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  cardToday: { borderColor: '#F3C6C6', shadowColor: '#8B0000', shadowOpacity: 0.08 },
  cardOnline: { opacity: 0.9 },
  cardGhost: { opacity: 0.94, borderColor: '#F5C2C0', borderStyle: 'dashed' },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 14 },

  cardHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6,
  },
  subject: { fontSize: 13, fontWeight: '800', color: '#8B0000', letterSpacing: 0.3 },
  title: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', lineHeight: 20, marginBottom: 8 },
  titleGhost: { color: '#6B7280', textDecorationLine: 'line-through' },
  time: { fontSize: 13, fontWeight: '500', color: '#4B5563', marginBottom: 8 },
  timeGhost: { color: '#9CA3AF', textDecorationLine: 'line-through' },

  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  metaIcon: { fontSize: 12, marginRight: 6, width: 16 },
  metaText: { fontSize: 12, color: '#6B7280', flex: 1 },
  metaTextGhost: { color: '#9CA3AF' },

  reasonChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#B00020',
  },
  reasonChipIcon: { fontSize: 16, marginTop: 1 },
  reasonChipTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: '#7A0014',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  reasonChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A0014',
    lineHeight: 18,
  },

  notesBox: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFF8F0',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#C77700',
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#8A4B00',
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  notesText: {
    fontSize: 12,
    color: '#5A3200',
    fontStyle: 'italic',
    lineHeight: 17,
  },

  statusBlock: {
    marginTop: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderLeftWidth: 4, borderRadius: 10,
  },
  statusHeadline: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  statusSubline: { fontSize: 12, color: '#4B5563', marginTop: 4, fontWeight: '500' },

  badgeNow: { backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeNowText: { color: '#059669', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  badgeSoon: { backgroundColor: '#FFFBEB', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeSoonText: { color: '#D97706', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  badgeDone: { backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeDoneText: { color: '#9CA3AF', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  badgeCancelled: { backgroundColor: '#FDECEC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeCancelledText: { color: '#B00020', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },

  // ============================================================
  // MODAL
  // ============================================================
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    maxHeight: '92%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  modalScrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 48,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#D1D5DB',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 12,
  },
  modalEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#8B0000',
    marginBottom: 4,
  },
  modalSubject: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1A1A1A',
    letterSpacing: -0.4,
  },
  modalTitle: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
    marginTop: 4,
    lineHeight: 19,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '700',
    lineHeight: 16,
  },

  modalBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  modalBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  modalBadgeF2F: { backgroundColor: '#FEF3C7' },
  modalBadgeOnline: { backgroundColor: '#DBEAFE' },
  modalBadgeCancelled: { backgroundColor: '#FDECEC' },
  modalBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  modalBadgeTextF2F: { color: '#C77700' },
  modalBadgeTextOnline: { color: '#1E88E5' },
  modalBadgeTextCancelled: { color: '#B00020' },
  modalStatusPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
  },
  modalStatusPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  modalDayPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
  },
  modalDayPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    color: '#4B5563',
  },

  modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#F7F5F2',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 4,
  },
  modalGridItem: { width: '50%', paddingVertical: 6 },
  modalGridLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#9A9A9E',
    marginBottom: 3,
  },
  modalGridValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
  },

  modalLiveBlock: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  modalLiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalLiveHeadline: { fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  modalLiveTime: { fontSize: 11, fontWeight: '800' },
  modalLiveSubline: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
    lineHeight: 17,
  },

  modalNotesBox: {
    backgroundColor: '#FFF8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#C77700',
  },
  modalNotesLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#8A4B00',
    marginBottom: 6,
  },
  modalNotesText: {
    fontSize: 12,
    color: '#5A3200',
    fontStyle: 'italic',
    lineHeight: 17,
  },

  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  modalPrimaryBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 140,
    backgroundColor: '#8B0000',
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B0000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  modalPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  modalSecondaryBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 110,
    backgroundColor: '#F5F5F7',
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
})

export default StudentScheduleScreen