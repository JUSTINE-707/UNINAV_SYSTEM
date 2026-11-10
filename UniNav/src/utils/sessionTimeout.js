// ============================================================
// Auto-timeout sweep for room_sessions
// ------------------------------------------------------------
// Finds any room_sessions row that is still "ongoing" (ended_at IS NULL)
// but whose parent schedule's end_time has already passed, and closes
// it with status='completed' and ended_at set to the scheduled end.
//
// Can be called from any screen — Professor Dashboard, Class Monitor,
// Faculty Schedule, etc. It's idempotent, so calling it repeatedly is safe.
// ============================================================

import { supabase } from '../services/supabase';

// ------------------------------------------------------------------
// Turn "14:30:00" (or "14:30") into 14*60+30 = 870
// ------------------------------------------------------------------
const timeToMinutes = (t) => {
  if (!t) return null;
  const parts = t.toString().trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const todayCode = () => {
  const map = { 0: 'Sun', 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sat' };
  return map[new Date().getDay()];
};

const toLocalDateString = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ------------------------------------------------------------------
// Build an ISO timestamp for "today at HH:MM:SS" (local time)
// ------------------------------------------------------------------
const buildEndedAt = (endTimeStr) => {
  if (!endTimeStr) return new Date().toISOString();

  const parts = endTimeStr.toString().trim().split(':').map(Number);
  const target = new Date();
  target.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
  return target.toISOString();
};

// ============================================================
// MAIN SWEEP
// ------------------------------------------------------------
// Optional filters:
//   - facultyId   : restrict to sessions of a specific faculty member
//   - scheduleIds : restrict to specific schedule IDs
//
// Returns the number of rows that were closed.
// ============================================================
export const autoCloseStaleSessions = async ({
  facultyId = null,
  scheduleIds = null,
} = {}) => {
  try {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = todayCode();

    // --------------------------------------------------------
    // 1. Fetch all ongoing sessions that have not been ended.
    // --------------------------------------------------------
    let query = supabase
      .from('room_sessions')
      .select(`
        id,
        schedule_id,
        scanned_at,
        ended_at,
        status,
        class_type,
        schedules (
          id,
          day,
          start_time,
          end_time,
          semester_id
        )
      `)
      .is('ended_at', null)
      .eq('status', 'ongoing');

    if (facultyId) query = query.eq('faculty_id', facultyId);
    if (scheduleIds && scheduleIds.length > 0) {
      query = query.in('schedule_id', scheduleIds);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[autoCloseStaleSessions] fetch error:', error.message);
      return 0;
    }

    if (!data || data.length === 0) return 0;

    // --------------------------------------------------------
    // 2. Filter to sessions whose scheduled end time has passed.
    // --------------------------------------------------------
    const toClose = data.filter((row) => {
      const sched = row.schedules;
      if (!sched) return false;

      const endMin = timeToMinutes(sched.end_time);
      if (endMin === null) return false;

      const sameDay = sched.day === today;

      if (sameDay) {
        return nowMin > endMin;
      }
      // Not today's class → definitely stale (older than today)
      return true;
    });

    if (toClose.length === 0) return 0;

    // --------------------------------------------------------
    // 3. Update each stale session with status='completed'.
    // --------------------------------------------------------
    let closed = 0;
    for (const row of toClose) {
      const sched = row.schedules;

      const endedAtIso = sched?.end_time
        ? buildEndedAt(sched.end_time)
        : new Date().toISOString();

      const { error: updErr } = await supabase
        .from('room_sessions')
        .update({
          status: 'completed',
          ended_at: endedAtIso,
          end_reason: 'auto_timeout',
          end_notes:
            'Session automatically ended by the system when the scheduled class time finished.',
        })
        .eq('id', row.id)
        .is('ended_at', null); // prevent race / double-update

      if (updErr) {
        console.warn(
          '[autoCloseStaleSessions] update failed for',
          row.id,
          updErr.message
        );
        continue;
      }
      closed += 1;
    }

    if (closed > 0) {
      console.log(
        `[autoCloseStaleSessions] Auto-closed ${closed} stale session(s) on ${toLocalDateString(now)}`
      );
    }
    return closed;
  } catch (err) {
    console.error('[autoCloseStaleSessions] unexpected error:', err);
    return 0;
  }
};