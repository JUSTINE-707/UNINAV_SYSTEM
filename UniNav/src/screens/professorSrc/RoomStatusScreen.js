import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import {
  computeRoomStatus,
  stateColor,
  stateLabel,
} from '../../utils/roomStatus';

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

// ------------------------------------------------------------
// State → token mapping (mirrors utils/roomStatus colors)
// ------------------------------------------------------------
const STATE_TONE = {
  occupied: { color: T.red, bg: T.redSoft },
  vacant: { color: T.amber, bg: T.amberSoft },
  reserved: { color: T.blue, bg: T.blueSoft },
  available: { color: T.green, bg: T.greenSoft },
  released: { color: '#C77700', bg: T.amberSoft },
  closed: { color: T.slate, bg: T.slateSoft },
  ended: { color: T.slate, bg: T.slateSoft },
};

const stateTone = (state) =>
  STATE_TONE[state] || { color: T.slate, bg: T.slateSoft };

// ------------------------------------------------------------
// Per-schedule live status tone (used inside the room modal)
// ------------------------------------------------------------
const SCHEDULE_TONE = {
  ongoing: { color: T.red, bg: T.redSoft },
  vacant: { color: T.amber, bg: T.amberSoft },
  upcoming: { color: T.blue, bg: T.blueSoft },
  ended: { color: T.slate, bg: T.slateSoft },
  ended_early: { color: '#C77700', bg: T.amberSoft },
  cancelled: { color: T.slate, bg: T.slateSoft },
  released: { color: '#C77700', bg: T.amberSoft },
  unknown: { color: T.slate, bg: T.slateSoft },
};

const scheduleTone = (key) =>
  SCHEDULE_TONE[key] || { color: T.slate, bg: T.slateSoft };

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
    const t = new Date(isoString);
    return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

const DAY_LABELS = {
  Sun: 'Sunday',
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  Th: 'Thursday',
  F: 'Friday',
  Sat: 'Saturday',
};

const getTodayCode = () => {
  const map = { 0: 'Sun', 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sat' };
  return map[new Date().getDay()];
};

// ------------------------------------------------------------
// Per-schedule live status (used in the room detail modal)
// ------------------------------------------------------------
const getScheduleState = (sched, session, ghost, nowMin) => {
  const start = timeToMinutes(sched.start_time);
  const end = timeToMinutes(sched.end_time);

  if (ghost?.room_released) {
    return { key: 'released', label: 'RELEASED' };
  }
  if (ghost) {
    return { key: 'cancelled', label: 'CANCELLED' };
  }
  if (session?.ended_at) {
    return { key: 'ended_early', label: 'ENDED EARLY' };
  }
  if (start === null || end === null) {
    return { key: 'unknown', label: '—' };
  }
  if (nowMin > end) {
    return { key: 'ended', label: 'ENDED' };
  }
  if (nowMin >= start && nowMin <= end) {
    if (session) {
      return { key: 'ongoing', label: 'IN PROGRESS' };
    }
    return { key: 'vacant', label: 'NOT CHECKED IN' };
  }
  return { key: 'upcoming', label: 'UPCOMING' };
};

// ============================================================
// SCREEN
// ============================================================

const RoomStatusScreen = () => {
  const navigation = useNavigation();
  const { height: screenHeight } = useWindowDimensions();

  const [statuses, setStatuses] = useState([]);
  const [rawSchedules, setRawSchedules] = useState([]);
  const [sessionsBySchedule, setSessionsBySchedule] = useState({});
  const [ghostsBySchedule, setGhostsBySchedule] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState(null);

  const todayRef = useRef(getTodayCode());

  const sheetHeight = Math.round(screenHeight * 0.85);

  const load = useCallback(async () => {
    try {
      const { data: rooms, error: roomErr } = await supabase
        .from('rooms')
        .select('id, room_code, floor_level, building_id, room_type')
        .not('qr_code', 'is', null)
        .eq('is_teaching_room', true)
        .order('room_code');

      if (roomErr) throw roomErr;

      const { data: rawData, error: dataErr } = await supabase.rpc(
        'get_room_status_data'
      );

      if (dataErr) throw dataErr;

      const sessionsMap = {};
      const ghostsMap = {};

      (rawData || []).forEach((row) => {
        if (row.has_session) {
          sessionsMap[row.id] = {
            id: row.session_id,
            ended_at: row.session_ended_at,
          };
        }
        if (row.ghost_id) {
          ghostsMap[row.id] = {
            id: row.ghost_id,
            room_released: row.ghost_room_released,
          };
        }
      });

      const now = new Date();
      const computed = (rooms || []).map((room) => {
        const status = computeRoomStatus(
          room,
          rawData || [],
          sessionsMap,
          ghostsMap,
          now
        );
        return {
          ...room,
          ...status,
          color: stateColor(status.state),
          label: stateLabel(status.state),
        };
      });

      const order = {
        occupied: 0,
        vacant: 1,
        reserved: 2,
        available: 3,
        released: 4,
        closed: 5,
        ended: 6,
      };
      computed.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

      setStatuses(computed);
      setRawSchedules(rawData || []);
      setSessionsBySchedule(sessionsMap);
      setGhostsBySchedule(ghostsMap);
    } catch (err) {
      console.error('Room status load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const tick = setInterval(() => {
      const code = getTodayCode();
      if (code !== todayRef.current) {
        todayRef.current = code;
        load();
      }
    }, 60000);

    return () => clearInterval(tick);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={T.crimson} />
        <Text style={styles.loadingText}>Loading room status…</Text>
      </View>
    );
  }

  const counts = statuses.reduce((acc, s) => {
    acc[s.state] = (acc[s.state] || 0) + 1;
    return acc;
  }, {});

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayCode = getTodayCode();

  const selectedRoomSchedules = selectedRoom
    ? rawSchedules
        .filter(
          (s) =>
            s.day === todayCode &&
            s.room_name &&
            s.room_name.trim().toUpperCase() ===
              selectedRoom.room_code.trim().toUpperCase()
        )
        .sort(
          (a, b) =>
            (timeToMinutes(a.start_time) || 0) -
            (timeToMinutes(b.start_time) || 0)
        )
    : [];

  const closeModal = () => setSelectedRoom(null);

  const summaryItems = [
    { label: 'OCCUPIED', value: counts.occupied || 0, tone: T.red },
    { label: 'VACANT', value: counts.vacant || 0, tone: T.amber },
    { label: 'RESERVED', value: counts.reserved || 0, tone: T.blue },
    { label: 'AVAILABLE', value: counts.available || 0, tone: T.green },
  ];

  return (
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
              <Text style={styles.headerEyebrow}>LIVE</Text>
              <Text style={styles.headerTitle}>Room Status</Text>
            </View>

            <View style={styles.livePill}>
              <View style={styles.livePillDot} />
              <Text style={styles.livePillText}>UPDATED</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ==================== SUMMARY STRIP ==================== */}
      <View style={styles.summaryStrip}>
        {summaryItems.map((item, i) => (
          <View key={item.label} style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: item.tone }]}>
              {String(item.value).padStart(2, '0')}
            </Text>
            <Text style={styles.summaryLabel}>{item.label}</Text>
            {i < summaryItems.length - 1 && (
              <View style={styles.summaryDivider} />
            )}
          </View>
        ))}
      </View>

      {/* ==================== LIST ==================== */}
      <FlatList
        data={statuses}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={T.crimson}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => {
          const tone = stateTone(item.state);
          const isLast = index === statuses.length - 1;
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setSelectedRoom(item)}
              style={[styles.roomRow, !isLast && styles.roomRowDivided]}
            >
              <View style={[styles.roomRail, { backgroundColor: tone.color }]} />

              <View style={styles.roomBody}>
                <View style={styles.roomNameRow}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {item.room_code}
                  </Text>
                  {item.room_type === 'Gymnasium' && (
                    <View style={styles.largeVenuePill}>
                      <Text style={styles.largeVenueText}>LARGE VENUE</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.roomFloor}>
                  Floor {item.floor_level}
                </Text>

                {!!item.reason && (
                  <Text style={styles.roomReason} numberOfLines={1}>
                    {item.reason}
                  </Text>
                )}
              </View>

              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: tone.bg },
                ]}
              >
                <View
                  style={[
                    styles.statusBadgeDot,
                    { backgroundColor: tone.color },
                  ]}
                />
                <Text
                  style={[styles.statusText, { color: tone.color }]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </View>

              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No rooms found</Text>
          </View>
        }
      />

      {/* ============================================================
          ROOM DETAIL MODAL
          ============================================================ */}
      <Modal
        visible={!!selectedRoom}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          <TouchableWithoutFeedback onPress={closeModal}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={[styles.modalSheet, { height: sheetHeight }]}>
            <View style={styles.modalGrabber} />

            {selectedRoom && (
              <>
                {/* ---- FIXED HEADER ---- */}
                <View style={styles.modalFixedHeader}>
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalEyebrow}>ROOM DETAILS</Text>
                      <Text style={styles.modalRoom}>
                        {selectedRoom.room_code}
                      </Text>
                      <Text style={styles.modalSubtitle}>
                        Floor {selectedRoom.floor_level} ·{' '}
                        {DAY_LABELS[todayCode] || todayCode}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={closeModal}
                      style={styles.modalCloseBtn}
                    >
                      <Text style={styles.modalCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalBadgesRow}>
                    {(() => {
                      const tone = stateTone(selectedRoom.state);
                      return (
                        <View
                          style={[
                            styles.modalStatusBadge,
                            { backgroundColor: tone.bg },
                          ]}
                        >
                          <View
                            style={[
                              styles.modalStatusBadgeDot,
                              { backgroundColor: tone.color },
                            ]}
                          />
                          <Text
                            style={[
                              styles.modalStatusBadgeText,
                              { color: tone.color },
                            ]}
                          >
                            {selectedRoom.label}
                          </Text>
                        </View>
                      );
                    })()}

                    <View style={styles.modalCountBadge}>
                      <Text style={styles.modalCountBadgeText}>
                        {selectedRoomSchedules.length}{' '}
                        {selectedRoomSchedules.length === 1
                          ? 'class today'
                          : 'classes today'}
                      </Text>
                    </View>
                  </View>

                  {!!selectedRoom.reason && (
                    <Text style={styles.modalReason}>
                      {selectedRoom.reason}
                    </Text>
                  )}

                  <Text style={styles.modalSectionLabel}>
                    TODAY'S SCHEDULE
                  </Text>
                </View>

                {/* ---- SCROLLABLE SCHEDULE LIST ---- */}
                <ScrollView
                  style={styles.scheduleScroll}
                  contentContainerStyle={styles.scheduleScrollContent}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  bounces
                >
                  {selectedRoomSchedules.length === 0 ? (
                    <View style={styles.modalEmptyBox}>
                      <Text style={styles.modalEmptyText}>
                        No classes scheduled for this room today.
                      </Text>
                    </View>
                  ) : (
                    selectedRoomSchedules.map((sched) => {
                      const session =
                        sessionsBySchedule[sched.id] || null;
                      const ghost = ghostsBySchedule[sched.id] || null;
                      const state = getScheduleState(
                        sched,
                        session,
                        ghost,
                        nowMin
                      );
                      const tone = scheduleTone(state.key);

                      return (
                        <View key={sched.id} style={styles.schedCard}>
                          <View
                            style={[
                              styles.schedRail,
                              { backgroundColor: tone.color },
                            ]}
                          />

                          <View style={styles.schedBody}>
                            <View style={styles.schedTopRow}>
                              <View
                                style={[
                                  styles.schedBadge,
                                  { backgroundColor: tone.bg },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.schedBadgeText,
                                    { color: tone.color },
                                  ]}
                                >
                                  {state.label}
                                </Text>
                              </View>
                            </View>

                            <Text style={styles.schedSubject}>
                              {sched.subject_code}
                            </Text>
                            {!!sched.course_title && (
                              <Text
                                style={styles.schedTitle}
                                numberOfLines={2}
                              >
                                {sched.course_title}
                              </Text>
                            )}

                            <View style={styles.schedTimeRow}>
                              <View style={styles.schedTimeItem}>
                                <Text style={styles.schedTimeLabel}>START</Text>
                                <Text style={styles.schedTimeValue}>
                                  {formatTime(sched.start_time)}
                                </Text>
                              </View>
                              <View style={styles.schedTimeDivider} />
                              <View style={styles.schedTimeItem}>
                                <Text style={styles.schedTimeLabel}>END</Text>
                                <Text style={styles.schedTimeValue}>
                                  {formatTime(sched.end_time)}
                                </Text>
                              </View>
                            </View>

                            {(!!sched.section || !!sched.professor_name) && (
                              <View style={styles.schedMetaBlock}>
                                {!!sched.section && (
                                  <View style={styles.schedMetaRow}>
                                    <Text style={styles.schedMetaLabel}>
                                      SECTION
                                    </Text>
                                    <Text
                                      style={styles.schedMetaValue}
                                      numberOfLines={1}
                                    >
                                      {sched.section}
                                    </Text>
                                  </View>
                                )}
                                {!!sched.professor_name && (
                                  <View style={styles.schedMetaRow}>
                                    <Text style={styles.schedMetaLabel}>
                                      PROFESSOR
                                    </Text>
                                    <Text
                                      style={styles.schedMetaValue}
                                      numberOfLines={1}
                                    >
                                      {sched.professor_name}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            )}

                            {session?.scanned_at && !session?.ended_at && (
                              <View style={styles.schedNote}>
                                <View
                                  style={[
                                    styles.schedNoteDot,
                                    { backgroundColor: T.green },
                                  ]}
                                />
                                <Text style={styles.schedNoteText}>
                                  Checked in at{' '}
                                  {formatVerifiedTime(session.scanned_at)}
                                </Text>
                              </View>
                            )}
                            {session?.ended_at && (
                              <View style={styles.schedNote}>
                                <View
                                  style={[
                                    styles.schedNoteDot,
                                    { backgroundColor: '#C77700' },
                                  ]}
                                />
                                <Text style={styles.schedNoteText}>
                                  Ended early at{' '}
                                  {formatVerifiedTime(session.ended_at)}
                                </Text>
                              </View>
                            )}
                            {ghost?.room_released && (
                              <View style={styles.schedNote}>
                                <View
                                  style={[
                                    styles.schedNoteDot,
                                    { backgroundColor: '#C77700' },
                                  ]}
                                />
                                <Text style={styles.schedNoteText}>
                                  Room was released by the professor.
                                </Text>
                              </View>
                            )}
                            {ghost && !ghost?.room_released && (
                              <View style={styles.schedNote}>
                                <View
                                  style={[
                                    styles.schedNoteDot,
                                    { backgroundColor: T.slate },
                                  ]}
                                />
                                <Text style={styles.schedNoteText}>
                                  Class was cancelled.
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.canvas },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.canvas,
  },
  loadingText: {
    marginTop: 12,
    color: T.inkMuted,
    fontSize: 13,
    fontWeight: '500',
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
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    gap: 6,
  },
  livePillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7CFC9E',
  },
  livePillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#FFFFFF',
  },

  // ==================== SUMMARY STRIP ====================
  summaryStrip: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    marginTop: -14,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: 'hidden',
  },
  summaryItem: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    position: 'relative',
  },
  summaryDivider: {
    position: 'absolute',
    right: 0,
    top: 12,
    bottom: 12,
    width: 1,
    backgroundColor: T.hair2,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: T.inkFaint,
    marginTop: 3,
    letterSpacing: 1.4,
  },

  // ==================== ROOM LIST ====================
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 40,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    paddingVertical: 14,
    paddingRight: 14,
    overflow: 'hidden',
  },
  roomRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: T.hair2,
  },
  roomRail: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: 12,
    borderRadius: 2,
  },
  roomBody: { flex: 1, paddingRight: 8 },
  roomNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  roomName: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
  },
  roomFloor: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  roomReason: {
    fontSize: 11,
    color: T.inkFaint,
    marginTop: 3,
    fontWeight: '500',
  },

  largeVenuePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.amberSoft,
  },
  largeVenueText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: T.amber,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    gap: 6,
    maxWidth: 130,
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },

  chevron: {
    fontSize: 20,
    color: T.inkFaint,
    fontWeight: '300',
    paddingLeft: 8,
    lineHeight: 20,
  },

  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { color: T.inkMuted, fontSize: 13, fontWeight: '500' },

  // ============================================================
  // ROOM DETAIL MODAL
  // ============================================================
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    overflow: 'hidden',
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    marginBottom: 16,
  },

  modalFixedHeader: {
    paddingHorizontal: 22,
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
    marginBottom: 5,
  },
  modalRoom: {
    fontSize: 28,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.6,
  },
  modalSubtitle: {
    fontSize: 12,
    color: T.inkMuted,
    fontWeight: '600',
    marginTop: 4,
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
    lineHeight: 16,
  },

  modalBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  modalStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    gap: 6,
  },
  modalStatusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modalStatusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  modalCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: T.hair2,
  },
  modalCountBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    color: T.inkSoft,
  },
  modalReason: {
    fontSize: 11,
    color: T.inkMuted,
    fontStyle: 'italic',
    marginBottom: 12,
    fontWeight: '500',
  },
  modalSectionLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.inkFaint,
    marginTop: 6,
    marginBottom: 12,
  },

  scheduleScroll: {
    flex: 1,
    paddingHorizontal: 22,
  },
  scheduleScrollContent: {
    paddingBottom: 40,
  },

  modalEmptyBox: {
    padding: 28,
    backgroundColor: T.hair2,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 12,
    color: T.inkMuted,
    textAlign: 'center',
    fontWeight: '500',
  },

  // ==================== SCHEDULE CARD ====================
  schedCard: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.hair,
    overflow: 'hidden',
    marginBottom: 10,
  },
  schedRail: {
    width: 3,
  },
  schedBody: {
    flex: 1,
    padding: 14,
  },
  schedTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  schedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  schedBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },

  schedSubject: {
    fontSize: 15,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: -0.2,
  },
  schedTitle: {
    fontSize: 13,
    color: T.ink,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 18,
  },

  schedTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  schedTimeItem: {
    flex: 1,
  },
  schedTimeLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    marginBottom: 3,
  },
  schedTimeValue: {
    fontSize: 14,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  schedTimeDivider: {
    width: 1,
    height: 30,
    backgroundColor: T.hair,
    marginHorizontal: 12,
  },

  schedMetaBlock: {
    marginTop: 12,
    gap: 6,
  },
  schedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  schedMetaLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.inkFaint,
    width: 78,
  },
  schedMetaValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: T.inkSoft,
  },

  schedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  schedNoteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  schedNoteText: {
    fontSize: 11,
    color: T.inkMuted,
    fontWeight: '600',
    flex: 1,
  },
});

export default RoomStatusScreen;