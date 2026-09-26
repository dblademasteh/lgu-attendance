import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Link2, Loader2, Pencil, PlugZap, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { status as syncStatus, logs as syncLogs, run as runSync } from '../api/sync.js';
import { list as listIntegrations, create as createIntegration, update as updateIntegration, remove as removeIntegration, test as testIntegration, run as runIntegration } from '../api/integrations.js';
import { list as listKeys, create as createKey, remove as removeKey } from '../api/apiKeys.js';
import Badge from '../components/Badge.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import MasterTable from '../components/MasterTable.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { useAuth } from '../stores/auth.js';

const SYNC_WRITE_ROLES = ['ADMIN', 'HR_MANAGER'];

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export default function Integration() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const canSync = SYNC_WRITE_ROLES.includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  const [state, setState] = useState(null);
  const [logsData, setLogsData] = useState(null);
  const [keysData, setKeysData] = useState(null);
  const [runOpen, setRunOpen] = useState(false);
  const [keyModal, setKeyModal] = useState(null);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: '', attendanceRead: true, reportsRead: false });
  const [busy, setBusy] = useState(false);
  const [logFilters, setLogFilters] = useState({ status: '', source: '', direction: '', integrationId: '' });

  // Integrations manager (list for ADMIN/HR_MANAGER; mutations ADMIN only).
  const EMPTY_FORM = {
    name: '', provider: 'hrms', baseUrl: '', apiKey: '', webhookSecret: '', webhookSlug: '',
    pollerEnabled: false, intervalMin: '15', timeoutMs: '15000', ingestBase: '/integrations/attendance',
    forwardingEnabled: false, isPrimary: false, isActive: true,
  };
  const [integrations, setIntegrations] = useState([]);
  const [intModalOpen, setIntModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [intForm, setIntForm] = useState(EMPTY_FORM);
  const [intFormError, setIntFormError] = useState(null);
  const [intBusy, setIntBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const receiverUrl = (slug) => (typeof window !== 'undefined' && slug
    ? `${window.location.origin}/api/v1/webhooks/${slug}`
    : '');

  const load = useCallback(async (filters = logFilters) => {
    setBusy(true);
    try {
      const params = { page: 1, limit: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.source) params.source = filters.source;
      if (filters.direction) params.direction = filters.direction;
      if (filters.integrationId) params.integrationId = filters.integrationId;
      const [stateResult, logsResult, integrationsResult] = await Promise.all([
        syncStatus(),
        syncLogs(params),
        listIntegrations().catch(() => []),
      ]);
      setState(stateResult);
      setLogsData(logsResult);
      setIntegrations(Array.isArray(integrationsResult) ? integrationsResult : []);
      if (isAdmin) {
        setKeysData(await listKeys().catch(() => null));
      }
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load integration state', 'error');
    } finally {
      setBusy(false);
    }
  }, [isAdmin, toast, logFilters]);

  useEffect(() => { load(); }, [load]);

  const applyLogFilter = (key, value) => {
    setLogFilters((f) => ({ ...f, [key]: value }));
  };

  const submitRun = async () => {
    setBusy(true);
    try {
      const result = await runSync();
      toast(`Sync ${result.status.toLowerCase()} — ${result.processed} employees processed`, result.status === 'SUCCESS' ? 'success' : 'warning');
      setRunOpen(false);
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Sync failed', 'error');
      setRunOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const submitCreateKey = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const scopes = [];
      if (keyForm.attendanceRead) scopes.push('attendance:read');
      if (keyForm.reportsRead) scopes.push('reports:read');
      const created = await createKey({ name: keyForm.name, scopes });
      setAddKeyOpen(false);
      setKeyForm({ name: '', attendanceRead: true, reportsRead: false });
      setKeyModal(created); // raw key shown once
      await load();
    } catch (err) {
      toast(err?.response?.data?.error?.message ?? 'Create key failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitRemoveKey = async () => {
    if (!keyModal?.deleteId) return;
    setBusy(true);
    try {
      await removeKey(keyModal.deleteId);
      toast('API key revoked', 'success');
      setKeyModal(null);
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Revoke failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const latest = state?.latestSync;
  const counts = state?.counts ?? [];
  const totalEvents = counts.reduce((n, c) => n + (c.count ?? 0), 0);
  const countOf = (status) => counts.find((c) => c.status === status)?.count ?? 0;
  const primary = integrations.find((r) => r.isPrimary) ?? integrations[0] ?? null;

  const copyText = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage, 'success');
    } catch {
      toast('Copy failed — select the text manually', 'error');
    }
  };

  const copyKey = async () => {
    if (!keyModal?.key) return;
    await copyText(keyModal.key, 'API key copied');
  };

  const openCreateIntegration = () => {
    setEditingId(null);
    setIntForm(EMPTY_FORM);
    setIntFormError(null);
    setIntModalOpen(true);
  };

  const openEditIntegration = (row) => {
    setEditingId(row.id);
    setIntForm({
      name: row.name ?? '',
      provider: row.provider ?? 'hrms',
      baseUrl: row.baseUrl ?? '',
      apiKey: '',
      webhookSecret: '',
      webhookSlug: row.webhookSlug ?? '',
      pollerEnabled: row.pollerEnabled,
      intervalMin: String(row.intervalMin ?? 15),
      timeoutMs: String(row.timeoutMs ?? 15000),
      ingestBase: row.attendanceIngestPath ?? '/integrations/attendance',
      forwardingEnabled: row.attendanceForwarding,
      isPrimary: row.isPrimary,
      isActive: row.isActive,
    });
    setIntFormError(null);
    setIntModalOpen(true);
  };

  const submitIntegrationForm = async (e) => {
    e.preventDefault();
    setIntBusy(true);
    setIntFormError(null);
    try {
      const payload = {
        name: intForm.name.trim(),
        provider: intForm.provider,
        baseUrl: intForm.baseUrl.trim(),
        ...(intForm.apiKey ? { apiKey: intForm.apiKey } : {}),
        ...(intForm.webhookSecret ? { webhookSecret: intForm.webhookSecret } : {}),
        webhookSlug: intForm.webhookSlug.trim() || undefined,
        pollerEnabled: intForm.pollerEnabled,
        intervalMin: intForm.intervalMin !== '' ? Number(intForm.intervalMin) : undefined,
        timeoutMs: intForm.timeoutMs !== '' ? Number(intForm.timeoutMs) : undefined,
        ingestBase: intForm.ingestBase.trim() || undefined,
        forwardingEnabled: intForm.forwardingEnabled,
        isPrimary: intForm.isPrimary,
        isActive: intForm.isActive,
      };
      if (editingId) {
        await updateIntegration(editingId, payload);
        toast('Integration updated — applied immediately', 'success');
      } else {
        await createIntegration(payload);
        toast('Integration created', 'success');
      }
      setIntModalOpen(false);
      await load();
    } catch (err) {
      setIntFormError(err?.response?.data?.error?.message ?? 'Failed to save integration');
    } finally {
      setIntBusy(false);
    }
  };

  const submitTestIntegration = async (id, withForm = false) => {
    setRowBusy(id);
    try {
      const body = withForm && editingId === id
        ? {
          ...(intForm.baseUrl.trim() ? { baseUrl: intForm.baseUrl.trim() } : {}),
          ...(intForm.apiKey ? { apiKey: intForm.apiKey } : {}),
        }
        : {};
      const result = await testIntegration(id, body);
      toast(result.message, result.ok ? 'success' : 'error');
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Connection test failed', 'error');
    } finally {
      setRowBusy(null);
    }
  };

  const submitRunIntegration = async (id) => {
    setRowBusy(id);
    try {
      const result = id ? await runIntegration(id) : await runSync();
      toast(`Sync ${String(result.status).toLowerCase()} — ${result.processed} employees processed`, result.status === 'SUCCESS' ? 'success' : 'warning');
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Sync failed', 'error');
    } finally {
      setRowBusy(null);
    }
  };

  const submitDeleteIntegration = async () => {
    if (!deleteTarget) return;
    setIntBusy(true);
    try {
      await removeIntegration(deleteTarget.id);
      toast(`Integration "${deleteTarget.name}" deleted`, 'success');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Delete failed', 'error');
    } finally {
      setIntBusy(false);
    }
  };

  const logColumns = [
    { key: 'createdAt', header: 'When', render: (r) => <span className="font-mono">{formatDateTime(r.createdAt)}</span> },
    { key: 'source', header: 'Source', render: (r) => <Badge value={r.source} /> },
    { key: 'direction', header: 'Direction', render: (r) => <Badge value={r.direction} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'processed', header: 'Processed', render: (r) => <span className="font-mono">{r.processed}</span> },
    { key: 'message', header: 'Message', render: (r) => <span className="text-xs text-muted">{r.message ?? '—'}</span> },
  ];

  const keyColumns = [
    { key: 'name', header: 'Name' },
    { key: 'prefix', header: 'Key', render: (r) => <span className="font-mono">{r.prefix}…</span> },
    { key: 'scopes', header: 'Scopes', render: (r) => <span className="font-mono text-xs">{(r.scopes ?? []).join(', ')}</span> },
    { key: 'active', header: 'Active', render: (r) => <Badge value={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'lastUsedAt', header: 'Last Used', render: (r) => <span className="font-mono">{formatDateTime(r.lastUsedAt)}</span> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-ghost px-3 text-xs gap-1"
            onClick={() => setKeyModal({ ...r, deleteId: r.id })}
          >
            <Trash2 size={13} aria-hidden="true" />
            Revoke
          </button>
        </div>
      ),
    },
  ];

  const intModalFooter = (
    <>
      <button type="button" className="btn" onClick={() => setIntModalOpen(false)} disabled={intBusy}>
        <X size={15} aria-hidden="true" />
        Cancel
      </button>
      <button type="submit" form="integration-form" className="btn btn-primary" disabled={intBusy}>
        <Link2 size={15} aria-hidden="true" />
        {editingId ? 'Save changes' : 'Add integration'}
      </button>
    </>
  );

  const keyModalFooter = (
    <>
      <button type="button" className="btn" onClick={() => setAddKeyOpen(false)} disabled={busy}>
        <X size={15} aria-hidden="true" />
        Cancel
      </button>
      <button type="submit" form="key-form" className="btn btn-primary" disabled={busy}>
        <Plus size={15} aria-hidden="true" />
        Create Key
      </button>
    </>
  );

  const setupSteps = [
    {
      title: 'Create a remote read key',
      body: (
        <>On the external system → Settings → Integrations → <strong>API Keys</strong>, create a key with scopes <span className="font-mono">employees:read</span> (roster pull) and <span className="font-mono">attendance:ingest</span> (punch forwarding), then paste it into the integration&apos;s form below.</>
      ),
    },
    {
      title: 'Register the webhook',
      body: (
        <>On the external system → Settings → Integrations → <strong>Webhooks</strong>, point to the integration&apos;s receiver URL (shown on its row, Copy button included) for events <span className="font-mono">employee.created</span> · <span className="font-mono">employee.updated</span> · <span className="font-mono">employee.deleted</span>. Copy the secret (shown once) into the integration&apos;s webhook secret field. Each integration enforces its own secret.</>
      ),
    },
    {
      title: 'Enable the roster poller',
      body: (
        <>Set <span className="font-mono">HRMS_SYNC_POLLER=1</span> to schedule the roster pull (fallback when webhooks are missed), then restart the backend. Adjust frequency with <span className="font-mono">HRMS_SYNC_INTERVAL_MIN</span>.</>
      ),
    },
    {
      title: 'Expose reads and device punches',
      body: (
        <>External consumers (e.g. HRMS payroll) read attendance back via <span className="font-mono">GET /api/v1/external/attendance</span>, <span className="font-mono">GET /api/v1/external/attendance/:employeeNumber</span>, and <span className="font-mono">GET /api/v1/external/summary</span> with a Bearer API key created below (ADMIN only). Biometric device punches arrive on the same webhook and are paired into daily records (source = <span className="font-mono">DEVICE</span>).</>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ink">Integrations</h1>
          <p className="text-sm text-muted mt-0.5">External systems via API — webhooks, roster polling, and external reads</p>
        </div>
        {canSync ? (
          <button type="button" className="btn btn-primary shrink-0" onClick={() => setRunOpen(true)} disabled={busy}>
            <RefreshCw size={15} aria-hidden="true" />
            Run Sync Now
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="mono-label">Primary Integration</div>
              <h2 className="font-display font-semibold text-ink mt-0.5">{primary?.name ?? 'Connection'}</h2>
            </div>
            <Badge value={primary?.configured ? 'ACTIVE' : 'INACTIVE'} label={primary?.configured ? 'Configured' : 'Not configured'} />
          </div>
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Base URL</span>
              <span className="font-mono text-sm text-ink">{primary?.baseUrl ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">API key</span>
              <Badge value={primary?.apiKeySet ? 'ACTIVE' : 'INACTIVE'} label={primary?.apiKeySet ? 'Set' : 'Missing'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Webhook secret</span>
              <Badge value={primary?.webhookSecretSet ? 'ACTIVE' : 'INACTIVE'} label={primary?.webhookSecretSet ? 'Set' : 'Missing'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Roster poller</span>
              <Badge value={primary?.pollerEnabled ? 'ACTIVE' : 'INACTIVE'} label={primary?.pollerEnabled ? `Every ${primary?.intervalMin} min` : 'Disabled'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Punch forwarding</span>
              <Badge value={primary?.attendanceForwarding ? 'ACTIVE' : 'INACTIVE'} label={primary?.attendanceForwarding ? 'On' : 'Off'} />
            </div>
            {primary?.attendanceForwarding ? (
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Ingest endpoint</span>
                <span className="font-mono text-sm text-ink break-all">{primary?.ingestUrl ?? '—'}</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-line">
            <span className="text-xs text-muted">Sync health</span>
            <div className="flex gap-2">
              <Badge value="SUCCESS" label={`SUCCESS ${countOf('SUCCESS')}`} />
              <Badge value="PARTIAL" label={`PARTIAL ${countOf('PARTIAL')}`} />
              <Badge value="FAILED" label={`FAILED ${countOf('FAILED')}`} />
            </div>
            <span className="mono-label ml-auto">{totalEvents} TOTAL</span>
          </div>
        </div>

        <div className="card p-5">
          <div className="mono-label">Recent Activity</div>
          <h2 className="font-display font-semibold text-ink mt-0.5">Last Sync</h2>
          {latest ? (
            <div className="divide-y divide-line">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">When</span>
                <span className="font-mono text-sm text-ink">{formatDateTime(latest.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Source</span>
                <Badge value={latest.source} />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Direction</span>
                <Badge value={latest.direction} />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Status</span>
                <Badge value={latest.status} />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Processed</span>
                <span className="font-mono text-sm text-ink">{latest.processed}</span>
              </div>
              {latest.message ? (
                <div className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-muted shrink-0">Message</span>
                  <span className="text-sm text-ink text-right">{latest.message}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted mt-3">No sync recorded yet — run one now or enable the poller.</p>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-9 w-9 rounded-lg bg-accent/10 text-accent shrink-0">
              <Link2 size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-ink">External Integrations</h2>
              <p className="text-xs text-muted mt-0.5">
                Each connection runs the same workflow — roster pull, webhooks, forwarding — against its own system.
              </p>
            </div>
          </div>
          {isAdmin ? (
            <button type="button" className="btn btn-outline shrink-0" onClick={openCreateIntegration} disabled={busy}>
              <Plus size={15} aria-hidden="true" />
              Add Integration
            </button>
          ) : null}
        </div>

        <div className="divide-y divide-line mt-2">
          {integrations.length === 0 ? (
            <p className="text-sm text-muted py-3">No integrations yet — add one to connect an external system.</p>
          ) : (
            integrations.map((row) => (
              <div key={row.id} className="py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{row.name}</span>
                  <Badge value={row.provider === 'hrms' ? 'WEBHOOK' : 'POLL'} label={row.provider} />
                  {row.isPrimary ? <Badge value="ACTIVE" label="Primary" /> : null}
                  {!row.isActive ? <Badge value="INACTIVE" label="Disabled" /> : null}
                  <Badge value={row.configured ? 'ACTIVE' : 'INACTIVE'} label={row.configured ? 'Connected' : 'Not configured'} />
                  <span className="mono-label ml-auto">{row.baseUrl ?? 'no URL'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
                  <span>Key: {row.apiKeySet ? <span className="font-mono">{row.apiKeyPreview}</span> : 'missing'}</span>
                  <span>Poller: {row.pollerEnabled ? `every ${row.intervalMin}m` : 'off'}</span>
                  <span>Forwarding: {row.attendanceForwarding ? 'on' : 'off'}</span>
                  <span>Last sync: {row.latestSync ? formatDateTime(row.latestSync.createdAt) : '—'}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted shrink-0">Receiver</span>
                  <span className="font-mono text-xs text-ink truncate">{receiverUrl(row.webhookSlug)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0 px-2 py-1 text-xs"
                    onClick={() => copyText(receiverUrl(row.webhookSlug), 'Webhook URL copied')}
                    aria-label={`Copy webhook URL for ${row.name}`}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost px-3 py-1.5 text-xs"
                    onClick={() => submitTestIntegration(row.id)}
                    disabled={rowBusy === row.id}
                  >
                    {rowBusy === row.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <PlugZap size={13} aria-hidden="true" />}
                    Test
                  </button>
                  {canSync ? (
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => submitRunIntegration(row.id)}
                      disabled={rowBusy === row.id}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      Sync now
                    </button>
                  ) : null}
                  {isAdmin ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => openEditIntegration(row)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal open={intModalOpen} title={editingId ? 'Edit Integration' : 'Add Integration'} onClose={() => setIntModalOpen(false)} footer={intModalFooter}>
        <form id="integration-form" onSubmit={submitIntegrationForm} className="flex flex-col gap-3">
          {editingId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg/60 px-3 py-2">
              <span className="text-xs text-muted">Receiver URL</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-ink truncate">{receiverUrl(intForm.webhookSlug || integrations.find((r) => r.id === editingId)?.webhookSlug)}</span>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-2 py-1 text-xs"
                  onClick={() => copyText(receiverUrl(intForm.webhookSlug || integrations.find((r) => r.id === editingId)?.webhookSlug), 'Webhook URL copied')}
                  aria-label="Copy webhook receiver URL"
                >
                  <Copy size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="mono-label" htmlFor="int-name">Name</label>
              <input
                id="int-name"
                className="input"
                placeholder="e.g. LGU-HRMS"
                value={intForm.name}
                onChange={(e) => setIntForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-provider">Provider</label>
              <select
                id="int-provider"
                className="select"
                value={intForm.provider}
                onChange={(e) => setIntForm((f) => ({ ...f, provider: e.target.value }))}
              >
                <option value="hrms">hrms</option>
                <option value="generic">generic</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-slug">Webhook slug (optional)</label>
              <input
                id="int-slug"
                className="input font-mono"
                placeholder="auto from name"
                value={intForm.webhookSlug}
                onChange={(e) => setIntForm((f) => ({ ...f, webhookSlug: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-base-url">Base URL</label>
              <input
                id="int-base-url"
                className="input font-mono"
                placeholder="http://localhost:4000/api/v1"
                value={intForm.baseUrl}
                onChange={(e) => setIntForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-ingest">Ingest base path</label>
              <input
                id="int-ingest"
                className="input font-mono"
                placeholder="/integrations/attendance"
                value={intForm.ingestBase}
                onChange={(e) => setIntForm((f) => ({ ...f, ingestBase: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-api-key">API key</label>
              <input
                id="int-api-key"
                type="password"
                className="input font-mono"
                placeholder={editingId ? 'Saved — blank keeps it' : 'Not set'}
                value={intForm.apiKey}
                onChange={(e) => setIntForm((f) => ({ ...f, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-secret">Webhook secret</label>
              <input
                id="int-secret"
                type="password"
                className="input font-mono"
                placeholder={editingId ? 'Saved — blank keeps it' : 'Not set'}
                value={intForm.webhookSecret}
                onChange={(e) => setIntForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-interval">Poll every (minutes)</label>
              <input
                id="int-interval"
                type="number"
                min="1"
                max="1440"
                className="input"
                value={intForm.intervalMin}
                disabled={!intForm.pollerEnabled}
                onChange={(e) => setIntForm((f) => ({ ...f, intervalMin: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="int-timeout">Timeout (ms)</label>
              <input
                id="int-timeout"
                type="number"
                min="1000"
                max="120000"
                step="1000"
                className="input"
                value={intForm.timeoutMs}
                onChange={(e) => setIntForm((f) => ({ ...f, timeoutMs: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={intForm.pollerEnabled}
                onChange={(e) => setIntForm((f) => ({ ...f, pollerEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Roster poller
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={intForm.forwardingEnabled}
                onChange={(e) => setIntForm((f) => ({ ...f, forwardingEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Forward punches
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={intForm.isPrimary}
                onChange={(e) => setIntForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Primary
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={intForm.isActive}
                onChange={(e) => setIntForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Enabled
            </label>
          </div>

          {editingId ? (
            <button
              type="button"
              className="btn btn-outline self-start"
              onClick={() => submitTestIntegration(editingId, true)}
              disabled={intBusy || rowBusy === editingId}
            >
              {rowBusy === editingId ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
              Test with these values
            </button>
          ) : null}

          {intFormError && <p className="text-sm text-error">{intFormError}</p>}
          <p className="text-xs text-muted leading-relaxed">
            Test probes with what you typed (blank secrets probe the saved values) — nothing is
            stored. Save encrypts secrets at rest, writes the audit trail, and reconciles the
            poller immediately.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Integration"
        message={`Delete "${deleteTarget?.name}"? Roster rows already synced stay untouched; future polls, webhooks, and forwards for it stop.`}
        confirmLabel="Delete"
        danger
        busy={intBusy}
        onConfirm={submitDeleteIntegration}
        onClose={() => setDeleteTarget(null)}
      />

      <div className="card p-5">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-accent/10 text-accent shrink-0">
            <PlugZap size={16} aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-ink">Biometric Ingestion</h2>
            <p className="text-xs text-muted mt-0.5">How device punches flow in and out</p>
          </div>
        </div>
        <div className="divide-y divide-line mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Inbound (device → app)</span>
            <span className="font-mono text-sm text-ink">POST /biometric/:deviceId/punches</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Also accepted</span>
            <span className="font-mono text-sm text-ink">biometric.punch / biometric.punch_batch (HRMS webhook)</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Pairing</span>
            <span className="text-sm text-ink text-right">earliest punch → timeIn, latest → timeOut (per Manila day, per employee)</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Direction-aware</span>
            <span className="text-sm text-ink text-right">incremental IN/OUT events merge instead of clobbering</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Raw log</span>
            <span className="font-mono text-sm text-ink">BiometricPunch table</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm text-muted">Outbound (app → systems)</span>
            <span className="font-mono text-sm text-ink break-all">{primary?.attendanceForwarding ? `${primary?.ingestUrl || '/integrations/attendance'} (on)` : 'off'}</span>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mono-label">Setup</div>
        <h2 className="font-display font-semibold text-ink mt-0.5">Connecting this system to LGU-HRMS</h2>
        <div className="space-y-4 mt-4">
          {setupSteps.map((step, i) => (
            <div key={step.title} className="flex gap-3">
              <div className="grid place-items-center h-7 w-7 rounded-lg border border-line font-mono text-xs font-medium text-ink shrink-0 mt-0.5">
                {i + 1}
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="text-sm text-muted mt-0.5">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <div className="mono-label">Sync Log</div>
            <span className="mono-label text-muted">{logsData?.total ?? 0} EVENTS</span>
          </div>
          <Badge value={integrations.some((r) => r.configured) ? 'ACTIVE' : 'INACTIVE'} label={integrations.some((r) => r.configured) ? 'Live' : 'Unconfigured'} />
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            className="select w-auto text-xs"
            aria-label="Filter sync log by status"
            value={logFilters.status}
            onChange={(e) => applyLogFilter('status', e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select
            className="select w-auto text-xs"
            aria-label="Filter sync log by source"
            value={logFilters.source}
            onChange={(e) => applyLogFilter('source', e.target.value)}
          >
            <option value="">All sources</option>
            <option value="WEBHOOK">WEBHOOK</option>
            <option value="POLL">POLL</option>
          </select>
          <select
            className="select w-auto text-xs"
            aria-label="Filter sync log by direction"
            value={logFilters.direction}
            onChange={(e) => applyLogFilter('direction', e.target.value)}
          >
            <option value="">All directions</option>
            <option value="INBOUND">INBOUND</option>
            <option value="PULL">PULL</option>
            <option value="OUTBOUND">OUTBOUND</option>
          </select>
          <select
            className="select w-auto text-xs"
            aria-label="Filter sync log by integration"
            value={logFilters.integrationId}
            onChange={(e) => applyLogFilter('integrationId', e.target.value)}
          >
            <option value="">All integrations</option>
            {integrations.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </div>
        <MasterTable columns={logColumns} rows={logsData?.items ?? []} empty="No sync events recorded yet." />
      </div>

      {isAdmin ? (
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="mono-label">External Consumers</div>
              <h2 className="font-display font-semibold text-ink">API Keys</h2>
            </div>
            <button type="button" className="btn btn-outline shrink-0" onClick={() => setAddKeyOpen(true)} disabled={busy}>
              <Plus size={15} aria-hidden="true" />
              Create Key
            </button>
          </div>
          <MasterTable columns={keyColumns} rows={keysData?.items ?? []} empty="No API keys yet — create one for HRMS payroll or another consumer." />
        </div>
      ) : null}

      <ConfirmDialog
        open={runOpen}
        title="Run HRMS Sync"
        message="Pull the full employee roster from the HRMS API now? Existing employees are updated (upsert by employee number); this is safe to repeat."
        confirmLabel="Run Sync"
        busy={busy}
        onConfirm={submitRun}
        onClose={() => setRunOpen(false)}
      />

      <Modal open={addKeyOpen} title="Create API Key" onClose={() => setAddKeyOpen(false)} footer={keyModalFooter}>
        <form id="key-form" onSubmit={submitCreateKey} className="flex flex-col gap-3">
          <div>
            <label className="mono-label" htmlFor="k-name">Name</label>
            <input id="k-name" className="input mt-1" placeholder="e.g. HRMS payroll" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} required />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mono-label">Scopes</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={keyForm.attendanceRead} onChange={(e) => setKeyForm({ ...keyForm, attendanceRead: e.target.checked })} />
              <span className="font-mono">attendance:read</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={keyForm.reportsRead} onChange={(e) => setKeyForm({ ...keyForm, reportsRead: e.target.checked })} />
              <span className="font-mono">reports:read</span>
            </label>
          </fieldset>
        </form>
      </Modal>

      <Modal open={Boolean(keyModal?.key)} title="API Key Created" onClose={() => setKeyModal(null)}>
        <p className="text-sm text-ink">Copy this key now — it is shown <strong>only once</strong> (sha256-hashed at rest).</p>
        <div className="flex items-center gap-2 mt-3">
          <code className="card p-3 flex-1 overflow-x-auto text-xs break-all">{keyModal?.key}</code>
          <button type="button" className="btn btn-outline shrink-0" onClick={copyKey}>
            <Copy size={15} aria-hidden="true" />
            Copy
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(keyModal?.deleteId)}
        title="Revoke API Key"
        message={`Revoke "${keyModal?.name}"? Any consumer using it will immediately lose access.`}
        confirmLabel="Revoke"
        danger
        busy={busy}
        onConfirm={submitRemoveKey}
        onClose={() => setKeyModal(null)}
      />
    </div>
  );
}