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
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';

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
};

// Reasons the professor can pick. Codes must match END_REASONS
// in utils/roomStatus.js.
const REASONS = [
  {
    code: 'urgent_meeting',
    label: 'Urgent meeting',
    hint: 'Called into a meeting, emergency faculty meeting, or official duty.',
    icon: '📅',
  },
  {
    code: 'medical',
    label: 'Medical / emergency',
    hint: 'Feeling unwell, medical situation, or a personal emergency.',
    icon: '🏥',
  },
  {
    code: 'finished_early',
    label: 'Class finished early',
    hint: 'Covered the material ahead of schedule — nothing left to teach.',
    icon: '✓',
  },
  {
    code: 'other',
    label: 'Other reason',
    hint: 'Describe the situation in the notes below.',
    icon: '⋯',
  },
];

const formatTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

const formatClock = (date) =>
  date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const EndClassEarlyScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();

  const {
    scheduleId,
    sessionId,
    subjectCode,
    section,
    roomName,
    startTime,
    endTime,
  } = route.params || {};

  const [reason, setReason] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Sanity check: params must be present
  useEffect(() => {
    if (!scheduleId || !sessionId) {
      Alert.alert(
        'Missing data',
        'Cannot end this class — class or session info is missing.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  }, [scheduleId, sessionId, navigation]);

  const handleSubmit = async () => {
    if (!reason) {
      Alert.alert('Reason required', 'Please pick a reason for ending early.');
      return;
    }

    if (reason === 'other' && !notes.trim()) {
      Alert.alert(
        'Description required',
        'Please describe why you ended the class early.'
      );
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'No logged-in faculty account found.');
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('room_sessions')
        .update({
          ended_at: new Date().toISOString(),
          end_reason: reason,
          end_notes: notes.trim() || null,
        })
        .eq('id', sessionId)
        .eq('faculty_id', user.id); // RLS-safe guard

      if (error) throw error;

      setSubmitted(true);
    } catch (err) {
      console.error('[EndClassEarly] update error:', err);
      Alert.alert(
        'Could not end class',
        err?.message || 'Something went wrong. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // SUCCESS
  // ============================================================

  if (submitted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successCard}>
            <View style={styles.successIconCircle}>
              <Text style={styles.successIcon}>✓</Text>
            </View>

            <Text style={styles.successTitle}>Class Ended Early</Text>
            <Text style={styles.successSubtitle}>
              The room is now available. Your Program Chair will see the
              reason you provided.
            </Text>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryBoxLabel}>CLASS</Text>
              <Text style={styles.summaryBoxValue}>
                {subjectCode || '—'} · {section || '—'}
              </Text>

              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>
                ROOM
              </Text>
              <Text style={styles.summaryBoxValue}>{roomName || '—'}</Text>

              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>
                ENDED AT
              </Text>
              <Text style={styles.summaryBoxValue}>
                {formatClock(new Date())}
              </Text>

              <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>
                REASON
              </Text>
              <Text style={styles.summaryBoxValue}>
                {REASONS.find((r) => r.code === reason)?.label || reason}
              </Text>

              {!!notes.trim() && (
                <>
                  <Text style={[styles.summaryBoxLabel, { marginTop: 12 }]}>
                    NOTES
                  </Text>
                  <Text style={styles.summaryBoxValue}>{notes.trim()}</Text>
                </>
              )}
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
  // FORM
  // ============================================================

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
            <Text style={styles.headerTitle}>End Class Early</Text>
          </View>

          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* CLASS INFO */}
          <View style={styles.classCard}>
            <Text style={styles.classCardEyebrow}>ENDING NOW</Text>
            <Text style={styles.classSubject}>
              {subjectCode || 'Unknown Subject'}
            </Text>

            <View style={styles.classMetaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>SECTION</Text>
                <Text style={styles.metaValue}>{section || '—'}</Text>
              </View>
              <View style={styles.metaDivider} />
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>ROOM</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {roomName || '—'}
                </Text>
              </View>
              <View style={styles.metaDivider} />
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>ENDED AT</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {formatClock(new Date())}
                </Text>
              </View>
            </View>

            {!!startTime && !!endTime && (
              <Text style={styles.classOriginalTime}>
                Originally scheduled {formatTime(startTime)} –{' '}
                {formatTime(endTime)}
              </Text>
            )}
          </View>

          {/* INFO BANNER */}
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerIcon}>🔓</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBannerTitle}>
                What this does
              </Text>
              <Text style={styles.infoBannerText}>
                The room frees up from this moment forward. Your Program Chair
                will see the reason. This is <Text style={{ fontWeight: '900' }}>not</Text> a
                ghost report — the class happened, it just ended early.
              </Text>
            </View>
          </View>

          {/* REASON */}
          <Text style={styles.stepLabel}>STEP 1 OF 2</Text>
          <Text style={styles.sectionTitle}>Why is the class ending early?</Text>
          <Text style={styles.sectionSubtitle}>
            Select the option that best describes the situation.
          </Text>

          <View style={styles.reasonList}>
            {REASONS.map((item) => {
              const isSelected = reason === item.code;
              return (
                <TouchableOpacity
                  key={item.code}
                  style={[
                    styles.reasonCard,
                    isSelected && styles.reasonCardSelected,
                  ]}
                  onPress={() => setReason(item.code)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.reasonIconBox,
                      isSelected && styles.reasonIconBoxSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.reasonIconText,
                        isSelected && styles.reasonIconTextSelected,
                      ]}
                    >
                      {item.icon}
                    </Text>
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

          {/* NOTES */}
          <Text style={styles.stepLabel}>STEP 2 OF 2</Text>
          <Text style={styles.sectionTitle}>
            Additional Notes{' '}
            <Text style={styles.optionalText}>
              ({reason === 'other' ? 'required' : 'optional'})
            </Text>
          </Text>

          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={5}
            placeholder={
              reason === 'other'
                ? 'Please describe why the class ended early…'
                : 'E.g., "Called into a dean\'s meeting" or "Sudden migraine"…'
            }
            placeholderTextColor={COLORS.gray}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{notes.length}/500</Text>

          {/* SUBMIT */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (submitting || !reason) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting || !reason}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.submitButtonText}>End class now</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            This action cannot be undone. If the class needs to resume, start
            a new session by scanning the room QR again.
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },

  // HEADER
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

  scrollContent: { padding: 16 },

  // CLASS CARD
  classCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  classCardEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: COLORS.gray,
    marginBottom: 6,
  },
  classSubject: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
  },
  classMetaRow: {
    flexDirection: 'row',
    backgroundColor: '#F7F5F2',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  metaItem: { flex: 1, alignItems: 'center' },
  metaDivider: { width: 1, backgroundColor: '#E5E5E7' },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: COLORS.gray,
    marginBottom: 2,
  },
  metaValue: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  classOriginalTime: {
    fontSize: 11,
    color: COLORS.gray,
    fontStyle: 'italic',
    marginTop: 10,
    textAlign: 'center',
  },

  // INFO BANNER
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
  infoBannerIcon: { fontSize: 20 },
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
    opacity: 0.9,
  },

  // STEPS
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

  // REASON LIST
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

  // NOTES
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

  // SUBMIT
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

  // SUCCESS
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

export default EndClassEarlyScreen;