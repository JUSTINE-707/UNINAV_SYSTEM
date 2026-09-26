// ============================================================
// Shared helpers for the professor screens
// Place at: src/utils/Schedulehelpers.js
// ============================================================

// DB day codes: M, T, W, Th, F, S  (Sunday has no code -> null)
// Index = JS Date.getDay()
export const DAY_CODES = [null, 'M', 'T', 'W', 'Th', 'F', 'S'];

// Full names, for DISPLAY ONLY (never query with these)
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// "07:30:00" -> 450
export const timeToMinutes = (time) => {
  if (!time) return null;
  const parts = time.toString().trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

// "13:30:00" -> "1:30 PM"
export const formatTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

export const isOnlineRoom = (roomName) => {
  if (!roomName) return false;
  const n = roomName.toString().trim().toUpperCase();
  return (
    n.includes('ONLINE') ||
    n.includes('ASYNCHRONOUS') ||
    n === 'ZOOM' ||
    n === 'GOOGLE MEET' ||
    n === 'GMEET'
  );
};

// Uppercase + strip everything that isn't A-Z / 0-9.
// "IT 201" / "IT-201" / "it201"  -> "IT201"
// "DELA CRUZ, JUAN A." / "Dela Cruz Juan A" -> "DELACRUZJUANA"
export const normalizeText = (value) =>
  (value ?? '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Local (device) date as YYYY-MM-DD.
// Do NOT use toISOString() here: it's UTC, and a 7 AM Manila class
// would land on the previous day.
export const toLocalDateString = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};