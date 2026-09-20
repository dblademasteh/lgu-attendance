import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun, ChevronDown, LogOut, Landmark, Clock, Bell, CircleAlert, CheckCircle2, Info, Loader2, CheckCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../stores/auth.js';
import { useTheme, toggleTheme } from '../theme.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { useInAppEnabled } from '../lib/notifPrefs.js';
import { useToast } from '../hooks/useToast.jsx';

const TITLES = {
  '/dashboard': 'Dashboard',
  '/my-attendance': 'My Attendance',
  '/attendance': 'Attendance',
  '/employees': 'Employees',
  '/reports': 'Reports',
  '/integration': 'HRMS Sync',
  '/biometric-devices': 'Biometric Devices',
  '/settings': 'Settings',
};

const TONE_STYLES = {
  error: { icon: CircleAlert, cls: 'bg-error/10 text-error' },
  warn: { icon: CircleAlert, cls: 'bg-warning/10 text-warning' },
  success: { icon: CheckCircle2, cls: 'bg-success/10 text-success' },
  info: { icon: Info, cls: 'bg-accent/10 text-accent' },
};

function manilaParts(now) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { date: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 19) };
}

export default function Header({ onToggleSidebar }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [now, setNow] = useState(() => new Date());
  const theme = useTheme();
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const userRef = useRef(null);
  const notifRef = useRef(null);
  const { items, loading, markRead, markAllRead, dismissAll } = useNotifications();
  const inAppEnabled = useInAppEnabled();
  const toast = useToast();
  const unread = items.filter((n) => n.unread).length;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!userOpen && !notifOpen) return undefined;
    const onDown = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [userOpen, notifOpen]);

  const title = TITLES[location.pathname] ?? 'LGU Attendance';
  const { date, time } = manilaParts(now);
  const initial = (user?.fullName ?? user?.username ?? 'U').trim()[0]?.toUpperCase() ?? 'U';

  const signOut = () => {
    logout();
    setUserOpen(false);
    navigate('/');
  };

  return (
    <header className="h-16 shrink-0 bg-surface/90 backdrop-blur-md border-b border-line" style={{ zIndex: 50 }}>
      <div className="h-full px-4 md:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="btn btn-ghost p-2 md:p-2.5"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="hidden sm:flex items-center gap-2 text-muted">
            <Landmark size={16} aria-hidden="true" />
            <span className="mono-label">/</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-ink text-lg leading-tight truncate">{title}</h1>
            <p className="hidden sm:flex items-center gap-1.5 text-xs text-muted truncate">
              <Clock size={12} aria-hidden="true" className="shrink-0" />
              <span className="font-mono">{time} PHT · {date}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          <div className="dropdown" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              className="btn btn-ghost px-2 md:px-3 relative"
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
              aria-expanded={notifOpen}
              title="Notifications"
            >
              <Bell size={18} aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-error-ink text-[10px] font-bold grid place-items-center ring-2 ring-surface">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="dropdown-panel w-[360px] max-w-[calc(100vw-2rem)] p-0 shadow-lg" role="menu" aria-label="Notifications">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
                  <p className="font-display font-semibold text-ink text-sm">Notifications</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-xs"
                      onClick={() => { markAllRead(); toast('All notifications marked as read', 'success'); }}
                      title="Mark all as read"
                      aria-label="Mark all as read"
                    >
                      <CheckCheck size={14} aria-hidden="true" /> Read
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-xs"
                      onClick={() => { dismissAll(); toast('Notifications cleared', 'success'); }}
                      title="Clear all notifications"
                      aria-label="Clear all notifications"
                    >
                      <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                  </div>
                </div>

                {!inAppEnabled ? (
                  <button type="button" className="w-full text-left px-4 py-8 text-center" onClick={() => navigate('/settings')}>
                    <p className="text-sm font-medium text-ink">Notifications muted</p>
                    <p className="text-xs text-muted mt-1">Turn on In-app notifications under Settings → Notifications.</p>
                  </button>
                ) : loading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading notifications…
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm font-medium text-ink">No notifications</p>
                    <p className="text-xs text-muted mt-1">You're all caught up.</p>
                  </div>
                ) : (
                  <ul className="max-h-[420px] overflow-y-auto hide-scrollbar divide-y divide-line">
                    {items.slice(0, 12).map((n) => {
                      const style = TONE_STYLES[n.tone] ?? TONE_STYLES.info;
                      const ToneIcon = style.icon;
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            className="w-full text-left flex items-start gap-3 px-4 py-3 transition hover:bg-bg/60"
                            onClick={() => { markRead(n.id); setNotifOpen(false); navigate(n.path); }}
                          >
                            <div className={`w-8 h-8 rounded-[10px] grid place-items-center shrink-0 mt-0.5 ${style.cls}`}>
                              <ToneIcon size={15} aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink flex items-center gap-2">
                                <span className="truncate">{n.title}</span>
                                {n.unread && <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-label="Unread" />}
                              </p>
                              <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</p>
                              <p className="mono-label text-[10px] mt-1.5">{n.time}</p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost px-2 md:px-3"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-pressed={theme === 'dark'}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>

          <div className="dropdown" ref={userRef}>
            <button
              type="button"
              className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-[12px] hover:bg-bg/60 border border-transparent hover:border-line transition"
              onClick={() => setUserOpen((o) => !o)}
              aria-expanded={userOpen}
              aria-label="User menu"
            >
              <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-accent/20 to-accent/5 text-accent grid place-items-center shrink-0 ring-1 ring-accent/10">
                <span className="font-display font-bold text-[13px]">{initial}</span>
              </div>
              <div className="hidden lg:block text-left leading-tight">
                <p className="text-sm font-semibold text-ink truncate max-w-28">{user?.fullName ?? user?.username ?? 'Account'}</p>
                <p className="text-[10px] mono-label text-muted">{user?.role?.replaceAll('_', ' ') ?? '—'}</p>
              </div>
              <ChevronDown size={14} className="text-muted hidden lg:block" aria-hidden="true" />
            </button>
            {userOpen && (
              <div className="dropdown-panel w-64 shadow-lg" role="menu" aria-label="User menu">
                <div className="px-4 py-4 border-b border-line">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-accent/20 to-accent/5 text-accent grid place-items-center ring-1 ring-accent/10">
                      <span className="font-display font-bold">{initial}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm truncate">{user?.fullName ?? user?.username ?? 'Account'}</p>
                      <p className="mono-label text-[11px] text-muted truncate">{user?.role?.replaceAll('_', ' ')}</p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-line py-1">
                  <button
                    type="button"
                    className="dropdown-item text-error"
                    onClick={signOut}
                  >
                    <LogOut size={16} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}