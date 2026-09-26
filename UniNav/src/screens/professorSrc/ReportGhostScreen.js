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

const COLORS = {
  primary: '#8B0000',
  white: '#FFFFFF',
  black: '#1A1A1A',
  gray: '#9A9A9E',
  lightGray: '#E8E5DF',
  background: '#F5F5F7',
  success: '#059669',
  warning: '#C77700',
  error: '#B00020',
  online: '#1E88E5',
  excused: '#059669',
  excusedBg: '#EAF6EC',
  unexcused: '#B26A00',
  unexcusedBg: '#FFF6E0',
  neutral: '#6B7280',
  neutralBg: '#F3F4F6',
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
  const [releaseRoom, setReleaseRoom] = useState(false);
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
    setReleaseRoom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset]);

  useEffect(() => {
    setReleaseRoom(false);
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
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successCard}>
            <View style={styles.successIconCircle}>
              <Text style={styles.successIcon}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Report Submitted</Text>
            <Text style={styles.successSubtitle}>
              Your report has been sent to your Program Chair and Admin.
            </Text>

            {cause === 'professor' && (
              <View
                style={[
                  styles.statusBanner,
                  isExcused ? styles.statusBannerExcused : styles.statusBannerUnexcused,
                ]}
              >
                <Text
                  style={[
                    styles.statusBannerText,
                    isExcused ? styles.statusTextExcused : styles.statusTextUnexcused,
                  ]}
                >
                  {isExcused ? '✓ Marked as EXCUSED absence' : '! Marked as UNEXCUSED absence'}
                </Text>
                <Text style={styles.statusBannerHint}>
                  {isExcused
                    ? 'Your absence has been classified as legitimate.'
                    : 'This will be reviewed by your Program Chair.'}
                </Text>
              </View>
            )}

            {releaseRoom && (
              <View style={styles.releaseBanner}>
                <Text style={styles.releaseBannerIcon}>🔓</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.releaseBannerTitle}>Room released</Text>
                  <Text style={styles.releaseBannerText}>
                    {selectedClass?.room_name} is now shown as available for the scheduled time. Other classes may use it.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.summaryBox}>
              <Text style={styles.summaryBoxLabel}>CLASS</Text>
              <Text style={styles.summaryBoxValue}>
                {selectedClass?.subject_code || '—'} · {selectedClass?.section || '—'}
              </Text>
              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>DATE</Text>
              <Text style={styles.summaryBoxValue}>
                {dayLabel} · {formatShortDate(targetDate)}
              </Text>
              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>TIME</Text>
              <Text style={styles.summaryBoxValue}>
                {selectedClass?.start_time
                  ? `${formatTime(selectedClass.start_time)} – ${formatTime(selectedClass.end_time)}`
                  : '—'}
              </Text>
              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>REASON</Text>
              <Text style={styles.summaryBoxValue}>
                {cause === 'professor'
                  ? PROFESSOR_REASONS.find((r) => r.code === profReason)?.label
                  : CAUSES.find((c) => c.code === cause)?.label}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('ProfessorDashboard')}
            >
              <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
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
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerEyebrow}>FACULTY</Text>
            <Text style={styles.headerTitle}>Report Ghost Class</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyPickerIcon}>📚</Text>
          <Text style={styles.emptyPickerTitle}>No active semester</Text>
          <Text style={styles.emptyPickerText}>
            There's no semester open right now. Please contact the admin to activate one before reporting classes.
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerEyebrow}>FACULTY</Text>
            <Text style={styles.headerTitle}>Report Ghost Class</Text>
            {semester && (
              <Text style={styles.headerSemester} numberOfLines={1}>{semester.name}</Text>
            )}
          </View>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.dayTabsRow}>
            {DAY_OPTIONS.map((opt) => {
              const isActive = dayOffset === opt.offset;
              const optDate = buildTargetDate(opt.offset);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dayTabPill, isActive && styles.dayTabPillActive]}
                  onPress={() => setDayOffset(opt.offset)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayTabPillLabel, isActive && styles.dayTabPillLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.dayTabPillSub, isActive && styles.dayTabPillSubActive]}>
                    {formatShortDate(optDate)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {dayOffset !== 0 && (
            <View
              style={[
                styles.contextHint,
                dayOffset === -1 ? styles.contextHintLate : styles.contextHintAdvance,
              ]}
            >
              <Text style={styles.contextHintIcon}>{dayOffset === -1 ? '⏪' : '⏩'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextHintTitle}>
                  {dayOffset === -1 ? 'Late report' : 'Advance report'}
                </Text>
                <Text style={styles.contextHintText}>
                  {dayOffset === -1
                    ? `This will be logged as a report for ${formatShortDate(targetDate)}. Use this for classes you couldn't report on time.`
                    : `This will be logged as an advance notice for ${formatShortDate(targetDate)}. Your chair will see it before the class date.`}
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.stepLabel}>
            STEP 1 OF {showSecondStep ? '3' : '2'}
          </Text>
          <Text style={styles.sectionTitle}>Which class are you reporting?</Text>
          <Text style={styles.sectionSubtitle}>
            {dayOffset === -1
              ? "Yesterday's classes that haven't been reported yet."
              : dayOffset === 1
              ? "Tomorrow's scheduled classes."
              : "Today's classes that haven't been reported yet."}
          </Text>

          {pickerLoading ? (
            <View style={styles.pickerList}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={styles.pickerRow}>
                  <SkeletonCircle size={22} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width="60%" height={14} radius={4} />
                    <Skeleton width="80%" height={12} radius={4} />
                    <Skeleton width="50%" height={11} radius={4} />
                  </View>
                </View>
              ))}
            </View>
          ) : !hasClasses ? (
            <View style={styles.emptyPicker}>
              <Text style={styles.emptyPickerIcon}>{dayOffset === 1 ? '📅' : '✓'}</Text>
              <Text style={styles.emptyPickerTitle}>
                {dayOffset === -1 ? 'Nothing to report' : dayOffset === 1 ? 'No classes tomorrow' : 'No classes to report'}
              </Text>
              <Text style={styles.emptyPickerText}>{emptyMessage}</Text>
            </View>
          ) : (
            <View style={styles.pickerList}>
              {todayClasses.map((cls) => {
                const isSelected = selectedClass?.id === cls.id;
                return (
                  <TouchableOpacity
                    key={cls.id}
                    style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                    onPress={() => setSelectedClass(cls)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                      {isSelected && <View style={styles.radioInner} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerCode, isSelected && styles.pickerCodeSelected]}>
                        {cls.subject_code} · {cls.section}
                      </Text>
                      <Text style={styles.pickerMeta} numberOfLines={1}>
                        {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                        {cls.room_name ? ` · ${cls.room_name}` : ''}
                      </Text>
                      {!!cls.course_title && (
                        <Text style={styles.pickerTitle} numberOfLines={1}>{cls.course_title}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {hasClasses && (
            <>
              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerIcon}>⚠</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoBannerTitle}>Why we ask for the reason</Text>
                  <Text style={styles.infoBannerText}>
                    Reports are reviewed by your Program Chair. Legitimate absences (meetings, medical, emergency) are marked as "excused" so your record stays accurate.
                  </Text>
                </View>
              </View>

              <Text style={styles.stepLabel}>
                STEP 2 OF {showSecondStep ? '3' : '2'}
              </Text>
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
                      style={[styles.reasonCard, isSelected && styles.reasonCardSelected]}
                      onPress={() => setCause(item.code)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.reasonIconBox, isSelected && styles.reasonIconBoxSelected]}>
                        <Text style={[styles.reasonIconText, isSelected && styles.reasonIconTextSelected]}>
                          {item.icon}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                          {item.label}
                        </Text>
                        <Text style={styles.reasonHint}>{item.hint}</Text>
                      </View>
                      <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {showSecondStep && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepLabel}>STEP 3 OF 3</Text>
                  <Text style={styles.sectionTitle}>Why couldn't you attend?</Text>
                  <Text style={styles.sectionSubtitle}>
                    This determines whether your absence is marked as excused.
                  </Text>

                  <View style={styles.reasonList}>
                    {PROFESSOR_REASONS.map((item) => {
                      const isSelected = profReason === item.code;
                      return (
                        <TouchableOpacity
                          key={item.code}
                          style={[styles.reasonCard, isSelected && styles.reasonCardSelected]}
                          onPress={() => setProfReason(item.code)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.reasonIconBox, isSelected && styles.reasonIconBoxSelected]}>
                            <Text style={[styles.reasonIconText, isSelected && styles.reasonIconTextSelected]}>
                              {item.icon}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={styles.reasonTitleRow}>
                              <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                                {item.label}
                              </Text>
                              <View
                                style={[
                                  styles.excuseTag,
                                  item.isExcused ? styles.excuseTagExcused : styles.excuseTagUnexcused,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.excuseTagText,
                                    item.isExcused ? styles.excuseTagTextExcused : styles.excuseTagTextUnexcused,
                                  ]}
                                >
                                  {item.isExcused ? 'EXCUSED' : 'UNEXCUSED'}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.reasonHint}>{item.hint}</Text>
                          </View>
                          <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                            {isSelected && <View style={styles.radioInner} />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={styles.sectionTitle}>
                Additional Notes{' '}
                <Text style={styles.optionalText}>
                  ({cause === 'other' ? 'required' : 'optional'})
                </Text>
              </Text>

              <TextInput
                style={styles.notesInput}
                multiline
                numberOfLines={5}
                placeholder={cause === 'other' ? 'Please describe what happened…' : 'E.g., "Meeting with the Dean" or "Sick leave approved"…'}
                placeholderTextColor={COLORS.gray}
                value={notes}
                onChangeText={setNotes}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.charCount}>{notes.length}/500</Text>

              {canReleaseRoom && (
                <View style={styles.releaseToggleCard}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.releaseToggleTitleRow}>
                      <Text style={styles.releaseToggleIcon}>🔓</Text>
                      <Text style={styles.releaseToggleTitle}>Release this room</Text>
                    </View>
                    <Text style={styles.releaseToggleText}>
                      Let other classes use{' '}
                      <Text style={{ fontWeight: '900' }}>{selectedClass.room_name}</Text>{' '}
                      during this time slot. Leave OFF if the room should stay reserved for you.
                    </Text>
                  </View>
                  <Switch
                    value={releaseRoom}
                    onValueChange={setReleaseRoom}
                    trackColor={{ false: '#E5E7EB', true: '#FFB3B3' }}
                    thumbColor={releaseRoom ? COLORS.primary : '#F4F4F5'}
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

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (submitting || !cause || (cause === 'professor' && !profReason)) && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={submitting || !cause || (cause === 'professor' && !profReason)}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.submitButtonText}>
                    Submit Report for {selectedClass?.subject_code || '—'}
                  </Text>
                )}
              </TouchableOpacity>

              <Text style={styles.footerNote}>
                Legitimate absences are protected. Only reports marked as unexcused will be flagged for review by your Program Chair.
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
    <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

    <View style={styles.header}>
      <Skeleton width={60} height={22} radius={6} />
      <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
        <Skeleton width={50} height={10} radius={4} />
        <Skeleton width={150} height={18} radius={6} />
      </View>
      <View style={{ width: 60 }} />
    </View>

    <View style={styles.scrollContent}>
      {/* DAY TABS */}
      <View style={styles.dayTabsRow}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width="31%" height={54} radius={12} />
        ))}
      </View>

      {/* STEP 1 HEADER */}
      <Skeleton width={100} height={10} radius={4} />
      <Skeleton width="70%" height={16} radius={6} style={{ marginTop: 8 }} />
      <Skeleton width="90%" height={12} radius={4} style={{ marginTop: 6 }} />

      {/* CLASS PICKER */}
      <View style={styles.pickerList}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.pickerRow}>
            <SkeletonCircle size={22} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="60%" height={14} radius={4} />
              <Skeleton width="80%" height={12} radius={4} />
              <Skeleton width="50%" height={11} radius={4} />
            </View>
          </View>
        ))}
      </View>

      {/* INFO BANNER */}
      <Skeleton width="100%" height={70} radius={12} style={{ marginTop: 20 }} />

      {/* STEP 2 HEADER */}
      <Skeleton width={100} height={10} radius={4} style={{ marginTop: 20 }} />
      <Skeleton width="60%" height={16} radius={6} style={{ marginTop: 8 }} />

      {/* REASON CARDS */}
      <View style={styles.reasonList}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.reasonCard}>
            <SkeletonCircle size={40} />
            <View style={{ flex: 1, gap: 6 }}>
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
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: 30,
  },
  loadingText: { marginTop: 12, color: COLORS.gray, fontSize: 13 },

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

  scrollContent: { padding: 16 },

  dayTabsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  dayTabPill: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  dayTabPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  dayTabPillLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 2,
  },
  dayTabPillLabelActive: { color: '#FFFFFF' },
  dayTabPillSub: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.gray,
    letterSpacing: 0.2,
  },
  dayTabPillSubActive: { color: 'rgba(255,255,255,0.85)' },

  contextHint: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 12,
    borderLeftWidth: 4,
  },
  contextHintLate: {
    backgroundColor: '#FFF6E0',
    borderLeftColor: '#C77700',
  },
  contextHintAdvance: {
    backgroundColor: '#EFF6FF',
    borderLeftColor: '#1E88E5',
  },
  contextHintIcon: { fontSize: 20 },
  contextHintTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 3,
  },
  contextHintText: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 17,
  },

  pickerList: { gap: 10, marginBottom: 20 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  pickerRowSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#FFF8F8',
  },
  pickerCode: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 2,
  },
  pickerCodeSelected: { color: COLORS.primary },
  pickerMeta: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '600',
  },
  pickerTitle: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 3,
    fontStyle: 'italic',
  },
  pickerLoadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  pickerLoadingText: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: '600',
  },
  emptyPicker: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyPickerIcon: {
    fontSize: 32,
    color: COLORS.success,
    marginBottom: 8,
  },
  emptyPickerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 6,
  },
  emptyPickerText: {
    fontSize: 12,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 18,
  },

  infoBanner: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.online,
    gap: 12,
  },
  infoBannerIcon: { fontSize: 20, color: '#1E40AF' },
  infoBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E40AF',
    marginBottom: 3,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
    opacity: 0.85,
  },

  stepLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: COLORS.primary,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 12,
  },
  optionalText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gray,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E7',
    marginVertical: 24,
  },

  reasonList: { gap: 10, marginBottom: 24 },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  reasonCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#FFF8F8',
  },
  reasonIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonIconBoxSelected: { backgroundColor: '#FFE5E5' },
  reasonIconText: { fontSize: 18, color: COLORS.gray },
  reasonIconTextSelected: { color: COLORS.primary },
  reasonTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 2,
  },
  reasonLabelSelected: { color: COLORS.primary },
  reasonHint: {
    fontSize: 11,
    color: COLORS.gray,
    lineHeight: 15,
  },
  excuseTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  excuseTagExcused: { backgroundColor: COLORS.excusedBg },
  excuseTagUnexcused: { backgroundColor: COLORS.unexcusedBg },
  excuseTagText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  excuseTagTextExcused: { color: COLORS.excused },
  excuseTagTextUnexcused: { color: COLORS.unexcused },

  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: COLORS.primary },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },

  notesInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    fontSize: 13,
    color: COLORS.black,
    minHeight: 120,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    marginTop: 8,
  },
  charCount: {
    fontSize: 10,
    color: COLORS.gray,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 24,
  },

  releaseToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8F0',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#C77700',
    gap: 12,
  },
  releaseToggleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  releaseToggleIcon: { fontSize: 16 },
  releaseToggleTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#8A4B00',
  },
  releaseToggleText: {
    fontSize: 11,
    color: '#8A4B00',
    lineHeight: 16,
    opacity: 0.9,
  },
  releaseNotApplicable: {
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  releaseNotApplicableText: {
    fontSize: 11,
    color: COLORS.gray,
    fontStyle: 'italic',
  },

  submitButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#C4C4C6',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footerNote: {
    fontSize: 11,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 16,
    fontStyle: 'italic',
    paddingHorizontal: 12,
  },

  successContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  successIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EAF6EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successIcon: {
    fontSize: 42,
    color: COLORS.success,
    fontWeight: '900',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.black,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  statusBanner: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
  },
  statusBannerExcused: {
    backgroundColor: COLORS.excusedBg,
    borderLeftColor: COLORS.excused,
  },
  statusBannerUnexcused: {
    backgroundColor: COLORS.unexcusedBg,
    borderLeftColor: COLORS.unexcused,
  },
  statusBannerText: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  statusTextExcused: { color: COLORS.excused },
  statusTextUnexcused: { color: COLORS.unexcused },
  statusBannerHint: {
    fontSize: 11,
    color: COLORS.black,
    opacity: 0.75,
    lineHeight: 16,
  },

  releaseBanner: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#FFF8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#C77700',
    gap: 12,
  },
  releaseBannerIcon: { fontSize: 22 },
  releaseBannerTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#8A4B00',
    marginBottom: 3,
  },
  releaseBannerText: {
    fontSize: 11,
    color: '#8A4B00',
    lineHeight: 16,
    opacity: 0.9,
  },

  summaryBox: {
    width: '100%',
    backgroundColor: '#F7F5F2',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  summaryBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: COLORS.gray,
    marginBottom: 2,
  },
  summaryBoxValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.black,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: COLORS.primary,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

export default ReportGhostScreen;