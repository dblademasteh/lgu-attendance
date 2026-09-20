import { useEffect, useState } from 'react';

// Notification preferences — the in-app toggle and the quiet-hours window.
// Persisted in localStorage under the lgu-attendance-* namespace and applied
// app-wide: useNotifications mutes the bell feed, useToast suppresses toasts.

export const INAPP_KEY = 'lgu-attendance-notif-inapp';
export const QUIET_KEY = 'lgu-attendance-notif-quiet';
export const QUIET_START_KEY = 'lgu-attendance-notif-quiet-start';
export const QUIET_END_KEY = 'lgu-attendance-notif-quiet-end';

export const QUIET_DEFAULTS = { enabled: false, start: '22:00', end: '07:00' };

const PREFS_EVENT = 'lgu-attendance-notif-prefs';

export function isInAppEnabled() {
  try {
    return localStorage.getItem(INAPP_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setInAppEnabled(enabled) {
  try {
    localStorage.setItem(INAPP_KEY, String(enabled));
  } catch {
    /* storage unavailable — value still applies for the session */
  }
  emitPrefs();
}

export function getQuietHours() {
  const out = { ...QUIET_DEFAULTS };
  try {
    out.enabled = localStorage.getItem(QUIET_KEY) === 'true';
    out.start = localStorage.getItem(QUIET_START_KEY) || out.start;
    out.end = localStorage.getItem(QUIET_END_KEY) || out.end;
  } catch {
    /* storage unavailable — defaults */
  }
  return out;
}

export function setQuietHours({ enabled, start, end }) {
  try {
    localStorage.setItem(QUIET_KEY, String(enabled));
    localStorage.setItem(QUIET_START_KEY, start);
    localStorage.setItem(QUIET_END_KEY, end);
  } catch {
    /* storage unavailable */
  }
  emitPrefs();
}

/** Clears persisted read/dismissed ids for the header notification feed. */
export function clearNotificationMemory() {
  try {
    localStorage.removeItem('lgu-attendance-notif-read');
    localStorage.removeItem('lgu-attendance-notif-dismissed');
  } catch {
    /* storage unavailable */
  }
  emitPrefs();
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** True when `now` falls inside the quiet window (supports overnight spans). */
export function isInsideQuietWindow(now = new Date()) {
  const { enabled, start, end } = getQuietHours();
  if (!enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e; // overnight window
}

/** Live mirror of the in-app toggle, updated on pref changes in any tab. */
export function useInAppEnabled() {
  const [enabled, setEnabled] = useState(isInAppEnabled);
  useEffect(() => onPrefsChange(() => setEnabled(isInAppEnabled())), []);
  return enabled;
}

function emitPrefs() {
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

function onPrefsChange(cb) {
  window.addEventListener(PREFS_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(PREFS_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}