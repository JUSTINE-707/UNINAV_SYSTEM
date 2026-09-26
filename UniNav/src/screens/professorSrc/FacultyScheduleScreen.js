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
  Modal,
  Pressable,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';
import { useSemester } from '../../context/SemesterContext';
import Skeleton, { SkeletonCircle } from '../../components/Skeleton';

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
};

const COLORS = {
  primary: T.crimson,
  white: '#FFFFFF',
  black: T.ink,
  gray: T.inkMuted,
  lightGray: T.hair,
  background: T.canvas,
  success: T.green,
  warning: T.amber,
  online: T.blue,
  onlineBg: T.blueSoft,
  f2fBg: T.amberSoft,
  excusedBg: T.greenSoft,
  unexcusedBg: T.amberSoft,
  neutralBg: T.slateSoft,
  ghostBg: T.slateSoft,
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
// LIVE STATUS
// ============================================================

const getLiveStatus = (cls, nowMin, todayCode) => {
  if (!cls || cls.day !== todayCode || cls.ghostReport) return null;

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  const hasSession = !!cls.liveSession;
  const endedEarly = !!cls.liveSession?.ended_at;
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

  if (nowMin > end) {
    if (hasSession && endedEarly) {
      return {
        roomState: 'ended_early',
        icon: '⏹',
        headline: 'ENDED EARLY',
        subline: `You ended this class at ${formatVerifiedTime(
          cls.liveSession.ended_at
        )}`,
      };
    }
    return {
      roomState: 'ended',
      icon: '·',
      headline: 'CLASS ENDED',
      subline: hasSession
        ? `You checked in at ${formatVerifiedTime(cls.liveSession.scanned_at)}`
        : 'Room was never verified',
    };
  }

  if (nowMin < start) {
    return {
      roomState: 'upcoming',
      icon: '🕐',
      headline: 'NOT STARTED YET',
      subline: `Starts at ${formatTime(cls.start_time)}`,
    };
  }

  if (hasSession) {
    if (endedEarly) {
      return {
        roomState: 'ended_early',
        icon: '⏹',
        headline: 'ENDED EARLY',
        subline: `You ended this class at ${formatVerifiedTime(cls.liveSession.ended_at)}`,
      };
    }
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
    case 'occupied': return T.green;
    case 'vacant': return T.amber;
    case 'online': return T.blue;
    case 'ended': return T.slate;
    case 'ended_early': return '#C77700';
    case 'upcoming': return T.crimson;
    default: return T.slate;
  }
};

const stateSoftBg = (state) => {
  switch (state) {
    case 'occupied': return T.greenSoft;
    case 'vacant': return T.amberSoft;
    case 'online': return T.blueSoft;
    case 'ended': return T.slateSoft;
    case 'ended_early': return T.amberSoft;
    case 'upcoming': return '#FDECEC';
    default: return T.slateSoft;
  }
};

// ------------------------------------------------------------
// Time-aware action gates
// ------------------------------------------------------------
const getAvailableActions = (cls, nowMin, todayCode) => {
  if (cls.ghostReport) {
    return { canScan: false, canNavigate: false, canEndEarly: false, canReportGhost: false };
  }
  if (cls.isOnline) {
    return { canScan: false, canNavigate: false, canEndEarly: false, canReportGhost: true };
  }

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);

  if (start === null || end === null) {
    return { canScan: false, canNavigate: true, canEndEarly: false, canReportGhost: true };
  }

  const hasSession = !!cls.liveSession;
  const endedEarly = !!cls.liveSession?.ended_at;
  const isToday = cls.day === todayCode;

  if (!isToday) {
    return {
      canScan: !hasSession,
      canNavigate: true,
      canEndEarly: hasSession && !endedEarly,
      canReportGhost: !hasSession,
    };
  }

  if (nowMin > end) {
    return { canScan: false, canNavigate: false, canEndEarly: false, canReportGhost: !hasSession };
  }
  if (nowMin < start) {
    return { canScan: true, canNavigate: true, canEndEarly: false, canReportGhost: true };
  }
  if (hasSession && !endedEarly) {
    return { canScan: false, canNavigate: true, canEndEarly: true, canReportGhost: false };
  }
  if (hasSession && endedEarly) {
    return { canScan: false, canNavigate: true, canEndEarly: false, canReportGhost: false };
  }
  return { canScan: true, canNavigate: true, canEndEarly: false, canReportGhost: true };
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

  const [detailClass, setDetailClass] = useState(null);

  const [nowTick, setNowTick] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNowTick(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const todayCode = getTodayCode();
  const nowMin = nowTick.getHours() * 60 + nowTick.getMinutes();

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

      {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('professor_id', user.id)
          .eq('semester_id', semester.id);
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

      if (!scheduleErr && scheduleData.length === 0 && profProfile?.employee_id) {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('employee_id', profProfile.employee_id)
          .eq('semester_id', semester.id);
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

      if (!scheduleErr && scheduleData.length === 0 && profProfile?.program) {
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

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const sessionsRes = await supabase
        .from('room_sessions')
        .select('id, schedule_id, status, class_type, scanned_at, ended_at')
        .in('schedule_id', scheduleIds)
        .gte('scanned_at', startOfDay.toISOString())
        .lte('scanned_at', endOfDay.toISOString());

      if (sessionsRes.error) {
        console.warn('[FacultySchedule] room_sessions fetch:', sessionsRes.error.message);
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

  const closeDetail = () => setDetailClass(null);

  const handleScanQR = (schedule) => {
    if (!schedule || schedule.ghostReport) return;
    closeDetail();
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
    if (!schedule || schedule.ghostReport) return;
    if (schedule.isOnline) {
      Alert.alert('Online Class', 'No navigation needed for online classes.');
      return;
    }
    closeDetail();
    navigation.navigate('Map', { roomName: schedule.room_name });
  };

  const handleReportGhost = (schedule) => {
    if (!schedule) return;
    closeDetail();
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

  const handleEndClassEarly = (schedule) => {
    if (!schedule?.liveSession?.id) {
      Alert.alert(
        'No active session',
        'You need to scan the room QR first before ending the class.'
      );
      return;
    }
    closeDetail();
    navigation.navigate('EndClassEarly', {
      scheduleId: schedule.id,
      sessionId: schedule.liveSession.id,
      subjectCode: schedule.subject_code,
      section: schedule.section,
      roomName: schedule.room_name,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
    });
  };

  // ============================================================
  // LOADING / ERROR
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

  const selectedSchedules = schedulesByDay[selectedDay] || [];
  const selectedDayFull = WEEK.find((w) => w.code === selectedDay)?.full;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

      {/* ==================== HEADER ==================== */}
      <View style={styles.header}>
        <View style={styles.headerDecor} />

        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backButton}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>

            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.headerEyebrow}>FACULTY</Text>
              <Text style={styles.headerTitle}>My Schedule</Text>
            </View>

            <View style={{ width: 34 }} />
          </View>

          {semester && (
            <View style={styles.semesterRow}>
              <View style={styles.semesterDot} />
              <Text style={styles.semesterText} numberOfLines={1}>
                {semester.name}
              </Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ==================== SUMMARY STRIP ==================== */}
        <View style={styles.statStrip}>
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>{totalWeekClasses}</Text>
            <Text style={styles.statLabel}>TOTAL</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={[styles.statValue, { color: T.amber }]}>
              {totalInPerson}
            </Text>
            <Text style={styles.statLabel}>F2F</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={[styles.statValue, { color: T.blue }]}>
              {totalOnline}
            </Text>
            <Text style={styles.statLabel}>ONLINE</Text>
          </View>
          {totalReported > 0 && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statBlock}>
                <Text style={[styles.statValue, { color: T.slate }]}>
                  {totalReported}
                </Text>
                <Text style={styles.statLabel}>REPORTED</Text>
              </View>
            </>
          )}
        </View>

        {/* ==================== DAY TABS ==================== */}
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
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.dayTabLabel,
                    isSelected && styles.dayTabLabelActive,
                  ]}
                >
                  {label}
                </Text>

                <Text
                  style={[
                    styles.dayTabCount,
                    isSelected && styles.dayTabCountActive,
                    count === 0 && !isSelected && styles.dayTabCountEmpty,
                  ]}
                >
                  {String(count).padStart(2, '0')}
                </Text>

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

        {/* ==================== SELECTED DAY HEADER ==================== */}
        <View style={styles.selectedDayHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedDayEyebrow}>
              {selectedDay === todayCode ? 'TODAY' : 'SCHEDULE'}
            </Text>
            <Text style={styles.selectedDayTitle}>{selectedDayFull}</Text>
          </View>

          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {selectedSchedules.length}{' '}
              {selectedSchedules.length === 1 ? 'class' : 'classes'}
            </Text>
          </View>
        </View>

        {/* ==================== CLASS LIST ==================== */}
        {selectedSchedules.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Text style={styles.emptyIconText}>·</Text>
            </View>
            <Text style={styles.emptyTitle}>No classes scheduled</Text>
            <Text style={styles.emptyText}>
              {semester
                ? `You have no classes on ${selectedDayFull}.`
                : 'No active semester. Please contact the admin.'}
            </Text>
          </View>
        ) : (
          <View style={styles.classList}>
            {selectedSchedules.map((schedule, index) => {
              const isGhost = !!schedule.ghostReport;
              const live = getLiveStatus(schedule, nowMin, todayCode);
              const accent = live
                ? stateAccent(live.roomState)
                : isGhost
                ? T.slate
                : T.crimson;
              const isLast = index === selectedSchedules.length - 1;

              return (
                <TouchableOpacity
                  key={schedule.id}
                  style={[styles.classRow, !isLast && styles.classRowDivided]}
                  activeOpacity={0.7}
                  onPress={() => setDetailClass(schedule)}
                >
                  <View
                    style={[styles.classRail, { backgroundColor: accent }]}
                  />

                  <View style={styles.classTimeCol}>
                    <Text
                      style={[
                        styles.classStartTime,
                        isGhost && styles.classStartTimeGhost,
                      ]}
                    >
                      {formatTime(schedule.start_time).replace(' ', '\n')}
                    </Text>
                    <View style={styles.timeConnector} />
                    <Text
                      style={[
                        styles.classEndTime,
                        isGhost && styles.classEndTimeGhost,
                      ]}
                    >
                      {formatTime(schedule.end_time).replace(' ', '\n')}
                    </Text>
                    <Text style={styles.classDuration}>
                      {formatDuration(schedule.start_time, schedule.end_time)}
                    </Text>
                  </View>

                  <View style={styles.classBody}>
                    <View style={styles.classHeaderRow}>
                      <Text
                        style={[
                          styles.classSubject,
                          isGhost && styles.classSubjectGhost,
                        ]}
                        numberOfLines={1}
                      >
                        {schedule.subject_code}
                      </Text>

                      {isGhost ? (
                        <View
                          style={[
                            styles.tag,
                            schedule.ghostReport.is_excused === true
                              ? { backgroundColor: T.greenSoft }
                              : schedule.ghostReport.is_excused === false
                              ? { backgroundColor: T.amberSoft }
                              : { backgroundColor: T.slateSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tagText,
                              schedule.ghostReport.is_excused === true
                                ? { color: T.green }
                                : schedule.ghostReport.is_excused === false
                                ? { color: T.amber }
                                : { color: T.slate },
                            ]}
                          >
                            {schedule.ghostReport.is_excused === true
                              ? 'EXCUSED'
                              : schedule.ghostReport.is_excused === false
                              ? 'UNEXCUSED'
                              : 'REPORTED'}
                          </Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.tag,
                            schedule.isOnline
                              ? { backgroundColor: T.blueSoft }
                              : { backgroundColor: T.amberSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tagText,
                              schedule.isOnline
                                ? { color: T.blue }
                                : { color: T.amber },
                            ]}
                          >
                            {schedule.isOnline ? 'ONLINE' : 'F2F'}
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

                    <View style={styles.metaRow}>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {schedule.section ? `${schedule.section} · ` : ''}
                        {schedule.isOnline
                          ? 'Online'
                          : schedule.room_name || '—'}
                      </Text>
                    </View>

                    {isGhost && (
                      <View style={styles.ghostNote}>
                        <Text style={styles.ghostNoteLabel}>REPORTED AS</Text>
                        <Text style={styles.ghostNoteValue} numberOfLines={2}>
                          {REASON_LABELS[schedule.ghostReport.reason] ||
                            REASON_LABELS[
                              schedule.ghostReport.excused_reason
                            ] ||
                            schedule.ghostReport.reason}
                        </Text>
                      </View>
                    )}

                    {live && !isGhost && (
                      <View
                        style={[
                          styles.liveStatusRow,
                          { borderLeftColor: stateAccent(live.roomState) },
                        ]}
                      >
                        <View
                          style={[
                            styles.liveStatusDot,
                            { backgroundColor: stateAccent(live.roomState) },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.liveStatusHeadline,
                              { color: stateAccent(live.roomState) },
                            ]}
                          >
                            {live.headline}
                          </Text>
                          <Text style={styles.liveStatusSubline} numberOfLines={2}>
                            {live.subline}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>

                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

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
              {detailClass && (() => {
                const live = getLiveStatus(detailClass, nowMin, todayCode);
                const accent = live
                  ? stateAccent(live.roomState)
                  : stateAccent(detailClass.ghostReport ? 'ghost' : 'upcoming');
                const isGhost = !!detailClass.ghostReport;
                const acts = getAvailableActions(detailClass, nowMin, todayCode);

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
                          style={[
                            styles.modalBadge,
                            detailClass.ghostReport.is_excused === true
                              ? { backgroundColor: T.greenSoft }
                              : detailClass.ghostReport.is_excused === false
                              ? { backgroundColor: T.amberSoft }
                              : { backgroundColor: T.slateSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.modalBadgeText,
                              detailClass.ghostReport.is_excused === true
                                ? { color: T.green }
                                : detailClass.ghostReport.is_excused === false
                                ? { color: T.amber }
                                : { color: T.slate },
                            ]}
                          >
                            {detailClass.ghostReport.is_excused === true
                              ? 'REPORTED · EXCUSED'
                              : detailClass.ghostReport.is_excused === false
                              ? 'REPORTED · UNEXCUSED'
                              : 'REPORTED'}
                          </Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.modalBadge,
                            detailClass.isOnline
                              ? { backgroundColor: T.blueSoft }
                              : { backgroundColor: T.amberSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.modalBadgeText,
                              detailClass.isOnline
                                ? { color: T.blue }
                                : { color: T.amber },
                            ]}
                          >
                            {detailClass.isOnline ? 'ONLINE' : 'FACE-TO-FACE'}
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
                          <Text
                            style={[
                              styles.modalStatusPillText,
                              { color: accent },
                            ]}
                          >
                            {live.headline}
                          </Text>
                        </View>
                      )}

                      <View
                        style={[
                          styles.modalDayPill,
                          { backgroundColor: T.slateSoft },
                        ]}
                      >
                        <Text style={styles.modalDayPillText}>
                          {WEEK.find((w) => w.code === detailClass.day)?.full ||
                            detailClass.day}
                        </Text>
                      </View>
                    </View>

                    {/* INFO GRID */}
                    <View style={styles.modalGrid}>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>SECTION</Text>
                        <Text style={styles.modalGridValue} numberOfLines={1}>
                          {detailClass.section || '—'}
                        </Text>
                      </View>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>ROOM</Text>
                        <Text style={styles.modalGridValue} numberOfLines={1}>
                          {detailClass.isOnline
                            ? 'Online'
                            : detailClass.room_name || '—'}
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

                    {/* LIVE STATUS */}
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
                            {live.headline}
                          </Text>
                          {detailClass.liveSession?.scanned_at && (
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
                          {live.subline}
                        </Text>
                      </View>
                    )}

                    {/* GHOST DETAILS */}
                    {isGhost && (
                      <View style={styles.modalGhostBox}>
                        <Text style={styles.modalGhostLabel}>
                          REPORT DETAILS
                        </Text>
                        <Text style={styles.modalGhostCause}>
                          Cause:{' '}
                          {CAUSE_LABELS[detailClass.ghostReport.cause] ||
                            detailClass.ghostReport.cause}
                        </Text>
                        <Text style={styles.modalGhostReason}>
                          Reason:{' '}
                          {REASON_LABELS[detailClass.ghostReport.reason] ||
                            REASON_LABELS[
                              detailClass.ghostReport.excused_reason
                            ] ||
                            detailClass.ghostReport.reason}
                        </Text>
                        {!!detailClass.ghostReport.notes && (
                          <Text style={styles.modalGhostNotes}>
                            "{detailClass.ghostReport.notes}"
                          </Text>
                        )}
                      </View>
                    )}

                    {/* ACTIONS */}
                    {!isGhost && (
                      <View style={styles.modalActions}>
                        {acts.canNavigate && (
                          <TouchableOpacity
                            style={styles.modalSecondaryBtn}
                            onPress={() => handleNavigate(detailClass)}
                          >
                            <Text style={styles.modalSecondaryBtnText}>
                              Navigate
                            </Text>
                          </TouchableOpacity>
                        )}

                        {acts.canEndEarly && (
                          <TouchableOpacity
                            style={styles.modalEndEarlyBtn}
                            onPress={() => handleEndClassEarly(detailClass)}
                          >
                            <Text style={styles.modalEndEarlyBtnText}>
                              End Class Early
                            </Text>
                          </TouchableOpacity>
                        )}

                        {acts.canScan && (
                          <TouchableOpacity
                            style={styles.modalPrimaryBtn}
                            onPress={() => handleScanQR(detailClass)}
                          >
                            <Text style={styles.modalPrimaryBtnText}>
                              Scan QR
                            </Text>
                          </TouchableOpacity>
                        )}

                        {acts.canReportGhost && (
                          <TouchableOpacity
                            style={styles.modalGhostLinkInline}
                            onPress={() => handleReportGhost(detailClass)}
                          >
                            <Text style={styles.modalGhostLinkInlineText}>
                              Report this class as cancelled / not attended
                            </Text>
                          </TouchableOpacity>
                        )}

                        {!acts.canScan &&
                          !acts.canEndEarly &&
                          !acts.canReportGhost &&
                          !acts.canNavigate && (
                            <TouchableOpacity
                              style={styles.modalPrimaryBtn}
                              onPress={closeDetail}
                            >
                              <Text style={styles.modalPrimaryBtnText}>
                                Close
                              </Text>
                            </TouchableOpacity>
                          )}
                      </View>
                    )}

                    {isGhost && (
                      <TouchableOpacity
                        style={styles.modalPrimaryBtn}
                        onPress={closeDetail}
                      >
                        <Text style={styles.modalPrimaryBtnText}>Close</Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

// ============================================================
// LOADING SKELETON
// ============================================================

const FacultyScheduleSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View style={styles.headerTopRow}>
          <Skeleton width={34} height={34} radius={17} />
          <View style={{ flex: 1, paddingLeft: 12, gap: 6 }}>
            <Skeleton width={60} height={9} radius={3} />
            <Skeleton width={140} height={18} radius={4} />
          </View>
          <View style={{ width: 34 }} />
        </View>
      </View>
    </View>

    <View style={styles.scrollContent}>
      <View style={styles.statStrip}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.statBlock,
              i < 3 && { borderRightWidth: 1, borderRightColor: T.hair2 },
            ]}
          >
            <Skeleton width={34} height={22} radius={4} />
            <Skeleton width={50} height={9} radius={3} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} width={60} height={72} radius={12} />
        ))}
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 }}>
        <Skeleton width={80} height={9} radius={3} />
        <Skeleton width={130} height={22} radius={4} style={{ marginTop: 6 }} />
      </View>

      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            paddingHorizontal: 16,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: T.hair2,
          }}
        >
          <View style={{ width: 56 }}>
            <Skeleton width={44} height={14} radius={3} />
            <Skeleton width={44} height={14} radius={3} style={{ marginTop: 12 }} />
          </View>
          <View style={{ flex: 1, paddingLeft: 12 }}>
            <Skeleton width={70} height={14} radius={4} />
            <Skeleton width="85%" height={14} radius={4} style={{ marginTop: 8 }} />
            <Skeleton width="55%" height={12} radius={4} style={{ marginTop: 8 }} />
            <Skeleton width="100%" height={40} radius={8} style={{ marginTop: 12 }} />
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
  container: { flex: 1, backgroundColor: T.canvas },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: T.canvas,
  },
  loadingText: { marginTop: 12, color: T.inkMuted, fontSize: 14 },

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
  errorRetryButton: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 10, backgroundColor: T.crimson,
  },
  errorRetryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  // ==================== HEADER ====================
  header: {
    backgroundColor: T.crimson,
    paddingTop: 54,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  headerDecor: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: T.crimsonLight,
    opacity: 0.4,
  },
  headerContent: {
    paddingHorizontal: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: -4,
  },
  headerEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
    opacity: 0.65,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  semesterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    gap: 7,
  },
  semesterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7CFC9E',
  },
  semesterText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  scrollContent: { paddingBottom: 20 },

  // ==================== STAT STRIP ====================
  statStrip: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: 'hidden',
  },
  statBlock: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: T.hair2,
    marginVertical: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: T.inkFaint,
    marginTop: 3,
    letterSpacing: 1.4,
  },

  // ==================== DAY TABS ====================
  dayTabsScroll: { maxHeight: 96, marginTop: 20 },
  dayTabsContent: { paddingHorizontal: 16, gap: 8 },
  dayTab: {
    minWidth: 62,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: T.surface,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: T.hair,
    position: 'relative',
  },
  dayTabActive: {
    backgroundColor: T.crimson,
    borderColor: T.crimson,
  },
  dayTabToday: {
    borderColor: '#F3C6C6',
  },
  dayTabLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: T.inkSoft,
    marginBottom: 8,
    letterSpacing: -0.1,
  },
  dayTabLabelActive: { color: '#FFFFFF' },
  dayTabCount: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  dayTabCountActive: { color: '#FFFFFF' },
  dayTabCountEmpty: { color: T.inkFaint, opacity: 0.6 },
  todayDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: T.crimson,
  },
  todayDotActive: { backgroundColor: '#FFFFFF' },

  // ==================== SELECTED DAY HEADER ====================
  selectedDayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 12,
    gap: 10,
  },
  selectedDayEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.2,
    color: T.crimson,
    marginBottom: 5,
  },
  selectedDayTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
  },
  countPillText: {
    fontSize: 10,
    fontWeight: '900',
    color: T.inkMuted,
    letterSpacing: 0.6,
  },

  // ==================== CLASS LIST ====================
  classList: {
    marginHorizontal: 16,
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.hair,
    overflow: 'hidden',
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 16,
    paddingRight: 14,
  },
  classRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: T.hair2,
  },
  classRail: {
    width: 3,
    marginRight: 12,
    borderRadius: 2,
  },
  classTimeCol: {
    width: 62,
    alignItems: 'flex-start',
    paddingRight: 8,
    paddingTop: 2,
  },
  classStartTime: {
    fontSize: 12,
    fontWeight: '900',
    color: T.crimson,
    lineHeight: 14,
    letterSpacing: -0.2,
  },
  classStartTimeGhost: {
    color: T.inkFaint,
    textDecorationLine: 'line-through',
  },
  timeConnector: {
    width: 1,
    height: 14,
    backgroundColor: T.hair,
    marginLeft: 2,
    marginVertical: 4,
  },
  classEndTime: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkSoft,
    lineHeight: 14,
  },
  classEndTimeGhost: { color: T.inkFaint },
  classDuration: {
    fontSize: 9,
    color: T.inkFaint,
    marginTop: 6,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  classBody: { flex: 1, paddingRight: 6 },
  classHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  classSubject: {
    fontSize: 13,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: 0.2,
    flex: 1,
  },
  classSubjectGhost: { color: T.slate },
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
  classTitle: {
    fontSize: 14,
    color: T.ink,
    fontWeight: '600',
    lineHeight: 19,
    marginBottom: 6,
  },
  classTitleGhost: {
    color: T.inkMuted,
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaText: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '500',
    flex: 1,
  },

  ghostNote: {
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: T.slate,
  },
  ghostNoteLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: T.inkFaint,
    marginBottom: 3,
  },
  ghostNoteValue: {
    fontSize: 12,
    fontWeight: '700',
    color: T.inkSoft,
  },

  liveStatusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    paddingLeft: 10,
    borderLeftWidth: 3,
    gap: 8,
  },
  liveStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  liveStatusHeadline: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  liveStatusSubline: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '500',
    lineHeight: 15,
  },

  chevron: {
    fontSize: 22,
    color: T.inkFaint,
    fontWeight: '300',
    alignSelf: 'center',
    paddingLeft: 6,
    lineHeight: 22,
  },

  emptyCard: {
    marginHorizontal: 16,
    padding: 40,
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.hair2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyIconText: {
    fontSize: 34,
    color: T.inkFaint,
    lineHeight: 30,
    marginTop: -6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
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
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalScrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 40,
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
    marginBottom: 6,
  },
  modalSubject: {
    fontSize: 26,
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
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modalStatusPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  modalDayPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modalDayPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
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
  modalGridItem: { width: '50%', paddingVertical: 6 },
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
  },
  modalLiveHeadline: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  modalLiveTime: { fontSize: 11, fontWeight: '800' },
  modalLiveSubline: {
    fontSize: 12,
    color: T.inkSoft,
    fontWeight: '500',
    lineHeight: 17,
  },
  modalGhostBox: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: T.slate,
  },
  modalGhostLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    marginBottom: 6,
  },
  modalGhostCause: {
    fontSize: 13,
    fontWeight: '700',
    color: T.ink,
    marginBottom: 3,
  },
  modalGhostReason: {
    fontSize: 13,
    fontWeight: '700',
    color: T.ink,
    marginBottom: 6,
  },
  modalGhostNotes: {
    fontSize: 12,
    color: T.inkMuted,
    fontStyle: 'italic',
    lineHeight: 17,
    marginTop: 4,
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
  modalEndEarlyBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 140,
    backgroundColor: '#FFFAF0',
    borderWidth: 1.5,
    borderColor: '#C77700',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEndEarlyBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#C77700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  modalGhostLinkInline: {
    flexBasis: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalGhostLinkInlineText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B26A00',
    textDecorationLine: 'underline',
  },
});

export default FacultyScheduleScreen;