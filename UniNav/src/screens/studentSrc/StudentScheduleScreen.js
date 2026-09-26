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
// DESIGN TOKENS
// ============================================================

const T = {
  crimson: '#8B0000',
  crimsonLight: '#A61B1B',
  ink: '#0B0B0D',
  inkSoft: '#3F3F46',
  inkMuted: '#71717A',
  inkFaint: '#A1A1AA',
  hair: '#E7E7E9',
  hair2: '#F1F1F3',
  canvas: '#F2F2F4',
  surface: '#FFFFFF',
  green: '#0F7A4A',
  greenSoft: '#ECFDF5',
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  red: '#9F1239',
  redSoft: '#FCE7F3',
  blue: '#1D4ED8',
  blueSoft: '#DBEAFE',
  slate: '#94A3B8',
  slateSoft: '#F1F5F9',
  // Featured highlight (was crimson)
  navy: '#1E1B4B',
  navyLight: '#312E81',
}

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
  return { start: toLocalDateString(monday), end: toLocalDateString(sunday) }
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
    case 'occupied': return T.green
    case 'vacant': return T.amber
    case 'online': return T.blue
    case 'cancelled': return T.red
    case 'ended': return T.slate
    case 'upcoming': return T.crimson
    default: return T.slate
  }
}

const stateSoftBg = (state) => {
  switch (state) {
    case 'occupied': return T.greenSoft
    case 'vacant': return T.amberSoft
    case 'online': return T.blueSoft
    case 'cancelled': return T.redSoft
    case 'ended': return T.slateSoft
    case 'upcoming': return '#FDECEC'
    default: return T.slateSoft
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
        setErrorMessage('Your roster record was not found. Please contact the admin.')
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
  // NO SEMESTER / NO CLASSES
  // ============================================================

  if (!semester) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIconWrap}>
          <View style={styles.emptyIconRing} />
          <View style={styles.emptyIconDot} />
        </View>
        <Text style={styles.emptyEyebrow}>NO SEMESTER</Text>
        <Text style={styles.emptyTitle}>Nothing scheduled</Text>
        <Text style={styles.emptyText}>
          There's no semester open right now. Please contact your program chair
          or the admin.
        </Text>
      </View>
    )
  }

  if (classes.length === 0) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIconWrap}>
          <View style={styles.emptyIconRing} />
          <View style={styles.emptyIconDot} />
        </View>
        <Text style={styles.emptyEyebrow}>NO CLASSES</Text>
        <Text style={styles.emptyTitle}>No enrollment records</Text>
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
            {/* ==================== RED HEADER ==================== */}
            <View style={styles.header}>
              <View style={styles.headerDecor1} />
              <View style={styles.headerDecor2} />

              <View style={styles.headerContent}>
                <View style={styles.headerTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.headerEyebrow}>STUDENT PORTAL</Text>
                    <Text style={styles.headerTitle}>My Schedule</Text>
                  </View>

                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {stats.classes} {stats.classes === 1 ? 'CLASS' : 'CLASSES'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.headerDate}>{getTodayLabel()}</Text>

                {semester && (
                  <View style={styles.headerSemesterRow}>
                    <View style={styles.headerSemesterDot} />
                    <Text style={styles.headerSemesterText} numberOfLines={1}>
                      {semester.name}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* ==================== STATS STRIP ==================== */}
            <View style={styles.statsStrip}>
              <Stat label="CLASSES" value={stats.classes} />
              <View style={styles.statDivider} />
              <Stat label="SUBJECTS" value={stats.subjects} />
              <View style={styles.statDivider} />
              <Stat label="HOURS" value={stats.hours} />
              <View style={styles.statDivider} />
              <Stat label="ROOMS" value={stats.rooms} />
            </View>

            {/* ==================== UP NEXT SPOTLIGHT (NAVY) ==================== */}
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

                <Text style={styles.spotlightSubject} numberOfLines={1}>
                  {nextClass.subject_code}
                </Text>
                <Text style={styles.spotlightTitle} numberOfLines={2}>
                  {nextClass.course_title}
                </Text>

                <View style={styles.spotlightMeta}>
                  <Text style={styles.spotlightMetaText}>
                    {formatTime(nextClass.start_time)} – {formatTime(nextClass.end_time)}
                  </Text>
                  <Text style={styles.spotlightMetaDivider}>·</Text>
                  <Text style={styles.spotlightMetaText} numberOfLines={1}>
                    {nextClass.room_name || 'Not assigned'}
                  </Text>
                </View>

                <View style={styles.spotlightMeta}>
                  <Text style={styles.spotlightMetaText} numberOfLines={1}>
                    {nextClass.professor_name || 'Professor not assigned'}
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
                  <Text style={styles.spotlightStatusSub} numberOfLines={3}>
                    {nextLive.subline}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => setDetailClass(nextClass)}
                  activeOpacity={0.85}
                  style={styles.spotlightRouteButton}
                >
                  <Text style={styles.spotlightRouteButtonText}>
                    View details →
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ==================== DAY STRIP ==================== */}
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
          const online = isOnlineRoom(item.room_name)

          const accent =
            isGhost ? T.red
            : online ? T.blue
            : status === 'now' ? T.green
            : status === 'soon' ? T.amber
            : status === 'next' && section.isToday ? T.crimson
            : T.slate

          return (
            <View style={styles.row}>
              <View style={styles.rail}>
                <Text style={styles.railTime}>
                  {formatTime(item.start_time).replace(' ', '\n')}
                </Text>
                <View style={styles.railNode}>
                  <View style={[styles.railDot, { backgroundColor: accent }]} />
                </View>
                <View style={[styles.railLine, { backgroundColor: accent + '30' }]} />
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setDetailClass(item)}
                style={[
                  styles.card,
                  section.isToday && styles.cardToday,
                  isGhost && styles.cardGhost,
                ]}
              >
                <View style={[styles.cardAccent, { backgroundColor: accent }]} />

                <View style={styles.cardBody}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.subject} numberOfLines={1}>
                      {item.subject_code}
                    </Text>

                    <View style={styles.tagRow}>
                      {online && !isGhost && (
                        <View style={[styles.tag, { backgroundColor: T.blueSoft }]}>
                          <Text style={[styles.tagText, { color: T.blue }]}>ONLINE</Text>
                        </View>
                      )}

                      {isGhost ? (
                        <View style={[styles.tag, { backgroundColor: T.redSoft }]}>
                          <Text style={[styles.tagText, { color: T.red }]}>CANCELLED</Text>
                        </View>
                      ) : (
                        <>
                          {status === 'now' && (
                            <View style={[styles.tag, { backgroundColor: T.greenSoft }]}>
                              <Text style={[styles.tagText, { color: T.green }]}>NOW</Text>
                            </View>
                          )}
                          {status === 'soon' && (
                            <View style={[styles.tag, { backgroundColor: T.amberSoft }]}>
                              <Text style={[styles.tagText, { color: T.amber }]}>SOON</Text>
                            </View>
                          )}
                          {status === 'done' && (
                            <View style={[styles.tag, { backgroundColor: T.slateSoft }]}>
                              <Text style={[styles.tagText, { color: T.slate }]}>DONE</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  </View>

                  <Text
                    style={[styles.title, isGhost && styles.titleGhost]}
                    numberOfLines={2}
                  >
                    {item.course_title}
                  </Text>

                  <Text style={[styles.timeLine, isGhost && styles.timeGhost]} numberOfLines={1}>
                    {formatTime(item.start_time)} – {formatTime(item.end_time)}
                  </Text>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>ROOM</Text>
                    <Text
                      style={[styles.metaValue, isGhost && styles.metaValueGhost]}
                      numberOfLines={1}
                    >
                      {online ? 'Online' : item.room_name || '—'}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>PROF</Text>
                    <Text
                      style={[styles.metaValue, isGhost && styles.metaValueGhost]}
                      numberOfLines={1}
                    >
                      {item.professor_name || '—'}
                    </Text>
                  </View>

                  {isGhost && (
                    <View style={styles.reasonChip}>
                      <View style={styles.reasonChipStripe} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reasonChipTitle}>
                          WHY IS THIS CANCELLED?
                        </Text>
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

                  {live && !isGhost && (
                    <View
                      style={[
                        styles.statusBlock,
                        { borderLeftColor: stateAccent(live.roomState) },
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: stateAccent(live.roomState) },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.statusHeadline,
                            { color: stateAccent(live.roomState) },
                          ]}
                        >
                          {live.headline}
                        </Text>
                        <Text style={styles.statusSubline} numberOfLines={2}>
                          {live.subline}
                        </Text>
                      </View>
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
            tintColor="#FFFFFF"
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
                  const accent = live ? stateAccent(live.roomState) : T.slate
                  const dayFull =
                    DAY_LABELS[detailClass.day] || detailClass.day || ''

                  const canViewRoute = !isGhost && !isOnline

                  return (
                    <>
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

                      <View style={styles.modalBadgesRow}>
                        {!isGhost && (
                          <View
                            style={[
                              styles.modalBadge,
                              isOnline
                                ? { backgroundColor: T.blueSoft }
                                : { backgroundColor: T.amberSoft },
                            ]}
                          >
                            <Text
                              style={[
                                styles.modalBadgeText,
                                { color: isOnline ? T.blue : T.amber },
                              ]}
                            >
                              {isOnline ? 'ONLINE' : 'FACE-TO-FACE'}
                            </Text>
                          </View>
                        )}

                        {live && (
                          <View
                            style={[
                              styles.modalStatusPill,
                              { backgroundColor: stateSoftBg(live.roomState) },
                            ]}
                          >
                            <View
                              style={[
                                styles.modalStatusPillDot,
                                { backgroundColor: accent },
                              ]}
                            />
                            <Text
                              style={[
                                styles.modalStatusPillText,
                                { color: accent },
                              ]}
                              numberOfLines={1}
                            >
                              {live.headline}
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

                      <View style={styles.modalGrid}>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>PROFESSOR</Text>
                          <Text style={styles.modalGridValue} numberOfLines={1}>
                            {detailClass.professor_name || '—'}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>ROOM</Text>
                          <Text style={styles.modalGridValue} numberOfLines={1}>
                            {isOnline ? 'Online' : detailClass.room_name || '—'}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>START</Text>
                          <Text style={styles.modalGridValue} numberOfLines={1}>
                            {formatTime(detailClass.start_time)}
                          </Text>
                        </View>
                        <View style={styles.modalGridItem}>
                          <Text style={styles.modalGridLabel}>END</Text>
                          <Text style={styles.modalGridValue} numberOfLines={1}>
                            {formatTime(detailClass.end_time)}
                          </Text>
                        </View>
                      </View>

                      {live && (
                        <View
                          style={[
                            styles.modalLiveBlock,
                            { borderLeftColor: accent },
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
                                style={[styles.modalLiveTime, { color: accent }]}
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
    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width={80} height={9} radius={3} />
            <Skeleton width={140} height={20} radius={4} />
          </View>
          <Skeleton width={80} height={24} radius={999} />
        </View>
        <Skeleton width={200} height={13} radius={3} style={{ marginTop: 14 }} />
      </View>
    </View>

    <View style={styles.content}>
      <View style={styles.statsStrip}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.stat}>
            <Skeleton width={34} height={22} radius={6} />
            <Skeleton width={52} height={9} radius={3} style={{ marginTop: 8 }} />
          </View>
        ))}
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
  container: { flex: 1, backgroundColor: T.canvas },
  content: { paddingHorizontal: 20, paddingBottom: 60 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 34,
    backgroundColor: T.canvas,
  },

  errorIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#FDECEC',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  errorIcon: { fontSize: 28, fontWeight: '900', color: T.crimson },
  errorTitle: {
    fontSize: 20, fontWeight: '900', color: T.ink,
    marginBottom: 8, textAlign: 'center',
  },
  errorText: {
    fontSize: 14, color: T.inkMuted,
    textAlign: 'center', lineHeight: 20,
  },

  emptyIconWrap: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 22,
  },
  emptyIconRing: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2,
    borderColor: T.crimson,
    opacity: 0.35,
  },
  emptyIconDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: T.crimson,
  },
  emptyEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.crimson,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },

  // ==================== RED HEADER ====================
  header: {
    backgroundColor: T.crimson,
    paddingTop: 58,
    paddingBottom: 62,
    overflow: 'hidden',
    marginHorizontal: -20,
    paddingHorizontal: 22,
  },
  headerDecor1: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: T.crimsonLight,
    opacity: 0.35,
  },
  headerDecor2: {
    position: 'absolute',
    top: 40,
    right: 40,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFFFFF',
    opacity: 0.06,
  },
  headerContent: {},
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
    opacity: 0.65,
    marginBottom: 5,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  headerBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: '#FFFFFF',
  },
  headerDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    opacity: 0.9,
    marginTop: 16,
    letterSpacing: 0.2,
  },
  headerSemesterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    gap: 7,
  },
  headerSemesterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7CFC9E',
  },
  headerSemesterText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  // ==================== STATS STRIP ====================
  statsStrip: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: T.hair,
    marginTop: -22,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: T.inkFaint,
    marginTop: 3,
    letterSpacing: 1.4,
  },
  statDivider: {
    width: 1,
    backgroundColor: T.hair2,
    marginVertical: 8,
  },

  // ==================== SPOTLIGHT (NAVY) ====================
  spotlight: {
    backgroundColor: T.navy,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    marginBottom: 24,
    shadowColor: T.navy,
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    overflow: 'hidden',
  },
  spotlightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  spotlightLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.2,
    color: '#C7D2FE',
  },
  spotlightDayPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  spotlightDayPillPressed: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  spotlightDayText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  spotlightDayChevron: {
    color: '#C7D2FE',
    fontSize: 14,
    fontWeight: '700',
    marginTop: -2,
  },

  spotlightSubject: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  spotlightTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E0E7FF',
    marginBottom: 14,
    lineHeight: 21,
  },
  spotlightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  spotlightMetaText: {
    color: '#E0E7FF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  spotlightMetaDivider: {
    color: '#C7D2FE',
    marginHorizontal: 6,
    fontSize: 12,
    opacity: 0.7,
  },

  spotlightStatusBlock: {
    marginTop: 16,
    paddingLeft: 12,
    paddingVertical: 4,
    borderLeftWidth: 3,
  },
  spotlightStatusHeadline: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  spotlightStatusSub: {
    color: '#E0E7FF',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
    lineHeight: 17,
  },

  spotlightRouteButton: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotlightRouteButtonText: {
    color: T.navy,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // ==================== DAY STRIP ====================
  dayStrip: {
    gap: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayChipSelected: {
    backgroundColor: T.crimson,
    borderColor: T.crimson,
  },
  dayChipTodayOutline: {
    borderColor: '#F3C6C6',
    backgroundColor: '#FFF5F5',
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: T.inkSoft,
    letterSpacing: 0.2,
  },
  dayChipTextSelected: {
    color: '#FFFFFF',
  },
  todayIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.crimson,
  },

  sectionListHeading: {
    fontSize: 10,
    fontWeight: '900',
    color: T.inkFaint,
    letterSpacing: 2.2,
    marginTop: 22,
    marginBottom: 8,
  },

  // ==================== SECTION HEADER ====================
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C7C7C7',
    marginRight: 10,
  },
  sectionDotToday: {
    backgroundColor: T.crimson,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.3,
  },
  sectionTitleToday: {
    color: T.crimson,
  },
  todayBadge: {
    backgroundColor: '#FDECEC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 10,
  },
  todayBadgeText: {
    color: T.crimson,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkFaint,
    letterSpacing: 0.3,
  },

  // ==================== CLASS ROW ====================
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  rail: {
    width: 56,
    alignItems: 'center',
    paddingTop: 4,
  },
  railTime: {
    fontSize: 10,
    fontWeight: '900',
    color: T.ink,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 12,
    letterSpacing: -0.2,
  },
  railNode: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: T.surface,
    borderWidth: 2,
    borderColor: T.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  railLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
    borderRadius: 1,
  },

  card: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.hair,
  },
  cardToday: {
    borderColor: '#F3C6C6',
  },
  cardGhost: {
    opacity: 0.9,
  },
  cardAccent: {
    width: 3,
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },

  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  subject: {
    fontSize: 13,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  title: {
    fontSize: 15,
    fontWeight: '600',
    color: T.ink,
    lineHeight: 20,
    marginBottom: 8,
  },
  titleGhost: {
    color: T.inkMuted,
    textDecorationLine: 'line-through',
  },
  timeLine: {
    fontSize: 12,
    fontWeight: '700',
    color: T.inkSoft,
    marginBottom: 10,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
  },
  timeGhost: {
    color: T.inkFaint,
    textDecorationLine: 'line-through',
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 8,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    width: 36,
  },
  metaValue: {
    fontSize: 12,
    color: T.inkSoft,
    flex: 1,
    fontWeight: '600',
  },
  metaValueGhost: {
    color: T.inkFaint,
  },

  reasonChip: {
    flexDirection: 'row',
    marginTop: 12,
    paddingRight: 12,
    paddingVertical: 12,
    backgroundColor: T.redSoft,
    borderRadius: 10,
    overflow: 'hidden',
  },
  reasonChipStripe: {
    width: 3,
    backgroundColor: T.red,
    marginRight: 10,
  },
  reasonChipTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#7A0014',
    marginBottom: 4,
  },
  reasonChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A0014',
    lineHeight: 17,
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#8A4B00',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 12,
    color: '#5A3200',
    fontStyle: 'italic',
    lineHeight: 17,
  },

  statusBlock: {
    flexDirection: 'row',
    marginTop: 12,
    paddingLeft: 12,
    paddingVertical: 10,
    borderLeftWidth: 3,
    gap: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  statusHeadline: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  statusSubline: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '500',
    lineHeight: 15,
  },

  // ============================================================
  // MODAL
  // ============================================================
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  modalScrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 48,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 12,
  },
  modalEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.crimson,
    marginBottom: 5,
  },
  modalSubject: {
    fontSize: 28,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.6,
  },
  modalTitle: {
    fontSize: 14,
    color: T.inkMuted,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 19,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.hair2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 14,
    color: T.inkSoft,
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
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modalBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  modalStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 6,
    maxWidth: '100%',
  },
  modalStatusPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modalStatusPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    flexShrink: 1,
  },
  modalDayPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: T.hair2,
  },
  modalDayPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    color: T.inkSoft,
  },
  modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 14,
    marginBottom: 16,
    gap: 4,
  },
  modalGridItem: {
    width: '50%',
    paddingVertical: 6,
  },
  modalGridLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    marginBottom: 3,
  },
  modalGridValue: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: -0.1,
  },
  modalLiveBlock: {
    paddingLeft: 12,
    paddingVertical: 4,
    borderLeftWidth: 3,
    marginBottom: 16,
  },
  modalLiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  modalLiveHeadline: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
    flexShrink: 1,
  },
  modalLiveTime: {
    fontSize: 11,
    fontWeight: '800',
  },
  modalLiveSubline: {
    fontSize: 12,
    color: T.inkSoft,
    fontWeight: '500',
    lineHeight: 17,
  },
  modalNotesBox: {
    backgroundColor: '#FFF8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#C77700',
  },
  modalNotesLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
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
    backgroundColor: T.crimson,
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  modalSecondaryBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 110,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
})

export default StudentScheduleScreen