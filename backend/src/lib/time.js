/**
 * Asia/Manila (UTC+8, no DST) helpers — mirrors LGU-HRMS `backend/src/lib/time.js`
 * so both systems compute identical Manila calendar days for attendance logic.
 * Dates are stored as UTC instants; these helpers compute Manila calendar days,
 * time-of-day, and boundaries so attendance logic never drifts on UTC vs
 * Manila midnight.
 */

export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' as seen in Asia/Manila for a given instant. */
export function manilaDateKey(dt) {
  const shifted = new Date(dt.getTime() + MANILA_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * UTC-midnight instant (key + 'T00:00:00.000Z'). This is the canonical value
 * stored in @db.Date date labels — always a calendar date as labeled, never a
 * shifted day.
 */
export function dateKeyToUtc(dtOrKey) {
  const key = typeof dtOrKey === 'string' ? dtOrKey : manilaDateKey(dtOrKey);
  return new Date(`${key}T00:00:00.000Z`);
}

/** Exclusive end of a Manila-labeled day: UTC-midnight of the next date. */
export function endOfDateKeyExclusive(key) {
  const next = new Date(dateKeyToUtc(key));
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Minutes since midnight Asia/Manila for an instant. */
export function manilaMinutes(dt) {
  const shifted = new Date(dt.getTime() + MANILA_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** UTC instant for local Asia/Manila hh:mm(:ss) on the given date key. */
export function manilaTimeOnDate(key, hours, minutes = 0, seconds = 0) {
  return new Date(dateKeyToUtc(key).getTime() - MANILA_OFFSET_MS + hours * 3600000 + minutes * 60000 + seconds * 1000);
}

const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Normalize a time input to a Date. Accepts ISO-8601 or 'HH:MM(:ss)'.
 * Time-only strings are interpreted on the given date key (Manila-local).
 * Returns null for missing/empty values.
 */
export function normalizeTimeField(v, dateKey) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (TIME_ONLY_RE.test(trimmed)) {
    const m = TIME_ONLY_RE.exec(trimmed);
    const key = dateKey ?? manilaDateKey(new Date());
    return manilaTimeOnDate(key, Number(m[1]), Number(m[2]), Number(m[3] || 0));
  }
  const d = ISO_RE.test(trimmed) ? new Date(trimmed) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** 'YYYY-MM-DD' for today as seen in Asia/Manila. */
export function todayKey() {
  return manilaDateKey(new Date());
}
