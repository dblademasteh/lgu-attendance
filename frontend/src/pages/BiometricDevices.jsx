import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cpu, Copy, Edit2, Plus, Power, Save, X } from 'lucide-react';
import { list as listDevices, register as registerDevice, update as updateDevice, remove as removeDevice } from '../api/biometric.js';
import Badge from '../components/Badge.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import MasterTable from '../components/MasterTable.jsx';
import Modal from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { useAuth } from '../stores/auth.js';

const SYNC_WRITE_ROLES = ['ADMIN', 'HR_MANAGER'];
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function statusOf(device) {
  if (!device.active) return 'INACTIVE';
  if (device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < ONLINE_WINDOW_MS) return 'ONLINE';
  return 'OFFLINE';
}

const EMPTY_FORM = { deviceId: '', name: '', token: '', model: '', ip: '' };

export default function BiometricDevices() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const canWrite = SYNC_WRITE_ROLES.includes(user?.role);

  const [devices, setDevices] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [token, setToken] = useState(null); // { value, updated } raw token, shown once
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setDevices(await listDevices());
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load devices', 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const reset = () => { setOpen(false); setEditing(null); setForm(EMPTY_FORM); };

  const stats = useMemo(() => {
    const list = devices ?? [];
    return {
      registered: list.length,
      active: list.filter((d) => d.active).length,
      online: list.filter((d) => statusOf(d) === 'ONLINE').length,
    };
  }, [devices]);

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.value);
      toast('Device token copied', 'success');
    } catch {
      toast('Copy failed — select the token manually', 'error');
    }
  };

  const doDeactivate = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      await removeDevice(confirmTarget.id);
      await load();
      toast(`Device "${confirmTarget.name}" deactivated`, 'success');
      setConfirmTarget(null);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Deactivate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        const updated = await updateDevice(editing.id, form);
        if (form.token) setToken({ value: updated.token, updated: true });
        toast(`Device "${updated.name}" updated`, 'success');
      } else {
        const created = await registerDevice(form);
        setToken({ value: created.token, updated: false });
        toast(`Device "${created.name}" registered`, 'success');
      }
      reset();
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Save device failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'device',
      header: 'Device',
      render: (r) => (
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{r.name || '—'}</div>
          <div className="mono-label mt-0.5">{r.deviceId}</div>
        </div>
      ),
    },
    { key: 'model', header: 'Model', render: (r) => r.model || '—' },
    { key: 'ip', header: 'IP / Endpoint', render: (r) => <span className="font-mono">{r.ip || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge value={statusOf(r)} /> },
    { key: 'lastSeenAt', header: 'Last Seen', render: (r) => <span className="font-mono">{formatDateTime(r.lastSeenAt)}</span> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canWrite ? (
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              className="btn btn-ghost px-3 text-xs gap-1"
              onClick={() => { setEditing(r); setForm({ deviceId: r.deviceId, name: r.name, token: '', model: r.model ?? '', ip: r.ip ?? '' }); setOpen(true); }}
            >
              <Edit2 size={13} aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost px-3 text-xs gap-1"
              onClick={() => setConfirmTarget(r)}
            >
              <Power size={13} aria-hidden="true" />
              Deactivate
            </button>
          </div>
        ) : null,
    },
  ];

  const footer = (
    <>
      <button type="button" className="btn" onClick={reset} disabled={busy}>
        <X size={15} aria-hidden="true" />
        Cancel
      </button>
      <button type="submit" form="device-form" className="btn btn-primary" disabled={busy}>
        {editing ? <Save size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        {editing ? 'Save Changes' : 'Register Device'}
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ink">Biometric Devices</h1>
          <p className="text-sm text-muted mt-0.5">Terminals that push punches to this app — devices authenticate with a Bearer token (sha256-hashed at rest).</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="mono-label">{stats.active}/{stats.registered} ACTIVE · {stats.online} ONLINE</div>
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); }}>
              <Plus size={15} aria-hidden="true" />
              Register Device
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Registered" value={stats.registered} hint="total terminals" />
        <StatCard label="Active" value={stats.active} hint="accepting punches" />
        <StatCard label="Online now" value={stats.online} hint="seen in the last 5 min" />
      </div>

      <MasterTable columns={columns} rows={devices ?? []} empty="No devices registered yet — add a terminal so it can POST punches to /api/v1/biometric/:deviceId/punches." />

      <Modal open={open} title={editing ? 'Update Device' : 'Register Device'} onClose={reset} footer={footer}>
        <form id="device-form" onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mono-label" htmlFor="bd-deviceId">Device ID</label>
            <input id="bd-deviceId" className="input mt-1" placeholder="e.g. ZK-EDGE-01" value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} required disabled={!!editing} />
          </div>
          <div>
            <label className="mono-label" htmlFor="bd-name">Name</label>
            <input id="bd-name" className="input mt-1" placeholder="Reception lobby" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="mono-label" htmlFor="bd-token">Device Token</label>
            <input id="bd-token" type="password" className="input mt-1" placeholder={editing ? 'leave blank to keep current' : 'generate a strong secret'} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} required={!editing} />
          </div>
          <div>
            <label className="mono-label" htmlFor="bd-model">Model</label>
            <input id="bd-model" className="input mt-1" placeholder="e.g. ZKTeco F18" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div>
            <label className="mono-label" htmlFor="bd-ip">IP / Endpoint</label>
            <input id="bd-ip" className="input mt-1" placeholder="10.0.1.42" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
          </div>
          <p className="text-xs text-muted">The raw token is shown once and never stored in plaintext (sha256 at rest). Devices authenticate with <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> at</p>
          <p className="text-xs font-mono break-all">POST /api/v1/biometric/:deviceId/punches</p>
        </form>
      </Modal>

      <Modal open={Boolean(token)} title={token?.updated ? 'Token Updated' : 'Device Registered'} onClose={() => setToken(null)}>
        <p className="text-sm text-ink">Copy this device token now — it is shown <strong>only once</strong> (sha256-hashed at rest). A lost token requires re-registering the device.</p>
        <div className="flex items-center gap-2 mt-3">
          <code className="card p-3 flex-1 overflow-x-auto text-xs break-all">{token?.value}</code>
          <button type="button" className="btn btn-outline shrink-0" onClick={copyToken}>
            <Copy size={15} aria-hidden="true" />
            Copy
          </button>
        </div>
        <p className="text-xs text-muted mt-3">Device punches to <span className="font-mono">POST /api/v1/biometric/:deviceId/punches</span>.</p>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title="Deactivate device"
        message={`Deactivate "${confirmTarget?.name}"? It will stop accepting punches until it is registered again.`}
        confirmLabel="Deactivate"
        danger
        busy={busy}
        onClose={() => setConfirmTarget(null)}
        onConfirm={doDeactivate}
      />
    </div>
  );
}