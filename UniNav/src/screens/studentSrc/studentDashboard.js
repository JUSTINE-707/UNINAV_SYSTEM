import { useEffect, useState, useCallback } from 'react';
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
import { navigate } from '../../navigation/navigationRef';
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
};

const buildCancelReason = (ghost) => {
  if (!ghost) return 'This class was cancelled.';

  const reason =
    STUDENT_REASON_LABELS[ghost.reason] ||
    STUDENT_REASON_LABELS[ghost.excused_reason] ||
    null;

  if (reason) return reason;

  const causeFallback = {
    professor: 'Your professor was not available.',
    students: 'No students attended.',
    room: 'The assigned room was not available.',
    admin: 'The class was moved or cancelled by the administration.',
    other: 'This class was cancelled.',
  };

  return causeFallback[ghost.cause] || 'This class was cancelled.';
};

// ============================================================
// HELPERS
// ============================================================

const getTodayCode = () => {
  const map = { 0: 'Sun', 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sat' };
  return map[new Date().getDay()];
};

const toLocalDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

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
    const t = new Date(isoString);
    return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const titleCase = (str) => {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join('-')
    )
    .join(' ');
};

// ============================================================
// LIVE STATUS
// ============================================================

const getLiveStatus = (cls, nowMin) => {
  if (!cls) return null;

  const todayCode = getTodayCode();
  if (cls.day !== todayCode) return null;

  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);

  const hasSession = !!cls.liveSession;
  const isOnline = cls.liveSession
    ? cls.liveSession.class_type === 'online'
    : isOnlineRoom(cls.room_name);

  if (cls.ghostReport) {
    return {
      roomState: 'cancelled',
      icon: '⚠',
      headline: 'CLASS CANCELLED',
      subline: buildCancelReason(cls.ghostReport),
    };
  }

  if (isOnline) {
    return {
      roomState: 'online',
      icon: '🌐',
      headline: 'ONLINE CLASS',
      subline: hasSession
        ? 'Professor confirmed session online'
        : 'No physical room — join virtually',
    };
  }

  if (start === null || end === null) return null;

  if (nowMin > end) {
    return {
      roomState: 'ended',
      icon: '·',
      headline: 'CLASS ENDED',
      subline: hasSession
        ? `Professor checked in at ${formatVerifiedTime(cls.liveSession.scanned_at)}`
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
    const t = formatVerifiedTime(cls.liveSession.scanned_at);
    return {
      roomState: 'occupied',
      icon: '✓',
      headline: 'ROOM OCCUPIED',
      subline: t ? `Professor checked in at ${t}` : 'Professor is present',
    };
  }

  return {
    roomState: 'vacant',
    icon: '⏳',
    headline: 'ROOM NOT OCCUPIED',
    subline: 'Professor has not scanned in yet',
  };
};

const stateAccent = (state) => {
  switch (state) {
    case 'occupied': return '#059669';
    case 'vacant': return '#D97706';
    case 'online': return '#3B82F6';
    case 'cancelled': return '#B00020';
    case 'ended': return '#9CA3AF';
    case 'upcoming': return '#8B0000';
    default: return '#9CA3AF';
  }
};

// ============================================================
// COMPONENT
// ============================================================

const StudentDashboard = ({ navigation }) => {
  const { user, session } = useAuth();
  const { semester } = useSemester();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [todayClasses, setTodayClasses] = useState([]);
  const [nextClass, setNextClass] = useState(null);
  const [now, setNow] = useState(new Date());

  // Class detail modal
  const [detailClass, setDetailClass] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ============================================================
  // DATA LOAD
  // ============================================================

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);

      const userId = session?.user?.id || user?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      if (!semester?.id) {
        setProfile({
          full_name: user?.full_name || null,
          sr_code: null,
          course: null,
        });
        setTodayClasses([]);
        setNextClass(null);
        setLoading(false);
        return;
      }

      const { data: rosterRow, error: rosterErr } = await supabase
        .from('students_roster')
        .select('id, sr_code, full_name, course')
        .eq('user_id', userId)
        .maybeSingle();

      if (rosterErr) throw rosterErr;

      setProfile({
        full_name: rosterRow?.full_name || user?.full_name || null,
        sr_code: rosterRow?.sr_code || null,
        course: rosterRow?.course || null,
      });

      if (!rosterRow) {
        setTodayClasses([]);
        setNextClass(null);
        setLoading(false);
        return;
      }

      const { data: enrollments, error: enrollErr } = await supabase
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
        .eq('semester_id', semester.id);

      if (enrollErr) throw enrollErr;

      const allSchedules = (enrollments || [])
        .map((e) => e.schedules)
        .filter(Boolean);

      const todayCode = getTodayCode();
      const todayDate = toLocalDateString(new Date());

      const todays = allSchedules
        .filter((s) => s.day === todayCode)
        .sort(
          (a, b) =>
            (timeToMinutes(a.start_time) || 0) -
            (timeToMinutes(b.start_time) || 0)
        );

      const scheduleIds = todays.map((s) => s.id);

      let sessionMap = {};
      let ghostMap = {};

      if (scheduleIds.length > 0) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

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
              'schedule_id, reason, cause, is_excused, excused_reason, notes'
            )
            .in('schedule_id', scheduleIds)
            .eq('report_date', todayDate),
        ]);

        (sessionsRes.data || []).forEach((s) => {
          sessionMap[s.schedule_id] = s;
        });
        (ghostsRes.data || []).forEach((g) => {
          ghostMap[g.schedule_id] = g;
        });
      }

      const enriched = todays.map((s) => ({
        ...s,
        liveSession: sessionMap[s.id] || null,
        ghostReport: ghostMap[s.id] || null,
      }));

      setTodayClasses(enriched);

      const nowMin = now.getHours() * 60 + now.getMinutes();
      const upcoming = enriched.find((c) => {
        const end = timeToMinutes(c.end_time);
        return end !== null && nowMin <= end;
      });

      setNextClass(upcoming || null);
    } catch (err) {
      console.error('Student dashboard load error:', err);
      Alert.alert('Error', 'Failed to load your dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, session, now, semester]);

  useFocusEffect(
    useCallback(() => {
      if (user || session) loadDashboard();
    }, [user, session, loadDashboard])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  // ============================================================
  // NAVIGATION HELPERS
  // ============================================================

  const closeDetail = () => setDetailClass(null);

  const openFullSchedule = () => {
    navigation.navigate('Schedule');
  };

  const openSettings = () => {
    navigation.navigate('Settings');
  };

  const openMap = () => {
    navigate('StudentMap');
  };

  const handleNavigate = (cls) => {
    if (!cls) return;
    if (isOnlineRoom(cls.room_name)) {
      Alert.alert(
        'Online Class',
        'This class is conducted online. No navigation needed.'
      );
      return;
    }
    if (cls.ghostReport) {
      Alert.alert('Class Cancelled', buildCancelReason(cls.ghostReport));
      return;
    }
    closeDetail();
    navigate('StudentMap', { roomName: cls.room_name });
  };

  // ============================================================
  // LOADING SKELETON
  // ============================================================

  if (loading) {
    return <StudentDashboardSkeleton />;
  }

  // ============================================================
  // RENDER
  // ============================================================

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextLive = nextClass ? getLiveStatus(nextClass, nowMin) : null;
  const remainingClasses = todayClasses.filter((c) => {
    if (c.ghostReport) return false;
    const end = timeToMinutes(c.end_time);
    return end !== null && end > nowMin;
  });

  const displayName = profile?.full_name
    ? titleCase(profile.full_name)
    : 'Student';

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
            <Text style={styles.headerEyebrow}>STUDENT PORTAL</Text>
            <Text style={styles.headerTitle} numberOfLines={2}>
              {getGreeting()}
            </Text>
            <Text style={styles.headerName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.headerSubtitle}>
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
        </View>

        {/* NEXT CLASS CARD */}
        {nextClass && nextLive ? (
          <View style={styles.nextClassCard}>
            <View style={styles.nextClassHeader}>
              <View
                style={[
                  styles.pulseDot,
                  { backgroundColor: stateAccent(nextLive.roomState) },
                ]}
              />
              <Text style={styles.nextClassEyebrow}>
                {nextLive.roomState === 'cancelled'
                  ? 'CANCELLED'
                  : nextLive.roomState === 'occupied' ||
                    nextLive.roomState === 'vacant'
                  ? 'IN PROGRESS'
                  : nextLive.roomState === 'online'
                  ? 'ONLINE NOW'
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
                <Text style={styles.metaLabel}>PROF</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {nextClass.professor_name || '—'}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.statusBlock,
                {
                  borderLeftColor: stateAccent(nextLive.roomState),
                  backgroundColor: stateAccent(nextLive.roomState) + '14',
                },
              ]}
            >
              <Text
                style={[
                  styles.statusHeadline,
                  { color: stateAccent(nextLive.roomState) },
                ]}
              >
                {nextLive.icon}  {nextLive.headline}
              </Text>
              <Text style={styles.statusSubline}>{nextLive.subline}</Text>
            </View>

            {nextClass.ghostReport?.notes && (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>NOTE FROM PROFESSOR</Text>
                <Text style={styles.notesText} numberOfLines={4}>
                  "{nextClass.ghostReport.notes}"
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => setDetailClass(nextClass)}
              activeOpacity={0.85}
            >
              <Text style={styles.scanButtonIcon}>ⓘ</Text>
              <Text style={styles.scanButtonText}>View Class Details</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyTitle}>No more classes today</Text>
            <Text style={styles.emptyText}>
              {semester
                ? 'You have no upcoming or ongoing classes scheduled.'
                : 'No active semester. Please contact your program chair.'}
            </Text>
          </View>
        )}

        {/* TODAY'S CLASSES */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Classes</Text>
            <TouchableOpacity onPress={openFullSchedule}>
              <Text style={styles.sectionLink}>View all →</Text>
            </TouchableOpacity>
          </View>

          {todayClasses.length === 0 ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>
                No classes scheduled for today.
              </Text>
            </View>
          ) : (
            todayClasses.slice(0, 3).map((cls) => {
              const live = getLiveStatus(cls, nowMin);
              const accent = live ? stateAccent(live.roomState) : '#9CA3AF';
              const isGhost = !!cls.ghostReport;

              return (
                <TouchableOpacity
                  key={cls.id}
                  style={[
                    styles.classCard,
                    isGhost && styles.classCardGhost,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => setDetailClass(cls)}
                >
                  <View
                    style={[styles.classAccent, { backgroundColor: accent }]}
                  />
                  <View style={styles.classInfo}>
                    <Text
                      style={[
                        styles.classSubject,
                        isGhost && styles.classSubjectGhost,
                      ]}
                    >
                      {cls.subject_code}
                    </Text>
                    <Text
                      style={[
                        styles.classTitle,
                        isGhost && styles.classTitleGhost,
                      ]}
                      numberOfLines={1}
                    >
                      {cls.course_title}
                    </Text>
                    <Text
                      style={[
                        styles.classTime,
                        isGhost && styles.classTimeGhost,
                      ]}
                    >
                      {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                      {cls.room_name ? ` · ${cls.room_name}` : ''}
                    </Text>

                    {live && (
                      <View style={styles.liveInlineRow}>
                        <View
                          style={[
                            styles.liveInlineDot,
                            { backgroundColor: accent },
                          ]}
                        />
                        <Text
                          style={[
                            styles.liveInlineText,
                            { color: accent },
                          ]}
                        >
                          {live.headline}
                        </Text>
                      </View>
                    )}

                    {isGhost && (
                      <Text style={styles.reasonInline} numberOfLines={2}>
                        {buildCancelReason(cls.ghostReport)}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
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

            <TouchableOpacity style={styles.quickCard} onPress={openMap}>
              <Text style={styles.quickIcon}>🗺️</Text>
              <Text style={styles.quickLabel}>Campus Map</Text>
              <Text style={styles.quickSub}>Find rooms</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard} onPress={openSettings}>
              <Text style={styles.quickIcon}>⚙️</Text>
              <Text style={styles.quickLabel}>Settings</Text>
              <Text style={styles.quickSub}>Account & app</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() =>
                Alert.alert(
                  'Coming soon',
                  'University Officials Directory will be available soon.'
                )
              }
            >
              <Text style={styles.quickIcon}>👥</Text>
              <Text style={styles.quickLabel}>Officials</Text>
              <Text style={styles.quickSub}>Directory</Text>
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

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {detailClass &&
                (() => {
                  const live = getLiveStatus(detailClass, nowMin);
                  const isGhost = !!detailClass.ghostReport;
                  const isOnline = isOnlineRoom(detailClass.room_name);
                  const accent = live ? stateAccent(live.roomState) : '#9CA3AF';
                  const dayFull =
                    DAY_LABELS[detailClass.day] || detailClass.day || '';

                  const canViewRoute = !isGhost && !isOnline;

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
                            onPress={() => handleNavigate(detailClass)}
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

const StudentDashboardSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor="#8B0000" />

    <View style={styles.scrollContent}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width={90} height={10} radius={4} />
          <Skeleton width={180} height={24} radius={6} />
          <Skeleton width={200} height={13} radius={4} />
        </View>
        <Skeleton width={64} height={32} radius={8} />
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Skeleton width={40} height={26} radius={6} />
          <Skeleton
            width="70%"
            height={11}
            radius={4}
            style={{ marginTop: 10 }}
          />
        </View>
        <View style={styles.summaryCard}>
          <Skeleton width={40} height={26} radius={6} />
          <Skeleton
            width="70%"
            height={11}
            radius={4}
            style={{ marginTop: 10 }}
          />
        </View>
      </View>

      <View style={styles.nextClassCard}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <SkeletonCircle size={10} />
          <Skeleton width={90} height={10} radius={4} />
        </View>

        <Skeleton
          width="55%"
          height={28}
          radius={6}
          style={{ marginTop: 14 }}
        />
        <Skeleton
          width="85%"
          height={16}
          radius={4}
          style={{ marginTop: 8 }}
        />

        <View style={styles.nextClassMeta}>
          <View style={styles.metaItem}>
            <Skeleton width={30} height={9} radius={3} />
            <Skeleton
              width={50}
              height={12}
              radius={4}
              style={{ marginTop: 6 }}
            />
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Skeleton width={30} height={9} radius={3} />
            <Skeleton
              width={50}
              height={12}
              radius={4}
              style={{ marginTop: 6 }}
            />
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Skeleton width={30} height={9} radius={3} />
            <Skeleton
              width={50}
              height={12}
              radius={4}
              style={{ marginTop: 6 }}
            />
          </View>
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
              <Skeleton width={70} height={14} radius={4} />
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
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    opacity: 0.95,
    letterSpacing: -0.2,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.75,
    marginTop: 6,
    fontWeight: '600',
  },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'flex-start',
  },
  logoutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

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
    lineHeight: 17,
  },

  notesBox: {
    marginTop: 12,
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

  onlineNote: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#1E88E5',
  },
  onlineNoteTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E40AF',
    marginBottom: 4,
  },
  onlineNoteText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 18,
    opacity: 0.85,
  },

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
  classCardGhost: {
    backgroundColor: '#FFFAFA',
    borderWidth: 1,
    borderColor: '#F5C2C0',
    borderStyle: 'dashed',
  },
  classAccent: { width: 4, borderRadius: 2, marginRight: 12 },
  classInfo: { flex: 1 },
  classSubject: {
    fontSize: 13,
    fontWeight: '800',
    color: '#8B0000',
    letterSpacing: 0.3,
  },
  classSubjectGhost: { color: '#6B7280' },
  classTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginTop: 2,
  },
  classTitleGhost: {
    color: '#6B7280',
    textDecorationLine: 'line-through',
  },
  classTime: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  classTimeGhost: {
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
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
  reasonInline: {
    fontSize: 12,
    color: '#7A0014',
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 16,
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
});

export default StudentDashboard;