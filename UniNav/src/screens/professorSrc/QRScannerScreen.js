import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Vibration,
  useWindowDimensions,
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
  error: T.red,
  warning: T.amber,
};

// Minutes before start_time that a professor may already scan in
const GRACE_MINUTES = 15;

// Fixed scan window size (square)
const FRAME_SIZE = 260;

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
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [mountCamera, setMountCamera] = useState(false);

  const lockRef = useRef(false);

  // Compute the scan window's exact pixel position so it's always centered
  const half = FRAME_SIZE / 2;
  const frameTop = screenH / 2 - half;
  const frameBottom = screenH / 2 + half;
  const frameLeft = screenW / 2 - half;
  const sideW = Math.max(0, frameLeft);

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

      const classType = 'in-person';

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
        <ActivityIndicator size="large" color={T.crimson} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionRoot}>
        <View style={styles.permissionIconWrap}>
          <View style={styles.permissionIconRing} />
          <View style={styles.permissionIconDot} />
        </View>
        <Text style={styles.permissionEyebrow}>CAMERA ACCESS</Text>
        <Text style={styles.permissionTitle}>Permission required</Text>
        <Text style={styles.permissionText}>
          UniNav needs camera access to scan the classroom QR code posted
          on the door.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
          activeOpacity={0.85}
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ============================================================
  // RESULT VIEW
  // ============================================================

  if (result) {
    const isWarning = !result.success && result.severity === 'warning';

    const tone = result.success
      ? {
          accent: T.green,
          soft: T.greenSoft,
          border: '#BFE3CF',
          glyph: '✓',
          label: 'VERIFIED',
        }
      : isWarning
      ? {
          accent: T.amber,
          soft: T.amberSoft,
          border: '#F0D08A',
          glyph: '!',
          label: 'ATTENTION',
        }
      : {
          accent: T.red,
          soft: T.redSoft,
          border: '#F5C2C0',
          glyph: '✕',
          label: 'FAILED',
        };

    return (
      <View style={styles.resultRoot}>
        <ScrollView
          contentContainerStyle={styles.resultContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultToneStrip}>
            <View style={[styles.resultToneDot, { backgroundColor: tone.accent }]} />
            <Text style={[styles.resultToneLabel, { color: tone.accent }]}>
              {tone.label}
            </Text>
          </View>

          <View
            style={[
              styles.resultBadge,
              { backgroundColor: tone.soft, borderColor: tone.border },
            ]}
          >
            <Text style={[styles.resultBadgeGlyph, { color: tone.accent }]}>
              {tone.glyph}
            </Text>
          </View>

          <Text style={styles.resultTitle}>
            {result.success
              ? result.alreadyVerified
                ? 'Already verified'
                : 'Room verified'
              : result.title || 'Verification failed'}
          </Text>

          {result.success ? (
            <>
              <Text style={styles.resultRoom}>{result.room}</Text>

              <View style={styles.resultDivider} />

              <Text style={styles.resultSubject}>
                {result.subject}
                {result.section ? ` · ${result.section}` : ''}
              </Text>
              {!!result.courseTitle && (
                <Text style={styles.resultCourse} numberOfLines={2}>
                  {result.courseTitle}
                </Text>
              )}

              <View style={styles.resultMetaPill}>
                <Text style={styles.resultMetaText}>{result.time}</Text>
              </View>

              <View
                style={[
                  styles.modalityPill,
                  result.classType === 'in-person'
                    ? { backgroundColor: T.amberSoft }
                    : { backgroundColor: T.blueSoft },
                ]}
              >
                <Text
                  style={[
                    styles.modalityText,
                    result.classType === 'in-person'
                      ? { color: T.amber }
                      : { color: T.blue },
                  ]}
                >
                  {result.classType === 'in-person' ? 'FACE-TO-FACE' : 'ONLINE'}
                </Text>
              </View>

              <Text style={styles.resultNote}>
                Room status has been updated. Students can now see this
                class is officially in session.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.resultFailureMessage, { color: tone.accent }]}>
                {result.message}
              </Text>

              {!!result.hint && (
                <View style={styles.resultHintBox}>
                  <Text style={styles.resultHintLabel}>WHAT TO DO</Text>
                  <Text style={styles.resultHintText}>{result.hint}</Text>
                </View>
              )}

              {!!result.debug && (
                <View style={styles.debugBox}>
                  <Text style={styles.debugLabel}>DEV INFO</Text>
                  <Text style={styles.debugText}>{result.debug}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.resultFooter}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={resetScanner}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {result.success ? 'Scan Another' : 'Try Again'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.75}
          >
            <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
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
          {/* -------- Dimming mask: 4 quadrants around a centered square -------- */}

          {/* Top band: full width, from top to just above the frame */}
          <View
            style={[
              styles.dim,
              { top: 0, left: 0, right: 0, height: frameTop },
            ]}
          />

          {/* Bottom band: full width, from just below the frame to bottom */}
          <View
            style={[
              styles.dim,
              { top: frameBottom, left: 0, right: 0, bottom: 0 },
            ]}
          />

          {/* Left band: only in the vertical range of the frame */}
          <View
            style={[
              styles.dim,
              { top: frameTop, left: 0, width: sideW, height: FRAME_SIZE },
            ]}
          />

          {/* Right band: only in the vertical range of the frame */}
          <View
            style={[
              styles.dim,
              { top: frameTop, right: 0, width: sideW, height: FRAME_SIZE },
            ]}
          />

          {/* -------- Centered scan frame (guaranteed square, true center) -------- */}
          <View
            style={[
              styles.scanFrame,
              {
                top: frameTop,
                left: frameLeft,
                width: FRAME_SIZE,
                height: FRAME_SIZE,
              },
            ]}
          >
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          {/* -------- Top instructions -------- */}
          <View style={styles.overlayTop}>
            <Text style={styles.overlayEyebrow}>ROOM VERIFICATION</Text>
            <Text style={styles.overlayTitle}>Scan classroom QR</Text>
            <Text style={styles.overlaySubtitle}>
              Point your camera at the QR code posted on the classroom door.
            </Text>
          </View>

          {/* -------- Bottom hint / processing -------- */}
          <View style={styles.overlayBottom}>
            {processing ? (
              <View style={styles.processingPill}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.processingText}>Verifying room…</Text>
              </View>
            ) : (
              <View style={styles.hintPill}>
                <Text style={styles.hintText}>
                  {mountCamera
                    ? 'Align the QR code within the frame'
                    : 'Starting camera…'}
                </Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.cancelButtonTop}
          onPress={() => navigation.goBack()}
          activeOpacity={0.75}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.cancelButtonTopText}>✕</Text>
        </TouchableOpacity>
      </View>
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

  // ============================================================
  // PERMISSION
  // ============================================================
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.canvas,
  },
  permissionRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    backgroundColor: T.canvas,
  },
  permissionIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  permissionIconRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: T.crimson,
    opacity: 0.35,
  },
  permissionIconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: T.crimson,
  },
  permissionEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.crimson,
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 28,
    maxWidth: 280,
  },
  permissionButton: {
    backgroundColor: T.crimson,
    paddingHorizontal: 26,
    paddingVertical: 15,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // ============================================================
  // SCANNER
  // ============================================================
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },

  // Dimming quadrants — absolute so we can precisely shape the cutout
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  // The scan frame itself — absolute, sized and positioned via inline style
  scanFrame: {
    position: 'absolute',
  },
  corner: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderColor: '#FFD700',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },

  overlayTop: {
    position: 'absolute',
    top: 90,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  overlayEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFD700',
    opacity: 0.9,
    marginBottom: 10,
  },
  overlayTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  overlaySubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.8,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  processingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.7)',
    gap: 10,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  hintPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintText: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.92,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  cancelButtonTop: {
    position: 'absolute',
    top: 52,
    left: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonTopText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
  },

  // ============================================================
  // RESULT
  // ============================================================
  resultRoot: {
    flex: 1,
    backgroundColor: T.canvas,
  },
  resultContent: {
    padding: 24,
    paddingTop: 70,
    alignItems: 'center',
  },

  resultToneStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    marginBottom: 26,
    gap: 8,
  },
  resultToneDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  resultToneLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
  },

  resultBadge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  resultBadgeGlyph: {
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 42,
  },

  resultTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.4,
    marginBottom: 22,
    textAlign: 'center',
  },

  resultRoom: {
    fontSize: 32,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: -0.8,
    marginBottom: 6,
  },

  resultDivider: {
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: T.hair,
    marginVertical: 18,
  },

  resultSubject: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  resultCourse: {
    fontSize: 13,
    color: T.inkMuted,
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  resultMetaPill: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
  },
  resultMetaText: {
    fontSize: 12,
    fontWeight: '800',
    color: T.inkSoft,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },

  modalityPill: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  modalityText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  resultNote: {
    fontSize: 12,
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: 22,
    fontStyle: 'italic',
    lineHeight: 17,
    paddingHorizontal: 12,
  },

  resultFailureMessage: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  resultHintBox: {
    alignSelf: 'stretch',
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    borderLeftWidth: 3,
    borderLeftColor: T.amber,
  },
  resultHintLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: T.inkFaint,
    marginBottom: 6,
  },
  resultHintText: {
    fontSize: 12,
    color: T.inkSoft,
    lineHeight: 18,
    fontWeight: '500',
  },

  debugBox: {
    alignSelf: 'stretch',
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
    backgroundColor: T.slateSoft,
    borderWidth: 1,
    borderColor: T.hair,
  },
  debugLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: T.inkFaint,
    marginBottom: 6,
  },
  debugText: {
    fontSize: 11,
    color: T.inkSoft,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },

  resultFooter: {
    padding: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.hair,
    backgroundColor: T.canvas,
  },
  primaryButton: {
    backgroundColor: T.crimson,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.hair,
    backgroundColor: T.surface,
  },
  secondaryButtonText: {
    color: T.ink,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});

export default QRScannerScreen;