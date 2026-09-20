import { useEffect, useState } from 'react';
import {
  Activity, Ban, Bell, BellOff, Check, Cpu, Info, KeyRound, Layout, Loader2, MapPin, MonitorDown, Moon, Palette,
  RefreshCw, Server, ShieldCheck, Sun, Trash2, Type, User,
} from 'lucide-react';
import { useTheme, applyTheme } from '../theme.js';
import {
  ACCENT_PRESETS, FONT_OPTIONS, presetValue,
  getAccent, applyAccent, getUiScale, applyUiScale, getFont, applyFont,
} from '../appearance.js';
import { useAuth } from '../stores/auth.js';
import { me } from '../api/auth.js';
import { health } from '../api/system.js';
import { API_BASE } from '../api/client.js';
import { useToast } from '../hooks/useToast.jsx';
import Badge from '../components/Badge.jsx';
import {
  useInAppEnabled, getQuietHours, setQuietHours, setInAppEnabled, clearNotificationMemory,
} from '../lib/notifPrefs.js';
import { usePwaStatus } from '../hooks/usePwaStatus.js';
import { getGeofenceConfig, updateGeofenceConfig } from '../api/attendance.js';

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'account', label: 'Account', icon: User },
  { id: 'attendance', label: 'Attendance', icon: MapPin, adminOnly: true },
  { id: 'system', label: 'System', icon: Server, adminOnly: true },
];

const GEO_HELP_MSG =
  'Self-service punches always require a location fix. Enabling the geofence also rejects punches outside the office radius — fake/zero-accuracy fixes are blocked by the accuracy cap.';

const UI_SCALE_STORAGE = ['auth', 'theme', 'accent', 'ui-scale', 'font'].map((k) => `lgu-attendance-${k}`);

const fmtTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const remainingMins = (exp) => (exp ? Math.max(0, Math.round((exp * 1000 - Date.now()) / 60000)) : null);

function Panel({ icon: Icon, title, desc, children, action }) {
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="px-5 md:px-6 pt-5 pb-4 flex items-start justify-between gap-3 border-b border-line">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent grid place-items-center shrink-0 ring-1 ring-accent/10">
            <Icon size={17} aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-ink text-sm md:text-base">{title}</h2>
            <p className="text-xs text-muted mt-0.5">{desc}</p>
          </div>
        </div>
        {action}
      </header>
      <div className="p-5 md:p-6">{children}</div>
    </section>
  );
}

function ThemeTile({ mode, active, themeLabel }) {
  const isDark = mode === 'dark';
  return (
    <button
      type="button"
      onClick={() => applyTheme(mode)}
      className={`flex-1 rounded-xl border px-4 py-4 flex flex-col items-center gap-2 transition ${
        active
          ? 'border-accent ring-1 ring-accent bg-accent/5 text-ink'
          : 'border-line text-muted hover:border-line hover:bg-bg/60 hover:text-ink'
      }`}
      aria-pressed={active}
    >
      {isDark ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
      <span className="text-sm font-medium">{themeLabel}</span>
      {active && <Check size={14} className="text-accent" aria-hidden="true" />}
    </button>
  );
}

function SettingRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2 shrink-0 text-sm text-ink">{children}</div>
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const theme = useTheme();

  const [tab, setTab] = useState('appearance');

  // Appearance state
  const [accent, setAccent] = useState(getAccent());
  const [uiScale, setUiScale] = useState(getUiScale());
  const [font, setFont] = useState(getFont());

  // Notification state
  const inApp = useInAppEnabled();
  const [quiet, setQuiet] = useState(getQuietHours);

  // PWA state
  const pwa = usePwaStatus();

  // Account state
  const [meData, setMeData] = useState(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState(null);

  // System state
  const [healthInfo, setHealthInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  // Attendance / geofence state
  const [geo, setGeo] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoSaving, setGeoSaving] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [geoForm, setGeoForm] = useState({ enabled: false, officeLat: '', officeLng: '', geofenceRadiusM: '', maxAccuracyM: '' });

  const isAdmin = user?.role === 'ADMIN';
  const canManageAttendance = ['ADMIN', 'HR_MANAGER'].includes(user?.role);
  const visibleTabs = TABS.filter((t) => !t.adminOnly || (t.id === 'attendance' ? canManageAttendance : isAdmin));

  useEffect(() => {
    if (tab !== 'account') return undefined;
    let cancelled = false;
    setMeLoading(true);
    setMeError(null);
    me()
      .then((res) => { if (!cancelled) setMeData(res); })
      .catch((err) => { if (!cancelled) setMeError(err?.response?.data?.message ?? err?.message); })
      .finally(() => { if (!cancelled) setMeLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const runCheck = () => {
    setChecking(true);
    const start = performance.now();
    health()
      .then((res) => setHealthInfo({ ...res, latency: Math.round(performance.now() - start) }))
      .catch(() => setHealthInfo({ latency: Math.round(performance.now() - start), status: null, service: null }))
      .finally(() => setChecking(false));
  };

  useEffect(() => { if (tab === 'system') runCheck(); }, [tab]);

  const loadGeofence = () => {
    setGeoLoading(true);
    setGeoError(null);
    getGeofenceConfig()
      .then((res) => {
        setGeo(res);
        setGeoForm({
          enabled: res.enabled,
          officeLat: res.officeLat != null ? String(res.officeLat) : '',
          officeLng: res.officeLng != null ? String(res.officeLng) : '',
          geofenceRadiusM: res.geofenceRadiusM != null ? String(res.geofenceRadiusM) : '',
          maxAccuracyM: res.maxAccuracyM != null ? String(res.maxAccuracyM) : '',
        });
      })
      .catch((err) => setGeoError(err?.response?.data?.message ?? err?.message))
      .finally(() => setGeoLoading(false));
  };

  useEffect(() => { if (tab === 'attendance') loadGeofence(); }, [tab]);

  const saveGeofence = () => {
    setGeoSaving(true);
    setGeoError(null);
    updateGeofenceConfig({
      enabled: geoForm.enabled,
      officeLat: geoForm.officeLat !== '' ? Number(geoForm.officeLat) : null,
      officeLng: geoForm.officeLng !== '' ? Number(geoForm.officeLng) : null,
      geofenceRadiusM: geoForm.geofenceRadiusM !== '' ? Number(geoForm.geofenceRadiusM) : null,
      maxAccuracyM: geoForm.maxAccuracyM !== '' ? Number(geoForm.maxAccuracyM) : null,
    })
      .then(() => { toast('Geofence settings saved', 'success'); loadGeofence(); })
      .catch((err) => setGeoError(err?.response?.data?.message ?? err?.message))
      .finally(() => setGeoSaving(false));
  };

  const pickAccent = (value, label = 'Accent updated') => {
    applyAccent(value);
    setAccent(value);
    toast(label, 'success');
  };

  const resetAppearance = () => {
    applyAccent(null);
    applyUiScale(100);
    applyFont('Inter');
    setAccent(null);
    setUiScale(100);
    setFont('Inter');
    toast('Appearance restored to defaults', 'success');
  };

  const session = meData?.user;
  const remaining = remainingMins(session?.exp);
  const identity = user?.fullName ?? user?.username ?? session?.username ?? 'Account';
  const initial = identity.trim()[0]?.toUpperCase() ?? 'U';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent grid place-items-center ring-1 ring-accent/10">
          <Server size={19} aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display font-bold text-ink text-lg leading-tight">Settings</h2>
          <p className="text-xs text-muted">Workspace, session, and system preferences</p>
        </div>
      </div>

      <div className="tabbar" role="tablist" aria-label="Settings sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`tab flex items-center gap-1.5 ${tab === t.id ? 'tab-active' : ''}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'appearance' && (
        <div className="space-y-4">
          <Panel icon={theme === 'dark' ? Moon : Sun} title="Theme" desc="Light and dark mode inherit the house token system.">
            <div className="flex gap-3">
              <ThemeTile mode="light" active={theme === 'light'} themeLabel="Light" />
              <ThemeTile mode="dark" active={theme === 'dark'} themeLabel="Dark" />
            </div>
          </Panel>

          <Panel icon={Palette} title="Accent" desc="Accent drives buttons, focus rings, and active states.">
            <div className="flex items-center gap-2.5 flex-wrap">
              {ACCENT_PRESETS.map((p) => {
                const active = accent !== null && accent === presetValue(p.token);
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    aria-label={`Set accent to ${p.label}`}
                    onClick={() => pickAccent(presetValue(p.token), `Accent set to ${p.label}`)}
                    className={`w-8 h-8 rounded-full ring-1 ring-offset-2 ring-offset-surface transition ${
                      active ? 'ring-2 ring-accent scale-105' : 'ring-line hover:ring-muted'
                    }`}
                    style={{ backgroundColor: `var(${p.token})` }}
                  />
                );
              })}
              {accent !== null && (
                <button
                  type="button"
                  title="Theme default"
                  aria-label="Restore theme default accent"
                  onClick={() => pickAccent(null, 'Accent restored to theme default')}
                  className="w-8 h-8 rounded-full grid place-items-center ring-1 ring-line ring-offset-2 ring-offset-surface text-muted hover:text-ink hover:ring-muted transition"
                >
                  <Ban size={14} aria-hidden="true" />
                </button>
              )}
              <div className="flex items-center gap-2 ml-2">
                <label htmlFor="custom-accent" className="text-xs text-muted">Custom</label>
                <input
                  id="custom-accent"
                  type="color"
                  value={accent ?? presetValue(ACCENT_PRESETS[0].token)}
                  onChange={(e) => pickAccent(e.target.value, 'Accent updated')}
                  className="w-9 h-8 rounded-lg cursor-pointer border border-line bg-surface p-0.5"
                  aria-label="Pick a custom accent color"
                />
                <span className="mono-label">{accent ?? 'default'}</span>
              </div>
            </div>
          </Panel>

          <Panel icon={Layout} title="UI density" desc="Scales base spacing and type across the app.">
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="80"
                  max="120"
                  step="5"
                  value={uiScale}
                  onChange={(e) => { applyUiScale(e.target.value); setUiScale(Number(e.target.value)); toast('UI density updated', 'success'); }}
                  className="flex-1 accent-[color:var(--accent)]"
                  aria-label="UI density scale"
                />
                <span className="mono-label w-12 text-right tabular-nums">{uiScale}%</span>
              </div>
              <p className="text-xs text-muted">Compact (80%) to comfortable (120%); 100% matches the house default.</p>
            </div>
          </Panel>

          <Panel icon={Type} title="Font family" desc="Self-hosted typefaces only — no external font requests.">
            <div className="grid gap-2.5 sm:grid-cols-3">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { applyFont(f.id); setFont(f.id); toast(`Font set to ${f.label}`, 'success'); }}
                  aria-pressed={font === f.id}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    font === f.id
                      ? 'border-accent ring-1 ring-accent bg-accent/5'
                      : 'border-line hover:bg-bg/60 hover:border-line'
                  }`}
                  style={f.id === 'Inter' ? undefined : { fontFamily: `'${f.id} Variable', '${f.id}', var(--font-sans-fallback)` }}
                >
                  <p className="text-sm font-semibold text-ink flex items-center justify-between">
                    {f.label}
                    {font === f.id && <Check size={14} className="text-accent" aria-hidden="true" />}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{f.desc}</p>
                </button>
              ))}
            </div>
          </Panel>

          <div className="flex justify-end">
            <button type="button" className="btn btn-outline" onClick={resetAppearance}>
              <Ban size={15} aria-hidden="true" /> Restore defaults
            </button>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-4">
          <Panel icon={Bell} title="In-app notifications" desc="Controls everything this workspace surfaces in the browser.">
            <div className="flex items-start justify-between gap-4 py-1">
              <div>
                <label htmlFor="inapp-toggle" className="text-sm font-medium text-ink cursor-pointer">In-app</label>
                <p className="text-xs text-muted mt-0.5">
                  Allow toast alerts and the notification bell feed. When off, toasts are silenced and the bell
                  shows a muted state.
                </p>
              </div>
              <input
                id="inapp-toggle"
                type="checkbox"
                checked={inApp}
                onChange={(e) => {
                  setInAppEnabled(e.target.checked);
                  if (e.target.checked) toast('In-app notifications enabled', 'success');
                }}
                className="w-4 h-4 mt-1 shrink-0 accent-[color:var(--accent)]"
              />
            </div>
          </Panel>

          <Panel icon={BellOff} title="Quiet hours" desc="Non-critical alerts stay silent during this window.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor="quiet-toggle" className="text-sm font-medium text-ink cursor-pointer">Enabled</label>
                  <p className="text-xs text-muted mt-0.5">
                    Suppresses toasts between the start and end times. Overnight spans (e.g. 22:00 → 07:00)
                    are supported. The bell feed is never suppressed — it is user-initiated.
                  </p>
                </div>
                <input
                  id="quiet-toggle"
                  type="checkbox"
                  checked={quiet.enabled}
                  onChange={(e) => {
                    const next = { ...quiet, enabled: e.target.checked };
                    setQuietHours(next);
                    setQuiet(next);
                    toast('Quiet hours updated', 'success');
                  }}
                  className="w-4 h-4 mt-1 shrink-0 accent-[color:var(--accent)]"
                />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted">From</span>
                  <input
                    type="time"
                    value={quiet.start}
                    aria-label="Quiet hours start"
                    onChange={(e) => {
                      const next = { ...quiet, start: e.target.value };
                      setQuietHours(next);
                      setQuiet(next);
                    }}
                    className="input w-36"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted">To</span>
                  <input
                    type="time"
                    value={quiet.end}
                    aria-label="Quiet hours end"
                    onChange={(e) => {
                      const next = { ...quiet, end: e.target.value };
                      setQuietHours(next);
                      setQuiet(next);
                    }}
                    className="input w-36"
                  />
                </div>
              </div>
            </div>
          </Panel>

          <Panel icon={Trash2} title="Notification history" desc="Read and dismissed state lives only in this browser.">
            <button type="button" className="btn btn-outline" onClick={() => { clearNotificationMemory(); toast('Notification history cleared', 'success'); }}>
              <Trash2 size={15} aria-hidden="true" /> Clear notification memory
            </button>
          </Panel>

          <Panel icon={ShieldCheck} title="Other channels" desc="Channel ownership is explicit.">
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              Email, push, and SMS delivery are owned by LGU-HRMS. This workspace exposes only in-app alerts —
              toasts and the notification bell — so no channel here points at a mail or messaging system that
              does not exist.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'account' && (
        <div className="space-y-4">
          <Panel icon={User} title="Profile" desc="Your sign-in identity on this workspace.">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 text-accent grid place-items-center ring-1 ring-accent/10">
                <span className="font-display font-bold text-lg">{initial}</span>
              </div>
              <div>
                <p className="font-display font-semibold text-ink">{identity}</p>
                <p className="mono-label text-[11px] mt-1">{session?.username ?? user?.username ?? 'username'}</p>
              </div>
            </div>
          </Panel>

          <Panel icon={KeyRound} title="Role & scope" desc="Permissions are enforced server-side by role.">
            <div className="divide-y divide-line">
              <SettingRow label="Role">
                <Badge value={session?.role ?? user?.role ?? 'VIEWER'} />
              </SettingRow>
              <SettingRow label="Employee no.">
                <span className="mono-label">{session?.externalId ?? '—'}</span>
              </SettingRow>
              <SettingRow label="Auth model">
                <span className="mono-label">JWT access · 15 min</span>
              </SettingRow>
              <SettingRow label="Session refresh">
                <span className="mono-label">Rotating token · 7 days</span>
              </SettingRow>
            </div>
          </Panel>

          <Panel icon={Activity} title="Current session" desc="Live view of the access token that authenticates this browser.">
            {meLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted py-2">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Verifying session…
              </div>
            ) : meError ? (
              <p className="text-sm text-error py-2">{meError}</p>
            ) : (
              <div className="divide-y divide-line">
                <SettingRow label="Issued">
                  <span className="mono-label">{fmtDate(session.iat)} · {fmtTime(session.iat)}</span>
                </SettingRow>
                <SettingRow label="Expires">
                  <span className="mono-label">{fmtDate(session.exp)} · {fmtTime(session.exp)}</span>
                </SettingRow>
                <SettingRow label="Remaining">{remaining !== null && <span className="mono-label">≈ {remaining} min</span>}</SettingRow>
                <SettingRow label="Session id">
                  <span className="mono-label truncate max-w-48">{String(session.id ?? '—')}</span>
                </SettingRow>
              </div>
            )}
          </Panel>

          <Panel icon={ShieldCheck} title="Identity is owned by LGU-HRMS" desc="This workspace mirrors HRMS identity.">
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              Password, PIN, and two-factor authentication live in LGU-HRMS — they are not
              managed here. Every mutating action made in this workspace is recorded in the
              local audit trail and mirrored to HRMS where applicable.
            </p>
          </Panel>

          <Panel icon={MonitorDown} title="App" desc="Progressive web app — installable and offline-ready.">
            <div className="divide-y divide-line">
              <SettingRow label="Installation">
                {pwa.canInstall ? (
                  <button
                    type="button"
                    className="btn btn-primary px-3 py-1.5 text-xs"
                    onClick={async () => {
                      const ok = await pwa.install();
                      toast(ok ? 'App installed' : 'Installation cancelled', ok ? 'success' : 'info');
                    }}
                  >
                    Install app
                  </button>
                ) : (
                  <Badge value={pwa.installed ? 'ACTIVE' : 'VIEWER'} label={pwa.installed ? 'Installed' : 'Via browser'} />
                )}
              </SettingRow>
              <SettingRow label="Connection">
                <Badge value={pwa.online ? 'ONLINE' : 'OFFLINE'} label={pwa.online ? 'Online' : 'Offline'} />
              </SettingRow>
            </div>
            <p className="text-xs text-muted leading-relaxed mt-4">
              The app shell (interface and login) works offline once it has loaded. Live attendance
              data still needs a connection to the backend. Updates apply automatically on the next
              launch.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'attendance' && canManageAttendance && (
        <div className="space-y-4">
          <Panel
            icon={MapPin}
            title="Punch geofence"
            desc="Where self-service punches are allowed. Lives on the active AttendanceRule, so it applies immediately to every employee."
            action={
              <button
                type="button"
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
                onClick={loadGeofence}
                disabled={geoLoading}
                aria-label="Reload geofence settings"
              >
                {geoLoading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Reload
              </button>
            }
          >
            {geoLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted py-2">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading geofence settings…
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label htmlFor="geofence-toggle" className="text-sm font-medium text-ink cursor-pointer">Enforce geofence</label>
                    <p className="text-xs text-muted mt-0.5">
                      {geo?.enabled
                        ? <>Active — punches outside the radius are rejected.</>
                        : <>Off — punches still require a location fix, but distance is not enforced.</>}
                    </p>
                  </div>
                  <input
                    id="geofence-toggle"
                    type="checkbox"
                    checked={geoForm.enabled}
                    onChange={(e) => setGeoForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="w-4 h-4 mt-1 shrink-0 accent-[color:var(--accent)]"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="geo-lat" className="text-xs text-muted">Office latitude</label>
                    <input
                      id="geo-lat"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={geoForm.officeLat}
                      disabled={!geoForm.enabled}
                      onChange={(e) => setGeoForm((f) => ({ ...f, officeLat: e.target.value }))}
                      placeholder="e.g. 14.5995"
                      className="input"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="geo-lng" className="text-xs text-muted">Office longitude</label>
                    <input
                      id="geo-lng"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={geoForm.officeLng}
                      disabled={!geoForm.enabled}
                      onChange={(e) => setGeoForm((f) => ({ ...f, officeLng: e.target.value }))}
                      placeholder="e.g. 120.9842"
                      className="input"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="geo-radius" className="text-xs text-muted">Radius (meters)</label>
                    <input
                      id="geo-radius"
                      type="number"
                      step="10"
                      min="1"
                      max="10000"
                      value={geoForm.geofenceRadiusM}
                      disabled={!geoForm.enabled}
                      onChange={(e) => setGeoForm((f) => ({ ...f, geofenceRadiusM: e.target.value }))}
                      placeholder="e.g. 200"
                      className="input"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="geo-accuracy" className="text-xs text-muted">Max accuracy (meters)</label>
                    <input
                      id="geo-accuracy"
                      type="number"
                      step="any"
                      min="1"
                      max="5000"
                      value={geoForm.maxAccuracyM}
                      disabled={!geoForm.enabled}
                      onChange={(e) => setGeoForm((f) => ({ ...f, maxAccuracyM: e.target.value }))}
                      placeholder="e.g. 100"
                      className="input"
                    />
                  </div>
                </div>

                {geoError && <p className="text-sm text-error">{geoError}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn btn-primary" onClick={saveGeofence} disabled={geoSaving}>
                    {geoSaving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                    Save settings
                  </button>
                  {geo?.enabled ? <Badge value="ACTIVE" label="Enforced" /> : <Badge value="OFF" label="Not enforced" />}
                </div>

                <p className="text-xs text-muted leading-relaxed">{GEO_HELP_MSG}</p>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'system' && isAdmin && (
        <div className="space-y-4">
          <Panel
            icon={Activity}
            title="Backend health"
            desc="Latency is measured from this browser to the API."
            action={
              <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={runCheck} disabled={checking}>
                {checking ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Check
              </button>
            }
          >
            {!healthInfo ? (
              <div className="flex items-center gap-2 text-xs text-muted py-2">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Contacting backend…
              </div>
            ) : (
              <div className="divide-y divide-line">
                <SettingRow label="Status">
                  {healthInfo.status === 'ok' ? (
                    <Badge value="SUCCESS" label="HEALTHY" />
                  ) : (
                    <Badge value="FAILED" label="UNREACHABLE" />
                  )}
                </SettingRow>
                <SettingRow label="Latency">
                  <span className="mono-label tabular-nums">{healthInfo.latency} ms</span>
                </SettingRow>
                <SettingRow label="Service">
                  <span className="mono-label truncate max-w-64">{healthInfo.service ?? '—'}</span>
                </SettingRow>
                <SettingRow label="API base">
                  <span className="mono-label truncate max-w-72">{API_BASE}</span>
                </SettingRow>
              </div>
            )}
          </Panel>

          <Panel icon={Cpu} title="Environment" desc="The active token values for this browser.">
            <div className="divide-y divide-line">
              <SettingRow label="Theme">
                <span className="mono-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </SettingRow>
              <SettingRow label="Accent">
                {accent ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full ring-1 ring-line" style={{ backgroundColor: `var(--accent)` }} />
                    <span className="mono-label">{accent}</span>
                  </>
                ) : (
                  <span className="mono-label">Theme default</span>
                )}
              </SettingRow>
              <SettingRow label="UI density">
                <span className="mono-label">{uiScale}%</span>
              </SettingRow>
              <SettingRow label="Font family">
                <span className="mono-label">{font}</span>
              </SettingRow>
              <SettingRow label="Storage namespace">
                <span className="mono-label truncate max-w-72">{UI_SCALE_STORAGE.join(', ')}</span>
              </SettingRow>
            </div>
          </Panel>

          <Panel icon={Info} title="About" desc="Deployment & privacy at a glance.">
            <div className="divide-y divide-line">
              <SettingRow label="Version"><span className="mono-label">v1.0.0</span></SettingRow>
              <SettingRow label="Stack"><span className="mono-label">Express 5 · React 19 · Prisma · Postgres</span></SettingRow>
              <SettingRow label="Deployment"><span className="mono-label">On-premise</span></SettingRow>
            </div>
            <p className="text-xs text-muted leading-relaxed mt-4">
              Attendance data is processed as personal information in line with the Data Privacy Act
              of 2012 (RA 10173). Access to this workspace is role-scoped and fully audited.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}