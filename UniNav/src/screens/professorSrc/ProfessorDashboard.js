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
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, CommonActions } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';
import { useSemester } from '../../context/SemesterContext';
import { navigate, navigationRef } from '../../navigation/navigationRef';
import Skeleton, { SkeletonCircle } from '../../components/Skeleton';
import SemesterProgressStrip from '../../components/SemesterProgressStrip';

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
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TODAY_PREVIEW_LIMIT = 5;
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

const getInitials = (name) => {
  if (!name) return 'FP';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// ============================================================
// CLASS STATUS
// ============================================================

const getProfessorClassStatus = (cls, nowMin) => {
  if (cls.ghostReport) return 'ghost';

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  if (start === null || end === null) return 'unknown';

  const hasSession = !!cls.liveSession;
  const endedEarly = !!cls.liveSession?.ended_at;

  if (nowMin > end) {
    if (hasSession && endedEarly) return 'ended_early';
    return hasSession ? 'completed' : 'missed';
  }
  if (nowMin >= start && nowMin <= end) {
    if (hasSession && endedEarly) return 'ended_early';
    return hasSession ? 'ongoing' : 'starts_now';
  }
  return 'upcoming';
};

const stateAccent = (state) => {
  switch (state) {
    case 'ongoing':
    case 'occupied':
      return T.green;
    case 'starts_now':
    case 'upcoming':
    case 'vacant':
      return T.amber;
    case 'ended_early':
      return '#C77700';
    case 'missed':
      return T.red;
    case 'online':
      return T.blue;
    case 'ghost':
    case 'completed':
    case 'ended':
      return T.slate;
    default:
      return T.slate;
  }
};

const stateSoftBg = (state) => {
  switch (state) {
    case 'ongoing':
    case 'occupied':
      return T.greenSoft;
    case 'starts_now':
    case 'upcoming':
    case 'vacant':
      return T.amberSoft;
    case 'ended_early':
      return '#FEF3C7';
    case 'missed':
      return T.redSoft;
    case 'online':
      return T.blueSoft;
    case 'ghost':
    case 'completed':
    case 'ended':
    default:
      return T.slateSoft;
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
  if (status === 'missed') return 'MISSED';
  return '';
};

const getAvailableActions = (cls, nowMin) => {
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
// COMPONENT
// ============================================================

const ProfessorDashboard = ({ navigation }) => {
  const { user } = useAuth();
  const { semester } = useSemester();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [fullName, setFullName] = useState('');
  const [todayClasses, setTodayClasses] = useState([]);
  const [nextClass, setNextClass] = useState(null);
  const [now, setNow] = useState(new Date());

  const [showReportedBanner, setShowReportedBanner] = useState(false);
  const bannerShownRef = useRef(false);
  const bannerTimerRef = useRef(null);

  const [detailClass, setDetailClass] = useState(null);

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

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
  // LOGOUT
  // ============================================================

  const performLogout = async () => {
    try {
      setLoggingOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setLogoutModalOpen(false);

      try {
        if (
          navigationRef &&
          typeof navigationRef.isReady === 'function' &&
          navigationRef.isReady()
        ) {
          navigationRef.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            })
          );
        } else {
          navigate('Login');
        }
      } catch (navErr) {
        console.warn('[Logout] nav reset failed, falling back:', navErr);
        navigate('Login');
      }
    } catch (err) {
      console.error('[Logout] error:', err);
      Alert.alert(
        'Could not log out',
        err?.message || 'Something went wrong. Please try again.'
      );
    } finally {
      setLoggingOut(false);
    }
  };

  const openLogoutModal = () => setLogoutModalOpen(true);
  const closeLogoutModal = () => {
    if (loggingOut) return;
    setLogoutModalOpen(false);
  };

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

      const [profileRes, userRes] = await Promise.all([
        supabase
          .from('faculty')
          .select('employee_id, program, college')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      const profProfile = profileRes?.data || null;
      setProfile(profProfile);
      setFullName(userRes?.data?.full_name || '');

      if (!semester?.id) {
        setTodayClasses([]);
        setNextClass(null);
        setLoading(false);
        return;
      }

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

      if (!scheduleErr && scheduleData.length === 0 && profProfile?.employee_id) {
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

      if (!scheduleErr && scheduleData.length === 0 && profProfile?.program) {
        if (userRes?.data?.full_name) {
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
            const target = normalizeNameKey(userRes.data.full_name);
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
          console.warn('[ProfessorDashboard] room_sessions fetch:', sessionErr.message);
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

      const currentNow = new Date();
      const nowMinutes = currentNow.getHours() * 60 + currentNow.getMinutes();
      const upcoming = classes.find((c) => {
        if (c.ghostReport) return false;
        if (c.liveSession?.ended_at) return false;
        const end = timeToMinutes(c.end_time);
        return end !== null && nowMinutes < end;
      });

      if (!upcoming) {
        const latestGhost = [...classes]
          .filter((c) => c.ghostReport)
          .sort(
            (a, b) =>
              (timeToMinutes(a.end_time) || 0) - (timeToMinutes(b.end_time) || 0)
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
  }, [user, semester]);

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
      Alert.alert('No classes to report', 'You have no classes scheduled today that can be reported.');
      return;
    }
    if (target.ghostReport) {
      Alert.alert('Already Reported', 'All your classes today have already been reported.');
      return;
    }
    handleReportGhost(target);
  };

  const openFullSchedule = () => navigation.navigate('FacultySchedule');

  if (loading) {
    return <ProfessorDashboardSkeleton />;
  }

  // ============================================================
  // DERIVED
  // ============================================================

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const reportedCount = todayClasses.filter((c) => c.ghostReport).length;
  const missedCount = todayClasses.filter(
    (c) => getProfessorClassStatus(c, nowMin) === 'missed'
  ).length;
  const doneCount = todayClasses.filter((c) => {
    const s = getProfessorClassStatus(c, nowMin);
    return s === 'completed' || s === 'ended_early' || s === 'ghost';
  }).length;
  const remainingClasses = todayClasses.filter((c) => {
    if (c.ghostReport) return false;
    if (c.liveSession?.ended_at) return false;
    const end = timeToMinutes(c.end_time);
    return end !== null && end > nowMin;
  });

  const nextStatus = nextClass ? getProfessorClassStatus(nextClass, nowMin) : null;

  const previewClasses = (() => {
    const active = todayClasses.filter((c) => !c.ghostReport);
    const ghost = todayClasses.filter((c) => c.ghostReport);
    return [...active, ...ghost].slice(0, TODAY_PREVIEW_LIMIT);
  })();

  const moreCount = Math.max(0, todayClasses.length - previewClasses.length);

  const heroProgress = (() => {
    if (!nextClass) return 0;
    const start = timeToMinutes(nextClass.start_time);
    const end = timeToMinutes(nextClass.end_time);
    if (start === null || end === null) return 0;
    if (nowMin <= start) return 0;
    if (nowMin >= end) return 1;
    return (nowMin - start) / (end - start);
  })();

  const today = new Date();
  const dayNumber = today.getDate();
  const monthName = MONTHS[today.getMonth()];
  const weekdayName = DAY_LABELS[DAYS[today.getDay()]];

  const initials = getInitials(fullName);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

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
          <View style={styles.headerDecor1} />
          <View style={styles.headerDecor2} />

          <View style={styles.headerContent}>
            <View style={styles.headerTopRow}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>

              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={styles.headerEyebrow}>FACULTY PORTAL</Text>
                <Text style={styles.headerName} numberOfLines={1}>
                  {fullName || 'Faculty'}
                </Text>
              </View>

              <TouchableOpacity
                onPress={openLogoutModal}
                style={styles.logoutButton}
                disabled={loggingOut}
                activeOpacity={0.8}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <View style={styles.logoutIconChip}>
                      <Feather name="log-out" size={12} color="#FFFFFF" />
                    </View>
                    <Text style={styles.logoutLabel}>LOG OUT</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.headerGreeting} numberOfLines={1}>
              {getGreeting()}.
            </Text>

            <View style={styles.headerDateRow}>
              <View style={styles.dateBlock}>
                <Text style={styles.dateNumber}>{dayNumber}</Text>
                <Text style={styles.dateMonth}>{monthName.slice(0, 3).toUpperCase()}</Text>
              </View>
              <View style={styles.dateDivider} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dateWeekday}>{weekdayName}</Text>
                {semester && (
                  <Text style={styles.dateSemester} numberOfLines={1}>
                    {semester.name}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* ==================== SEMESTER PROGRESS ==================== */}
        <SemesterProgressStrip accentColor={T.crimson} variant="light" />

        {/* ==================== STAT STRIP ==================== */}
        <View style={styles.statStrip}>
          <StatBlock label="TODAY" value={todayClasses.length} tone="ink" />
          <View style={styles.statDivider} />
          <StatBlock label="LEFT" value={remainingClasses.length} tone="amber" />
          <View style={styles.statDivider} />
          <StatBlock label="DONE" value={doneCount} tone="green" />
          {reportedCount > 0 ? (
            <>
              <View style={styles.statDivider} />
              <StatBlock label="REPORTED" value={reportedCount} tone="slate" />
            </>
          ) : missedCount > 0 ? (
            <>
              <View style={styles.statDivider} />
              <StatBlock label="MISSED" value={missedCount} tone="red" />
            </>
          ) : null}
        </View>

        {/* ==================== BANNERS ==================== */}
        {showReportedBanner && reportedCount > 0 && (
          <Banner
            tone="green"
            title={`${reportedCount} ${reportedCount === 1 ? 'class' : 'classes'} reported today`}
            body="Your Program Chair has been notified."
          />
        )}

        {missedCount > 0 && (
          <Banner
            tone="red"
            title={`${missedCount} ${missedCount === 1 ? 'class' : 'classes'} missed today`}
            body="You didn't scan in. File a ghost report or contact your chair."
          />
        )}

        {/* ==================== NEXT CLASS HERO ==================== */}
        {nextClass && nextStatus ? (
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={styles.heroEyebrow}>UP NEXT</Text>
              <View
                style={[
                  styles.heroStatusChip,
                  {
                    backgroundColor:
                      nextStatus === 'ghost'
                        ? T.slateSoft
                        : nextClass.isOnline
                        ? T.blueSoft
                        : stateSoftBg(nextStatus),
                  },
                ]}
              >
                <View
                  style={[
                    styles.heroStatusDot,
                    {
                      backgroundColor:
                        nextStatus === 'ghost'
                          ? T.slate
                          : nextClass.isOnline
                          ? T.blue
                          : stateAccent(nextStatus),
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.heroStatusText,
                    {
                      color:
                        nextStatus === 'ghost'
                          ? T.slate
                          : nextClass.isOnline
                          ? T.blue
                          : stateAccent(nextStatus),
                    },
                  ]}
                >
                  {nextStatus === 'ghost'
                    ? 'REPORTED'
                    : nextClass.isOnline
                    ? 'ONLINE'
                    : nextStatus === 'ongoing'
                    ? 'LIVE'
                    : nextStatus === 'ended_early'
                    ? 'ENDED'
                    : nextStatus === 'starts_now'
                    ? 'NOW'
                    : 'SOON'}
                </Text>
              </View>
            </View>

            <Text style={styles.heroSubject} numberOfLines={1}>
              {nextClass.subject_code}
            </Text>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {nextClass.course_title}
            </Text>

            {(nextStatus === 'ongoing' || nextStatus === 'starts_now') &&
              !nextClass.isOnline &&
              nextStatus !== 'ghost' && (
                <View style={styles.heroProgressWrap}>
                  <View style={styles.heroProgressTrack}>
                    <View
                      style={[
                        styles.heroProgressFill,
                        {
                          width: `${Math.max(2, Math.min(100, heroProgress * 100))}%`,
                          backgroundColor: stateAccent(nextStatus),
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.heroProgressLabel}>
                    {nextStatus === 'ongoing'
                      ? `${Math.round(heroProgress * 100)}% through`
                      : 'Starting soon'}
                  </Text>
                </View>
              )}

            <View style={styles.heroMetaGrid}>
              <View style={styles.heroMetaItem}>
                <Text style={styles.heroMetaLabel}>TIME</Text>
                <Text style={styles.heroMetaValue} numberOfLines={1}>
                  {formatTime(nextClass.start_time)}
                </Text>
                <Text style={styles.heroMetaSub}>
                  to {formatTime(nextClass.end_time)}
                </Text>
              </View>

              <View style={styles.heroMetaDivider} />

              <View style={styles.heroMetaItem}>
                <Text style={styles.heroMetaLabel}>ROOM</Text>
                <Text style={styles.heroMetaValue} numberOfLines={1}>
                  {nextClass.isOnline ? 'Online' : nextClass.room_name || '—'}
                </Text>
                <Text style={styles.heroMetaSub} numberOfLines={1}>
                  {nextClass.section || '—'}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.heroNote,
                {
                  borderLeftColor:
                    nextStatus === 'ghost'
                      ? T.slate
                      : nextClass.isOnline
                      ? T.blue
                      : stateAccent(nextStatus),
                },
              ]}
            >
              <Text style={styles.heroNoteText}>
                {nextStatus === 'ghost'
                  ? nextClass.ghostReport.is_excused === true
                    ? 'Your record is protected.'
                    : 'Your Chair will review this report.'
                  : nextClass.isOnline
                  ? 'Join virtually — no QR scan needed.'
                  : nextStatus === 'ongoing'
                  ? nextClass.liveSession?.scanned_at
                    ? `Checked in at ${formatVerifiedTime(nextClass.liveSession.scanned_at)}.`
                    : 'Checked in — room verified.'
                  : nextStatus === 'ended_early'
                  ? nextClass.liveSession?.ended_at
                    ? `Ended at ${formatVerifiedTime(nextClass.liveSession.ended_at)}.`
                    : 'You ended this class early.'
                  : nextStatus === 'starts_now'
                  ? 'Scan the room QR to begin this class.'
                  : `Class starts at ${formatTime(nextClass.start_time)}.`}
              </Text>
            </View>

            {(() => {
              const acts = getAvailableActions(nextClass, nowMin);

              if (nextStatus === 'ghost') {
                return (
                  <TouchableOpacity
                    style={styles.actionPrimary}
                    onPress={() => setDetailClass(nextClass)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.actionPrimaryText}>View Report Details</Text>
                  </TouchableOpacity>
                );
              }

              if (nextClass.isOnline) {
                return (
                  <TouchableOpacity
                    style={styles.actionPrimary}
                    onPress={() => handleReportGhost(nextClass)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.actionPrimaryText}>Report Ghost</Text>
                  </TouchableOpacity>
                );
              }

              if (acts.canEndEarly) {
                return (
                  <>
                    <TouchableOpacity
                      style={styles.actionOutlineAmber}
                      onPress={() => handleEndClassEarly(nextClass)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.actionOutlineAmberText}>
                        End Class Early
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.actionGhost}
                        onPress={() => handleNavigate(nextClass)}
                      >
                        <Text style={styles.actionGhostText}>Navigate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionGhost}
                        onPress={() => setDetailClass(nextClass)}
                      >
                        <Text style={styles.actionGhostText}>Details</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              }

              if (acts.canScan) {
                return (
                  <>
                    <TouchableOpacity
                      style={styles.actionPrimary}
                      onPress={() => handleScanQR(nextClass)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.actionPrimaryText}>
                        {nextStatus === 'upcoming'
                          ? 'Scan QR to Verify Room'
                          : 'Scan QR to Begin Class'}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.actionGhost}
                        onPress={() => handleNavigate(nextClass)}
                      >
                        <Text style={styles.actionGhostText}>Navigate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionGhost}
                        onPress={() => handleReportGhost(nextClass)}
                      >
                        <Text style={styles.actionGhostText}>Report Ghost</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              }

              return (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionGhost}
                    onPress={() => handleNavigate(nextClass)}
                  >
                    <Text style={styles.actionGhostText}>Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionGhost}
                    onPress={() => setDetailClass(nextClass)}
                  >
                    <Text style={styles.actionGhostText}>Details</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
          </View>
        ) : (
          <View style={styles.emptyHero}>
            <View style={styles.emptyHeroIcon}>
              <Feather name="check" size={24} color={T.green} />
            </View>
            <Text style={styles.emptyHeroTitle}>
              {semester ? 'All classes done' : 'No active semester'}
            </Text>
            <Text style={styles.emptyHeroBody}>
              {semester
                ? 'You have no upcoming or ongoing classes scheduled today.'
                : 'Please contact the admin to activate a semester.'}
            </Text>
          </View>
        )}

        {/* ==================== TIMELINE ==================== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>TODAY</Text>
              <Text style={styles.sectionTitle}>Your schedule</Text>
            </View>
            {todayClasses.length > 0 && (
              <TouchableOpacity
                onPress={openFullSchedule}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.sectionLink}>Full week →</Text>
              </TouchableOpacity>
            )}
          </View>

          {todayClasses.length === 0 ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>No classes scheduled for today.</Text>
            </View>
          ) : (
            <>
              <View style={styles.timeline}>
                {previewClasses.map((cls, idx) => {
                  const status = getProfessorClassStatus(cls, nowMin);
                  const isGhost = status === 'ghost';
                  const accent = stateAccent(status);
                  const isLast = idx === previewClasses.length - 1;

                  return (
                    <TouchableOpacity
                      key={cls.id}
                      style={styles.timelineRow}
                      activeOpacity={0.7}
                      onPress={() => setDetailClass(cls)}
                    >
                      <View style={styles.timelineRail}>
                        <Text style={styles.timelineTime}>
                          {formatTime(cls.start_time).replace(' ', '\n')}
                        </Text>
                        <View
                          style={[
                            styles.timelineDot,
                            {
                              backgroundColor: T.surface,
                              borderColor: accent,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.timelineDotInner,
                              { backgroundColor: accent },
                            ]}
                          />
                        </View>
                        {!isLast && (
                          <View
                            style={[
                              styles.timelineLine,
                              { backgroundColor: accent + '30' },
                            ]}
                          />
                        )}
                      </View>

                      <View
                        style={[
                          styles.timelineCard,
                          (status === 'ongoing' || status === 'starts_now') &&
                            styles.timelineCardLive,
                          isGhost && styles.timelineCardGhost,
                        ]}
                      >
                        <View style={styles.timelineCardTop}>
                          <Text style={styles.timelineSubject} numberOfLines={1}>
                            {cls.subject_code}
                          </Text>
                          <View
                            style={[
                              styles.timelineStatusChip,
                              { backgroundColor: stateSoftBg(status) },
                            ]}
                          >
                            <Text
                              style={[
                                styles.timelineStatusChipText,
                                { color: accent },
                              ]}
                              numberOfLines={1}
                            >
                              {getInlineStatusLabel(status, cls)}
                            </Text>
                          </View>
                        </View>

                        <Text
                          style={[
                            styles.timelineTitle,
                            isGhost && styles.timelineTitleGhost,
                          ]}
                          numberOfLines={2}
                        >
                          {cls.course_title}
                        </Text>

                        <View style={styles.timelineMetaRow}>
                          <Text style={styles.timelineMetaIcon}>·</Text>
                          <Text style={styles.timelineMeta} numberOfLines={1}>
                            {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                          </Text>
                        </View>

                        <View style={styles.timelineMetaRow}>
                          <Text style={styles.timelineMetaIcon}>·</Text>
                          <Text style={styles.timelineMeta} numberOfLines={1}>
                            {cls.section ? `${cls.section} · ` : ''}
                            {cls.room_name || '—'}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {moreCount > 0 && (
                <TouchableOpacity
                  style={styles.moreRow}
                  onPress={openFullSchedule}
                  activeOpacity={0.7}
                >
                  <Text style={styles.moreText}>
                    +{moreCount} more {moreCount === 1 ? 'class' : 'classes'}
                  </Text>
                  <Text style={styles.moreArrow}>→</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* ==================== QUICK ACTIONS ==================== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>TOOLS</Text>
              <Text style={styles.sectionTitle}>Quick actions</Text>
            </View>
          </View>

          <View style={styles.toolGrid}>
            <ToolCard
              icon="camera"
              label="Scan QR"
              sub="Verify a room"
              onPress={() => navigation.navigate('QRScanner')}
              accent
            />
            <ToolCard
              icon="calendar"
              label="My Schedule"
              sub="Full week view"
              onPress={openFullSchedule}
            />
            <ToolCard
              icon="map"
              label="Campus Map"
              sub="Find your way"
              onPress={() => navigation.navigate('Map')}
            />
            <ToolCard
              icon="activity"
              label="Room Status"
              sub="See what's free"
              onPress={() => navigation.navigate('RoomStatus')}
            />
            <ToolCard
              icon="alert-triangle"
              label="Report Ghost"
              sub="Cancelled class"
              onPress={handleQuickReportGhost}
              full
            />
          </View>
        </View>

        <View style={{ height: 56 }} />
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
                const status = getProfessorClassStatus(detailClass, nowMin);
                const accent = stateAccent(status);
                const isGhost = status === 'ghost';
                const acts = getAvailableActions(detailClass, nowMin);

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
                      {isGhost ? (
                        <View style={[styles.modalBadge, { backgroundColor: T.slateSoft }]}>
                          <Text style={[styles.modalBadgeText, { color: T.slate }]}>
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
                            {
                              backgroundColor: detailClass.isOnline
                                ? T.blueSoft
                                : T.amberSoft,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.modalBadgeText,
                              {
                                color: detailClass.isOnline ? T.blue : T.amber,
                              },
                            ]}
                          >
                            {detailClass.isOnline ? 'ONLINE' : 'FACE-TO-FACE'}
                          </Text>
                        </View>
                      )}

                      <View
                        style={[
                          styles.modalStatusPill,
                          { backgroundColor: stateSoftBg(status) },
                        ]}
                      >
                        <Text style={[styles.modalStatusPillText, { color: accent }]}>
                          {getInlineStatusLabel(status, detailClass)}
                        </Text>
                      </View>
                    </View>

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
                          {detailClass.isOnline ? 'Online' : detailClass.room_name || '—'}
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

                    {(() => {
                      let headline = '';
                      let subline = '';

                      if (isGhost) {
                        headline = 'REPORTED ABSENT';
                        subline =
                          detailClass.ghostReport.is_excused === true
                            ? 'Your record is protected.'
                            : 'Your Chair will review this.';
                      } else if (status === 'ongoing') {
                        headline = 'IN PROGRESS';
                        subline = 'You are checked in for this class.';
                      } else if (status === 'ended_early') {
                        headline = 'ENDED EARLY';
                        subline = detailClass.liveSession?.ended_at
                          ? `You ended this class at ${formatVerifiedTime(
                              detailClass.liveSession.ended_at
                            )}`
                          : 'You ended this class early.';
                      } else if (status === 'starts_now') {
                        headline = 'STARTS NOW';
                        subline = 'Scan the room QR to begin this class.';
                      } else if (status === 'upcoming') {
                        headline = 'UPCOMING';
                        subline = `Class starts at ${formatTime(
                          detailClass.start_time
                        )}.`;
                      } else if (status === 'completed') {
                        headline = 'COMPLETED';
                        subline = 'Class has ended.';
                      } else if (status === 'missed') {
                        headline = 'MISSED · NO CHECK-IN';
                        subline = 'You did not scan in for this class.';
                      }

                      return (
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
                              {headline}
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
                          <Text style={styles.modalLiveSubline}>{subline}</Text>
                        </View>
                      );
                    })()}

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
                            REASON_LABELS[detailClass.ghostReport.excused_reason] ||
                            detailClass.ghostReport.reason}
                        </Text>
                        {!!detailClass.ghostReport.notes && (
                          <Text style={styles.modalGhostNotes}>
                            "{detailClass.ghostReport.notes}"
                          </Text>
                        )}
                      </View>
                    )}

                    {!isGhost && (
                      <View style={styles.modalActions}>
                        {acts.canNavigate && (
                          <TouchableOpacity
                            style={styles.modalSecondaryBtn}
                            onPress={() => handleNavigate(detailClass)}
                          >
                            <Text style={styles.modalSecondaryBtnText}>Navigate</Text>
                          </TouchableOpacity>
                        )}

                        {acts.canEndEarly && (
                          <TouchableOpacity
                            style={styles.modalEndEarlyBtn}
                            onPress={() => handleEndClassEarly(detailClass)}
                          >
                            <Text style={styles.modalEndEarlyBtnText}>End Class Early</Text>
                          </TouchableOpacity>
                        )}

                        {acts.canScan && (
                          <TouchableOpacity
                            style={styles.modalPrimaryBtn}
                            onPress={() => handleScanQR(detailClass)}
                          >
                            <Text style={styles.modalPrimaryBtnText}>Scan QR</Text>
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

                        {!acts.canScan && !acts.canEndEarly && !acts.canReportGhost && !acts.canNavigate && (
                          <TouchableOpacity
                            style={styles.modalPrimaryBtn}
                            onPress={closeDetail}
                          >
                            <Text style={styles.modalPrimaryBtnText}>Close</Text>
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

      {/* ============================================================
          LOGOUT CONFIRMATION MODAL
          ============================================================ */}
      <Modal
        visible={logoutModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeLogoutModal}
      >
        <Pressable style={styles.logoutBackdrop} onPress={closeLogoutModal}>
          <Pressable style={styles.logoutCard} onPress={() => {}}>
            <View style={styles.logoutToneStrip}>
              <View style={styles.logoutToneDot} />
              <Text style={styles.logoutToneLabel}>SIGN OUT</Text>
            </View>

            <View style={styles.logoutBadgeWrap}>
              <View style={styles.logoutBadge}>
                <Feather name="log-out" size={28} color={T.crimson} />
              </View>
            </View>

            <Text style={styles.logoutCardTitle}>Log out of UniNav?</Text>
            <Text style={styles.logoutCardSubtitle}>
              You'll be signed out of your faculty account and will need to
              log in again to access your portal.
            </Text>

            {!!fullName && (
              <View style={styles.logoutAccountPill}>
                <View style={styles.logoutAccountAvatar}>
                  <Text style={styles.logoutAccountAvatarText}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logoutAccountLabel}>SIGNED IN AS</Text>
                  <Text style={styles.logoutAccountName} numberOfLines={1}>
                    {fullName}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.logoutActions}>
              <TouchableOpacity
                style={styles.logoutCancelBtn}
                onPress={closeLogoutModal}
                disabled={loggingOut}
                activeOpacity={0.85}
              >
                <Text style={styles.logoutCancelText}>Stay signed in</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.logoutConfirmBtn}
                onPress={performLogout}
                disabled={loggingOut}
                activeOpacity={0.85}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <View style={styles.logoutConfirmIconChip}>
                      <Feather name="log-out" size={12} color="#FFFFFF" />
                    </View>
                    <Text style={styles.logoutConfirmText}>Log out</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

// ============================================================
// SUB-COMPONENTS
// ============================================================

const StatBlock = ({ label, value, tone }) => {
  const color =
    tone === 'amber' ? T.amber :
    tone === 'green' ? T.green :
    tone === 'red' ? T.red :
    tone === 'slate' ? T.slate :
    T.ink;
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color }]}>{String(value).padStart(2, '0')}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
};

const Banner = ({ tone, title, body }) => {
  const stripe =
    tone === 'green' ? T.green :
    tone === 'red' ? T.red :
    T.amber;
  return (
    <View style={styles.banner}>
      <View style={[styles.bannerStripe, { backgroundColor: stripe }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>{title}</Text>
        <Text style={styles.bannerBody}>{body}</Text>
      </View>
    </View>
  );
};

const ToolCard = ({ icon, label, sub, onPress, accent, full }) => (
  <TouchableOpacity
    style={[
      styles.toolCard,
      full && styles.toolCardFull,
      accent && styles.toolCardAccent,
    ]}
    onPress={onPress}
    activeOpacity={0.75}
  >
    <View
      style={[
        styles.toolIconWrap,
        accent && styles.toolIconWrapAccent,
      ]}
    >
      <Feather
        name={icon}
        size={20}
        color={accent ? '#FFFFFF' : T.crimson}
      />
    </View>
    <Text
      style={[styles.toolLabel, accent && styles.toolLabelAccent]}
      numberOfLines={1}
    >
      {label}
    </Text>
    <Text
      style={[styles.toolSub, accent && styles.toolSubAccent]}
      numberOfLines={1}
    >
      {sub}
    </Text>
  </TouchableOpacity>
);

// ============================================================
// LOADING SKELETON
// ============================================================

const ProfessorDashboardSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

    <View style={styles.scrollContent}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <SkeletonCircle size={44} />
            <View style={{ flex: 1, paddingLeft: 12, gap: 6 }}>
              <Skeleton width={80} height={9} radius={3} />
              <Skeleton width={160} height={13} radius={3} />
            </View>
            <Skeleton width={98} height={34} radius={999} />
          </View>
          <Skeleton width={210} height={30} radius={6} style={{ marginTop: 22 }} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
        <Skeleton width="100%" height={78} radius={16} />
      </View>

      <View style={styles.statStrip}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.statBlock, i < 4 && { borderRightWidth: 1, borderRightColor: T.hair2 }]}>
            <Skeleton width={34} height={26} radius={4} />
            <Skeleton width={50} height={9} radius={3} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>

      <View style={styles.hero}>
        <Skeleton width={70} height={10} radius={3} />
        <Skeleton width="55%" height={34} radius={6} style={{ marginTop: 14 }} />
        <Skeleton width="85%" height={16} radius={4} style={{ marginTop: 8 }} />
        <Skeleton width="100%" height={60} radius={10} style={{ marginTop: 18 }} />
        <Skeleton width="100%" height={48} radius={12} style={{ marginTop: 14 }} />
      </View>
    </View>
  </View>
);

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.canvas },
  scrollContent: { paddingBottom: 20 },

  // ==================== HEADER ====================
  header: {
    backgroundColor: T.crimson,
    paddingTop: 58,
    paddingBottom: 32,
    overflow: 'hidden',
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
  headerContent: {
    paddingHorizontal: 22,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  headerEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
    opacity: 0.6,
    marginBottom: 4,
  },
  headerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    opacity: 0.95,
    letterSpacing: -0.1,
  },

  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 5,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    gap: 8,
    minHeight: 34,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logoutIconChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },

  headerGreeting: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    marginTop: 26,
    lineHeight: 38,
  },
  headerDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  dateBlock: {
    alignItems: 'center',
    minWidth: 44,
  },
  dateNumber: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  dateMonth: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFFFFF',
    opacity: 0.7,
    letterSpacing: 1.6,
    marginTop: 2,
  },
  dateDivider: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginHorizontal: 14,
  },
  dateWeekday: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  dateSemester: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.65,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0.2,
  },

  // ==================== STAT STRIP ====================
  // Now sits below the semester progress card — marginTop is
  // positive (12) instead of -18.
  statStrip: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 16,
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

  // ==================== BANNERS ====================
  banner: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: T.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    overflow: 'hidden',
    paddingRight: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  bannerStripe: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  bannerBody: {
    fontSize: 11,
    color: T.inkMuted,
    lineHeight: 16,
    fontWeight: '500',
  },

  // ==================== HERO ====================
  hero: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 22,
    backgroundColor: T.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.hair,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heroEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.2,
    color: T.inkFaint,
  },
  heroStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6,
  },
  heroStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroStatusText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  heroSubject: {
    fontSize: 36,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: -1,
    lineHeight: 40,
  },
  heroTitle: {
    fontSize: 15,
    color: T.inkSoft,
    marginTop: 4,
    fontWeight: '500',
    lineHeight: 21,
  },
  heroProgressWrap: {
    marginTop: 18,
  },
  heroProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: T.hair2,
    overflow: 'hidden',
  },
  heroProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  heroProgressLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: T.inkMuted,
    marginTop: 8,
    letterSpacing: 0.4,
  },
  heroMetaGrid: {
    flexDirection: 'row',
    marginTop: 18,
    backgroundColor: '#FAFAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    paddingVertical: 14,
  },
  heroMetaItem: {
    flex: 1,
    paddingHorizontal: 16,
  },
  heroMetaDivider: {
    width: 1,
    backgroundColor: T.hair,
    marginVertical: 4,
  },
  heroMetaLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: T.inkFaint,
    marginBottom: 6,
  },
  heroMetaValue: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
  },
  heroMetaSub: {
    fontSize: 11,
    fontWeight: '600',
    color: T.inkMuted,
    marginTop: 3,
  },
  heroNote: {
    marginTop: 16,
    paddingLeft: 12,
    paddingVertical: 2,
    borderLeftWidth: 3,
  },
  heroNoteText: {
    fontSize: 12,
    color: T.inkSoft,
    fontWeight: '500',
    lineHeight: 17,
  },

  actionPrimary: {
    marginTop: 18,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: T.crimson,
    alignItems: 'center',
  },
  actionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  actionOutlineAmber: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C77700',
    backgroundColor: '#FFFAF0',
    alignItems: 'center',
  },
  actionOutlineAmberText: {
    color: '#C77700',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actionGhost: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.hair,
    backgroundColor: T.surface,
    alignItems: 'center',
  },
  actionGhostText: {
    fontSize: 12,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: 0.3,
  },

  // ==================== EMPTY HERO ====================
  emptyHero: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 32,
    backgroundColor: T.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
  },
  emptyHeroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyHeroTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
  },
  emptyHeroBody: {
    fontSize: 13,
    color: T.inkMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },

  // ==================== SECTIONS ====================
  section: {
    marginTop: 32,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  sectionEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: 2.2,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
  },
  sectionLink: {
    fontSize: 12,
    fontWeight: '800',
    color: T.crimson,
    letterSpacing: 0.2,
    marginBottom: 4,
  },

  // ==================== TIMELINE ====================
  timeline: {
    paddingLeft: 2,
  },
  timelineRow: {
    flexDirection: 'row',
    minHeight: 80,
  },
  timelineRail: {
    width: 54,
    alignItems: 'center',
    paddingTop: 8,
  },
  timelineTime: {
    fontSize: 10,
    fontWeight: '900',
    color: T.ink,
    textAlign: 'center',
    lineHeight: 12,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.surface,
  },
  timelineDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
    marginBottom: -4,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 14,
    marginLeft: 10,
    marginBottom: 12,
  },
  timelineCardLive: {
    borderColor: '#F3C6C6',
    shadowColor: T.crimson,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  timelineCardGhost: {
    opacity: 0.75,
  },
  timelineCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  timelineSubject: {
    fontSize: 13,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: 0.2,
    flex: 1,
  },
  timelineStatusChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  timelineStatusChipText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: T.ink,
    lineHeight: 19,
  },
  timelineTitleGhost: {
    textDecorationLine: 'line-through',
    color: T.inkMuted,
  },
  timelineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  timelineMetaIcon: {
    fontSize: 14,
    color: T.inkFaint,
    marginRight: 6,
    lineHeight: 14,
  },
  timelineMeta: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '500',
    flex: 1,
  },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
    marginLeft: 64,
    backgroundColor: T.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    gap: 8,
  },
  moreText: {
    fontSize: 12,
    fontWeight: '800',
    color: T.crimson,
    letterSpacing: 0.2,
  },
  moreArrow: {
    fontSize: 14,
    fontWeight: '900',
    color: T.crimson,
  },

  emptyList: {
    padding: 28,
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 13,
    color: T.inkMuted,
    fontWeight: '500',
  },

  // ==================== TOOLS ====================
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolCard: {
    width: '48%',
    paddingVertical: 18,
    paddingHorizontal: 14,
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
  },
  toolCardFull: {
    width: '100%',
  },
  toolCardAccent: {
    backgroundColor: T.crimson,
    borderColor: T.crimson,
  },
  toolIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  toolIconWrapAccent: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  toolLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
  },
  toolLabelAccent: {
    color: '#FFFFFF',
  },
  toolSub: {
    fontSize: 11,
    color: T.inkMuted,
    marginTop: 3,
    fontWeight: '500',
  },
  toolSubAccent: {
    color: 'rgba(255,255,255,0.75)',
  },

  // ==================== CLASS MODAL ====================
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

  // ============================================================
  // LOGOUT CONFIRMATION MODAL
  // ============================================================
  logoutBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,11,13,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoutCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: T.surface,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  logoutToneStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.redSoft,
    gap: 8,
    marginBottom: 20,
  },
  logoutToneDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: T.crimson,
  },
  logoutToneLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: T.crimson,
  },
  logoutBadgeWrap: {
    marginBottom: 18,
  },
  logoutBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FDECEC',
    borderWidth: 2,
    borderColor: '#F5C2C0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCardTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 8,
  },
  logoutCardSubtitle: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    fontWeight: '500',
    paddingHorizontal: 6,
    marginBottom: 20,
  },
  logoutAccountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 12,
    gap: 12,
    marginBottom: 22,
  },
  logoutAccountAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.crimson,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutAccountAvatarText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  logoutAccountLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    marginBottom: 3,
  },
  logoutAccountName: {
    fontSize: 13,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: -0.1,
  },
  logoutActions: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 10,
  },
  logoutCancelBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCancelText: {
    fontSize: 14,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: 0.2,
  },
  logoutConfirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingLeft: 5,
    paddingRight: 14,
    borderRadius: 12,
    backgroundColor: T.crimson,
    gap: 8,
    minHeight: 48,
    shadowColor: T.crimson,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  logoutConfirmIconChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutConfirmText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});

export default ProfessorDashboard;