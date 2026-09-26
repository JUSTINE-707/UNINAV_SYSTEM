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

const REPORTED_BANNER_DURATION = 6000;

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
//   upcoming    — before the class window
//   starts_now  — in the window, professor hasn't scanned yet  (amber)
//   ongoing     — in the window, professor has scanned          (green)
//   missed      — window passed with NO scan                    (red)
//   completed   — window passed WITH a scan                     (grey)
//   ghost       — reported as cancelled / absent                (grey)
// ------------------------------------------------------------

const getProfessorClassStatus = (cls, nowMin) => {
  if (cls.ghostReport) return 'ghost';

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  if (start === null || end === null) return 'unknown';

  const hasSession = !!cls.liveSession;

  // Window already ended
  if (nowMin > end) {
    return hasSession ? 'completed' : 'missed';
  }

  // Window in progress
  if (nowMin >= start && nowMin <= end) {
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
  if (status === 'starts_now') return 'STARTS NOW';
  if (status === 'upcoming') return 'UPCOMING';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'missed') return 'MISSED · NO CHECK-IN';
  return '';
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

      // ---- 1. Faculty profile ----
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

      // ---- 2. Schedules ----
      let scheduleData = [];
      let scheduleErr = null;

      // 2a: professor_id
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

      // 2b: employee_id
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

      // 2c: name match
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

      // ---- 3. Ghost reports ----
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

      // ---- 4. Room sessions (check-ins) ----
      const scheduleIds = (scheduleData || []).map((s) => s.id);
      const sessionMap = {};

      if (scheduleIds.length > 0) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const { data: sessionData, error: sessionErr } = await supabase
          .from('room_sessions')
          .select('id, schedule_id, scanned_at, class_type, status')
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

      // ---- 5. Merge ----
      const classes = (scheduleData || []).map((c) => ({
        ...c,
        isOnline: isOnlineRoom(c.room_name),
        ghostReport: ghostMap[c.id] || null,
        liveSession: sessionMap[c.id] || null,
      }));

      setTodayClasses(classes);

      // ---- 6. Next class ----
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const upcoming = classes.find((c) => {
        if (c.ghostReport) return false;
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

      // ---- 7. Reported banner ----
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
      Alert.alert(
        'Online Class',
        'This class is conducted online. No navigation needed.'
      );
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

  const handleClassTap = (cls) => {
    if (cls.ghostReport) {
      showGhostDetails(cls);
      return;
    }
    if (cls.isOnline) {
      Alert.alert(
        `🌐 ${cls.subject_code} · ${cls.section}`,
        `${cls.course_title}\n\nThis is an online class. Join through your virtual meeting platform.`,
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Report Ghost', onPress: () => handleReportGhost(cls) },
        ]
      );
      return;
    }
    Alert.alert(
      `${cls.subject_code} · ${cls.section}`,
      `${cls.course_title}\nRoom: ${cls.room_name}\nTime: ${formatTime(
        cls.start_time
      )} – ${formatTime(cls.end_time)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Navigate', onPress: () => handleNavigate(cls) },
        { text: 'Scan QR', onPress: () => handleScanQR(cls) },
      ]
    );
  };

  const openFullSchedule = () => {
    navigation.navigate('FacultySchedule');
  };

  // ============================================================
  // LOADING SKELETON
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
    const end = timeToMinutes(c.end_time);
    return end !== null && end > nowMin && !c.ghostReport;
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerEyebrow}>FACULTY PORTAL</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {getGreeting()}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {profile?.program ? `${profile.program} · ` : ''}
              {DAY_LABELS[DAYS[now.getDay()]] || DAYS[now.getDay()]}
              {semester ? ` · ${semester.name}` : ''}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={styles.logoutButton}
          >
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

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

        {/* SUMMARY CARDS */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{todayClasses.length}</Text>
            <Text style={styles.summaryLabel}>Classes today</Text>
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

        {/* NEXT CLASS CARD */}
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
                onPress={() => showGhostDetails(nextClass)}
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
                    : nextStatus === 'starts_now'
                    ? 'Scan the room QR to begin this class'
                    : `Starts at ${formatTime(nextClass.start_time)}`}
                </Text>
              </View>

              {nextClass.isOnline ? (
                <TouchableOpacity
                  style={styles.scanButton}
                  onPress={() => handleReportGhost(nextClass)}
                >
                  <Text style={styles.scanButtonIcon}>⚠</Text>
                  <Text style={styles.scanButtonText}>Report Ghost</Text>
                </TouchableOpacity>
              ) : nextStatus === 'starts_now' ? (
                <>
                  <TouchableOpacity
                    style={styles.scanButton}
                    onPress={() => handleScanQR(nextClass)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.scanButtonIcon}>▣</Text>
                    <Text style={styles.scanButtonText}>
                      Scan QR to Begin Class
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.secondaryActions}>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => handleNavigate(nextClass)}
                    >
                      <Text style={styles.secondaryButtonText}>↗ Navigate</Text>
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
              ) : nextStatus === 'upcoming' ? (
                <>
                  <TouchableOpacity
                    style={styles.scanButton}
                    onPress={() => handleScanQR(nextClass)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.scanButtonIcon}>▣</Text>
                    <Text style={styles.scanButtonText}>
                      Scan QR to Verify Room
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.secondaryActions}>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => handleNavigate(nextClass)}
                    >
                      <Text style={styles.secondaryButtonText}>↗ Navigate</Text>
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
              ) : (
                /* ongoing (checked in) or completed — no scan action needed */
                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => handleNavigate(nextClass)}
                  >
                    <Text style={styles.secondaryButtonText}>↗ Navigate</Text>
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
              )}
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

        {/* TODAY'S CLASSES */}
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
                    onPress={() => handleClassTap(cls)}
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

        {/* QUICK ACTIONS */}
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
              <Text style={styles.quickLabel}>Report Ghost Class</Text>
              <Text style={styles.quickSub}>Cancelled class</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Skeleton width={140} height={18} radius={6} />
          <Skeleton width={70} height={13} radius={4} />
        </View>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.classCard}>
            <Skeleton width={4} height={72} radius={2} />
            <View style={styles.classInfo}>
              <Skeleton width={80} height={14} radius={4} />
              <Skeleton
                width="85%"
                height={14}
                radius={4}
                style={{ marginTop: 6 }}
              />
              <Skeleton
                width="60%"
                height={12}
                radius={4}
                style={{ marginTop: 8 }}
              />
              <Skeleton
                width="40%"
                height={11}
                radius={4}
                style={{ marginTop: 10 }}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Skeleton
          width={120}
          height={18}
          radius={6}
          style={{ marginBottom: 12 }}
        />
        <View style={styles.quickGrid}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.quickCard}>
              <Skeleton width={24} height={24} radius={6} />
              <Skeleton
                width="70%"
                height={13}
                radius={4}
                style={{ marginTop: 10 }}
              />
              <Skeleton
                width="50%"
                height={11}
                radius={4}
                style={{ marginTop: 6 }}
              />
            </View>
          ))}
        </View>
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
    backgroundColor: '#8B0000',
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#FFFFFF',
    opacity: 0.75,
    marginBottom: 4,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  headerSubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.85,
    marginTop: 2,
  },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  logoutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  reportedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#EAF6EC',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#059669',
    gap: 12,
  },
  reportedBannerIcon: {
    fontSize: 22,
    color: '#059669',
    fontWeight: '900',
  },
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

  // NEW: missed classes banner
  missedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#B00020',
    gap: 12,
  },
  missedBannerIcon: {
    fontSize: 20,
    color: '#B00020',
    fontWeight: '900',
  },
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

  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  summaryValue: { fontSize: 24, fontWeight: '800', color: '#1A1A1A' },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  nextClassCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  nextClassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  nextClassEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#6B7280',
  },
  nextClassSubject: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8B0000',
  },
  nextClassTitle: {
    fontSize: 15,
    color: '#4B5563',
    marginTop: 4,
    marginBottom: 16,
  },
  nextClassMeta: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  metaItem: { flex: 1, alignItems: 'center' },
  metaDivider: { width: 1, backgroundColor: '#E5E7EB' },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  metaValue: { fontSize: 12, fontWeight: '700', color: '#1A1A1A' },

  statusBlock: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    borderRadius: 10,
  },
  statusHeadline: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  statusSubline: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 4,
    fontWeight: '500',
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
  },
  scanButtonIcon: { fontSize: 18, color: '#FFFFFF' },
  scanButtonText: {
    color: '#FFFFFF',
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

  emptyCard: {
    margin: 16,
    padding: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, color: '#059669', marginBottom: 8 },
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

  section: { marginTop: 12, paddingHorizontal: 16 },
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
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B0000',
    marginBottom: 12,
  },

  classCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
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
    fontWeight: '800',
    color: '#8B0000',
    letterSpacing: 0.3,
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
  liveInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
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
  moreText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B0000',
  },
  moreArrow: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8B0000',
  },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  quickIcon: { fontSize: 24, marginBottom: 8 },
  quickLabel: { fontSize: 13, fontWeight: '800', color: '#1A1A1A' },
  quickSub: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
});

export default ProfessorDashboard;