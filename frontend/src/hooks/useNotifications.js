import { useCallback, useEffect, useState } from 'react';
import { myToday, myHistory } from '../api/attendance.js';
import { summary } from '../api/reports.js';
import { logs } from '../api/sync.js';
import { list as listDevices } from '../api/biometric.js';
import { useAuth } from '../stores/auth.js';
import { isInAppEnabled } from '../lib/notifPrefs.js';
import { OVERSIGHT_ROLES, SYNC_ROLES } from '../lib/roles.js';

const READ_KEY = 'lgu-attendance-notif-read';
const DISMISSED_KEY = 'lgu-attendance-notif-dismissed';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function loadIds(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveIds(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — ids stay in memory for the session */
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function manilaToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function deviceStatus(device) {
  if (!device.active) return 'INACTIVE';
  if (device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < ONLINE_WINDOW_MS) return 'ONLINE';
  return 'OFFLINE';
}

/**
 * Live notification feed derived entirely from existing APIs — no mock rows:
 * - VIEWER: today's own record (absent / late / undertime / on leave) plus the
 *   current month's shape summary from /attendance/my and /attendance/my/history
 * - Oversight: today's ABSENT / LATE / UNDERTIME counts from /reports/summary
 * - HR / ADMIN additionally: recent FAILED / PARTIAL HRMS syncs + offline or
 *   disabled biometric devices
 * Read + dismissed ids persist in localStorage so state survives remounts.
 */
export function useNotifications() {
  const user = useAuth((s) => s.user);
  const role = user?.role;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!role || !isInAppEnabled()) {
      setItems([]);
      setLoading(false);
      setLive(false);
      return undefined;
    }
    let cancelled = false;
    const run = async () => {
      const built = [];
      const today = manilaToday();
      let atLeastOneFulfilled = false;

      if (role === 'VIEWER') {
        const month = today.slice(0, 7);
        const [todayRes, monthRes] = await Promise.allSettled([myToday(), myHistory(month)]);
        atLeastOneFulfilled = todayRes.status === 'fulfilled' || monthRes.status === 'fulfilled';
        if (cancelled) return;

        if (todayRes.status === 'fulfilled') {
          const rec = todayRes.value?.record;
          if (rec) {
            if (rec.status === 'ABSENT') {
              built.push({
                id: 'me-absent-today',
                tone: 'error',
                title: 'Marked absent today',
                body: 'There is no attendance record for today. Contact your HR manager if this is an error.',
                time: 'today',
                path: '/my-attendance',
              });
            } else if (rec.status === 'LATE') {
              built.push({
                id: 'me-late-today',
                tone: 'warn',
                title: 'Clocked in late today',
                body: rec.minutesLate ? `Flagged ${rec.minutesLate} min late this morning.` : 'Your arrival today was flagged as late.',
                time: 'today',
                path: '/my-attendance',
              });
            } else if (rec.status === 'UNDERTIME') {
              built.push({
                id: 'me-undertime-today',
                tone: 'warn',
                title: 'Undertime flagged today',
                body: 'Your departure today was flagged as undertime.',
                time: 'today',
                path: '/my-attendance',
              });
            } else if (rec.status === 'ON_LEAVE') {
              built.push({
                id: 'me-leave-today',
                tone: 'success',
                title: 'On leave today',
                body: 'Enjoy your approved leave.',
                time: 'today',
                path: '/my-attendance',
              });
            }
          }
        }

        if (monthRes.status === 'fulfilled') {
          const s = monthRes.value?.summary;
          if (s) {
            if (s.absent > 0) {
              built.push({
                id: `me-absent-month`,
                tone: 'warn',
                title: 'Absences this month',
                body: `${s.absent} day(s) marked absent in ${month.replace('-', ' ')}.`,
                time: 'this month',
                path: '/my-attendance',
              });
            }
            if (s.late > 0) {
              built.push({
                id: 'me-late-month',
                tone: 'info',
                title: 'Late arrivals this month',
                body: `${s.late} day(s) flagged late in ${month.replace('-', ' ')}.`,
                time: 'this month',
                path: '/my-attendance',
              });
            }
            if (s.undertime > 0) {
              built.push({
                id: 'me-undertime-month',
                tone: 'info',
                title: 'Undertime this month',
                body: `${s.undertime} day(s) flagged undertime in ${month.replace('-', ' ')}.`,
                time: 'this month',
                path: '/my-attendance',
              });
            }
            if (s.onLeave > 0) {
              built.push({
                id: 'me-leave-month',
                tone: 'info',
                title: 'Leave days this month',
                body: `${s.onLeave} day(s) on approved leave in ${month.replace('-', ' ')}.`,
                time: 'this month',
                path: '/my-attendance',
              });
            }
          }
        }
      }

      if (OVERSIGHT_ROLES.includes(role)) {
        const [sumRes] = await Promise.allSettled([summary({ from: today, to: today })]);
        atLeastOneFulfilled = sumRes.status === 'fulfilled';
        if (cancelled) return;
        const counts = sumRes.value?.counts ?? {};
        if (counts.ABSENT) {
          built.push({
            id: 'absent-today',
            tone: 'error',
            title: 'Unfilled absences today',
            body: `${counts.ABSENT} employee(s) marked absent for today — review and correct as needed.`,
            time: 'today',
            path: '/attendance',
          });
        }
        if (counts.LATE) {
          built.push({
            id: 'late-today',
            tone: 'warn',
            title: 'Late arrivals today',
            body: `${counts.LATE} employee(s) clocked in late today.`,
            time: 'today',
            path: '/attendance',
          });
        }
        if (counts.UNDERTIME) {
          built.push({
            id: 'undertime-today',
            tone: 'warn',
            title: 'Undertime today',
            body: `${counts.UNDERTIME} record(s) flagged undertime today.`,
            time: 'today',
            path: '/attendance',
          });
        }
      }

      if (SYNC_ROLES.includes(role)) {
        const [syncRes, devRes] = await Promise.allSettled([
          logs({ limit: 20 }),
          listDevices(),
        ]);
        if (syncRes.status === 'fulfilled') atLeastOneFulfilled = true;
        if (devRes.status === 'fulfilled') atLeastOneFulfilled = true;
        if (cancelled) return;

        const syncItems = (syncRes.status === 'fulfilled' ? syncRes.value?.items : []) ?? [];
        for (const l of syncItems.filter((x) => x?.status === 'FAILED' || x?.status === 'PARTIAL').slice(0, 4)) {
          built.push({
            id: `sync-${l.id}`,
            tone: l.status === 'FAILED' ? 'error' : 'warn',
            title: `HRMS sync ${l.status.toLowerCase()}`,
            body:
              l.message ??
              `${l.status} — ${String(l.source ?? '').toLowerCase()} ${String(l.direction ?? '').toLowerCase()} (${l.processed ?? 0} processed).`,
            time: timeAgo(l.createdAt),
            path: '/integration',
          });
        }

        const devices = (devRes.status === 'fulfilled' && Array.isArray(devRes.value) ? devRes.value : []) ?? [];
        for (const d of devices) {
          const st = deviceStatus(d);
          if (st === 'OFFLINE') {
            built.push({
              id: `device-offline-${d.deviceId ?? d.id}`,
              tone: 'warn',
              title: 'Device offline',
              body: `"${d.name}" has not pinged back in over 5 minutes.`,
              time: timeAgo(d.lastSeenAt),
              path: '/biometric-devices',
            });
          } else if (st === 'INACTIVE') {
            built.push({
              id: `device-inactive-${d.deviceId ?? d.id}`,
              tone: 'info',
              title: 'Device deactivated',
              body: `"${d.name}" (${d.model ?? 'device'}) is inactive — punches are not being accepted.`,
              time: '',
              path: '/biometric-devices',
            });
          }
        }
      }

      if (cancelled) return;
      const read = loadIds(READ_KEY);
      const dismissed = loadIds(DISMISSED_KEY);
      const withState = built
        .filter((n) => !dismissed.has(n.id))
        .map((n) => ({ ...n, unread: !read.has(n.id) }));
      setItems(withState);
      setLive(atLeastOneFulfilled);
    };
    run().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const persist = useCallback((key, id) => {
    const set = loadIds(key);
    set.add(id);
    saveIds(key, set);
  }, []);

  const markRead = useCallback((id) => {
    persist(READ_KEY, id);
    setItems((ns) => ns.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }, [persist]);

  const markAllRead = useCallback(() => {
    const set = loadIds(READ_KEY);
    for (const n of items) set.add(n.id);
    saveIds(READ_KEY, set);
    setItems((ns) => ns.map((n) => ({ ...n, unread: false })));
  }, [items]);

  const dismissAll = useCallback(() => {
    const set = loadIds(DISMISSED_KEY);
    for (const n of items) set.add(n.id);
    saveIds(DISMISSED_KEY, set);
    setItems([]);
  }, [items]);

  return { items, loading, live, markRead, markAllRead, dismissAll };
}