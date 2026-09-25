import { useCallback, useEffect, useState } from 'react';
import { list as listAttendance, markAbsent as markAbsentApi, correct as correctApi } from '../api/attendance.js';
import MasterTable from '../components/MasterTable.jsx';
import Badge from '../components/Badge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { useAuth } from '../stores/auth.js';

const WRITE_ROLES = ['ADMIN', 'HR_MANAGER', 'DEPARTMENT_HEAD'];
const STATUSES = ['PRESENT', 'LATE', 'UNDERTIME', 'HALF_DAY', 'ABSENT', 'ON_LEAVE'];

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function formatDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

function todayKey() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function Attendance() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const canWrite = WRITE_ROLES.includes(user?.role);

  const [filters, setFilters] = useState({ from: '', to: '', department: '', status: '' });
  const [page, setPage] = useState(1);
  const [data, setBoard] = useState(null);
  const [correcting, setCorrecting] = useState(null);
  const [form, setForm] = useState({ timeIn: '', timeOut: '', status: '', remarks: '' });
  const [markAbsentOpen, setMarkAbsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await listAttendance({ ...filters, page, limit: 20 });
      setBoard(result);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load attendance records', 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCorrect = (record) => {
    setCorrecting(record);
    setForm({
      timeIn: record.timeIn ? formatTime(record.timeIn) : '',
      timeOut: record.timeOut ? formatTime(record.timeOut) : '',
      status: record.status,
      remarks: record.remarks ?? '',
    });
  };

  const submitCorrect = async () => {
    if (!correcting) return;
    setBusy(true);
    try {
      await correctApi(correcting.id, {
        timeIn: form.timeIn || null,
        timeOut: form.timeOut || null,
        status: form.status || undefined,
        remarks: form.remarks,
      });
      toast('Attendance record corrected', 'success');
      setCorrecting(null);
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Correction failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitMarkAbsent = async () => {
    setBusy(true);
    try {
      const result = await markAbsentApi(todayKey());
      toast(result.skipped ? result.reason : `Marked ${result.created} unrecorded employees`, 'success');
      setMarkAbsentOpen(false);
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Mark-absent failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const columns = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-mono">{formatDate(r.date)}</span> },
    { key: 'employeeNumber', header: 'Emp #', render: (r) => <span className="font-mono">{r.employee?.employeeNumber ?? '—'}</span> },
    { key: 'name', header: 'Employee', render: (r) => `${r.employee?.lastName ?? ''}, ${r.employee?.firstName ?? ''}` },
    { key: 'department', header: 'Department', render: (r) => r.employee?.department ?? 'Unassigned' },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'timeIn', header: 'Time In', render: (r) => <span className="font-mono">{formatTime(r.timeIn)}</span> },
    { key: 'timeOut', header: 'Time Out', render: (r) => <span className="font-mono">{formatTime(r.timeOut)}</span> },
    { key: 'hours', header: 'Hours', render: (r) => <span className="font-mono">{r.hours ?? '—'}</span> },
    { key: 'late', header: 'Late (m)', render: (r) => <span className="font-mono">{r.minutesLate || '—'}</span> },
    { key: 'source', header: 'Source', render: (r) => <Badge value={r.source ?? 'MANUAL'} /> },
    ...(canWrite
      ? [{
          key: 'actions',
          header: '',
          render: (r) => (
            <button type="button" className="btn btn-ghost" onClick={() => openCorrect(r)} aria-label={`Correct record for ${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`}>
              Edit
            </button>
          ),
        }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Attendance Records</h2>
          <div className="mono-label mt-0.5">{data ? `${data.total} records` : '…'}</div>
        </div>
        {canWrite ? (
          <button type="button" className="btn btn-outline" onClick={() => setMarkAbsentOpen(true)}>
            <Badge value="ABSENT" label="Mark unrecorded absent" />
          </button>
        ) : null}
      </div>

      <div className="card p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div>
          <label className="mono-label" htmlFor="f-from">From</label>
          <input id="f-from" type="date" className="input mt-1 min-h-11" value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
        </div>
        <div>
          <label className="mono-label" htmlFor="f-to">To</label>
          <input id="f-to" type="date" className="input mt-1 min-h-11" value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
        </div>
        <div>
          <label className="mono-label" htmlFor="f-dept">Department</label>
          <input id="f-dept" className="input mt-1 min-h-11" placeholder="e.g. Engineering" value={filters.department} onChange={(e) => { setPage(1); setFilters({ ...filters, department: e.target.value }); }} />
        </div>
        <div>
          <label className="mono-label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input mt-1 min-h-11" value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Phones: record cards. md+: full table. */}
      <div className="md:hidden flex flex-col gap-2.5">
        {(data?.items ?? []).length === 0 ? (
          <EmptyState message="No attendance records match the filters." />
        ) : (
          (data?.items ?? []).map((r) => (
            <article key={r.id} className="card p-4 flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {r.employee?.lastName ?? ''}, {r.employee?.firstName ?? ''}
                  </p>
                  <p className="mono-label mt-0.5">{r.employee?.employeeNumber ?? '—'} · {formatDate(r.date)}</p>
                </div>
                <Badge value={r.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-bg/60 px-2 py-2 text-center">
                <div>
                  <p className="mono-label">In</p>
                  <p className="font-mono text-sm text-ink tabular-nums">{formatTime(r.timeIn)}</p>
                </div>
                <div>
                  <p className="mono-label">Out</p>
                  <p className="font-mono text-sm text-ink tabular-nums">{formatTime(r.timeOut)}</p>
                </div>
                <div>
                  <p className="mono-label">Hours</p>
                  <p className="font-mono text-sm text-ink tabular-nums">{r.hours ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span className="truncate">{r.employee?.department ?? 'Unassigned'}</span>
                <span className="shrink-0">{r.minutesLate ? `Late ${r.minutesLate}m` : 'On time'}</span>
              </div>
              {canWrite ? (
                <button
                  type="button"
                  className="btn btn-outline w-full min-h-11"
                  onClick={() => openCorrect(r)}
                  aria-label={`Correct record for ${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`}
                >
                  Edit
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>
      <div className="hidden md:block">
        <MasterTable columns={columns} rows={data?.items ?? []} empty="No attendance records match the filters." />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="mono-label">Page {page} of {totalPages}</span>
        <div className="flex gap-2 flex-1 sm:flex-none justify-end">
          <button type="button" className="btn btn-outline min-h-11 flex-1 sm:flex-none" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || busy}>Previous</button>
          <button type="button" className="btn btn-outline min-h-11 flex-1 sm:flex-none" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || busy}>Next</button>
        </div>
      </div>

      <Modal open={Boolean(correcting)} title="Correct Attendance Record" onClose={() => setCorrecting(null)}>
        {correcting ? (
          <div className="flex flex-col gap-3">
            <div className="mono-label">
              {correcting.employee?.lastName}, {correcting.employee?.firstName} · {formatDate(correcting.date)} · {correcting.employee?.department ?? 'Unassigned'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mono-label" htmlFor="c-in">Time In (HH:MM)</label>
                <input id="c-in" className="input mt-1" placeholder="08:00" value={form.timeIn} onChange={(e) => setForm({ ...form, timeIn: e.target.value })} />
              </div>
              <div>
                <label className="mono-label" htmlFor="c-out">Time Out (HH:MM)</label>
                <input id="c-out" className="input mt-1" placeholder="17:00" value={form.timeOut} onChange={(e) => setForm({ ...form, timeOut: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mono-label" htmlFor="c-status">Status (blank = recompute from times)</label>
              <select id="c-status" className="input mt-1" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="">Recompute</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="mono-label" htmlFor="c-remarks">Remarks</label>
              <input id="c-remarks" className="input mt-1" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" className="btn btn-outline w-full sm:w-auto min-h-11" onClick={() => setCorrecting(null)}>Cancel</button>
              <button type="button" className="btn btn-primary w-full sm:w-auto min-h-11" onClick={submitCorrect} disabled={busy}>Save Correction</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={markAbsentOpen}
        title="Mark Unrecorded Employees"
        message={`Backfill ABSENT/ON_LEAVE rows for every active employee without a record today (${todayKey()}). Holidays are skipped; approved leaves mark ON_LEAVE. This cannot be undone in bulk.`}
        confirmLabel="Mark Absent"
        danger
        busy={busy}
        onConfirm={submitMarkAbsent}
        onClose={() => setMarkAbsentOpen(false)}
      />
    </div>
  );
}
