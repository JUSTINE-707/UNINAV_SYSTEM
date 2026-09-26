import { useEffect, useState, useCallback, useRef } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';
import { useSemester } from '../../context/SemesterContext';
import { COLORS } from '../../constants/theme';
import Skeleton, { SkeletonCircle } from '../../components/Skeleton';

// ============================================================
// CONSTANTS
// ============================================================

const DAYS = ['Sun', 'M', 'T', 'W', 'Th', 'F', 'Sat'];
const DAY_LABELS = {
  Sun: 'Sunday',
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  Th: 'Thursday',
  F: 'Friday',
  Sat: 'Saturday',
};

const TODAY_PREVIEW_LIMIT = 3;
const REPORTED_BANNER_DURATION = 6000;

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

const formatVerifiedTime = (isoString) => {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const isOnlineRoom = (roomName) => {
  if (!roomName) return false;
  const n = roomName.toString().trim().toUpperCase();
  return (
    n.includes('ONLINE') ||
    n.includes('ASYNCHRONOUS') ||
    n.includes('GOOGLE CLASSROOM') ||
    n === 'ZOOM' ||
    n === 'GOOGLE MEET' ||
    n === 'GMEET'
  );
};

const toLocalDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeNameKey = (name) => {
  if (!name) return '';
  return name.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

// ------------------------------------------------------------
// CLASS STATUS
//
//   upcoming     — before the class window
//   starts_now   — in the window, professor hasn't scanned yet  (amber)
//   ongoing      — in the window, professor has scanned          (green)
//   ended_early  — professor ended the class before its end time (deep amber)
//   missed       — window passed with NO scan                    (red)
//   completed    — window passed WITH a scan                     (grey)
//   ghost        — reported as cancelled / absent                (grey)
// ------------------------------------------------------------

const getProfessorClassStatus = (cls, nowMin) => {
  if (cls.ghostReport) return 'ghost';

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  if (start === null || end === null) return 'unknown';

  const hasSession = !!cls.liveSession;
  const endedEarly = !!cls.liveSession?.ended_at;

  // Window already ended
  if (nowMin > end) {
    return hasSession ? 'completed' : 'missed';
  }

  // Window in progress
  if (nowMin >= start && nowMin <= end) {
    if (hasSession && endedEarly) return 'ended_early';
    return hasSession ? 'ongoing' : 'starts_now';
  }

  // Before the window
  return 'upcoming';
};

const stateAccent = (state) => {
  switch (state) {
    case 'ongoing':
    case 'occupied':
      return '#059669'; // green
    case 'starts_now':
    case 'upcoming':
    case 'vacant':
      return '#D97706'; // amber
    case 'ended_early':
      return '#C77700'; // deep amber — ended but not a problem
    case 'missed':
      return '#B00020'; // red — problem state
    case 'online':
      return '#3B82F6'; // blue
    case 'ghost':
    case 'completed':
    case 'ended':
      return '#9CA3AF'; // grey
    default:
      return '#9CA3AF';
  }
};

const getInlineStatusLabel = (status, cls) => {
  if (status === 'ghost') {
    if (cls.ghostReport?.is_excused === true) return 'REPORTED · EXCUSED';
    if (cls.ghostReport?.is_excused === false) return 'REPORTED · UNEXCUSED';
    return 'REPORTED';
  }
  if (status === 'ongoing') return 'IN PROGRESS';
  if (status === 'ended_early') return 'ENDED EARLY';
  if (status === 'starts_now') return 'STARTS NOW';
  if (status === 'upcoming') return 'UPCOMING';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'missed') return 'MISSED · NO CHECK-IN';
  return '';
};

// ------------------------------------------------------------
// Which actions apply to a class right now?
// ------------------------------------------------------------
const getAvailableActions = (cls, nowMin) => {
  if (cls.ghostReport) {
    return {
      canScan: false,
      canNavigate: false,
      canEndEarly: false,
      canReportGhost: false,
    };
  }

  if (cls.isOnline) {
    return {
      canScan: false,
      canNavigate: false,
      canEndEarly: false,
      canReportGhost: true,
    };
  }

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);

  if (start === null || end === null) {
    return {
      canScan: false,
      canNavigate: true,
      canEndEarly: false,
      canReportGhost: true,
    };
  }

  const hasSession = !!cls.liveSession;
  const endedEarly = !!cls.liveSession?.ended_at;

  // Class window already passed
  if (nowMin > end) {
    return {
      canScan: false,
      canNavigate: false,
      canEndEarly: false,
      canReportGhost: !hasSession,
    };
  }

  // Before class starts
  if (nowMin < start) {
    return {
      canScan: true,
      canNavigate: true,
      canEndEarly: false,
      canReportGhost: true,
    };
  }

  // Inside class window
  if (hasSession && !endedEarly) {
    return {
      canScan: false,
      canNavigate: true,
      canEndEarly: true,
      canReportGhost: false,
    };
  }

  if (hasSession && endedEarly) {
    return {
      canScan: false,
      canNavigate: true,
      canEndEarly: false,
      canReportGhost: false,
    };
  }

  // Inside window, no session yet
  return {
    canScan: true,
    canNavigate: true,
    canEndEarly: false,
    canReportGhost: true,
  };
};

// ============================================================
// COMPONENT
// ============================================================

const ProfessorDashboard = ({ navigation }) => {
  const { user } = useAuth();
  const { semester } = useSemester();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [todayClasses, setTodayClasses] = useState([]);
  const [nextClass, setNextClass] = useState(null);
  const [now, setNow] = useState(new Date());

  const [showReportedBanner, setShowReportedBanner] = useState(false);
  const bannerShownRef = useRef(false);
  const bannerTimerRef = useRef(null);

  // Class detail modal
  const [detailClass, setDetailClass] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // ============================================================
  // DATA LOAD
  // ============================================================

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);

      if (!user?.id) {
        setLoading(false);
        return;
      }

      if (!semester?.id) {
        setTodayClasses([]);
        setNextClass(null);
        setLoading(false);
        return;
      }

      const { data: profProfile } = await supabase
        .from('faculty')
        .select('employee_id, program, college')
        .eq('id', user.id)
        .maybeSingle();

      setProfile(profProfile);

      const today = DAYS[new Date().getDay()];
      const todayDate = toLocalDateString(new Date());

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
          .eq('day', today)
          .eq('semester_id', semester.id)
          .order('start_time', { ascending: true });
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

      if (
        !scheduleErr &&
        scheduleData.length === 0 &&
        profProfile?.employee_id
      ) {
        const { data, error } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('employee_id', profProfile.employee_id)
          .eq('day', today)
          .eq('semester_id', semester.id)
          .order('start_time', { ascending: true });
        if (error) scheduleErr = error;
        else scheduleData = data || [];
      }

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
            .eq('day', today)
            .eq('semester_id', semester.id)
            .order('start_time', { ascending: true });

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

      if (scheduleErr) throw scheduleErr;

      const { data: ghostData, error: ghostErr } = await supabase
        .from('ghost_reports')
        .select(
          'id, schedule_id, reason, cause, is_excused, excused_reason, notes, report_date, room_released'
        )
        .eq('faculty_id', user.id)
        .eq('report_date', todayDate);

      if (ghostErr) throw ghostErr;

      const ghostMap = {};
      (ghostData || []).forEach((r) => {
        ghostMap[r.schedule_id] = r;
      });

      const scheduleIds = (scheduleData || []).map((s) => s.id);
      const sessionMap = {};

      if (scheduleIds.length > 0) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const { data: sessionData, error: sessionErr } = await supabase
          .from('room_sessions')
          .select('id, schedule_id, scanned_at, ended_at, class_type, status')
          .eq('faculty_id', user.id)
          .in('schedule_id', scheduleIds)
          .gte('scanned_at', startOfDay.toISOString())
          .lte('scanned_at', endOfDay.toISOString());

        if (sessionErr) {
          console.warn(
            '[ProfessorDashboard] room_sessions fetch:',
            sessionErr.message
          );
        } else {
          (sessionData || []).forEach((s) => {
            sessionMap[s.schedule_id] = s;
          });
        }
      }

      const classes = (scheduleData || []).map((c) => ({
        ...c,
        isOnline: isOnlineRoom(c.room_name),
        ghostReport: ghostMap[c.id] || null,
        liveSession: sessionMap[c.id] || null,
      }));

      setTodayClasses(classes);

      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const upcoming = classes.find((c) => {
        if (c.ghostReport) return false;
        if (c.liveSession?.ended_at) return false; // already ended early
        const end = timeToMinutes(c.end_time);
        return end !== null && nowMinutes < end;
      });

      if (!upcoming) {
        const latestGhost = [...classes]
          .filter((c) => c.ghostReport)
          .sort(
            (a, b) =>
              (timeToMinutes(a.end_time) || 0) -
              (timeToMinutes(b.end_time) || 0)
          )
          .pop();
        setNextClass(latestGhost || null);
      } else {
        setNextClass(upcoming);
      }

      const reportedCount = classes.filter((c) => c.ghostReport).length;

      if (reportedCount > 0 && !bannerShownRef.current) {
        bannerShownRef.current = true;
        setShowReportedBanner(true);

        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = setTimeout(() => {
          setShowReportedBanner(false);
        }, REPORTED_BANNER_DURATION);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
      Alert.alert('Error', 'Failed to load your schedule.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, now, semester]);

  useFocusEffect(
    useCallback(() => {
      if (user) loadDashboard();
    }, [user, loadDashboard])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

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
      Alert.alert('Online Class', 'This class is conducted online. No navigation needed.');
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

  const handleQuickReportGhost = () => {
    const target = todayClasses.find((c) => !c.ghostReport) || todayClasses[0];
    if (!target) {
      Alert.alert(
        'No classes to report',
        'You have no classes scheduled today that can be reported.'
      );
      return;
    }
    if (target.ghostReport) {
      Alert.alert(
        'Already Reported',
        'All your classes today have already been reported.'
      );
      return;
    }
    handleReportGhost(target);
  };

  const openFullSchedule = () => {
    navigation.navigate('FacultySchedule');
  };

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return <ProfessorDashboardSkeleton />;
  }

  // ============================================================
  // RENDER
  // ============================================================

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const reportedCount = todayClasses.filter((c) => c.ghostReport).length;
  const missedCount = todayClasses.filter(
    (c) => getProfessorClassStatus(c, nowMin) === 'missed'
  ).length;
  const remainingClasses = todayClasses.filter((c) => {
    if (c.ghostReport) return false;
    // Ended early → no longer "remaining"
    if (c.liveSession?.ended_at) return false;
    const end = timeToMinutes(c.end_time);
    return end !== null && end > nowMin;
  });

  const nextStatus = nextClass
    ? getProfessorClassStatus(nextClass, nowMin)
    : null;

  const previewClasses = (() => {
    const active = todayClasses.filter((c) => !c.ghostReport);
    const ghost = todayClasses.filter((c) => c.ghostReport);
    return [...active, ...ghost].slice(0, TODAY_PREVIEW_LIMIT);
  })();

  const moreCount = Math.max(0, todayClasses.length - previewClasses.length);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#8B0000" />

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
        {/* ==================== HERO HEADER ==================== */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerEyebrow}>FACULTY PORTAL</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {getGreeting()}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {profile?.program ? `${profile.program} · ` : ''}
                {DAY_LABELS[DAYS[now.getDay()]] || DAYS[now.getDay()]}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={styles.logoutButton}
            >
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>

          {semester && (
            <View style={styles.semesterChip}>
              <Text style={styles.semesterChipDot}>●</Text>
              <Text style={styles.semesterChipText}>{semester.name}</Text>
            </View>
          )}
        </View>

        {/* ==================== SUMMARY ==================== */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{todayClasses.length}</Text>
            <Text style={styles.summaryLabel}>Classes</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{remainingClasses.length}</Text>
            <Text style={styles.summaryLabel}>Remaining</Text>
          </View>

          {reportedCount > 0 && (
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#9CA3AF' }]}>
                {reportedCount}
              </Text>
              <Text style={styles.summaryLabel}>Reported</Text>
            </View>
          )}

          {missedCount > 0 && (
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#B00020' }]}>
                {missedCount}
              </Text>
              <Text style={styles.summaryLabel}>Missed</Text>
            </View>
          )}
        </View>

        {/* ==================== BANNERS ==================== */}
        {showReportedBanner && reportedCount > 0 && (
          <View style={styles.reportedBanner}>
            <Text style={styles.reportedBannerIcon}>✓</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportedBannerTitle}>
                {reportedCount}{' '}
                {reportedCount === 1 ? 'class' : 'classes'} reported today
              </Text>
              <Text style={styles.reportedBannerText}>
                Your Program Chair has been notified.
              </Text>
            </View>
          </View>
        )}

        {missedCount > 0 && (
          <View style={styles.missedBanner}>
            <Text style={styles.missedBannerIcon}>!</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.missedBannerTitle}>
                {missedCount} {missedCount === 1 ? 'class' : 'classes'} missed
                today
              </Text>
              <Text style={styles.missedBannerText}>
                You didn't scan in for these. File a ghost report or contact
                your chair if this is wrong.
              </Text>
            </View>
          </View>
        )}

        {/* ==================== NEXT CLASS CARD ==================== */}
        {nextClass && nextStatus ? (
          nextStatus === 'ghost' ? (
            <View style={styles.nextClassCard}>
              <View style={styles.nextClassHeader}>
                <View
                  style={[
                    styles.pulseDot,
                    { backgroundColor: stateAccent('ghost') },
                  ]}
                />
                <Text style={styles.nextClassEyebrow}>REPORTED ABSENT</Text>
              </View>

              <Text style={styles.nextClassSubject}>
                {nextClass.subject_code}
              </Text>
              <Text style={styles.nextClassTitle} numberOfLines={2}>
                {nextClass.course_title}
              </Text>

              <View style={styles.nextClassMeta}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>ROOM</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {nextClass.room_name || '—'}
                  </Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>TIME</Text>
                  <Text style={styles.metaValue}>
                    {formatTime(nextClass.start_time)}
                  </Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>SECTION</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {nextClass.section}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.statusBlock,
                  {
                    borderLeftColor: stateAccent('ghost'),
                    backgroundColor: stateAccent('ghost') + '14',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusHeadline,
                    { color: stateAccent('ghost') },
                  ]}
                >
                  ⚠  REPORTED ·{' '}
                  {nextClass.ghostReport.is_excused === true
                    ? 'EXCUSED'
                    : nextClass.ghostReport.is_excused === false
                    ? 'UNEXCUSED'
                    : 'CANCELLED'}
                </Text>
                <Text style={styles.statusSubline}>
                  {nextClass.ghostReport.is_excused === true
                    ? 'Your record is protected.'
                    : 'Your Chair will review this.'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => setDetailClass(nextClass)}
              >
                <Text style={styles.scanButtonIcon}>ⓘ</Text>
                <Text style={styles.scanButtonText}>View Report Details</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.nextClassCard}>
              <View style={styles.nextClassHeader}>
                <View
                  style={[
                    styles.pulseDot,
                    { backgroundColor: stateAccent(nextStatus) },
                  ]}
                />
                <Text style={styles.nextClassEyebrow}>
                  {nextClass.isOnline
                    ? 'ONLINE NOW'
                    : nextStatus === 'ongoing'
                    ? 'IN PROGRESS'
                    : nextStatus === 'ended_early'
                    ? 'ENDED EARLY'
                    : nextStatus === 'starts_now'
                    ? 'STARTS NOW'
                    : 'UP NEXT'}
                </Text>
              </View>

              <Text style={styles.nextClassSubject}>
                {nextClass.subject_code}
              </Text>
              <Text style={styles.nextClassTitle} numberOfLines={2}>
                {nextClass.course_title}
              </Text>

              <View style={styles.nextClassMeta}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>ROOM</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {nextClass.isOnline ? 'Online' : nextClass.room_name || '—'}
                  </Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>TIME</Text>
                  <Text style={styles.metaValue}>
                    {formatTime(nextClass.start_time)}
                  </Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>SECTION</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {nextClass.section}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.statusBlock,
                  {
                    borderLeftColor: nextClass.isOnline
                      ? stateAccent('online')
                      : stateAccent(nextStatus),
                    backgroundColor:
                      (nextClass.isOnline
                        ? stateAccent('online')
                        : stateAccent(nextStatus)) + '14',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusHeadline,
                    {
                      color: nextClass.isOnline
                        ? stateAccent('online')
                        : stateAccent(nextStatus),
                    },
                  ]}
                >
                  {nextClass.isOnline
                    ? '🌐  ONLINE CLASS'
                    : nextStatus === 'ongoing'
                    ? '●  IN PROGRESS'
                    : nextStatus === 'ended_early'
                    ? '⏹  ENDED EARLY'
                    : nextStatus === 'starts_now'
                    ? '⏳  STARTS NOW'
                    : '🕐  NOT STARTED YET'}
                </Text>
                <Text style={styles.statusSubline}>
                  {nextClass.isOnline
                    ? 'Join virtually — no QR scan needed'
                    : nextStatus === 'ongoing'
                    ? nextClass.liveSession?.scanned_at
                      ? `Checked in at ${formatVerifiedTime(
                          nextClass.liveSession.scanned_at
                        )}`
                      : 'Checked in — room verified'
                    : nextStatus === 'ended_early'
                    ? nextClass.liveSession?.ended_at
                      ? `You ended this class at ${formatVerifiedTime(
                          nextClass.liveSession.ended_at
                        )}`
                      : 'You ended this class early'
                    : nextStatus === 'starts_now'
                    ? 'Scan the room QR to begin this class'
                    : `Starts at ${formatTime(nextClass.start_time)}`}
                </Text>
              </View>

              {/* PRIMARY ACTION — time-aware */}
              {(() => {
                const acts = getAvailableActions(nextClass, nowMin);

                if (nextClass.isOnline) {
                  return (
                    <TouchableOpacity
                      style={styles.scanButton}
                      onPress={() => handleReportGhost(nextClass)}
                    >
                      <Text style={styles.scanButtonIcon}>⚠</Text>
                      <Text style={styles.scanButtonText}>Report Ghost</Text>
                    </TouchableOpacity>
                  );
                }

                if (acts.canEndEarly) {
                  return (
                    <>
                      <TouchableOpacity
                        style={styles.endEarlyButton}
                        onPress={() => handleEndClassEarly(nextClass)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.endEarlyButtonIcon}>⏹</Text>
                        <Text style={styles.endEarlyButtonText}>
                          End Class Early
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.secondaryActions}>
                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => handleNavigate(nextClass)}
                        >
                          <Text style={styles.secondaryButtonText}>
                            ↗ Navigate
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => setDetailClass(nextClass)}
                        >
                          <Text style={styles.secondaryButtonText}>
                            ⓘ Details
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                }

                if (acts.canScan) {
                  return (
                    <>
                      <TouchableOpacity
                        style={styles.scanButton}
                        onPress={() => handleScanQR(nextClass)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.scanButtonIcon}>▣</Text>
                        <Text style={styles.scanButtonText}>
                          {nextStatus === 'upcoming'
                            ? 'Scan QR to Verify Room'
                            : 'Scan QR to Begin Class'}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.secondaryActions}>
                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => handleNavigate(nextClass)}
                        >
                          <Text style={styles.secondaryButtonText}>
                            ↗ Navigate
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => handleReportGhost(nextClass)}
                        >
                          <Text style={styles.secondaryButtonText}>
                            ⚠ Report Ghost
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                }

                // Fallback — ended early, completed, missed
                return (
                  <View style={styles.secondaryActions}>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => handleNavigate(nextClass)}
                    >
                      <Text style={styles.secondaryButtonText}>↗ Navigate</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => setDetailClass(nextClass)}
                    >
                      <Text style={styles.secondaryButtonText}>ⓘ Details</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
            </View>
          )
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyTitle}>
              {semester ? 'No more classes today' : 'No active semester'}
            </Text>
            <Text style={styles.emptyText}>
              {semester
                ? 'You have no upcoming or ongoing classes scheduled.'
                : 'Please contact the admin to activate a semester.'}
            </Text>
          </View>
        )}

        {/* ==================== TODAY'S CLASSES ==================== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Classes</Text>
            {todayClasses.length > 0 && (
              <TouchableOpacity onPress={openFullSchedule}>
                <Text style={styles.sectionLink}>View all →</Text>
              </TouchableOpacity>
            )}
          </View>

          {todayClasses.length === 0 ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>
                No classes scheduled for today.
              </Text>
            </View>
          ) : (
            <>
              {previewClasses.map((cls) => {
                const status = getProfessorClassStatus(cls, nowMin);
                const isGhost = status === 'ghost';
                const accent = stateAccent(status);

                return (
                  <TouchableOpacity
                    key={cls.id}
                    style={[
                      styles.classCard,
                      status === 'missed' && styles.classCardMissed,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setDetailClass(cls)}
                  >
                    <View
                      style={[styles.classAccent, { backgroundColor: accent }]}
                    />
                    <View style={styles.classInfo}>
                      <Text style={styles.classSubject}>
                        {cls.subject_code}
                      </Text>
                      <Text style={styles.classTitle} numberOfLines={1}>
                        {cls.course_title}
                      </Text>
                      <Text style={styles.classTime}>
                        {formatTime(cls.start_time)} –{' '}
                        {formatTime(cls.end_time)}
                        {cls.section ? ` · ${cls.section}` : ''}
                        {cls.room_name ? ` · ${cls.room_name}` : ''}
                      </Text>

                      <View style={styles.liveInlineRow}>
                        <View
                          style={[
                            styles.liveInlineDot,
                            { backgroundColor: accent },
                          ]}
                        />
                        <Text
                          style={[styles.liveInlineText, { color: accent }]}
                        >
                          {getInlineStatusLabel(status, cls)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {moreCount > 0 && (
                <TouchableOpacity
                  style={styles.moreRow}
                  onPress={openFullSchedule}
                  activeOpacity={0.85}
                >
                  <Text style={styles.moreText}>
                    +{moreCount} more{' '}
                    {moreCount === 1 ? 'class' : 'classes'} today
                  </Text>
                  <Text style={styles.moreArrow}>→</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* ==================== QUICK ACTIONS ==================== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>

          <View style={styles.quickGrid}>
            <TouchableOpacity
              style={styles.quickCard}
              onPress={openFullSchedule}
            >
              <Text style={styles.quickIcon}>📅</Text>
              <Text style={styles.quickLabel}>My Schedule</Text>
              <Text style={styles.quickSub}>Full week view</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('QRScanner')}
            >
              <Text style={styles.quickIcon}>▣</Text>
              <Text style={styles.quickLabel}>Scan QR</Text>
              <Text style={styles.quickSub}>Verify room</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('Map')}
            >
              <Text style={styles.quickIcon}>🗺️</Text>
              <Text style={styles.quickLabel}>Campus Map</Text>
              <Text style={styles.quickSub}>Find rooms</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={handleQuickReportGhost}
            >
              <Text style={styles.quickIcon}>⚠️</Text>
              <Text style={styles.quickLabel}>Report Ghost</Text>
              <Text style={styles.quickSub}>Cancelled class</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('RoomStatus')}
            >
              <Text style={styles.quickIcon}>🏛️</Text>
              <Text style={styles.quickLabel}>Rooms</Text>
              <Text style={styles.quickSub}>See what's free</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
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

            {detailClass && (() => {
              const status = getProfessorClassStatus(detailClass, nowMin);
              const accent = stateAccent(status);
              const isGhost = status === 'ghost';
              const acts = getAvailableActions(detailClass, nowMin);

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
                            ? styles.modalBadgeExcused
                            : detailClass.ghostReport.is_excused === false
                            ? styles.modalBadgeUnexcused
                            : styles.modalBadgeNeutral,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modalBadgeText,
                            detailClass.ghostReport.is_excused === true
                              ? styles.modalBadgeTextExcused
                              : detailClass.ghostReport.is_excused === false
                              ? styles.modalBadgeTextUnexcused
                              : styles.modalBadgeTextNeutral,
                          ]}
                        >
                          {detailClass.ghostReport.is_excused === true
                            ? '✓ REPORTED · EXCUSED'
                            : detailClass.ghostReport.is_excused === false
                            ? '! REPORTED · UNEXCUSED'
                            : '● REPORTED'}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.modalBadge,
                          detailClass.isOnline
                            ? styles.modalBadgeOnline
                            : styles.modalBadgeF2F,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modalBadgeText,
                            detailClass.isOnline
                              ? styles.modalBadgeTextOnline
                              : styles.modalBadgeTextF2F,
                          ]}
                        >
                          {detailClass.isOnline
                            ? '🌐 ONLINE'
                            : '● FACE-TO-FACE'}
                        </Text>
                      </View>
                    )}

                    <View style={styles.modalStatusPill}>
                      <Text
                        style={[styles.modalStatusPillText, { color: accent }]}
                      >
                        ● {getInlineStatusLabel(status, detailClass)}
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

                  {/* LIVE STATUS BLOCK */}
                  {(() => {
                    let headline = '';
                    let subline = '';

                    if (isGhost) {
                      headline = '⚠  REPORTED ABSENT';
                      subline =
                        detailClass.ghostReport.is_excused === true
                          ? 'Your record is protected.'
                          : 'Your Chair will review this.';
                    } else if (status === 'ongoing') {
                      headline = '●  IN PROGRESS';
                      subline = 'You are checked in for this class.';
                    } else if (status === 'ended_early') {
                      headline = '⏹  ENDED EARLY';
                      subline = detailClass.liveSession?.ended_at
                        ? `You ended this class at ${formatVerifiedTime(
                            detailClass.liveSession.ended_at
                          )}`
                        : 'You ended this class early.';
                    } else if (status === 'starts_now') {
                      headline = '⏳  STARTS NOW';
                      subline = 'Scan the room QR to begin this class.';
                    } else if (status === 'upcoming') {
                      headline = '🕐  UPCOMING';
                      subline = `Class starts at ${formatTime(
                        detailClass.start_time
                      )}.`;
                    } else if (status === 'completed') {
                      headline = '✓  COMPLETED';
                      subline = 'Class has ended.';
                    } else if (status === 'missed') {
                      headline = '!  MISSED · NO CHECK-IN';
                      subline = 'You did not scan in for this class.';
                    }

                    return (
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
                            {headline}
                          </Text>
                          {detailClass.liveSession?.scanned_at && (
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
                        <Text style={styles.modalLiveSubline}>{subline}</Text>
                      </View>
                    );
                  })()}

                  {/* GHOST DETAILS */}
                  {isGhost && (
                    <View style={styles.modalGhostBox}>
                      <Text style={styles.modalGhostLabel}>REPORT DETAILS</Text>
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

                  {/* ACTIONS — time-aware */}
                  {!isGhost && (
                    <View style={styles.modalActions}>
                      {acts.canNavigate && (
                        <TouchableOpacity
                          style={styles.modalSecondaryBtn}
                          onPress={() => handleNavigate(detailClass)}
                        >
                          <Text style={styles.modalSecondaryBtnText}>
                            ↗ Navigate
                          </Text>
                        </TouchableOpacity>
                      )}

                      {acts.canEndEarly && (
                        <TouchableOpacity
                          style={styles.modalEndEarlyBtn}
                          onPress={() => handleEndClassEarly(detailClass)}
                        >
                          <Text style={styles.modalEndEarlyBtnText}>
                            ⏹ End Class Early
                          </Text>
                        </TouchableOpacity>
                      )}

                      {acts.canScan && (
                        <TouchableOpacity
                          style={styles.modalPrimaryBtn}
                          onPress={() => handleScanQR(detailClass)}
                        >
                          <Text style={styles.modalPrimaryBtnText}>
                            ▣ Scan QR
                          </Text>
                        </TouchableOpacity>
                      )}

                      {acts.canReportGhost && (
                        <TouchableOpacity
                          style={styles.modalGhostLinkInline}
                          onPress={() => handleReportGhost(detailClass)}
                        >
                          <Text style={styles.modalGhostLinkInlineText}>
                            ⚠ Report this class as cancelled / not attended
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
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

// ============================================================
// LOADING SKELETON
// ============================================================

const ProfessorDashboardSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor="#8B0000" />

    <View style={styles.scrollContent}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width={90} height={10} radius={4} />
          <Skeleton width={150} height={22} radius={6} />
          <Skeleton width={200} height={13} radius={4} />
        </View>
        <Skeleton width={64} height={32} radius={8} />
      </View>

      <View style={styles.summaryRow}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.summaryCard}>
            <Skeleton width={40} height={26} radius={6} />
            <Skeleton
              width="70%"
              height={11}
              radius={4}
              style={{ marginTop: 10 }}
            />
          </View>
        ))}
      </View>

      <View style={styles.nextClassCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SkeletonCircle size={10} />
          <Skeleton width={100} height={10} radius={4} />
        </View>

        <Skeleton width="55%" height={28} radius={6} style={{ marginTop: 14 }} />
        <Skeleton width="85%" height={16} radius={4} style={{ marginTop: 8 }} />

        <View style={styles.nextClassMeta}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.metaItem}>
              <Skeleton width={30} height={9} radius={3} />
              <Skeleton
                width={50}
                height={12}
                radius={4}
                style={{ marginTop: 6 }}
              />
            </View>
          ))}
        </View>

        <Skeleton
          width="100%"
          height={62}
          radius={10}
          style={{ marginTop: 14 }}
        />
        <Skeleton
          width="100%"
          height={50}
          radius={14}
          style={{ marginTop: 14 }}
        />
      </View>
    </View>
  </View>
);

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F7',
  },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  scrollContent: { paddingBottom: 20 },

  // ==================== HEADER ====================
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 28,
    backgroundColor: '#8B0000',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#FFFFFF',
    opacity: 0.7,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.85,
    marginTop: 4,
  },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  logoutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  semesterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    gap: 6,
  },
  semesterChipDot: { fontSize: 8, color: '#7CFC9E' },
  semesterChipText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ==================== SUMMARY ====================
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: -18,
    marginBottom: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  summaryValue: { fontSize: 22, fontWeight: '900', color: '#1A1A1A' },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ==================== BANNERS ====================
  reportedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#EAF6EC',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#059669',
    gap: 12,
  },
  reportedBannerIcon: { fontSize: 22, color: '#059669', fontWeight: '900' },
  reportedBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
    marginBottom: 2,
  },
  reportedBannerText: {
    fontSize: 11,
    color: '#065F46',
    opacity: 0.85,
  },

  missedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#FDECEC',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#B00020',
    gap: 12,
  },
  missedBannerIcon: { fontSize: 20, color: '#B00020', fontWeight: '900' },
  missedBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7A0014',
    marginBottom: 2,
  },
  missedBannerText: {
    fontSize: 11,
    color: '#7A0014',
    opacity: 0.85,
    lineHeight: 15,
  },

  // ==================== NEXT CLASS ====================
  nextClassCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  nextClassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  nextClassEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: '#6B7280',
  },
  nextClassSubject: {
    fontSize: 26,
    fontWeight: '900',
    color: '#8B0000',
    letterSpacing: -0.4,
  },
  nextClassTitle: {
    fontSize: 15,
    color: '#4B5563',
    marginTop: 4,
    marginBottom: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  nextClassMeta: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  metaItem: { flex: 1, alignItems: 'center' },
  metaDivider: { width: 1, backgroundColor: '#E5E7EB' },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#9CA3AF',
    marginBottom: 3,
  },
  metaValue: { fontSize: 12, fontWeight: '800', color: '#1A1A1A' },

  statusBlock: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    borderRadius: 12,
  },
  statusHeadline: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  statusSubline: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 4,
    fontWeight: '500',
    lineHeight: 17,
  },

  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B0000',
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 14,
    gap: 8,
    shadowColor: '#8B0000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  scanButtonIcon: { fontSize: 18, color: '#FFFFFF' },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  endEarlyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8F0',
    borderWidth: 1.5,
    borderColor: '#C77700',
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 14,
    gap: 8,
  },
  endEarlyButtonIcon: { fontSize: 16, color: '#C77700' },
  endEarlyButtonText: {
    color: '#C77700',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  secondaryActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },

  // ==================== EMPTY ====================
  emptyCard: {
    margin: 16,
    padding: 36,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 34, color: '#059669', marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  emptyList: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    alignItems: 'center',
  },
  emptyListText: { fontSize: 13, color: '#9CA3AF' },

  // ==================== SECTIONS ====================
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B0000',
    marginBottom: 12,
  },

  // ==================== CLASS CARDS ====================
  classCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  classCardMissed: {
    backgroundColor: '#FFFAFA',
    borderWidth: 1,
    borderColor: '#F5C2C0',
  },
  classAccent: { width: 4, borderRadius: 2, marginRight: 12 },
  classInfo: { flex: 1 },
  classSubject: {
    fontSize: 13,
    fontWeight: '900',
    color: '#8B0000',
    letterSpacing: 0.4,
  },
  classTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginTop: 2,
  },
  classTime: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  liveInlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  liveInlineDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
  },
  liveInlineText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 2,
    marginBottom: 4,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  moreText: { fontSize: 13, fontWeight: '700', color: '#8B0000' },
  moreArrow: { fontSize: 14, fontWeight: '800', color: '#8B0000' },

  // ==================== QUICK ACTIONS ====================
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  quickIcon: { fontSize: 24, marginBottom: 10 },
  quickLabel: { fontSize: 13, fontWeight: '800', color: '#1A1A1A' },
  quickSub: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  // ==================== MODAL ====================
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 32,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
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
  modalBadgeExcused: { backgroundColor: '#EAF6EC' },
  modalBadgeUnexcused: { backgroundColor: '#FFF6E0' },
  modalBadgeNeutral: { backgroundColor: '#F3F4F6' },
  modalBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  modalBadgeTextF2F: { color: '#C77700' },
  modalBadgeTextOnline: { color: '#1E88E5' },
  modalBadgeTextExcused: { color: '#059669' },
  modalBadgeTextUnexcused: { color: '#C77700' },
  modalBadgeTextNeutral: { color: '#6B7280' },
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

  modalGhostBox: {
    backgroundColor: '#F7F5F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#9CA3AF',
  },
  modalGhostLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#9A9A9E',
    marginBottom: 6,
  },
  modalGhostCause: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 3,
  },
  modalGhostReason: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  modalGhostNotes: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
    lineHeight: 17,
    marginTop: 4,
  },

  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalPrimaryBtn: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#8B0000',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
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
  },
  modalSecondaryBtn: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#F5F5F7',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: 0.3,
  },
  modalEndEarlyBtn: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#FFF8F0',
    borderWidth: 1.5,
    borderColor: '#C77700',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalEndEarlyBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C77700',
    letterSpacing: 0.3,
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

export default ProfessorDashboard;