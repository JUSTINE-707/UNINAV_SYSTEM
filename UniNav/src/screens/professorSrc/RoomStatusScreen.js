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
    return { key: 'released', label: 'RELEASED', color: '#C77700' };
  }
  if (ghost) {
    return { key: 'cancelled', label: 'CANCELLED', color: '#6B7280' };
  }
  if (session?.ended_at) {
    return { key: 'ended_early', label: 'ENDED EARLY', color: '#C77700' };
  }
  if (start === null || end === null) {
    return { key: 'unknown', label: '—', color: '#9CA3AF' };
  }
  if (nowMin > end) {
    return { key: 'ended', label: 'ENDED', color: '#9CA3AF' };
  }
  if (nowMin >= start && nowMin <= end) {
    if (session) {
      return { key: 'ongoing', label: 'IN PROGRESS', color: '#B00020' };
    }
    return { key: 'vacant', label: 'NOT CHECKED IN', color: '#D97706' };
  }
  return { key: 'upcoming', label: 'UPCOMING', color: '#3B82F6' };
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

  // Room detail modal
  const [selectedRoom, setSelectedRoom] = useState(null);

  // Track the current day so we can refetch when midnight passes
  const todayRef = useRef(getTodayCode());

  // Definite height for the modal sheet — required for the inner
  // ScrollView to actually scroll reliably on all RN platforms.
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

  // ---- Option A: refetch every time the screen comes into focus ----
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ---- Option B: watch for the day flipping over while mounted ----
  useEffect(() => {
    const tick = setInterval(() => {
      const code = getTodayCode();
      if (code !== todayRef.current) {
        todayRef.current = code;
        // Midnight just passed — refetch so the schedule matches the new day
        load();
      }
    }, 60000); // check once a minute

    return () => clearInterval(tick);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8B0000" />
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#8B0000" />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 60 }}
        >
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.eyebrow}>LIVE</Text>
          <Text style={styles.title}>Room Status</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* SUMMARY */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryChip}>
          <Text style={[styles.summaryNum, { color: '#B00020' }]}>
            {counts.occupied || 0}
          </Text>
          <Text style={styles.summaryLbl}>Occupied</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={[styles.summaryNum, { color: '#D97706' }]}>
            {counts.vacant || 0}
          </Text>
          <Text style={styles.summaryLbl}>Vacant</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={[styles.summaryNum, { color: '#3B82F6' }]}>
            {counts.reserved || 0}
          </Text>
          <Text style={styles.summaryLbl}>Reserved</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={[styles.summaryNum, { color: '#059669' }]}>
            {counts.available || 0}
          </Text>
          <Text style={styles.summaryLbl}>Available</Text>
        </View>
      </View>

      {/* LIST */}
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
          />
        }
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setSelectedRoom(item)}
            style={[styles.roomCard, { borderLeftColor: item.color }]}
          >
            <View style={styles.roomLeft}>
              <View style={styles.roomNameRow}>
                <Text style={styles.roomName}>{item.room_code}</Text>
                {item.room_type === 'Gymnasium' && (
                  <View style={styles.largeVenuePill}>
                    <Text style={styles.largeVenueText}>LARGE VENUE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.roomFloor}>Floor {item.floor_level}</Text>
              {!!item.reason && (
                <Text style={styles.roomReason} numberOfLines={1}>
                  {item.reason}
                </Text>
              )}
            </View>

            <View
              style={[
                styles.statusBadge,
                { backgroundColor: `${item.color}20` },
              ]}
            >
              <Text style={[styles.statusText, { color: item.color }]}>
                {item.label}
              </Text>
            </View>
          </TouchableOpacity>
        )}
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
                    <View
                      style={[
                        styles.modalStatusBadge,
                        { backgroundColor: `${selectedRoom.color}20` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.modalStatusBadgeText,
                          { color: selectedRoom.color },
                        ]}
                      >
                        ● {selectedRoom.label}
                      </Text>
                    </View>

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

                      return (
                        <View
                          key={sched.id}
                          style={[
                            styles.schedCard,
                            { borderLeftColor: state.color },
                          ]}
                        >
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

                          <View style={styles.schedStatusRow}>
                            <View
                              style={[
                                styles.schedBadge,
                                { backgroundColor: `${state.color}20` },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.schedBadgeText,
                                  { color: state.color },
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

                          <View style={styles.schedMetaRow}>
                            {!!sched.section && (
                              <Text style={styles.schedMeta}>
                                <Text style={styles.schedMetaLabel}>
                                  Section:{' '}
                                </Text>
                                {sched.section}
                              </Text>
                            )}
                          </View>

                          {!!sched.professor_name && (
                            <View style={styles.schedMetaRow}>
                              <Text style={styles.schedMeta}>
                                <Text style={styles.schedMetaLabel}>
                                  Professor:{' '}
                                </Text>
                                {sched.professor_name}
                              </Text>
                            </View>
                          )}

                          {session?.scanned_at && !session?.ended_at && (
                            <Text style={styles.schedNote}>
                              Checked in at{' '}
                              {formatVerifiedTime(session.scanned_at)}
                            </Text>
                          )}
                          {session?.ended_at && (
                            <Text style={styles.schedNote}>
                              Ended early at{' '}
                              {formatVerifiedTime(session.ended_at)}
                            </Text>
                          )}
                          {ghost?.room_released && (
                            <Text style={styles.schedNote}>
                              Room was released by the professor.
                            </Text>
                          )}
                          {ghost && !ghost?.room_released && (
                            <Text style={styles.schedNote}>
                              Class was cancelled.
                            </Text>
                          )}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, color: '#6B7280' },

  // HEADER
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 16,
    backgroundColor: '#8B0000',
  },
  back: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#FFF',
    opacity: 0.7,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#FFF' },

  // SUMMARY
  summaryRow: { flexDirection: 'row', padding: 16, gap: 8 },
  summaryChip: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  summaryNum: { fontSize: 20, fontWeight: '900' },
  summaryLbl: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 2,
  },

  // ROOM CARD
  roomCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  roomLeft: { flex: 1 },
  roomNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomName: { fontSize: 15, fontWeight: '900', color: '#1A1A1A' },
  roomFloor: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  roomReason: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 4,
    fontStyle: 'italic',
  },

  // LARGE VENUE BADGE
  largeVenuePill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  largeVenueText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    color: '#92400E',
  },

  // STATUS BADGE
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // EMPTY
  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#9CA3AF', fontSize: 13 },

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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#D1D5DB',
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#8B0000',
    marginBottom: 4,
  },
  modalRoom: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1A1A1A',
    letterSpacing: -0.4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
    marginTop: 4,
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
    marginBottom: 12,
  },
  modalStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  modalStatusBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  modalCountBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
  },
  modalCountBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
    color: '#4B5563',
  },
  modalReason: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  modalSectionLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 10,
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
    backgroundColor: '#F7F5F2',
    borderRadius: 12,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },

  // SCHEDULE CARD
  schedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderLeftWidth: 4,
  },

  schedTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F5F2',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  schedTimeItem: {
    flex: 1,
  },
  schedTimeLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#9A9A9E',
    marginBottom: 2,
  },
  schedTimeValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  schedTimeDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 12,
  },

  schedStatusRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  schedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  schedBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  schedSubject: {
    fontSize: 14,
    fontWeight: '900',
    color: '#8B0000',
    letterSpacing: 0.3,
  },
  schedTitle: {
    fontSize: 13,
    color: '#1A1A1A',
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 18,
  },
  schedMetaRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  schedMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  schedMetaLabel: {
    color: '#B0B0B5',
    fontWeight: '600',
  },
  schedNote: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 6,
  },
});

export default RoomStatusScreen;