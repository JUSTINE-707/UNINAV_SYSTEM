import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  StatusBar,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';
import { useSemester } from '../../context/SemesterContext';
import Skeleton, { SkeletonCircle } from '../../components/Skeleton';

// ============================================================
// CONSTANTS
// ============================================================

const COLORS = {
  primary: '#8B0000',
  white: '#FFFFFF',
  black: '#1A1A1A',
  gray: '#9A9A9E',
  lightGray: '#E8E5DF',
  background: '#F5F5F7',
  success: '#059669',
  warning: '#C77700',
  online: '#1E88E5',
  onlineBg: '#DBEAFE',
  f2fBg: '#FEF3C7',
  excusedBg: '#EAF6EC',
  unexcusedBg: '#FFF6E0',
  neutralBg: '#F3F4F6',
  ghostBg: '#FAFAFA',
};

const WEEK = [
  { code: 'M',  label: 'Mon', full: 'Monday' },
  { code: 'T',  label: 'Tue', full: 'Tuesday' },
  { code: 'W',  label: 'Wed', full: 'Wednesday' },
  { code: 'Th', label: 'Thu', full: 'Thursday' },
  { code: 'F',  label: 'Fri', full: 'Friday' },
  { code: 'Sat', label: 'Sat', full: 'Saturday' },
  { code: 'Sun', label: 'Sun', full: 'Sunday' },
];

const DAY_CODES = ['Sun', 'M', 'T', 'W', 'Th', 'F', 'Sat'];

const CAUSE_LABELS = {
  professor: 'You could not attend',
  students: 'No students showed up',
  room: 'Room unavailable',
  admin: 'Class moved online',
  other: 'Other reason',
};

const REASON_LABELS = {
  official_duty: 'Official Duty',
  medical: 'Medical / Sick Leave',
  emergency: 'Personal Emergency',
  personal: 'Personal Matter',
  other_prof: 'Other',
  class_cancelled: 'Class Cancelled',
  no_students: 'No Students',
  room_unavailable: 'Room Unavailable',
  moved_online: 'Moved Online',
  other: 'Other',
};

// ============================================================
// HELPERS
// ============================================================

const timeToMinutes = (time) => {
  if (!time) return null;
  const parts = time.toString().trim().split(':');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 60 + Number(parts[1]);
};

const formatTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

const formatDuration = (start, end) => {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return '';
  const mins = e - s;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

const isOnlineRoom = (roomName) => {
  if (!roomName) return false;
  const n = roomName.toString().trim().toUpperCase();

  const ONLINE_SUBSTRINGS = [
    'ONLINE', 'ASYNCHRONOUS', 'GOOGLE CLASSROOM', 'GOOGLE CLASS',
    'GC', 'MODULAR', 'VIRTUAL', 'DISTANCE',
  ];
  if (ONLINE_SUBSTRINGS.some((m) => n.includes(m))) return true;

  const ONLINE_EXACT = [
    'ZOOM', 'GOOGLE MEET', 'GMEET', 'TEAMS', 'MICROSOFT TEAMS',
    'WEBEX', 'DISCORD',
  ];
  return ONLINE_EXACT.includes(n);
};

const getTodayCode = () => DAY_CODES[new Date().getDay()];

const toLocalDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: toLocalDateString(monday),
    end: toLocalDateString(sunday),
  };
};

const normalizeNameKey = (name) => {
  if (!name) return '';
  return name.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const nowInMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const formatVerifiedTime = (isoString) => {
  if (!isoString) return '';
  try {
    const t = new Date(isoString);
    return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

// ============================================================
// LIVE STATUS — time wins over scan
// ============================================================

const getLiveStatus = (cls, nowMin, todayCode) => {
  if (!cls || cls.day !== todayCode || cls.ghostReport) return null;

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  const hasSession = !!cls.liveSession;
  const online = cls.isOnline;

  if (online) {
    return {
      roomState: 'online',
      icon: '🌐',
      headline: 'ONLINE CLASS',
      subline: hasSession
        ? 'You checked in online'
        : 'No physical room — join virtually',
    };
  }

  if (start === null || end === null) return null;

  // Window passed
  if (nowMin > end) {
    return {
      roomState: 'ended',
      icon: '·',
      headline: 'CLASS ENDED',
      subline: hasSession
        ? `You checked in at ${formatVerifiedTime(cls.liveSession.scanned_at)}`
        : 'Room was never verified',
    };
  }

  // Before window
  if (nowMin < start) {
    return {
      roomState: 'upcoming',
      icon: '🕐',
      headline: 'NOT STARTED YET',
      subline: `Starts at ${formatTime(cls.start_time)}`,
    };
  }

  // Inside window
  if (hasSession) {
    const t = formatVerifiedTime(cls.liveSession.scanned_at);
    return {
      roomState: 'occupied',
      icon: '✓',
      headline: 'CHECKED IN',
      subline: t ? `You checked in at ${t}` : 'Your check-in is on record',
    };
  }

  return {
    roomState: 'vacant',
    icon: '⏳',
    headline: 'NOT CHECKED IN',
    subline: 'Scan the room QR to confirm you are here',
  };
};

const stateAccent = (state) => {
  switch (state) {
    case 'occupied': return '#059669';
    case 'vacant': return '#D97706';
    case 'online': return '#3B82F6';
    case 'ended': return '#9CA3AF';
    case 'upcoming': return '#8B0000';
    default: return '#9CA3AF';
  }
};

// ============================================================
// SCREEN
// ============================================================

const FacultyScheduleScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { semester } = useSemester();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [selectedDay, setSelectedDay] = useState(getTodayCode());
  const [errorMessage, setErrorMessage] = useState(null);

  const todayCode = getTodayCode();

  // ============================================================
  // DATA LOAD
  // ============================================================

  const loadSchedule = useCallback(async () => {
    try {
      setErrorMessage(null);

      if (!user?.id) {
        setErrorMessage('No logged-in faculty account was found.');
        return;
      }

      if (!semester?.id) {
        setSchedules([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const { data: profProfile, error: profileError } = await supabase
        .from('faculty')
        .select('employee_id, program, college')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        setErrorMessage(`Profile error:\n${profileError.message}`);
        return;
      }

      setProfile(profProfile);

      const { start: weekStart, end: weekEnd } = getWeekRange();

      const SCHEDULE_COLUMNS = `
        id, subject_code, course_title, section, program,
        day, start_time, end_time, room_id, room_name,
        professor_name, professor_id, employee_id
      `;

      let scheduleData = [];
      let scheduleErr = null;

      // 2a: professor_id === auth uid
      {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('professor_id', user.id)
          .eq('semester_id', semester.id);
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

      // 2b: employee_id fallback
      if (
        !scheduleErr &&
        scheduleData.length === 0 &&
        profProfile?.employee_id
      ) {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('employee_id', profProfile.employee_id)
          .eq('semester_id', semester.id);
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

      // 2c: name match scoped to program
      if (
        !scheduleErr &&
        scheduleData.length === 0 &&
        profProfile?.program
      ) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle();

        if (userRow?.full_name) {
          const { data: candidates, error } = await supabase
            .from('schedules')
            .select(SCHEDULE_COLUMNS)
            .eq('program', profProfile.program)
            .eq('semester_id', semester.id);

          if (error) {
            scheduleErr = error;
          } else {
            const target = normalizeNameKey(userRow.full_name);
            scheduleData = (candidates || []).filter(
              (s) => normalizeNameKey(s.professor_name) === target
            );
          }
        }
      }

      // Ghost reports (this week)
      const { data: ghostData, error: ghostErr } = await supabase
        .from('ghost_reports')
        .select(
          'id, schedule_id, reason, cause, is_excused, excused_reason, notes, report_date, created_at'
        )
        .eq('faculty_id', user.id)
        .gte('report_date', weekStart)
        .lte('report_date', weekEnd)
        .order('created_at', { ascending: false });

      if (scheduleErr) {
        setErrorMessage(`Schedule error:\n${scheduleErr.message}`);
        return;
      }
      if (ghostErr) {
        setErrorMessage(`Ghost report error:\n${ghostErr.message}`);
        return;
      }

      const baseList = scheduleData;
      const scheduleIds = baseList.map((s) => s.id);

      const ghostMap = {};
      (ghostData || []).forEach((r) => {
        if (!ghostMap[r.schedule_id]) {
          ghostMap[r.schedule_id] = r;
        }
      });

      if (scheduleIds.length === 0) {
        setSchedules([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Today's live room_sessions
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const sessionsRes = await supabase
        .from('room_sessions')
        .select('schedule_id, status, class_type, scanned_at')
        .in('schedule_id', scheduleIds)
        .gte('scanned_at', startOfDay.toISOString())
        .lte('scanned_at', endOfDay.toISOString());

      if (sessionsRes.error) {
        console.warn(
          '[FacultySchedule] room_sessions fetch:',
          sessionsRes.error.message
        );
      }

      const sessionMap = {};
      (sessionsRes.data || []).forEach((s) => {
        sessionMap[s.schedule_id] = s;
      });

      const merged = baseList.map((c) => ({
        ...c,
        isOnline: isOnlineRoom(c.room_name),
        ghostReport: ghostMap[c.id] || null,
        liveSession: sessionMap[c.id] || null,
      }));

      setSchedules(merged);
    } catch (err) {
      console.error('[FacultySchedule] Unexpected error:', err);
      setErrorMessage(`Unexpected error:\n${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, semester]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        setLoading(true);
        loadSchedule();
      }
    }, [user, loadSchedule])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadSchedule();
  };

  // ============================================================
  // DERIVED DATA
  // ============================================================

  const schedulesByDay = useMemo(() => {
    const map = {};
    WEEK.forEach(({ code }) => { map[code] = []; });
    schedules.forEach((s) => {
      if (map[s.day]) map[s.day].push(s);
    });
    Object.keys(map).forEach((code) => {
      map[code].sort(
        (a, b) =>
          (timeToMinutes(a.start_time) || 0) -
          (timeToMinutes(b.start_time) || 0)
      );
    });
    return map;
  }, [schedules]);

  const countsByDay = useMemo(() => {
    const counts = {};
    WEEK.forEach(({ code }) => {
      counts[code] = schedulesByDay[code]?.length || 0;
    });
    return counts;
  }, [schedulesByDay]);

  const totalWeekClasses = schedules.length;
  const totalInPerson = schedules.filter((s) => !s.isOnline).length;
  const totalOnline = schedules.filter((s) => s.isOnline).length;
  const totalReported = schedules.filter((s) => s.ghostReport).length;

  // ============================================================
  // ACTIONS
  // ============================================================

  const handleScanQR = (schedule) => {
    if (schedule.ghostReport) return;
    navigation.navigate('QRScanner', {
      scheduleId: schedule.id,
      roomId: schedule.room_id,
      roomName: schedule.room_name,
      subjectCode: schedule.subject_code,
      courseTitle: schedule.course_title,
      section: schedule.section,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
    });
  };

  const handleNavigate = (schedule) => {
    if (schedule.ghostReport) return;
    if (schedule.isOnline) {
      Alert.alert('Online Class', 'No navigation needed for online classes.');
      return;
    }
    navigation.navigate('Map', { roomName: schedule.room_name });
  };

  const handleReportGhost = (schedule) => {
    navigation.navigate('ReportGhost', {
      scheduleId: schedule.id,
      subjectCode: schedule.subject_code,
      section: schedule.section,
      roomName: schedule.room_name,
      courseTitle: schedule.course_title,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
    });
  };

  const showGhostDetails = (cls) => {
    const r = cls.ghostReport;
    if (!r) return;

    const reasonLabel =
      REASON_LABELS[r.reason] || REASON_LABELS[r.excused_reason] || r.reason;
    const causeLabel = CAUSE_LABELS[r.cause] || r.cause;

    const lines = [
      `Cause: ${causeLabel}`,
      `Reason: ${reasonLabel}`,
      r.is_excused === true
        ? 'Status: EXCUSED — your record is protected.'
        : r.is_excused === false
        ? 'Status: UNEXCUSED — your Chair will review this.'
        : '',
      `Reported on: ${r.report_date}`,
      r.notes ? `\nNotes: ${r.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    Alert.alert(
      `Reported Absent — ${cls.subject_code}`,
      lines,
      [{ text: 'Close', style: 'cancel' }]
    );
  };

  const handleClassTap = (schedule) => {
    if (schedule.ghostReport) {
      showGhostDetails(schedule);
      return;
    }

    if (schedule.isOnline) {
      Alert.alert(
        `🌐 ${schedule.subject_code} · ${schedule.section}`,
        `${schedule.course_title}\n\nThis is an online class. Join through your virtual meeting platform.`,
        [
          { text: 'Close', style: 'cancel' },
          {
            text: 'Report Ghost',
            onPress: () => handleReportGhost(schedule),
          },
        ]
      );
      return;
    }

    Alert.alert(
      `${schedule.subject_code} · ${schedule.section}`,
      `${schedule.course_title}\nRoom: ${schedule.room_name}\nTime: ${formatTime(
        schedule.start_time
      )} – ${formatTime(schedule.end_time)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Navigate', onPress: () => handleNavigate(schedule) },
        { text: 'Scan QR', onPress: () => handleScanQR(schedule) },
      ]
    );
  };

  // ============================================================
  // LOADING — skeleton
  // ============================================================

  if (loading) {
    return <FacultyScheduleSkeleton />;
  }

  if (errorMessage) {
    return (
      <View style={styles.center}>
        <View style={styles.errorIconWrap}>
          <Text style={styles.errorIcon}>!</Text>
        </View>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          style={styles.errorRetryButton}
          onPress={() => {
            setLoading(true);
            loadSchedule();
          }}
        >
          <Text style={styles.errorRetryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  const nowMin = nowInMinutes();
  const selectedSchedules = schedulesByDay[selectedDay] || [];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerEyebrow}>FACULTY</Text>
          <Text style={styles.headerTitle}>My Schedule</Text>
          {semester && (
            <Text style={styles.headerSemester} numberOfLines={1}>
              {semester.name}
            </Text>
          )}
        </View>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{totalWeekClasses}</Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: COLORS.warning }]}>
              {totalInPerson}
            </Text>
            <Text style={styles.summaryLabel}>Face-to-Face</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: COLORS.online }]}>
              {totalOnline}
            </Text>
            <Text style={styles.summaryLabel}>Online</Text>
          </View>
          {totalReported > 0 && (
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: COLORS.gray }]}>
                {totalReported}
              </Text>
              <Text style={styles.summaryLabel}>Reported</Text>
            </View>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayTabsContent}
          style={styles.dayTabsScroll}
        >
          {WEEK.map(({ code, label }) => {
            const isSelected = code === selectedDay;
            const isToday = code === todayCode;
            const count = countsByDay[code] || 0;

            return (
              <TouchableOpacity
                key={code}
                style={[
                  styles.dayTab,
                  isSelected && styles.dayTabActive,
                  isToday && !isSelected && styles.dayTabToday,
                ]}
                onPress={() => setSelectedDay(code)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.dayTabLabel,
                    isSelected && styles.dayTabLabelActive,
                  ]}
                >
                  {label}
                </Text>

                <View
                  style={[
                    styles.dayTabBadge,
                    isSelected && styles.dayTabBadgeActive,
                    count === 0 && styles.dayTabBadgeEmpty,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayTabBadgeText,
                      isSelected && styles.dayTabBadgeTextActive,
                    ]}
                  >
                    {count}
                  </Text>
                </View>

                {isToday && (
                  <View
                    style={[
                      styles.todayDot,
                      isSelected && styles.todayDotActive,
                    ]}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.selectedDayHeader}>
          <Text style={styles.selectedDayTitle}>
            {WEEK.find((w) => w.code === selectedDay)?.full}
          </Text>
          {selectedDay === todayCode && (
            <View style={styles.todayPill}>
              <Text style={styles.todayPillText}>TODAY</Text>
            </View>
          )}
        </View>

        {selectedSchedules.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>☕</Text>
            <Text style={styles.emptyTitle}>No classes</Text>
            <Text style={styles.emptyText}>
              {semester
                ? `You have no scheduled classes on ${WEEK.find((w) => w.code === selectedDay)?.full}.`
                : 'No active semester. Please contact the admin.'}
            </Text>
          </View>
        ) : (
          selectedSchedules.map((schedule, index) => {
            const isGhost = !!schedule.ghostReport;
            const live = getLiveStatus(schedule, nowMin, todayCode);

            return (
              <TouchableOpacity
                key={schedule.id}
                style={[
                  styles.classCard,
                  index === 0 && styles.classCardFirst,
                  isGhost && styles.classCardGhost,
                ]}
                activeOpacity={0.85}
                onPress={() => handleClassTap(schedule)}
              >
                <View style={styles.classTimeCol}>
                  <Text
                    style={[
                      styles.classStartTime,
                      isGhost && styles.classStartTimeGhost,
                    ]}
                  >
                    {formatTime(schedule.start_time)}
                  </Text>
                  <View style={styles.classTimeLine} />
                  <Text
                    style={[
                      styles.classEndTime,
                      isGhost && styles.classEndTimeGhost,
                    ]}
                  >
                    {formatTime(schedule.end_time)}
                  </Text>
                  <Text style={styles.classDuration}>
                    {formatDuration(schedule.start_time, schedule.end_time)}
                  </Text>
                </View>

                <View style={styles.classInfoCol}>
                  <View style={styles.classHeaderRow}>
                    <Text
                      style={[
                        styles.classSubject,
                        isGhost && styles.classSubjectGhost,
                      ]}
                    >
                      {schedule.subject_code}
                    </Text>

                    {isGhost ? (
                      <View
                        style={[
                          styles.modalityPill,
                          schedule.ghostReport.is_excused === true
                            ? styles.pillExcused
                            : schedule.ghostReport.is_excused === false
                            ? styles.pillUnexcused
                            : styles.pillNeutral,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modalityPillText,
                            schedule.ghostReport.is_excused === true
                              ? styles.pillTextExcused
                              : schedule.ghostReport.is_excused === false
                              ? styles.pillTextUnexcused
                              : styles.pillTextNeutral,
                          ]}
                        >
                          {schedule.ghostReport.is_excused === true
                            ? '✓ EXCUSED'
                            : schedule.ghostReport.is_excused === false
                            ? '! UNEXCUSED'
                            : '● CANCELLED'}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.modalityPill,
                          schedule.isOnline
                            ? styles.modalityOnline
                            : styles.modalityF2F,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modalityPillText,
                            schedule.isOnline
                              ? styles.modalityTextOnline
                              : styles.modalityTextF2F,
                          ]}
                        >
                          {schedule.isOnline ? '🌐 ONLINE' : '● F2F'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text
                    style={[
                      styles.classTitle,
                      isGhost && styles.classTitleGhost,
                    ]}
                    numberOfLines={2}
                  >
                    {schedule.course_title}
                  </Text>

                  <View style={styles.classMetaRow}>
                    <Text style={styles.classMetaItem}>
                      <Text style={styles.classMetaLabel}>Section: </Text>
                      {schedule.section}
                    </Text>
                  </View>

                  {isGhost ? (
                    <View style={styles.ghostReasonBox}>
                      <Text style={styles.ghostReasonLabel}>Reported as:</Text>
                      <Text style={styles.ghostReasonValue}>
                        {REASON_LABELS[schedule.ghostReport.reason] ||
                          REASON_LABELS[schedule.ghostReport.excused_reason] ||
                          schedule.ghostReport.reason}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.classMetaRow}>
                      <Text style={styles.classMetaItem}>
                        <Text style={styles.classMetaLabel}>Room: </Text>
                        {schedule.isOnline
                          ? 'Online'
                          : schedule.room_name || '—'}
                      </Text>
                    </View>
                  )}

                  {live && (
                    <View
                      style={[
                        styles.liveStatusBlock,
                        {
                          borderLeftColor: stateAccent(live.roomState),
                          backgroundColor: stateAccent(live.roomState) + '14',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.liveStatusHeadline,
                          { color: stateAccent(live.roomState) },
                        ]}
                      >
                        {live.icon}  {live.headline}
                      </Text>
                      <Text style={styles.liveStatusSubline}>{live.subline}</Text>
                    </View>
                  )}

                  {isGhost ? (
                    <TouchableOpacity
                      style={styles.ghostDetailsBtn}
                      onPress={() => showGhostDetails(schedule)}
                    >
                      <Text style={styles.ghostDetailsBtnText}>
                        View Report Details
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    !schedule.isOnline && (
                      <View style={styles.classActions}>
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => handleNavigate(schedule)}
                        >
                          <Text style={styles.actionButtonText}>
                            ↗ Navigate
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.actionButton,
                            styles.actionButtonPrimary,
                          ]}
                          onPress={() => handleScanQR(schedule)}
                        >
                          <Text style={styles.actionButtonPrimaryText}>
                            ▣ Scan QR
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

// ============================================================
// LOADING SKELETON
// ============================================================

const FacultyScheduleSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

    <View style={styles.header}>
      <Skeleton width={60} height={22} radius={6} />
      <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
        <Skeleton width={50} height={10} radius={4} />
        <Skeleton width={130} height={18} radius={6} />
        <Skeleton width={150} height={11} radius={4} />
      </View>
      <View style={{ width: 60 }} />
    </View>

    <View style={styles.scrollContent}>
      <View style={styles.summaryRow}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.summaryCard}>
            <Skeleton width={30} height={22} radius={6} />
            <Skeleton width={60} height={10} radius={4} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} width={64} height={62} radius={14} />
        ))}
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Skeleton width={130} height={20} radius={6} />
      </View>

      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.classCard}>
          <View style={styles.classTimeCol}>
            <Skeleton width={50} height={14} radius={4} />
            <Skeleton
              width={2}
              height={10}
              radius={1}
              style={{ marginTop: 8, marginLeft: 4 }}
            />
            <Skeleton
              width={50}
              height={13}
              radius={4}
              style={{ marginTop: 8 }}
            />
            <Skeleton
              width={40}
              height={10}
              radius={4}
              style={{ marginTop: 8 }}
            />
          </View>
          <View style={styles.classInfoCol}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <Skeleton width={70} height={14} radius={4} />
              <Skeleton width={60} height={18} radius={6} />
            </View>
            <Skeleton width="85%" height={14} radius={4} />
            <Skeleton
              width="40%"
              height={12}
              radius={4}
              style={{ marginTop: 10 }}
            />
            <Skeleton
              width="45%"
              height={12}
              radius={4}
              style={{ marginTop: 6 }}
            />
            <Skeleton
              width="100%"
              height={54}
              radius={8}
              style={{ marginTop: 14 }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Skeleton width="48%" height={34} radius={8} />
              <Skeleton width="48%" height={34} radius={8} />
            </View>
          </View>
        </View>
      ))}
    </View>
  </View>
);

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: COLORS.background,
  },
  loadingText: { marginTop: 12, color: COLORS.gray, fontSize: 14 },

  errorIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  errorIcon: { fontSize: 28, fontWeight: '700', color: COLORS.primary },
  errorTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 8, textAlign: 'center' },
  errorText: { fontSize: 14, color: COLORS.gray, textAlign: 'center', lineHeight: 20 },
  errorRetryButton: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 10, backgroundColor: COLORS.primary,
  },
  errorRetryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 16,
    backgroundColor: COLORS.primary,
  },
  backButton: { width: 60 },
  backText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#FFFFFF',
    opacity: 0.7,
    marginBottom: 2,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  headerSemester: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.75,
    marginTop: 2,
    fontWeight: '600',
  },

  scrollContent: { paddingBottom: 20 },

  summaryRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.gray,
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  dayTabsScroll: { maxHeight: 80 },
  dayTabsContent: { paddingHorizontal: 16, gap: 8 },
  dayTab: {
    minWidth: 64,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    position: 'relative',
  },
  dayTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayTabToday: { borderColor: COLORS.primary },
  dayTabLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 6,
  },
  dayTabLabelActive: { color: '#FFFFFF' },
  dayTabBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#F0F0F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTabBadgeActive: { backgroundColor: '#FFFFFF' },
  dayTabBadgeEmpty: { opacity: 0.4 },
  dayTabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.gray,
  },
  dayTabBadgeTextActive: { color: COLORS.primary },
  todayDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  todayDotActive: { backgroundColor: '#FFFFFF' },

  selectedDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    gap: 10,
  },
  selectedDayTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.black,
  },
  todayPill: {
    backgroundColor: '#FFF5F5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  todayPillText: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
  },

  classCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  classCardFirst: { borderTopWidth: 0 },
  classCardGhost: {
    backgroundColor: '#FAFAFA',
    borderLeftWidth: 4,
    borderLeftColor: '#9CA3AF',
    opacity: 0.95,
  },

  classTimeCol: {
    width: 76,
    alignItems: 'flex-start',
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: '#F0F0F2',
  },
  classStartTime: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.primary,
  },
  classStartTimeGhost: {
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  classTimeLine: {
    width: 2,
    height: 10,
    backgroundColor: '#E5E5E7',
    marginLeft: 4,
    marginVertical: 3,
    borderRadius: 1,
  },
  classEndTime: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  classEndTimeGhost: { color: '#9CA3AF' },
  classDuration: {
    fontSize: 10,
    color: COLORS.gray,
    marginTop: 6,
    fontStyle: 'italic',
  },

  classInfoCol: { flex: 1, paddingLeft: 12 },
  classHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  classSubject: { fontSize: 14, fontWeight: '900', color: COLORS.black },
  classSubjectGhost: { color: '#6B7280' },

  modalityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modalityOnline: { backgroundColor: COLORS.onlineBg },
  modalityF2F: { backgroundColor: COLORS.f2fBg },
  pillExcused: { backgroundColor: COLORS.excusedBg },
  pillUnexcused: { backgroundColor: COLORS.unexcusedBg },
  pillNeutral: { backgroundColor: COLORS.neutralBg },
  modalityPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  modalityTextOnline: { color: COLORS.online },
  modalityTextF2F: { color: COLORS.warning },
  pillTextExcused: { color: COLORS.success },
  pillTextUnexcused: { color: COLORS.warning },
  pillTextNeutral: { color: COLORS.gray },

  classTitle: {
    fontSize: 13,
    color: COLORS.black,
    fontWeight: '600',
    marginBottom: 8,
    lineHeight: 18,
  },
  classTitleGhost: { color: '#6B7280' },

  classMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  classMetaItem: { fontSize: 12, color: COLORS.gray },
  classMetaLabel: { color: '#B0B0B5', fontWeight: '600' },

  ghostReasonBox: {
    backgroundColor: '#F5F5F7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  ghostReasonLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: COLORS.gray,
    marginBottom: 1,
  },
  ghostReasonValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },

  liveStatusBlock: {
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    borderRadius: 8,
  },
  liveStatusHeadline: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  liveStatusSubline: { fontSize: 11, color: '#4B5563', marginTop: 3, fontWeight: '500' },

  classActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
  },
  actionButtonPrimary: { backgroundColor: COLORS.primary },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.black,
  },
  actionButtonPrimaryText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  ghostDetailsBtn: {
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
  },
  ghostDetailsBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A1A1A',
  },

  emptyCard: {
    margin: 16,
    padding: 40,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 19,
  },
});

export default FacultyScheduleScreen;