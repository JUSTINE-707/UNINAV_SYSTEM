// ============================================================
// ROOM STATUS
//
// Derives the live state of a room from three sources:
//   schedules       — the plan
//   room_sessions   — the reality (scan-in, end-early)
//   ghost_reports   — the exception (class cancelled, released)
// ============================================================

const DAYS = ['Sun', 'M', 'T', 'W', 'Th', 'F', 'Sat'];

const timeToMinutes = (time) => {
  if (!time) return null;
  const parts = time.toString().trim().split(':');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 60 + Number(parts[1]);
};

// Grace period (minutes) after a class starts before we consider
// the room truly vacant. 0 = strict (booked until released or
// ended early).
export const VACANT_GRACE_MINUTES = 15;

/**
 * Compute the status of a single room at a given moment.
 *
 * @param {Object} room
 * @param {Array}  schedules
 * @param {Object} sessionsBySchedule  - map: schedule_id -> room_sessions row
 * @param {Object} ghostsBySchedule    - map: schedule_id -> ghost_reports row
 * @param {Date}   now
 *
 * @returns {Object} { state, schedule, session, ghost, reason }
 */
export const computeRoomStatus = (
  room,
  schedules = [],
  sessionsBySchedule = {},
  ghostsBySchedule = {},
  now = new Date()
) => {
  const roomName =
    typeof room === 'string' ? room : room?.room_name || room?.room_code || '';

  if (!roomName) {
    return {
      state: 'available',
      schedule: null,
      session: null,
      ghost: null,
      reason: 'no room',
    };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayCode = DAYS[now.getDay()];

  const todays = schedules.filter(
    (s) =>
      s.day === todayCode &&
      s.room_name &&
      s.room_name.trim().toUpperCase() === roomName.trim().toUpperCase()
  );

  if (todays.length === 0) {
    return {
      state: 'available',
      schedule: null,
      session: null,
      ghost: null,
      reason: 'no class scheduled',
    };
  }

  let current = null;
  let upcoming = null;

  for (const s of todays) {
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    if (start === null || end === null) continue;

    if (nowMin >= start && nowMin <= end) {
      current = s;
    } else if (start > nowMin) {
      if (!upcoming || start < timeToMinutes(upcoming.start_time)) {
        upcoming = s;
      }
    }
  }

  const target = current || upcoming;

  if (!target) {
    return {
      state: 'available',
      schedule: null,
      session: null,
      ghost: null,
      reason: 'all classes ended',
    };
  }

  const start = timeToMinutes(target.start_time);
  const end = timeToMinutes(target.end_time);
  const ghost = ghostsBySchedule[target.id] || null;
  const session = sessionsBySchedule[target.id] || null;

  // ---- 1. Ghost report: cancelled before class ----
  if (ghost?.room_released) {
    return {
      state: 'released',
      schedule: target,
      session: null,
      ghost,
      reason: `released by ${target.subject_code}`,
    };
  }
  if (ghost) {
    return {
      state: 'closed',
      schedule: target,
      session: null,
      ghost,
      reason: `cancelled (${target.subject_code})`,
    };
  }

  // ---- 2. Session already ended early (mid-class timeout) ----
  if (session?.ended_at) {
    const endedAt = new Date(session.ended_at);
    if (now >= endedAt) {
      return {
        state: 'available',
        schedule: target,
        session,
        ghost: null,
        reason: `${target.subject_code} ended early`,
      };
    }
    // Weird future ended_at — treat as occupied
    return {
      state: 'occupied',
      schedule: target,
      session,
      ghost: null,
      reason: `${target.subject_code} in session`,
    };
  }

  // ---- 3. Before class starts ----
  if (nowMin < start) {
    return {
      state: 'reserved',
      schedule: target,
      session: null,
      ghost: null,
      reason: `reserved for ${target.subject_code} at ${target.start_time}`,
    };
  }

  // ---- 4. Session exists, still open → occupied ----
  if (session) {
    return {
      state: 'occupied',
      schedule: target,
      session,
      ghost: null,
      reason: `${target.subject_code} is in session`,
    };
  }

  // ---- 5. In window, no session ----
  const minutesSinceStart = nowMin - start;
  if (
    VACANT_GRACE_MINUTES > 0 &&
    minutesSinceStart > VACANT_GRACE_MINUTES
  ) {
    return {
      state: 'available',
      schedule: target,
      session: null,
      ghost: null,
      reason: `vacant for ${minutesSinceStart}m — auto-released`,
    };
  }

  return {
    state: 'vacant',
    schedule: target,
    session: null,
    ghost: null,
    reason: `waiting for check-in (${target.subject_code})`,
  };
};

export const stateColor = (state) => {
  switch (state) {
    case 'available': return '#059669';
    case 'released':  return '#C77700';
    case 'reserved':  return '#3B82F6';
    case 'vacant':    return '#D97706';
    case 'occupied':  return '#B00020';
    case 'closed':    return '#6B7280';
    case 'ended':     return '#9CA3AF';
    default:          return '#9CA3AF';
  }
};

export const stateLabel = (state) => {
  switch (state) {
    case 'available': return 'AVAILABLE';
    case 'released':  return 'RELEASED';
    case 'reserved':  return 'RESERVED';
    case 'vacant':    return 'VACANT';
    case 'occupied':  return 'OCCUPIED';
    case 'closed':    return 'CANCELLED';
    case 'ended':     return 'ENDED';
    default:          return state?.toUpperCase?.() || '';
  }
};

// Reasons a professor can pick when ending a class early.
// Keep in sync with the EndClassEarly screen's REASONS array.
export const END_REASONS = {
  urgent_meeting: 'Urgent Meeting',
  medical: 'Medical / Emergency',
  finished_early: 'Class Finished Early',
  other: 'Other',
};