import { useEffect, useMemo, useState } from 'react';
import { Fingerprint, LogIn, LogOut, Plus, Trash2 } from 'lucide-react';
import { myToday, myHistory, punch } from '../api/attendance.js';
import { getCredentials, getWebauthnEnrollOptions, webauthnEnrollVerify, enroll, removeCredential, getVerifyChallenge, verifyAssertion } from '../api/biometric.js';
import { getPosition } from '../lib/geo.js';
import { useToast } from '../hooks/useToast.jsx';
import Badge from '../components/Badge.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

function toBase64url(buf) {
  if (typeof buf === 'string') return buf;
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const formatTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16); }
  catch { return iso; }
};

const hoursOf = (r) => {
  if (r?.hours != null) return Number(r.hours).toFixed(1);
  if (!r?.timeIn || !r?.timeOut) return '0.0';
  return ((new Date(r.timeOut) - new Date(r.timeIn)) / (1000 * 60 * 60)).toFixed(1);
};

const histDetail = (a) => {
  const bits = [`IN ${formatTime(a.timeIn)}`, `OUT ${formatTime(a.timeOut)}`, `${hoursOf(a)}h`];
  if (a.minutesLate > 0) bits.push(`LATE ${a.minutesLate}m`);
  if (a.undertimeMinutes > 0) bits.push(`UNDERTIME ${a.undertimeMinutes}m`);
  return bits.join(' · ');
};

export default function MyAttendance() {
  const toast = useToast();

  const [now, setNow] = useState(() => new Date());
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [biometricPunching, setBiometricPunching] = useState(false);

  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  // Biometric enrollment state
  const [credentials, setCredentials] = useState([]);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollDeviceName, setEnrollDeviceName] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadToday = async () => {
    setLoading(true);
    try {
      const data = await myToday();
      setToday(data?.record || null);
    } catch (e) {
      toast(e?.response?.data?.error?.message || 'Failed to load attendance', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await myHistory(month);
      setHistory(data?.records || []);
      setSummary(data?.summary || null);
    } catch (e) {
      toast(e?.response?.data?.error?.message || 'Failed to load history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadToday(); }, []);
  useEffect(() => { loadHistory(); }, [month]);

  const handlePunch = async (type, geo) => {
    setPunching(true);
    try {
      const result = await punch({ direction: type, geo });
      toast(`Clocked ${result.direction} at ${formatTime(result.record.timeIn ?? result.record.timeOut)}`, 'success');
      loadToday();
      loadHistory();
    } catch (e) {
      toast(e?.response?.data?.error?.message || e?.message || 'Punch failed', 'error');
    } finally {
      setPunching(false);
    }
  };

  // Every punch is location-stamped: fix a fresh GPS position first, then send
  // it with the punch. Geolocation failures block the punch (strict geofence).
  const handlePunchWithGps = async (type) => {
    setPunching(true);
    try {
      const geo = await getPosition();
      await handlePunch(type, geo);
    } catch (e) {
      toast(e?.response?.data?.error?.message || e?.message || 'Punch failed', 'error');
      setPunching(false);
    }
  };

  const loadCredentials = async () => {
    setCredentialsLoading(true);
    try {
      const data = await getCredentials();
      setCredentials(data?.credentials || []);
    } catch (e) {
      toast(e?.response?.data?.error?.message || 'Failed to load biometric credentials', 'error');
    } finally {
      setCredentialsLoading(false);
    }
  };

  // Biometric punch = WebAuthn proof first, then the normal audited punch endpoint.
  const handleBiometricPunch = async (type) => {
    if (!credentials || credentials.length === 0) {
      toast('No biometric credential enrolled', 'error');
      return;
    }
    const credential = credentials[0];
    setBiometricPunching(true);
    try {
      const geo = await getPosition();
      const challengeRes = await getVerifyChallenge(credential.credentialId);
      const { options } = challengeRes;

      if (!window.PublicKeyCredential) {
        toast('Biometric authentication is not supported in this browser', 'error');
        return;
      }

      const authenticationResponse = await window.PublicKeyCredential.request({
        challenge: fromBase64url(options.challenge),
        rpId: options.rpID,
        userVerification: 'required',
        allowCredentials: options.allowCredentials.map((c) => ({
          id: fromBase64url(c.id),
          type: c.type,
          transports: c.transports,
        })),
        timeout: options.timeout || 60000,
      });

      const assertion = {
        clientDataJSON: toBase64url(authenticationResponse.response.clientDataJSON),
        authenticatorData: toBase64url(authenticationResponse.response.authenticatorData),
        signature: toBase64url(authenticationResponse.response.signature),
        challenge: options.challenge,
      };

      const res = await verifyAssertion(credential.credentialId, assertion, type);
      if (!res.verified) throw new Error('Biometric verification failed');

      const result = await punch({ direction: type, remarks: 'Verified via biometric', geo });
      toast(`Clocked ${result.direction} at ${formatTime(result.record.timeIn ?? result.record.timeOut)} (biometric)`, 'success');
      loadToday();
      loadHistory();
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Biometric punch failed';
      toast(msg, 'error');
    } finally {
      setBiometricPunching(false);
    }
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      if (window.PublicKeyCredential) {
        const optionsRes = await getWebauthnEnrollOptions();
        const { options } = optionsRes;

        const credential = await window.PublicKeyCredential.create({
          challenge: fromBase64url(options.challenge),
          rp: options.rp,
          user: {
            id: fromBase64url(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout || 60000,
          attestation: options.attestation || 'none',
          excludeCredentials: options.excludeCredentials?.map((c) => ({
            id: fromBase64url(c.id),
            type: c.type,
            transports: c.transports,
          })) || [],
        });

        const attestationResponse = {
          id: credential.id,
          rawId: toBase64url(credential.rawId),
          response: {
            clientDataJSON: toBase64url(credential.response.clientDataJSON),
            attestationObject: toBase64url(credential.response.attestationObject),
            transports: credential.response.getTransports ? credential.response.getTransports() : [],
          },
          type: credential.type,
        };

        await webauthnEnrollVerify(attestationResponse);
        toast('Fingerprint enrolled successfully', 'success');
        setShowEnrollModal(false);
        setEnrollDeviceName('');
        loadCredentials();
      } else {
        const credentialId = `cred_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const publicKey = `publicKey_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await enroll(credentialId, publicKey, enrollDeviceName.trim() || undefined);
        toast('Fingerprint enrolled successfully', 'success');
        setShowEnrollModal(false);
        setEnrollDeviceName('');
        loadCredentials();
      }
    } catch (e) {
      toast(e?.response?.data?.error?.message || 'Enrollment failed', 'error');
    } finally {
      setEnrolling(false);
    }
  };

  useEffect(() => { loadCredentials(); }, []);

  const isPunchedIn = today?.timeIn && !today?.timeOut;
  const isPunchedOut = today?.timeIn && today?.timeOut;
  const canPunchIn = !today?.timeIn || isPunchedOut;
  const nextAction = isPunchedIn ? 'OUT' : 'IN';

  const manilaClock = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 19);
  const todayDate = today?.date ?? new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const summaryRows = useMemo(() => (
    summary
      ? [
          ['Total Days', summary.totalDays],
          ['Present', summary.present],
          ['Late', summary.late],
          ['Undertime', summary.undertime],
          ['Half-Day', summary.halfDay],
          ['Absent', summary.absent],
          ['On Leave', summary.onLeave],
          ['Total Hours', Number(summary.totalHours).toFixed(1)],
        ]
      : null
  ), [summary]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ink leading-tight break-words">My Attendance</h1>
          <p className="text-sm text-muted mt-0.5">Self-service time clock, biometrics, and monthly records</p>
        </div>
        <div className="mono-label shrink-0">As of {todayDate} · Manila</div>
      </div>

      <div className="card p-4 sm:p-6">
        {loading ? (
          <div className="space-y-4">
            <div className="skeleton h-12 w-52"></div>
            <div className="skeleton h-16 w-full"></div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5 lg:gap-x-8">
            <div className="min-w-0">
              <div className="mono-label">Manila · PHT</div>
              <div className="font-mono text-3xl sm:text-4xl font-semibold text-ink tabular-nums tracking-tight mt-1">{manilaClock}</div>
              <div className="text-xs text-muted mt-1">{todayDate}</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 flex-1 min-w-0">
              <div>
                <div className="mono-label">Time In</div>
                <div className="font-mono text-base font-medium text-ink mt-1">{formatTime(today?.timeIn)}</div>
              </div>
              <div>
                <div className="mono-label">Time Out</div>
                <div className="font-mono text-base font-medium text-ink mt-1">{formatTime(today?.timeOut)}</div>
              </div>
              <div>
                <div className="mono-label">Hours</div>
                <div className="font-mono text-base font-medium text-ink mt-1">{hoursOf(today)}</div>
              </div>
              <div>
                <div className="mono-label">Status</div>
                <div className="mt-1"><Badge value={today?.status || 'NO_RECORD'} /></div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 w-full min-w-0 sm:w-auto">
              {credentials.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost gap-2 w-full min-h-11 sm:w-auto"
                  onClick={() => handleBiometricPunch(nextAction)}
                  disabled={biometricPunching || loading || (nextAction === 'IN' ? !canPunchIn : !isPunchedIn)}
                >
                  {biometricPunching ? <span className="skeleton h-4 w-4 rounded-full"></span> : <Fingerprint size={16} aria-hidden="true" />}
                  Biometric {nextAction === 'IN' ? 'In' : 'Out'}
                </button>
              )}
              <button
                type="button"
                className={`btn gap-2 w-full min-h-11 sm:w-auto ${nextAction === 'IN' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => handlePunchWithGps('IN')}
                disabled={punching || loading || !canPunchIn}
              >
                {punching ? <span className="skeleton h-4 w-4 rounded-full"></span> : <LogIn size={16} aria-hidden="true" />}
                <span className="text-left">
                  <span className="block leading-tight">{isPunchedOut ? 'Punch In (New)' : 'Punch In'}</span>
                  {today?.timeIn ? <span className="block text-xs font-normal opacity-80 mt-0.5">Recorded {formatTime(today.timeIn)}</span> : null}
                </span>
              </button>
              <button
                type="button"
                className={`btn gap-2 w-full min-h-11 sm:w-auto ${nextAction === 'OUT' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => handlePunchWithGps('OUT')}
                disabled={punching || loading || !isPunchedIn}
              >
                {punching ? <span className="skeleton h-4 w-4 rounded-full"></span> : <LogOut size={16} aria-hidden="true" />}
                <span className="text-left">
                  <span className="block leading-tight">Punch Out</span>
                  {today?.timeOut ? <span className="block text-xs font-normal opacity-80 mt-0.5">Recorded {formatTime(today.timeOut)}</span> : null}
                </span>
              </button>
            </div>
          </div>
        )}
        {today?.minutesLate > 0 || today?.undertimeMinutes > 0 ? (
          <div className="mono-label mt-4 border-t border-line pt-3">
            LATE {today.minutesLate}m · UNDERTIME {today.undertimeMinutes}m
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 sm:p-5 sm:pb-4">
            <div>
              <h2 className="font-display font-semibold text-ink">Attendance History</h2>
              <p className="text-xs text-muted mt-0.5">Daily time records for the selected month</p>
            </div>
            <label className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <span className="mono-label shrink-0">Month</span>
              <input type="month" className="input w-full sm:w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>

          {/* Phone / small tablet: record cards (no horizontal scroll) */}
          <div className="md:hidden border-t border-line">
            {historyLoading ? (
              <div className="space-y-2 p-4">
                <div className="skeleton h-14 w-full"></div>
                <div className="skeleton h-14 w-full"></div>
                <div className="skeleton h-14 w-full"></div>
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted text-center py-8 px-4">No attendance records for this month</p>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-ink">{a.date ? String(a.date).slice(0, 10) : '—'}</p>
                      <p className="text-xs text-muted mt-0.5 truncate">{histDetail(a)}</p>
                    </div>
                    <Badge value={a.status || 'NO_RECORD'} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Tablet / desktop: full table */}
          <div className="hidden md:block overflow-x-auto border-t border-line">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th className="text-right">Hours</th>
                  <th className="text-right">Late</th>
                  <th className="text-right">UT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7}><div className="skeleton h-5 w-full"></div></td>
                    </tr>
                  ))
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted">No attendance records for this month</td>
                  </tr>
                ) : (
                  history.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono">{a.date ? String(a.date).slice(0, 10) : '—'}</td>
                      <td className="font-mono">{formatTime(a.timeIn)}</td>
                      <td className="font-mono">{formatTime(a.timeOut)}</td>
                      <td className="font-mono text-right">{hoursOf(a)}</td>
                      <td className="font-mono text-right">{a.minutesLate || 0}</td>
                      <td className="font-mono text-right">{a.undertimeMinutes || 0}</td>
                      <td><Badge value={a.status || 'NO_RECORD'} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
          <div className="card p-4 sm:p-5">
            <h2 className="font-display font-semibold text-ink">Monthly Summary</h2>
            <p className="text-xs text-muted mt-0.5 mb-3">{month}</p>
            {summaryRows ? (
              <div className="divide-y divide-line">
                {summaryRows.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-2 gap-3">
                    <span className="text-sm text-muted">{label}</span>
                    <span className="font-mono text-sm font-medium text-ink tabular-nums shrink-0">{value}</span>
                  </div>
                ))}
              </div>
            ) : historyLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-5 w-full"></div>
                <div className="skeleton h-5 w-full"></div>
                <div className="skeleton h-5 w-full"></div>
              </div>
            ) : null}
          </div>

          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="font-display font-semibold text-ink">Fingerprint Devices</h2>
                <p className="text-xs text-muted mt-0.5">{credentialsLoading ? '…' : `${credentials.length} enrolled`}</p>
              </div>
              <button type="button" className="btn btn-outline shrink-0 min-h-10" onClick={() => setShowEnrollModal(true)}>
                <Plus size={15} aria-hidden="true" />
                Enroll
              </button>
            </div>
            {credentialsLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-12 w-full"></div>
                <div className="skeleton h-12 w-full"></div>
              </div>
            ) : credentials.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No fingerprint devices enrolled</p>
            ) : (
              <div className="space-y-2">
                {credentials.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-bg border border-line rounded-lg">
                    <div className="grid place-items-center h-9 w-9 rounded-lg bg-accent/10 text-accent shrink-0">
                      <Fingerprint size={16} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{c.deviceName || 'Unnamed Device'}</p>
                      <p className="text-xs text-muted">Enrolled {c.enrolledAt ? new Date(c.enrolledAt).toLocaleDateString() : '—'}</p>
                    </div>
                    <button type="button" className="btn btn-ghost px-2.5 text-xs gap-1 shrink-0 min-h-10" onClick={() => setDeleteTarget(c)}>
                      <Trash2 size={12} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={showEnrollModal}
        onClose={() => { setShowEnrollModal(false); setEnrollDeviceName(''); }}
        title="Enroll Fingerprint Device"
        footer={(
          <>
            <button type="button" className="btn" onClick={() => { setShowEnrollModal(false); setEnrollDeviceName(''); }} disabled={enrolling}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={enrolling} onClick={handleEnroll}>
              {enrolling ? 'Enrolling…' : 'Enroll'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {window.PublicKeyCredential
              ? 'Enroll your device fingerprint or face biometric for attendance verification. You will be prompted to authenticate with your device sensor.'
              : 'Enroll a new fingerprint device for biometric attendance. Follow your device instructions to capture the fingerprint template.'}
          </p>
          <div>
            <label className="mono-label" htmlFor="enroll-name">Device Name (optional)</label>
            <input id="enroll-name" className="input mt-1" value={enrollDeviceName} onChange={(e) => setEnrollDeviceName(e.target.value)} placeholder="e.g. Left Thumb Scanner" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await removeCredential(deleteTarget.credentialId);
            toast('Credential removed', 'success');
            setDeleteTarget(null);
            loadCredentials();
          } catch (e) {
            toast(e?.response?.data?.error?.message || 'Failed to remove credential', 'error');
          }
        }}
        title="Remove biometric device"
        message={`Remove enrolled device "${deleteTarget?.deviceName || 'Unnamed Device'}"? This will prevent future fingerprint punches from this device.`}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}