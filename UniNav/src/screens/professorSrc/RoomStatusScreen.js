import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import {
  computeRoomStatus,
  stateColor,
  stateLabel,
} from '../../utils/roomStatus';

const RoomStatusScreen = () => {
  const navigation = useNavigation();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // 1. Fetch all teaching rooms only
      const { data: rooms, error: roomErr } = await supabase
        .from('rooms')
        .select('id, room_code, floor_level, building_id, room_type')
        .not('qr_code', 'is', null)
        .eq('is_teaching_room', true)
        .order('room_code');

      if (roomErr) throw roomErr;

      // 2. Fetch sanitized schedule/session/ghost data
      const { data: rawData, error: dataErr } = await supabase.rpc(
        'get_room_status_data'
      );

      if (dataErr) throw dataErr;

      // 3. Group sessions and ghosts by schedule_id
      const sessionsBySchedule = {};
      const ghostsBySchedule = {};

      (rawData || []).forEach((row) => {
        if (row.has_session) {
          sessionsBySchedule[row.id] = {
            id: row.session_id,
            ended_at: row.session_ended_at,
          };
        }
        if (row.ghost_id) {
          ghostsBySchedule[row.id] = {
            id: row.ghost_id,
            room_released: row.ghost_room_released,
          };
        }
      });

      // 4. Compute per-room status
      const now = new Date();
      const computed = (rooms || []).map((room) => {
        const status = computeRoomStatus(
          room,
          rawData || [],
          sessionsBySchedule,
          ghostsBySchedule,
          now
        );
        return {
          ...room,
          ...status,
          color: stateColor(status.state),
          label: stateLabel(status.state),
        };
      });

      // 5. Sort: occupied → vacant → reserved → available → others
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
    } catch (err) {
      console.error('Room status load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8B0000" />
        <Text style={styles.loadingText}>Loading room status…</Text>
      </View>
    );
  }

  // Summary counts
  const counts = statuses.reduce((acc, s) => {
    acc[s.state] = (acc[s.state] || 0) + 1;
    return acc;
  }, {});

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
          <View style={[styles.roomCard, { borderLeftColor: item.color }]}>
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
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No rooms found</Text>
          </View>
        }
      />
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
});

export default RoomStatusScreen;