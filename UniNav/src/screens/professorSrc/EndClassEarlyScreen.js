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
        .eq('faculty_id', user.id);

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
        <StatusBar barStyle="light-content" backgroundColor={T.crimson} />

        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerContent}>
            <View style={styles.headerTopRow}>
              <View style={{ width: 34 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerEyebrow}>FACULTY</Text>
                <Text style={styles.headerTitle}>End Class Early</Text>
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
            <Text style={styles.successToneLabel}>CLASS ENDED</Text>
          </View>

          <View style={styles.successBadge}>
            <Text style={styles.successBadgeGlyph}>✓</Text>
          </View>

          <Text style={styles.successTitle}>Class ended early</Text>
          <Text style={styles.successSubtitle}>
            The room is now available. Your Program Chair will see the reason
            you provided.
          </Text>

          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>CLASS</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {subjectCode || '—'}
                {section ? ` · ${section}` : ''}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>ROOM</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {roomName || '—'}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>ENDED AT</Text>
              <Text style={styles.summaryValue}>
                {formatClock(new Date())}
              </Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>REASON</Text>
              <Text style={styles.summaryValue} numberOfLines={2}>
                {REASONS.find((r) => r.code === reason)?.label || reason}
              </Text>
            </View>

            {!!notes.trim() && (
              <>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>NOTES</Text>
                  <Text style={styles.summaryValue} numberOfLines={4}>
                    {notes.trim()}
                  </Text>
                </View>
              </>
            )}
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
  // FORM
  // ============================================================

  const submitDisabled = submitting || !reason;

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
                <Text style={styles.headerTitle}>End Class Early</Text>
              </View>

              <View style={{ width: 34 }} />
            </View>

            <View style={styles.endedPill}>
              <View style={styles.endedPillDot} />
              <Text style={styles.endedPillText} numberOfLines={1}>
                ENDING NOW · {formatClock(new Date())}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ==================== CLASS INFO ==================== */}
          <View style={styles.classCard}>
            <View style={styles.classEyebrowRow}>
              <View style={styles.classEyebrowChip}>
                <Text style={styles.classEyebrowChipText}>ENDING NOW</Text>
              </View>
            </View>

            <Text style={styles.classSubject}>
              {subjectCode || 'Unknown Subject'}
            </Text>

            <View style={styles.classMetaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>SECTION</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {section || '—'}
                </Text>
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

          {/* ==================== INFO BANNER ==================== */}
          <View style={styles.infoBanner}>
            <View style={styles.infoBannerTag}>
              <Text style={styles.infoBannerTagText}>NOTE</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBannerTitle}>What this does</Text>
              <Text style={styles.infoBannerText}>
                The room frees up from this moment forward. Your Program Chair
                will see the reason. This is{' '}
                <Text style={{ fontWeight: '900' }}>not</Text> a class cancellation
                — the class happened, it just ended early.
              </Text>
            </View>
          </View>

          {/* ==================== STEP 1 ==================== */}
          <View style={styles.stepHeader}>
            <View style={styles.stepCounter}>
              <Text style={styles.stepCounterText}>1 / 2</Text>
            </View>
            <Text style={styles.stepEyebrow}>REASON</Text>
          </View>

          <Text style={styles.sectionTitle}>
            Why is the class ending early?
          </Text>
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

          {/* ==================== STEP 2 ==================== */}
          <View style={styles.stepHeader}>
            <View style={styles.stepCounter}>
              <Text style={styles.stepCounterText}>2 / 2</Text>
            </View>
            <Text style={styles.stepEyebrow}>
              {reason === 'other' ? 'REQUIRED' : 'OPTIONAL'}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Additional notes</Text>
          <Text style={styles.sectionSubtitle}>
            {reason === 'other'
              ? 'Please describe why the class ended early.'
              : 'Any context that helps your chair understand the situation.'}
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
            placeholderTextColor={T.inkFaint}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{notes.length}/500</Text>

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
  container: { flex: 1, backgroundColor: T.canvas },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.canvas,
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
  endedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    gap: 7,
  },
  endedPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFD700',
  },
  endedPillText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  scrollContent: { padding: 20, paddingBottom: 20 },

  // ==================== CLASS CARD ====================
  classCard: {
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.hair,
    padding: 18,
    marginBottom: 18,
  },
  classEyebrowRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  classEyebrowChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: T.amberSoft,
  },
  classEyebrowChipText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.amber,
  },
  classSubject: {
    fontSize: 24,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: -0.5,
  },
  classMetaRow: {
    flexDirection: 'row',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.hair2,
    paddingVertical: 12,
    marginTop: 14,
  },
  metaItem: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  metaDivider: {
    width: 1,
    backgroundColor: T.hair,
    marginVertical: 4,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
  },
  classOriginalTime: {
    fontSize: 11,
    color: T.inkMuted,
    fontStyle: 'italic',
    marginTop: 12,
    textAlign: 'center',
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
    gap: 12,
    alignItems: 'flex-start',
  },
  infoBannerTag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: T.blue,
    marginTop: 1,
  },
  infoBannerTagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#FFFFFF',
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

  // ==================== REASON LIST ====================
  reasonList: { gap: 8, marginBottom: 26 },
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
  reasonLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 2,
    letterSpacing: -0.1,
  },
  reasonLabelSelected: { color: T.crimson },
  reasonHint: {
    fontSize: 11,
    color: T.inkMuted,
    lineHeight: 15,
    fontWeight: '500',
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
    alignItems: 'flex-start',
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
    marginTop: 2,
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

export default EndClassEarlyScreen;