import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
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
  error: T.red,
  online: T.blue,
  excused: T.green,
  excusedBg: T.greenSoft,
  unexcused: T.amber,
  unexcusedBg: T.amberSoft,
  neutral: T.slate,
  neutralBg: T.slateSoft,
};

const DAYS = ['Sun', 'M', 'T', 'W', 'Th', 'F', 'Sat'];

const DAY_OPTIONS = [
  { offset: -1, key: 'yesterday', label: 'Yesterday' },
  { offset: 0,  key: 'today',     label: 'Today' },
  { offset: 1,  key: 'tomorrow',  label: 'Tomorrow' },
];

const CAUSES = [
  { code: 'professor', label: "I couldn't attend the class", hint: 'You were unable to teach due to a conflict or emergency.', icon: '🧑‍🏫' },
  { code: 'students', label: 'No students showed up', hint: 'You arrived but no students attended the class.', icon: '👥' },
  { code: 'room', label: 'Room was unavailable', hint: 'The assigned room was locked, occupied, or unusable.', icon: '🔒' },
  { code: 'admin', label: 'Class moved online', hint: 'The class was conducted virtually instead of face-to-face.', icon: '🌐' },
  { code: 'other', label: 'Other reason', hint: 'Something else happened. Please describe below.', icon: '⋯' },
];

const PROFESSOR_REASONS = [
  { code: 'official_duty', label: 'Official duty', hint: 'Meeting, seminar, training, or official university assignment.', isExcused: true, excusedReason: 'Official Duty', icon: '🏛️' },
  { code: 'medical', label: 'Medical / Sick leave', hint: 'You were sick or on approved medical leave.', isExcused: true, excusedReason: 'Medical', icon: '🏥' },
  { code: 'emergency', label: 'Personal emergency', hint: 'Family emergency, accident, or urgent personal matter.', isExcused: true, excusedReason: 'Emergency', icon: '🚨' },
  { code: 'personal', label: 'Personal matter', hint: 'A non-emergency personal commitment.', isExcused: false, excusedReason: 'Personal', icon: '👤' },
  { code: 'other_prof', label: 'Other reason', hint: 'Describe the situation in the notes below.', isExcused: false, excusedReason: 'Other', icon: '⋯' },
];

const formatTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

const toLocalDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatShortDate = (date) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
};

const normalizeNameKey = (name) => {
  if (!name) return '';
  return name.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const buildTargetDate = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};

const ReportGhostScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { semester } = useSemester();

  const initialScheduleId = route.params?.scheduleId || null;

  const [cause, setCause] = useState(null);
  const [profReason, setProfReason] = useState(null);
  const [notes, setNotes] = useState('');

  const [releaseRoom, setReleaseRoom] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [faculty, setFaculty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [dayOffset, setDayOffset] = useState(0);

  const [todayClasses, setTodayClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  const targetDate = buildTargetDate(dayOffset);
  const targetDateStr = toLocalDateString(targetDate);
  const targetDayCode = DAYS[targetDate.getDay()];

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      if (!semester?.id) {
        setFaculty(null);
        setTodayClasses([]);
        setSelectedClass(null);
        setLoading(false);
        setPickerLoading(false);
        return;
      }

      if (!faculty) setLoading(true);
      else setPickerLoading(true);

      const { data: facultyData } = await supabase
        .from('faculty')
        .select('id, employee_id, program, college')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;
      setFaculty(facultyData);

      const { data: ghostData } = await supabase
        .from('ghost_reports')
        .select('schedule_id')
        .eq('faculty_id', user.id)
        .eq('report_date', targetDateStr);

      if (cancelled) return;
      const reportedIds = new Set((ghostData || []).map((g) => g.schedule_id));

      const SCHEDULE_COLUMNS = `
        id, subject_code, course_title, section, program,
        day, start_time, end_time, room_id, room_name,
        professor_name, professor_id, employee_id
      `;

      let scheduleData = [];

      {
        const { data } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('professor_id', user.id)
          .eq('day', targetDayCode)
          .eq('semester_id', semester.id)
          .order('start_time', { ascending: true });
        scheduleData = data || [];
      }

      if (scheduleData.length === 0 && facultyData?.employee_id) {
        const { data } = await supabase
          .from('schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('employee_id', facultyData.employee_id)
          .eq('day', targetDayCode)
          .eq('semester_id', semester.id)
          .order('start_time', { ascending: true });
        scheduleData = data || [];
      }

      if (scheduleData.length === 0 && facultyData?.program) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle();

        if (userRow?.full_name) {
          const { data: candidates } = await supabase
            .from('schedules')
            .select(SCHEDULE_COLUMNS)
            .eq('program', facultyData.program)
            .eq('day', targetDayCode)
            .eq('semester_id', semester.id)
            .order('start_time', { ascending: true });

          const target = normalizeNameKey(userRow.full_name);
          scheduleData = (candidates || []).filter(
            (s) => normalizeNameKey(s.professor_name) === target
          );
        }
      }

      if (cancelled) return;

      const available = scheduleData.filter((s) => !reportedIds.has(s.id));
      setTodayClasses(available);

      const pre =
        (dayOffset === 0 &&
          initialScheduleId &&
          available.find((s) => s.id === initialScheduleId)) ||
        available[0] ||
        null;
      setSelectedClass(pre);

      setLoading(false);
      setPickerLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, dayOffset, initialScheduleId, targetDateStr, targetDayCode, semester?.id]);

  useEffect(() => {
    if (cause !== 'professor') setProfReason(null);
  }, [cause]);

  useEffect(() => {
    setCause(null);
    setProfReason(null);
    setReleaseRoom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset]);

  useEffect(() => {
    setReleaseRoom(true);
  }, [selectedClass?.id]);

  const handleSubmit = async () => {
    if (!selectedClass) {
      Alert.alert('No class selected', 'Please choose the class you are reporting.');
      return;
    }
    if (!cause) {
      Alert.alert('Reason required', 'Please select what happened.');
      return;
    }
    if (cause === 'professor' && !profReason) {
      Alert.alert('Reason required', 'Please select why you could not attend the class.');
      return;
    }
    if (cause === 'other' && !notes.trim()) {
      Alert.alert('Description required', 'Please describe what happened for "Other reason".');
      return;
    }
    if (!faculty) {
      Alert.alert('Error', 'Faculty profile not found.');
      return;
    }

    setSubmitting(true);

    try {
      let reasonText = cause;
      let isExcused = null;
      let excusedReason = null;

      if (cause === 'professor' && profReason) {
        const selected = PROFESSOR_REASONS.find((r) => r.code === profReason);
        if (selected) {
          reasonText = selected.code;
          isExcused = selected.isExcused;
          excusedReason = selected.excusedReason;
        }
      }

      const isPhysicalRoom = !!selectedClass.room_name;

      const { error } = await supabase.from('ghost_reports').insert({
        schedule_id: selectedClass.id,
        faculty_id: faculty.id,
        reason: reasonText,
        notes: notes.trim() || null,
        cause,
        is_excused: isExcused,
        excused_reason: excusedReason,
        report_date: targetDateStr,
        room_released: isPhysicalRoom ? releaseRoom : false,
      });

      if (error) throw error;
      setSubmitted(true);
    } catch (err) {
      console.error('Ghost report error:', err);
      Alert.alert('Submission Failed', err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return <ReportGhostSkeleton />;
  }

  // ============================================================
  // SUCCESS
  // ============================================================

  if (submitted) {
    const isExcused =
      cause === 'professor' &&
      PROFESSOR_REASONS.find((r) => r.code === profReason)?.isExcused;

    const dayLabel =
      dayOffset === -1 ? 'Yesterday' :
      dayOffset === 1  ? 'Tomorrow'  :
      'Today';

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerContent}>
            <View style={styles.headerTopRow}>
              <View style={{ width: 34 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerEyebrow}>FACULTY</Text>
                <Text style={styles.headerTitle}>Report Ghost Class</Text>
              </View>
              <View style={{ width: 34 }} />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.successContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successToneStrip}>
            <View style={styles.successToneDot} />
            <Text style={styles.successToneLabel}>SUBMITTED</Text>
          </View>

          <View style={styles.successBadge}>
            <Text style={styles.successBadgeGlyph}>✓</Text>
          </View>

          <Text style={styles.successTitle}>Report submitted</Text>
          <Text style={styles.successSubtitle}>
            Your report has been sent to your Program Chair and Admin.
          </Text>

          {cause === 'professor' && (
            <View
              style={[
                styles.statusBanner,
                isExcused
                  ? {
                      backgroundColor: T.greenSoft,
                      borderLeftColor: T.green,
                    }
                  : {
                      backgroundColor: T.amberSoft,
                      borderLeftColor: T.amber,
                    },
              ]}
            >
              <Text
                style={[
                  styles.statusBannerText,
                  { color: isExcused ? T.green : T.amber },
                ]}
              >
                {isExcused ? 'MARKED AS EXCUSED' : 'MARKED AS UNEXCUSED'}
              </Text>
              <Text style={styles.statusBannerHint}>
                {isExcused
                  ? 'Your absence has been classified as legitimate.'
                  : 'This will be reviewed by your Program Chair.'}
              </Text>
            </View>
          )}

          {releaseRoom && selectedClass?.room_name && (
            <View style={styles.releaseBanner}>
              <View style={styles.releaseBannerStripe} />
              <View style={{ flex: 1 }}>
                <Text style={styles.releaseBannerTitle}>Room released</Text>
                <Text style={styles.releaseBannerText}>
                  {selectedClass.room_name} is now shown as available for the
                  scheduled time. Other classes may use it.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>CLASS</Text>
              <Text style={styles.summaryValue}>
                {selectedClass?.subject_code || '—'}
                {selectedClass?.section ? ` · ${selectedClass.section}` : ''}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>DATE</Text>
              <Text style={styles.summaryValue}>
                {dayLabel} · {formatShortDate(targetDate)}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>TIME</Text>
              <Text style={styles.summaryValue}>
                {selectedClass?.start_time
                  ? `${formatTime(selectedClass.start_time)} – ${formatTime(
                      selectedClass.end_time
                    )}`
                  : '—'}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>REASON</Text>
              <Text style={styles.summaryValue}>
                {cause === 'professor'
                  ? PROFESSOR_REASONS.find((r) => r.code === profReason)?.label
                  : CAUSES.find((c) => c.code === cause)?.label}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('ProfessorDashboard')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // NO SEMESTER STATE
  // ============================================================

  if (!semester) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

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
                <Text style={styles.headerTitle}>Report Ghost Class</Text>
              </View>
              <View style={{ width: 34 }} />
            </View>
          </View>
        </View>

        <View style={styles.emptyCenter}>
          <View style={styles.emptyIconWrap}>
            <View style={styles.emptyIconDot} />
            <View style={styles.emptyIconRing} />
          </View>
          <Text style={styles.emptyEyebrow}>NO SEMESTER</Text>
          <Text style={styles.emptyTitle}>Nothing to report</Text>
          <Text style={styles.emptyText}>
            There's no semester open right now. Please contact the admin to
            activate one before reporting classes.
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================
  // FORM
  // ============================================================

  const showSecondStep = cause === 'professor';
  const hasClasses = todayClasses.length > 0;
  const canReleaseRoom = !!selectedClass?.room_name;

  const emptyMessage =
    dayOffset === -1
      ? 'You have no scheduled classes yesterday that need reporting.'
      : dayOffset === 1
      ? 'You have no scheduled classes tomorrow to report in advance.'
      : "You have no scheduled classes today that haven't already been reported.";

  const submitDisabled =
    submitting || !cause || (cause === 'professor' && !profReason);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
                <Text style={styles.headerTitle}>Report Ghost Class</Text>
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
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ==================== DAY TABS ==================== */}
          <View style={styles.dayTabsRow}>
            {DAY_OPTIONS.map((opt) => {
              const isActive = dayOffset === opt.offset;
              const optDate = buildTargetDate(opt.offset);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dayTabPill, isActive && styles.dayTabPillActive]}
                  onPress={() => setDayOffset(opt.offset)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.dayTabPillLabel,
                      isActive && styles.dayTabPillLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={[
                      styles.dayTabPillSub,
                      isActive && styles.dayTabPillSubActive,
                    ]}
                  >
                    {formatShortDate(optDate)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ==================== CONTEXT HINT ==================== */}
          {dayOffset !== 0 && (
            <View
              style={[
                styles.contextHint,
                dayOffset === -1
                  ? { borderLeftColor: T.amber, backgroundColor: T.amberSoft }
                  : { borderLeftColor: T.blue, backgroundColor: T.blueSoft },
              ]}
            >
              <View
                style={[
                  styles.contextHintTag,
                  dayOffset === -1
                    ? { backgroundColor: T.amber }
                    : { backgroundColor: T.blue },
                ]}
              >
                <Text style={styles.contextHintTagText}>
                  {dayOffset === -1 ? 'LATE' : 'ADVANCE'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextHintTitle}>
                  {dayOffset === -1 ? 'Late report' : 'Advance report'}
                </Text>
                <Text style={styles.contextHintText}>
                  {dayOffset === -1
                    ? `Logged for ${formatShortDate(targetDate)}. Use this for classes you couldn't report on time.`
                    : `Logged as advance notice for ${formatShortDate(targetDate)}. Your chair will see it before the class date.`}
                </Text>
              </View>
            </View>
          )}

          {/* ==================== STEP 1 ==================== */}
          <View style={styles.stepHeader}>
            <View style={styles.stepCounter}>
              <Text style={styles.stepCounterText}>
                1 / {showSecondStep ? '3' : '2'}
              </Text>
            </View>
            <Text style={styles.stepEyebrow}>SELECT CLASS</Text>
          </View>

          <Text style={styles.sectionTitle}>Which class are you reporting?</Text>
          <Text style={styles.sectionSubtitle}>
            {dayOffset === -1
              ? "Yesterday's classes that haven't been reported yet."
              : dayOffset === 1
              ? "Tomorrow's scheduled classes."
              : "Today's classes that haven't been reported yet."}
          </Text>

          {pickerLoading ? (
            <View style={styles.pickerGroup}>
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[styles.pickerRow, i < 3 && styles.pickerRowDivided]}
                >
                  <SkeletonCircle size={22} />
                  <View style={{ flex: 1, gap: 6, marginLeft: 12 }}>
                    <Skeleton width="60%" height={14} radius={4} />
                    <Skeleton width="80%" height={12} radius={4} />
                    <Skeleton width="50%" height={11} radius={4} />
                  </View>
                </View>
              ))}
            </View>
          ) : !hasClasses ? (
            <View style={styles.emptyPicker}>
              <View style={styles.emptyPickerIconWrap}>
                <Text style={styles.emptyPickerIconText}>
                  {dayOffset === 1 ? '⌛' : '✓'}
                </Text>
              </View>
              <Text style={styles.emptyPickerTitle}>
                {dayOffset === -1
                  ? 'Nothing to report'
                  : dayOffset === 1
                  ? 'No classes tomorrow'
                  : 'No classes to report'}
              </Text>
              <Text style={styles.emptyPickerText}>{emptyMessage}</Text>
            </View>
          ) : (
            <View style={styles.pickerGroup}>
              {todayClasses.map((cls, idx) => {
                const isSelected = selectedClass?.id === cls.id;
                const isLast = idx === todayClasses.length - 1;
                return (
                  <TouchableOpacity
                    key={cls.id}
                    style={[
                      styles.pickerRow,
                      !isLast && styles.pickerRowDivided,
                      isSelected && styles.pickerRowSelected,
                    ]}
                    onPress={() => setSelectedClass(cls)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.radioOuter,
                        isSelected && styles.radioOuterSelected,
                      ]}
                    >
                      {isSelected && <View style={styles.radioInner} />}
                    </View>

                    <View style={styles.pickerBody}>
                      <View style={styles.pickerTopRow}>
                        <Text
                          style={[
                            styles.pickerCode,
                            isSelected && styles.pickerCodeSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {cls.subject_code}
                        </Text>
                        {!!cls.section && (
                          <View style={styles.pickerSectionPill}>
                            <Text style={styles.pickerSectionPillText}>
                              {cls.section}
                            </Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.pickerMeta} numberOfLines={1}>
                        {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                        {cls.room_name ? ` · ${cls.room_name}` : ''}
                      </Text>

                      {!!cls.course_title && (
                        <Text style={styles.pickerTitle} numberOfLines={1}>
                          {cls.course_title}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {hasClasses && (
            <>
              {/* ==================== INFO BANNER ==================== */}
              <View style={styles.infoBanner}>
                <View style={styles.infoBannerStripe} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoBannerTitle}>
                    Why we ask for the reason
                  </Text>
                  <Text style={styles.infoBannerText}>
                    Reports are reviewed by your Program Chair. Legitimate
                    absences (meetings, medical, emergency) are marked as
                    "excused" so your record stays accurate.
                  </Text>
                </View>
              </View>

              {/* ==================== STEP 2 ==================== */}
              <View style={styles.stepHeader}>
                <View style={styles.stepCounter}>
                  <Text style={styles.stepCounterText}>
                    2 / {showSecondStep ? '3' : '2'}
                  </Text>
                </View>
                <Text style={styles.stepEyebrow}>WHAT HAPPENED</Text>
              </View>

              <Text style={styles.sectionTitle}>What happened?</Text>
              <Text style={styles.sectionSubtitle}>
                Select the option that best describes the situation.
              </Text>

              <View style={styles.reasonList}>
                {CAUSES.map((item) => {
                  const isSelected = cause === item.code;
                  return (
                    <TouchableOpacity
                      key={item.code}
                      style={[
                        styles.reasonCard,
                        isSelected && styles.reasonCardSelected,
                      ]}
                      onPress={() => setCause(item.code)}
                      activeOpacity={0.75}
                    >
                      <View
                        style={[
                          styles.reasonIconBox,
                          isSelected && styles.reasonIconBoxSelected,
                        ]}
                      >
                        <Text style={styles.reasonIconText}>{item.icon}</Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.reasonLabel,
                            isSelected && styles.reasonLabelSelected,
                          ]}
                        >
                          {item.label}
                        </Text>
                        <Text style={styles.reasonHint}>{item.hint}</Text>
                      </View>

                      <View
                        style={[
                          styles.radioOuter,
                          isSelected && styles.radioOuterSelected,
                        ]}
                      >
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ==================== STEP 3 ==================== */}
              {showSecondStep && (
                <>
                  <View style={styles.divider} />

                  <View style={styles.stepHeader}>
                    <View style={styles.stepCounter}>
                      <Text style={styles.stepCounterText}>3 / 3</Text>
                    </View>
                    <Text style={styles.stepEyebrow}>REASON</Text>
                  </View>

                  <Text style={styles.sectionTitle}>
                    Why couldn't you attend?
                  </Text>
                  <Text style={styles.sectionSubtitle}>
                    This determines whether your absence is marked as excused.
                  </Text>

                  <View style={styles.reasonList}>
                    {PROFESSOR_REASONS.map((item) => {
                      const isSelected = profReason === item.code;
                      return (
                        <TouchableOpacity
                          key={item.code}
                          style={[
                            styles.reasonCard,
                            isSelected && styles.reasonCardSelected,
                          ]}
                          onPress={() => setProfReason(item.code)}
                          activeOpacity={0.75}
                        >
                          <View
                            style={[
                              styles.reasonIconBox,
                              isSelected && styles.reasonIconBoxSelected,
                            ]}
                          >
                            <Text style={styles.reasonIconText}>
                              {item.icon}
                            </Text>
                          </View>

                          <View style={{ flex: 1 }}>
                            <View style={styles.reasonTitleRow}>
                              <Text
                                style={[
                                  styles.reasonLabel,
                                  isSelected && styles.reasonLabelSelected,
                                ]}
                              >
                                {item.label}
                              </Text>
                              <View
                                style={[
                                  styles.excuseTag,
                                  item.isExcused
                                    ? { backgroundColor: T.greenSoft }
                                    : { backgroundColor: T.amberSoft },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.excuseTagText,
                                    {
                                      color: item.isExcused
                                        ? T.green
                                        : T.amber,
                                    },
                                  ]}
                                >
                                  {item.isExcused ? 'EXCUSED' : 'UNEXCUSED'}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.reasonHint}>{item.hint}</Text>
                          </View>

                          <View
                            style={[
                              styles.radioOuter,
                              isSelected && styles.radioOuterSelected,
                            ]}
                          >
                            {isSelected && <View style={styles.radioInner} />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* ==================== NOTES ==================== */}
              <View style={styles.stepHeader}>
                <View style={styles.stepCounter}>
                  <Text style={styles.stepCounterText}>
                    {showSecondStep ? '★' : '★'}
                  </Text>
                </View>
                <Text style={styles.stepEyebrow}>
                  {cause === 'other' ? 'REQUIRED' : 'OPTIONAL'}
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Additional notes</Text>
              <Text style={styles.sectionSubtitle}>
                {cause === 'other'
                  ? 'Please describe what happened in detail.'
                  : 'Any context that helps your chair review this report.'}
              </Text>

              <TextInput
                style={styles.notesInput}
                multiline
                numberOfLines={5}
                placeholder={
                  cause === 'other'
                    ? 'Please describe what happened…'
                    : 'E.g., "Meeting with the Dean" or "Sick leave approved"…'
                }
                placeholderTextColor={T.inkFaint}
                value={notes}
                onChangeText={setNotes}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.charCount}>{notes.length}/500</Text>

              {/* ==================== RELEASE ROOM ==================== */}
              {canReleaseRoom && (
                <View style={styles.releaseToggleCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.releaseToggleTitle}>
                      Release this room
                    </Text>
                    <Text style={styles.releaseToggleText}>
                      Let other classes use{' '}
                      <Text style={{ fontWeight: '900' }}>
                        {selectedClass.room_name}
                      </Text>{' '}
                      during this time slot. Turn OFF to keep it reserved.
                    </Text>

                    <View style={styles.releasePreviewRow}>
                      <Text style={styles.releasePreviewLabel}>
                        Room status will show
                      </Text>
                      <View
                        style={[
                          styles.releasePreviewBadge,
                          releaseRoom
                            ? { backgroundColor: T.greenSoft }
                            : { backgroundColor: T.slateSoft },
                        ]}
                      >
                        <View
                          style={[
                            styles.releasePreviewDot,
                            {
                              backgroundColor: releaseRoom
                                ? T.green
                                : T.slate,
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.releasePreviewText,
                            { color: releaseRoom ? T.green : T.slate },
                          ]}
                        >
                          {releaseRoom ? 'AVAILABLE' : 'CANCELLED'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Switch
                    value={releaseRoom}
                    onValueChange={setReleaseRoom}
                    trackColor={{ false: '#E5E7EB', true: '#FFB3B3' }}
                    thumbColor={releaseRoom ? T.crimson : '#F4F4F5'}
                  />
                </View>
              )}

              {!canReleaseRoom && selectedClass && (
                <View style={styles.releaseNotApplicable}>
                  <Text style={styles.releaseNotApplicableText}>
                    This is an online class — no physical room to release.
                  </Text>
                </View>
              )}

              {/* ==================== SUBMIT ==================== */}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  submitDisabled && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={submitDisabled}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color={T.surface} />
                ) : (
                  <Text style={styles.submitButtonText}>
                    Submit Report
                    {selectedClass?.subject_code
                      ? ` · ${selectedClass.subject_code}`
                      : ''}
                  </Text>
                )}
              </TouchableOpacity>

              <Text style={styles.footerNote}>
                Legitimate absences are protected. Only reports marked as
                unexcused will be flagged for review by your Program Chair.
              </Text>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

// ============================================================
// LOADING SKELETON
// ============================================================

const ReportGhostSkeleton = () => (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View style={styles.headerTopRow}>
          <Skeleton width={34} height={34} radius={17} />
          <View style={{ flex: 1, paddingLeft: 12, gap: 6 }}>
            <Skeleton width={60} height={9} radius={3} />
            <Skeleton width={150} height={18} radius={4} />
          </View>
          <View style={{ width: 34 }} />
        </View>
      </View>
    </View>

    <View style={styles.scrollContent}>
      <View style={styles.dayTabsRow}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width="31%" height={62} radius={12} />
        ))}
      </View>

      <Skeleton width={80} height={9} radius={3} style={{ marginTop: 8 }} />
      <Skeleton width="70%" height={16} radius={6} style={{ marginTop: 8 }} />
      <Skeleton width="90%" height={12} radius={4} style={{ marginTop: 6 }} />

      <View style={styles.pickerGroup}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.pickerRow, i < 3 && styles.pickerRowDivided]}
          >
            <SkeletonCircle size={22} />
            <View style={{ flex: 1, gap: 6, marginLeft: 12 }}>
              <Skeleton width="60%" height={14} radius={4} />
              <Skeleton width="80%" height={12} radius={4} />
              <Skeleton width="50%" height={11} radius={4} />
            </View>
          </View>
        ))}
      </View>

      <Skeleton width="100%" height={70} radius={12} style={{ marginTop: 20 }} />

      <Skeleton width={80} height={9} radius={3} style={{ marginTop: 24 }} />
      <Skeleton width="60%" height={16} radius={6} style={{ marginTop: 8 }} />

      <View style={styles.reasonList}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.reasonCard}>
            <SkeletonCircle size={40} />
            <View style={{ flex: 1, gap: 6, marginLeft: 12 }}>
              <Skeleton width="60%" height={14} radius={4} />
              <Skeleton width="80%" height={11} radius={4} />
            </View>
            <SkeletonCircle size={22} />
          </View>
        ))}
      </View>
    </View>
  </View>
);

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.canvas },

  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 34,
    backgroundColor: T.canvas,
  },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  emptyIconRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: T.crimson,
    opacity: 0.35,
  },
  emptyIconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 300,
  },

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

  scrollContent: { padding: 20, paddingBottom: 20 },

  // ==================== DAY TABS ====================
  dayTabsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  dayTabPill: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: T.surface,
    borderWidth: 1.5,
    borderColor: T.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTabPillActive: {
    backgroundColor: T.crimson,
    borderColor: T.crimson,
  },
  dayTabPillLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  dayTabPillLabelActive: { color: '#FFFFFF' },
  dayTabPillSub: {
    fontSize: 10,
    fontWeight: '700',
    color: T.inkFaint,
    letterSpacing: 0.4,
  },
  dayTabPillSubActive: { color: 'rgba(255,255,255,0.85)' },

  // ==================== CONTEXT HINT ====================
  contextHint: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 14,
    marginBottom: 22,
    gap: 12,
    borderLeftWidth: 4,
    alignItems: 'flex-start',
  },
  contextHintTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    marginTop: 1,
  },
  contextHintTagText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  contextHintTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  contextHintText: {
    fontSize: 11,
    color: T.inkSoft,
    lineHeight: 16,
    fontWeight: '500',
  },

  // ==================== STEP HEADER ====================
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
    gap: 10,
  },
  stepCounter: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: T.crimson,
  },
  stepCounterText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  stepEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.inkFaint,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: T.inkMuted,
    marginBottom: 14,
    lineHeight: 17,
    fontWeight: '500',
  },
  optionalText: {
    fontSize: 11,
    fontWeight: '600',
    color: T.inkFaint,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: T.hair,
    marginVertical: 26,
  },

  // ==================== PICKER ====================
  pickerGroup: {
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    marginBottom: 20,
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  pickerRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: T.hair2,
  },
  pickerRowSelected: {
    backgroundColor: '#FFF8F8',
  },
  pickerBody: { flex: 1 },
  pickerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  pickerCode: {
    fontSize: 14,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.1,
  },
  pickerCodeSelected: { color: T.crimson },
  pickerSectionPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.hair2,
  },
  pickerSectionPillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: T.inkMuted,
  },
  pickerMeta: {
    fontSize: 11,
    color: T.inkSoft,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pickerTitle: {
    fontSize: 11,
    color: T.inkMuted,
    marginTop: 3,
    fontWeight: '500',
  },

  // ==================== EMPTY PICKER ====================
  emptyPicker: {
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 32,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyPickerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyPickerIconText: {
    fontSize: 22,
    color: T.green,
    fontWeight: '900',
  },
  emptyPickerTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  emptyPickerText: {
    fontSize: 12,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
  },

  // ==================== INFO BANNER ====================
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: T.blueSoft,
    borderRadius: 12,
    padding: 14,
    marginBottom: 22,
    borderLeftWidth: 4,
    borderLeftColor: T.blue,
    overflow: 'hidden',
  },
  infoBannerStripe: {
    width: 0,
  },
  infoBannerTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#1E3A8A',
    marginBottom: 4,
    letterSpacing: -0.1,
  },
  infoBannerText: {
    fontSize: 11,
    color: '#1E3A8A',
    lineHeight: 16,
    opacity: 0.9,
    fontWeight: '500',
  },

  // ==================== REASON CARDS ====================
  reasonList: { gap: 8, marginBottom: 22 },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: T.hair,
    gap: 12,
  },
  reasonCardSelected: {
    borderColor: T.crimson,
    backgroundColor: '#FFF8F8',
  },
  reasonIconBox: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: T.hair2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonIconBoxSelected: {
    backgroundColor: '#FFE5E5',
  },
  reasonIconText: {
    fontSize: 18,
  },
  reasonTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.1,
  },
  reasonLabelSelected: { color: T.crimson },
  reasonHint: {
    fontSize: 11,
    color: T.inkMuted,
    lineHeight: 15,
    fontWeight: '500',
  },
  excuseTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  excuseTagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  // ==================== RADIO ====================
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: T.crimson },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: T.crimson,
  },

  // ==================== NOTES ====================
  notesInput: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 14,
    fontSize: 13,
    color: T.ink,
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: T.hair,
    lineHeight: 19,
  },
  charCount: {
    fontSize: 10,
    color: T.inkFaint,
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // ==================== RELEASE TOGGLE ====================
  releaseToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.hair,
    borderLeftWidth: 4,
    borderLeftColor: T.amber,
    gap: 14,
  },
  releaseToggleTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 4,
    letterSpacing: -0.1,
  },
  releaseToggleText: {
    fontSize: 11,
    color: T.inkSoft,
    lineHeight: 16,
    fontWeight: '500',
  },
  releasePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  releasePreviewLabel: {
    fontSize: 10,
    color: T.inkFaint,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  releasePreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 5,
  },
  releasePreviewDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  releasePreviewText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  releaseNotApplicable: {
    backgroundColor: T.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.hair,
  },
  releaseNotApplicableText: {
    fontSize: 11,
    color: T.inkMuted,
    fontStyle: 'italic',
    fontWeight: '500',
  },

  // ==================== SUBMIT ====================
  submitButton: {
    backgroundColor: T.crimson,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: '#C4C4C6',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  footerNote: {
    fontSize: 11,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 16,
    fontStyle: 'italic',
    paddingHorizontal: 12,
    fontWeight: '500',
  },

  // ==================== SUCCESS ====================
  successContent: {
    padding: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  successToneStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    marginBottom: 24,
    gap: 8,
  },
  successToneDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: T.green,
  },
  successToneLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: T.green,
  },
  successBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: T.greenSoft,
    borderWidth: 2,
    borderColor: '#BFE3CF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  successBadgeGlyph: {
    fontSize: 38,
    fontWeight: '900',
    color: T.green,
    lineHeight: 40,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
    paddingHorizontal: 12,
    fontWeight: '500',
  },
  statusBanner: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
    borderLeftWidth: 4,
  },
  statusBannerText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statusBannerHint: {
    fontSize: 11,
    color: T.inkSoft,
    opacity: 0.85,
    lineHeight: 16,
    fontWeight: '500',
  },
  releaseBanner: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: T.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingRight: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: T.hair,
    overflow: 'hidden',
  },
  releaseBannerStripe: {
    width: 3,
    backgroundColor: T.amber,
    marginRight: 12,
  },
  releaseBannerTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  releaseBannerText: {
    fontSize: 11,
    color: T.inkMuted,
    lineHeight: 16,
    fontWeight: '500',
  },

  summaryBox: {
    width: '100%',
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 16,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 12,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: T.hair2,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: T.inkFaint,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '800',
    color: T.ink,
    textAlign: 'right',
    flex: 1,
    letterSpacing: -0.1,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: T.crimson,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});

export default ReportGhostScreen;