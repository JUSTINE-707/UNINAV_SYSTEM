import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  DAY_CODES,
  timeToMinutes,
  formatTime,
  normalizeText,
} from '../../utils/scheduleHelpers';

const COLORS = {
  primary: '#8B0000',
  white: '#FFFFFF',
  black: '#1C1C1E',
  gray: '#9A9A9E',
  lightGray: '#E8E5DF',
  background: '#F7F5F2',
  success: '#2E8B22',
  error: '#B00020',
  warning: '#B26A00',
};

// Minutes before start_time that a professor may already scan in
const GRACE_MINUTES = 15;

// ============================================================
// ERROR HANDLING
// ============================================================

class ScanError extends Error {
  constructor(code, title, message, hint = '', severity = 'warning') {
    super(message);
    this.name = 'ScanError';
    this.code = code;
    this.title = title;
    this.hint = hint;
    this.severity = severity;
  }
}

const toScanFailure = (err) => {
  if (err instanceof ScanError) {
    return {
      code: err.code,
      title: err.title,
      message: err.message,
      hint: err.hint,
      severity: err.severity,
    };
  }

  const msg = (err?.message || '').toString();
  const pgCode = err?.code;

  if (/network request failed|failed to fetch|timed? ?out/i.test(msg)) {
    return {
      code: 'NETWORK',
      title: 'No connection',
      message: "We couldn't reach the server.",
      hint: 'Check your internet connection and try again.',
      severity: 'error',
    };
  }

  if (pgCode === '42501') {
    return {
      code: 'PERMISSION',
      title: 'Access denied',
      message: "Your account isn't allowed to do that.",
      hint: 'Please contact your administrator.',
      severity: 'error',
    };
  }

  if (pgCode === '42P01' || pgCode === 'PGRST205') {
    return {
      code: 'NOT_SET_UP',
      title: 'Feature not ready',
      message: 'Room verification is not set up on the server yet.',
      hint: 'Please contact your administrator.',
      severity: 'error',
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'Something went wrong',
    message: "We couldn't verify this room.",
    hint: 'Please try again. If it keeps happening, report it to your administrator.',
    severity: 'error',
  };
};

const pickNextClass = (list, nowMin) => {
  return (
    [...list]
      .filter((s) => {
        const end = timeToMinutes(s.end_time);
        return end !== null && nowMin <= end;
      })
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))[0] ||
    null
  );
};

// ============================================================
// SCREEN
// ============================================================

const QRScannerScreen = () => {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { user } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [mountCamera, setMountCamera] = useState(false);

  const lockRef = useRef(false);

  // Black-preview fix (Android)
  useEffect(() => {
    if (!permission?.granted || !isFocused) {
      setMountCamera(false);
      return;
    }
    const t = setTimeout(() => setMountCamera(true), 300);
    return () => clearTimeout(t);
  }, [permission?.granted, isFocused]);

  // ============================================================
  // HANDLE SCAN
  // ============================================================

  const handleBarCodeScanned = async ({ data }) => {
    if (lockRef.current) return;
    lockRef.current = true;

    Vibration.vibrate(80);
    setScanning(false);
    setProcessing(true);

    let debugInfo = '';

    try {
      const scannedValue = (data ?? '').toString().trim();

      // 1. Look up the room by qr_code
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_code, floor_level, building_id')
        .eq('qr_code', scannedValue)
        .maybeSingle();

      if (roomError) throw roomError;
      if (!room) {
        debugInfo = `scanned: ${
          scannedValue.length > 40 ? `${scannedValue.slice(0, 40)}…` : scannedValue
        }`;
        throw new ScanError(
          'UNKNOWN_QR',
          'Unrecognized QR code',
          "This isn't a UniNav classroom QR code.",
          'Scan the QR code posted at the classroom door.',
          'warning'
        );
      }

      // 2. Who is scanning?
      const [facultyRes, userRes] = await Promise.all([
        supabase
          .from('faculty')
          .select('id, employee_id')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      if (facultyRes.error) throw facultyRes.error;
      if (userRes.error) throw userRes.error;

      const faculty = facultyRes.data;
      const fullName = userRes.data?.full_name;

      if (!faculty || !fullName) {
        throw new ScanError(
          'NO_PROFILE',
          'Profile not found',
          "We couldn't find your faculty profile.",
          'Log out and back in. If it persists, contact your administrator.',
          'error'
        );
      }

      // 3. Today's day code
      const now = new Date();
      const todayCode = DAY_CODES[now.getDay()];
      if (!todayCode) {
        throw new ScanError(
          'NO_CLASSES_SUNDAY',
          'No classes today',
          'There are no classes scheduled on Sundays.',
          '',
          'warning'
        );
      }
      const nowMin = now.getHours() * 60 + now.getMinutes();

      // 4. Today's schedules
      const { data: schedules, error: schedError } = await supabase
        .from('schedules')
        .select(
          'id, subject_code, course_title, section, day, start_time, end_time, room_name, professor_name'
        )
        .eq('day', todayCode);

      if (schedError) throw schedError;

      const myName = normalizeText(fullName);
      const scannedRoom = normalizeText(room.room_code);

      const mine = (schedules || []).filter(
        (s) => normalizeText(s.professor_name) === myName
      );
      const inRoom = mine.filter(
        (s) => normalizeText(s.room_name) === scannedRoom
      );

      debugInfo =
        `day: ${todayCode} | now: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}\n` +
        `schedules today: ${(schedules || []).length} | mine: ${mine.length} | in this room: ${inRoom.length}\n` +
        `my name: ${myName}\n` +
        `room: ${scannedRoom}` +
        (mine.length
          ? `\nmy rooms: ${mine.map((s) => normalizeText(s.room_name)).join(', ')}`
          : '');

      if (mine.length === 0) {
        throw new ScanError(
          'NO_CLASSES_TODAY',
          'No classes found',
          'We found no classes under your name for today.',
          'If you do have classes today, your registered name may not match the schedule. Ask your Program Chair to check it.',
          'warning'
        );
      }

      if (inRoom.length === 0) {
        const next = pickNextClass(mine, nowMin);
        throw new ScanError(
          'WRONG_ROOM',
          'Wrong room',
          `You scanned ${room.room_code}, but you have no class in this room today.`,
          next
            ? `Your ${next.subject_code} (${next.section}) class is in ${
                next.room_name || 'an unassigned room'
              } at ${formatTime(next.start_time)}.`
            : 'All your classes for today have already ended.',
          'warning'
        );
      }

      const activeSchedule = inRoom.find((s) => {
        const start = timeToMinutes(s.start_time);
        const end = timeToMinutes(s.end_time);
        if (start === null || end === null) return false;
        return nowMin >= start - GRACE_MINUTES && nowMin <= end;
      });

      if (!activeSchedule) {
        const upcoming = inRoom
          .filter((s) => {
            const start = timeToMinutes(s.start_time);
            return start !== null && nowMin < start - GRACE_MINUTES;
          })
          .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))[0];

        if (upcoming) {
          throw new ScanError(
            'TOO_EARLY',
            'Too early to verify',
            `Your ${upcoming.subject_code} class in ${room.room_code} starts at ${formatTime(
              upcoming.start_time
            )}.`,
            `You can verify up to ${GRACE_MINUTES} minutes before the class starts.`,
            'warning'
          );
        }

        const last = [...inRoom].sort(
          (a, b) => timeToMinutes(b.end_time) - timeToMinutes(a.end_time)
        )[0];
        throw new ScanError(
          'CLASS_ENDED',
          'Class already ended',
          `Your ${last.subject_code} class in ${room.room_code} ended at ${formatTime(
            last.end_time
          )}.`,
          'Room verification is only available during class time.',
          'warning'
        );
      }

      // 5. Determine class type (scanning physical QR = in-person)
      const classType = 'in-person';

      // 6. Save the room session.
      //    scanned_at is auto-populated by the DB default.
      const { error: insertError } = await supabase
        .from('room_sessions')
        .insert({
          schedule_id: activeSchedule.id,
          faculty_id: faculty.id,
          room_id: room.id,
          class_type: classType,
          status: 'ongoing',
        });

      if (insertError) {
        console.error('[QR scan] insert error:', insertError);
        throw insertError;
      }

      setResult({
        success: true,
        alreadyVerified: false,
        room: room.room_code,
        subject: activeSchedule.subject_code,
        section: activeSchedule.section,
        courseTitle: activeSchedule.course_title,
        classType,
        time: `${formatTime(activeSchedule.start_time)} – ${formatTime(
          activeSchedule.end_time
        )}`,
      });
    } catch (err) {
      const failure = toScanFailure(err);

      if (err instanceof ScanError) {
        console.log(`[QR scan] ${failure.code}: ${failure.message}`);
      } else {
        console.error('[QR scan] unexpected error:', err);
      }

      setResult({
        success: false,
        ...failure,
        debug: __DEV__ ? debugInfo || (err?.message ?? '') : '',
      });
    } finally {
      setProcessing(false);
    }
  };

  // ============================================================
  // RESET
  // ============================================================

  const resetScanner = () => {
    lockRef.current = false;
    setScanning(true);
    setProcessing(false);
    setResult(null);
  };

  // ============================================================
  // PERMISSION
  // ============================================================

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permText}>
          UniNav needs camera access to scan classroom QR codes.
        </Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ============================================================
  // RESULT VIEW
  // ============================================================

  if (result) {
    const isWarning = !result.success && result.severity === 'warning';
    const accentColor = result.success
      ? COLORS.success
      : isWarning
      ? COLORS.warning
      : COLORS.error;

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.resultContent}
      >
        <View
          style={[
            styles.resultCard,
            result.success
              ? styles.resultSuccess
              : isWarning
              ? styles.resultWarning
              : styles.resultError,
          ]}
        >
          <Text style={[styles.resultIcon, { color: accentColor }]}>
            {result.success ? '✓' : isWarning ? '!' : '✕'}
          </Text>
          <Text style={styles.resultTitle}>
            {result.success
              ? result.alreadyVerified
                ? 'Already Verified'
                : 'Room Verified'
              : result.title || 'Verification Failed'}
          </Text>

          {result.success ? (
            <>
              <Text style={styles.resultRoom}>{result.room}</Text>
              <Text style={styles.resultSubject}>
                {result.subject} · {result.section}
              </Text>
              <Text style={styles.resultCourse}>{result.courseTitle}</Text>
              <Text style={styles.resultTime}>{result.time}</Text>

              <View style={styles.badgeRow}>
                <View style={styles.badgeF2F}>
                  <Text style={styles.badgeText}>
                    ● {result.classType === 'in-person' ? 'FACE-TO-FACE' : 'ONLINE'}
                  </Text>
                </View>
              </View>

              <Text style={styles.resultNote}>
                Room status has been updated. Students can now see this class is officially in session.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.resultErrorText, { color: accentColor }]}>
                {result.message}
              </Text>
              {!!result.hint && (
                <Text style={styles.resultHint}>{result.hint}</Text>
              )}
              {!!result.debug && (
                <View style={styles.debugBox}>
                  <Text style={styles.debugTitle}>DEV INFO</Text>
                  <Text style={styles.debugText}>{result.debug}</Text>
                </View>
              )}
            </>
          )}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={resetScanner}>
          <Text style={styles.primaryButtonText}>
            {result.success ? 'Scan Another' : 'Try Again'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ============================================================
  // SCANNER VIEW
  // ============================================================

  return (
    <View style={styles.container}>
      <View style={styles.cameraContainer}>
        {mountCamera && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanning ? handleBarCodeScanned : undefined}
            onMountError={(e) => console.warn('Camera mount error:', e)}
          />
        )}

        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.overlayTop}>
            <Text style={styles.overlayTitle}>Scan Classroom QR</Text>
            <Text style={styles.overlaySubtitle}>
              Point your camera at the QR code posted on the classroom door.
            </Text>
          </View>

          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          <View style={styles.overlayBottom}>
            {processing ? (
              <>
                <ActivityIndicator color={COLORS.white} />
                <Text style={styles.processingText}>Verifying…</Text>
              </>
            ) : (
              <Text style={styles.hintText}>
                {mountCamera ? 'Align the QR code within the frame' : 'Starting camera…'}
              </Text>
            )}
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: 30,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 8,
    textAlign: 'center',
  },
  permText: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    marginBottom: 24,
  },
  permButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },

  cameraContainer: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingTop: 80,
    paddingBottom: 60,
  },
  overlayTop: {
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  overlayTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 6,
  },
  overlaySubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.85,
    textAlign: 'center',
  },
  scanFrame: {
    width: 260,
    height: 260,
    alignSelf: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#FFD700',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  overlayBottom: {
    alignItems: 'center',
  },
  hintText: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.85,
    fontStyle: 'italic',
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  cancelButton: {
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#000',
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  resultContent: {
    padding: 24,
  },
  resultCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
  },
  resultSuccess: {
    backgroundColor: '#EAF6EC',
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  resultError: {
    backgroundColor: '#FDECEC',
    borderWidth: 2,
    borderColor: COLORS.error,
  },
  resultIcon: {
    fontSize: 56,
    fontWeight: '900',
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 16,
  },
  resultRoom: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.primary,
    marginBottom: 4,
  },
  resultSubject: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.black,
    marginTop: 8,
  },
  resultCourse: {
    fontSize: 13,
    color: COLORS.gray,
    marginTop: 2,
  },
  resultTime: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
    marginTop: 12,
  },
  badgeRow: {
    marginTop: 16,
  },
  badgeF2F: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.black,
  },
  resultNote: {
    fontSize: 12,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  },
  resultWarning: {
    backgroundColor: '#FFF6E0',
    borderWidth: 2,
    borderColor: '#E0A800',
  },
  resultErrorText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.error,
    textAlign: 'center',
    lineHeight: 21,
  },
  resultHint: {
    fontSize: 13,
    color: COLORS.black,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 19,
  },
  debugBox: {
    alignSelf: 'stretch',
    marginTop: 20,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  debugTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.gray,
    marginBottom: 4,
  },
  debugText: {
    fontSize: 11,
    color: COLORS.black,
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  secondaryButtonText: {
    color: COLORS.black,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default QRScannerScreen;