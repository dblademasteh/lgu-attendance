import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Link2, Loader2, PlugZap, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { status as syncStatus, logs as syncLogs, run as runSync, getConfig as getSyncConfig, updateConfig as updateSyncConfig, testConnection as testSyncConnection } from '../api/sync.js';
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
  const [logFilters, setLogFilters] = useState({ status: '', source: '', direction: '' });

  // HRMS connect form (ADMIN only — secrets involved).
  const [cfg, setCfg] = useState(null);
  const [cfgForm, setCfgForm] = useState({
    baseUrl: '', apiKey: '', webhookSecret: '', pollerEnabled: false,
    intervalMin: '', timeoutMs: '', ingestPath: '', forwardingEnabled: false,
  });
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgTesting, setCfgTesting] = useState(false);
  const [cfgError, setCfgError] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1/webhooks/hrms` : '/api/v1/webhooks/hrms';

  const load = useCallback(async (filters = logFilters) => {
    setBusy(true);
    try {
      const params = { page: 1, limit: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.source) params.source = filters.source;
      if (filters.direction) params.direction = filters.direction;
      const [stateResult, logsResult] = await Promise.all([
        syncStatus(),
        syncLogs(params),
      ]);
      setState(stateResult);
      setLogsData(logsResult);
      if (isAdmin) {
        setKeysData(await listKeys().catch(() => null));
        const cfgResult = await getSyncConfig().catch(() => null);
        setCfg(cfgResult);
        if (cfgResult) {
          setCfgForm({
            baseUrl: cfgResult.baseUrl ?? '',
            apiKey: '',
            webhookSecret: '',
            pollerEnabled: cfgResult.pollerEnabled,
            intervalMin: String(cfgResult.intervalMin ?? 15),
            timeoutMs: String(cfgResult.timeoutMs ?? 15000),
            ingestPath: cfgResult.attendanceIngestPath ?? '/integrations/attendance',
            forwardingEnabled: cfgResult.attendanceForwarding,
          });
        }
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

  const copyKey = async () => {
    if (!keyModal?.key) return;
    try {
      await navigator.clipboard.writeText(keyModal.key);
      toast('API key copied', 'success');
    } catch {
      toast('Copy failed — select the key manually', 'error');
    }
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast('Webhook URL copied — paste it into HRMS', 'success');
    } catch {
      toast('Copy failed — select the URL manually', 'error');
    }
  };

  const submitTestConnection = async () => {
    setCfgTesting(true);
    setCfgError(null);
    setTestResult(null);
    try {
      // Blank secret fields probe the saved values; typed values probe first.
      const result = await testSyncConnection({
        ...(cfgForm.baseUrl ? { baseUrl: cfgForm.baseUrl } : {}),
        ...(cfgForm.apiKey ? { apiKey: cfgForm.apiKey } : {}),
      });
      setTestResult(result);
      toast(result.message, result.ok ? 'success' : 'error');
    } catch (e) {
      const message = e?.response?.data?.error?.message ?? 'Connection test failed';
      setTestResult({ ok: false, message });
      toast(message, 'error');
    } finally {
      setCfgTesting(false);
    }
  };

  const submitSaveConfig = async () => {
    setCfgSaving(true);
    setCfgError(null);
    try {
      const updated = await updateSyncConfig({
        baseUrl: cfgForm.baseUrl,
        ...(cfgForm.apiKey ? { apiKey: cfgForm.apiKey } : {}),
        ...(cfgForm.webhookSecret ? { webhookSecret: cfgForm.webhookSecret } : {}),
        pollerEnabled: cfgForm.pollerEnabled,
        intervalMin: cfgForm.intervalMin !== '' ? Number(cfgForm.intervalMin) : undefined,
        timeoutMs: cfgForm.timeoutMs !== '' ? Number(cfgForm.timeoutMs) : undefined,
        ingestPath: cfgForm.ingestPath || undefined,
        forwardingEnabled: cfgForm.forwardingEnabled,
      });
      setCfg(updated);
      setCfgForm((f) => ({ ...f, apiKey: '', webhookSecret: '' }));
      toast('HRMS connection saved — applied immediately', 'success');
      await load();
    } catch (e) {
      setCfgError(e?.response?.data?.error?.message ?? 'Failed to save configuration');
    } finally {
      setCfgSaving(false);
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
      title: 'Create an HRMS read key',
      body: (
        <>In LGU-HRMS → Settings → Integrations → <strong>API Keys</strong>, create a key with scopes <span className="font-mono">employees:read</span> (roster pull) and <span className="font-mono">attendance:ingest</span> (punch forwarding), then paste it into the HRMS Connection card below.</>
      ),
    },
    {
      title: 'Register the webhook',
      body: (
        <>In LGU-HRMS → Settings → Integrations → <strong>Webhooks</strong>, point to the receiver URL in the HRMS Connection card for events <span className="font-mono">employee.created</span> · <span className="font-mono">employee.updated</span> · <span className="font-mono">employee.deleted</span> (the three HRMS emits today; biometric/leave events are accepted for future use). Copy the secret (shown once) into the card&apos;s webhook secret field. HRMS-approved leaves arrive as local leave rows and drive <span className="font-mono">ON_LEAVE</span> in the absent backfill once HRMS emits them.</>
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
          <h1 className="font-display text-xl font-bold text-ink">HRMS Integration</h1>
          <p className="text-sm text-muted mt-0.5">LGU-HRMS via API — webhooks, roster polling, and external reads</p>
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
              <div className="mono-label">Integration Config</div>
              <h2 className="font-display font-semibold text-ink mt-0.5">Connection</h2>
            </div>
            <Badge value={state?.configured ? 'ACTIVE' : 'INACTIVE'} label={state?.configured ? 'Configured' : 'Not configured'} />
          </div>
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">HRMS base URL</span>
              <span className="font-mono text-sm text-ink">{state?.baseUrl ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">API key</span>
              <Badge value={state?.apiKeySet ? 'ACTIVE' : 'INACTIVE'} label={state?.apiKeySet ? 'Set' : 'Missing'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Webhook secret</span>
              <Badge value={state?.webhookSecretSet ? 'ACTIVE' : 'INACTIVE'} label={state?.webhookSecretSet ? 'Set' : 'Missing'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Roster poller</span>
              <Badge value={state?.pollerEnabled ? 'ACTIVE' : 'INACTIVE'} label={state?.pollerEnabled ? `Every ${state?.intervalMin} min` : 'Disabled'} />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted">Punch forwarding</span>
              <Badge value={state?.attendanceForwarding ? 'ACTIVE' : 'INACTIVE'} label={state?.attendanceForwarding ? 'To HRMS' : 'Off'} />
            </div>
            {state?.attendanceForwarding ? (
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted">Ingest endpoint</span>
                <span className="font-mono text-sm text-ink break-all">{state?.ingestUrl ?? '—'}</span>
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

      {isAdmin ? (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-9 w-9 rounded-lg bg-accent/10 text-accent shrink-0">
              <Link2 size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-ink">HRMS Connection</h2>
              <p className="text-xs text-muted mt-0.5">
                {cfg?.managedByDb
                  ? 'In-app configuration active — changes apply immediately, no restart.'
                  : 'Environment defaults active — save once to take over from here.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 py-3 mt-2 border-t border-line">
            <span className="text-sm text-muted">Webhook receiver (paste into HRMS)</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs text-ink truncate max-w-64">{webhookUrl}</span>
              <button type="button" className="btn btn-outline shrink-0 px-3 py-1.5 text-xs" onClick={copyWebhookUrl}>
                <Copy size={13} aria-hidden="true" />
                Copy
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 mt-1">
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-base-url">HRMS base URL</label>
              <input
                id="cfg-base-url"
                className="input font-mono"
                placeholder="http://localhost:4000/api/v1"
                value={cfgForm.baseUrl}
                onChange={(e) => setCfgForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-ingest">Ingest base path</label>
              <input
                id="cfg-ingest"
                className="input font-mono"
                placeholder="/integrations/attendance"
                value={cfgForm.ingestPath}
                onChange={(e) => setCfgForm((f) => ({ ...f, ingestPath: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-api-key">API key (employees:read)</label>
              <input
                id="cfg-api-key"
                type="password"
                className="input font-mono"
                placeholder={cfg?.apiKeyPreview ? `Saved ${cfg.apiKeyPreview} — blank keeps it` : 'Not set'}
                value={cfgForm.apiKey}
                onChange={(e) => setCfgForm((f) => ({ ...f, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-secret">Webhook secret</label>
              <input
                id="cfg-secret"
                type="password"
                className="input font-mono"
                placeholder={cfg?.webhookSecretSet ? 'Saved — blank keeps it' : 'Not set'}
                value={cfgForm.webhookSecret}
                onChange={(e) => setCfgForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-interval">Poll every (minutes)</label>
              <input
                id="cfg-interval"
                type="number"
                min="1"
                max="1440"
                className="input"
                value={cfgForm.intervalMin}
                disabled={!cfgForm.pollerEnabled}
                onChange={(e) => setCfgForm((f) => ({ ...f, intervalMin: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="mono-label" htmlFor="cfg-timeout">Timeout (ms)</label>
              <input
                id="cfg-timeout"
                type="number"
                min="1000"
                max="120000"
                step="1000"
                className="input"
                value={cfgForm.timeoutMs}
                onChange={(e) => setCfgForm((f) => ({ ...f, timeoutMs: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={cfgForm.pollerEnabled}
                onChange={(e) => setCfgForm((f) => ({ ...f, pollerEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Roster poller
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={cfgForm.forwardingEnabled}
                onChange={(e) => setCfgForm((f) => ({ ...f, forwardingEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[color:var(--accent)]"
              />
              Forward punches to HRMS
            </label>
          </div>

          {testResult && (
            <p
              role="status"
              className={`rounded-lg border px-3 py-2 text-xs leading-relaxed mt-3 ${
                testResult.ok
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-error/40 bg-error/10 text-error'
              }`}
            >
              {testResult.message}
            </p>
          )}
          {cfgError && <p className="text-sm text-error mt-3">{cfgError}</p>}

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button type="button" className="btn btn-primary" onClick={submitSaveConfig} disabled={cfgSaving || cfgTesting}>
              {cfgSaving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
              Save connection
            </button>
            <button type="button" className="btn btn-outline" onClick={submitTestConnection} disabled={cfgSaving || cfgTesting}>
              {cfgTesting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
              Test connection
            </button>
          </div>
          <p className="text-xs text-muted leading-relaxed mt-3">
            Test probes the roster pull with what you typed (blank secrets probe the saved values) —
            nothing is stored. Save encrypts secrets at rest, writes the audit trail, and restarts
            the poller if needed. Clearing the base URL falls back to environment defaults.
          </p>
        </div>
      ) : null}

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
            <span className="text-sm text-muted">Outbound (app → HRMS)</span>
            <span className="font-mono text-sm text-ink break-all">{state?.attendanceForwarding ? `${state?.ingestUrl || '/api/v1/attendance'} (on)` : 'off'}</span>
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
          <Badge value={state?.configured ? 'ACTIVE' : 'INACTIVE'} label={state?.configured ? 'Live' : 'Unconfigured'} />
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