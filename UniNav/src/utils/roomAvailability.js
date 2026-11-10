import { isOnlineRoom, timeToMinutes } from './scheduleHelpers'

export const WEEK_DAYS = [
  { code: 'M', label: 'Mon', name: 'Monday' },
  { code: 'T', label: 'Tue', name: 'Tuesday' },
  { code: 'W', label: 'Wed', name: 'Wednesday' },
  { code: 'Th', label: 'Thu', name: 'Thursday' },
  { code: 'F', label: 'Fri', name: 'Friday' },
  { code: 'Sat', label: 'Sat', name: 'Saturday' },
  { code: 'Sun', label: 'Sun', name: 'Sunday' },
]

export const HOURS = Array.from({ length: 14 }, (_, index) => index + 7)

const DAY_CODES_BY_NAME = {
  m: 'M',
  mon: 'M',
  monday: 'M',
  t: 'T',
  tue: 'T',
  tues: 'T',
  tuesday: 'T',
  w: 'W',
  wed: 'W',
  wednesday: 'W',
  th: 'Th',
  thu: 'Th',
  thur: 'Th',
  thurs: 'Th',
  thursday: 'Th',
  f: 'F',
  fri: 'F',
  friday: 'F',
  s: 'Sat',
  sat: 'Sat',
  saturday: 'Sat',
  sun: 'Sun',
  sunday: 'Sun',
}

const UNASSIGNED_ROOM_NAMES = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'tba',
  'tbd',
  'room tba',
  'to be announced',
  'to be assigned',
  'to be confirmed',
  'to be determined',
  'unassigned',
  'not assigned',
  'not specified',
  'not yet assigned',
  'no room',
  'no room assigned',
])

const NON_SCANNABLE_VENUE_PATTERN =
  /\bopen\s+grounds?\b|\bgrounds\b|\boval\b|\bopen\s+fields?\b|\bfields?\b|\b(?:covered\s+)?courts?\b|\bquadrangle\b|\bamphitheat(?:er|re)\b/i

export const normalizeRoomKey = (name) =>
  String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeDayCode = (day) =>
  DAY_CODES_BY_NAME[String(day || '').trim().toLowerCase()] || null

const isUnassignedRoom = (name) =>
  UNASSIGNED_ROOM_NAMES.has(normalizeRoomKey(name))

const isNonScannableVenue = (name) =>
  NON_SCANNABLE_VENUE_PATTERN.test(String(name || '').trim())

const isVirtualRoom = (name) => {
  const normalized = String(name || '').trim().toUpperCase()
  return (
    [
      'GC',
      'TEAMS',
      'MICROSOFT TEAMS',
      'WEBEX',
      'DISCORD',
      'GOOGLE CLASSROOM',
      'GOOGLE CLASS',
    ].includes(normalized) ||
    ['MODULAR', 'VIRTUAL', 'DISTANCE'].some((term) =>
      normalized.includes(term)
    )
  )
}

const getValidTimeMinutes = (time) => {
  if (time == null) return null

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
    String(time).trim()
  )
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] || 0)
  if (hour > 23 || minute > 59 || second > 59) return null

  return timeToMinutes(time)
}

const isPhysicalRoom = (name) =>
  Boolean(
    name &&
      !isOnlineRoom(name) &&
    !isVirtualRoom(name) &&
    !isUnassignedRoom(name) &&
      !isNonScannableVenue(name)
  )

export const getInitialSelectedDay = (scheduledDays, date = new Date()) => {
  const scheduledDaySet = new Set(scheduledDays)
  const todayCode = ['Sun', 'M', 'T', 'W', 'Th', 'F', 'Sat'][date.getDay()]
  if (scheduledDaySet.has(todayCode)) return todayCode
  return WEEK_DAYS.find(({ code }) => scheduledDaySet.has(code))?.code || 'M'
}

export const buildRoomAvailability = (schedules = []) => {
  const rooms = new Map()
  const busyRooms = new Map()
  const scheduledDays = new Set()

  for (const schedule of schedules) {
    const name = schedule?.room_name
    if (isPhysicalRoom(name)) {
      const key = normalizeRoomKey(name)
      if (!rooms.has(key)) rooms.set(key, String(name).trim())
    }

    const day = normalizeDayCode(schedule?.day)
    const start = getValidTimeMinutes(schedule?.start_time)
    const end = getValidTimeMinutes(schedule?.end_time)
    if (day && start != null && end != null && end > start) {
      scheduledDays.add(day)
    }
  }

  const roomKeys = [...rooms.keys()].sort((a, b) =>
    rooms.get(a).localeCompare(rooms.get(b))
  )

  for (const day of WEEK_DAYS) {
    for (const hour of HOURS) {
      busyRooms.set(`${day.code}-${hour}`, new Set())
    }
  }

  for (const schedule of schedules) {
    const name = schedule?.room_name
    if (!isPhysicalRoom(name)) continue

    const day = normalizeDayCode(schedule?.day)
    const start = getValidTimeMinutes(schedule?.start_time)
    const end = getValidTimeMinutes(schedule?.end_time)
    if (!day || start == null || end == null || end <= start) continue

    const roomKey = normalizeRoomKey(name)
    for (const hour of HOURS) {
      const slotStart = hour * 60
      const slotEnd = slotStart + 60
      if (start < slotEnd && slotStart < end) {
        busyRooms.get(`${day}-${hour}`)?.add(roomKey)
      }
    }
  }

  const availability = {}
  for (const { code } of WEEK_DAYS) {
    for (const hour of HOURS) {
      const key = `${code}-${hour}`
      const busy = busyRooms.get(key) || new Set()
      const availableKeys = roomKeys.filter((roomKey) => !busy.has(roomKey))
      availability[key] = {
        availableNames: availableKeys.map((roomKey) => rooms.get(roomKey)),
        busyCount: busy.size,
        freeCount: availableKeys.length,
      }
    }
  }

  return {
    roomNames: roomKeys.map((roomKey) => rooms.get(roomKey)),
    availability,
    scheduledDays: WEEK_DAYS.filter(({ code }) => scheduledDays.has(code)).map(
      ({ code }) => code
    ),
    totalRooms: roomKeys.length,
  }
}
