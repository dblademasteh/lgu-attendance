import { useCallback, useEffect, useState } from 'react';
import { list as listEmployees, create as createEmployee } from '../api/employees.js';
import { list as listAttendance } from '../api/attendance.js';
import MasterTable from '../components/MasterTable.jsx';
import Badge from '../components/Badge.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { useAuth } from '../stores/auth.js';

const WRITE_ROLES = ['ADMIN', 'HR_MANAGER'];

function formatDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

const EMPTY_FORM = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  department: '',
  position: '',
};

export default function Employees() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const canWrite = WRITE_ROLES.includes(user?.role);

  const [filters, setFilters] = useState({ q: '', department: '', status: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailRecords, setDetailRecords] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await listEmployees({ ...filters, page, limit: 20 });
      setData(result);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load the roster', 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (employee) => {
    setDetail(employee);
    setDetailRecords(null);
    try {
      const result = await listAttendance({ employeeId: employee.id, limit: 10 });
      setDetailRecords(result.items ?? []);
    } catch (e) {
      setDetailRecords([]);
      toast(e?.response?.data?.error?.message ?? 'Failed to load recent attendance', 'error');
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createEmployee({
        ...form,
        email: form.email || null,
        department: form.department || null,
        position: form.position || null,
      });
      toast(`Employee ${form.employeeNumber} created`, 'success');
      setAddOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast(err?.response?.data?.error?.message ?? 'Create failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const columns = [
    { key: 'employeeNumber', header: 'Emp #', render: (r) => <span className="font-mono">{r.employeeNumber}</span> },
    { key: 'name', header: 'Employee', render: (r) => `${r.lastName}, ${r.firstName}` },
    { key: 'department', header: 'Department', render: (r) => r.department ?? 'Unassigned' },
    { key: 'position', header: 'Position', render: (r) => r.position ?? '—' },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'sync', header: 'Sync', render: (r) => <Badge value={r.syncSource} /> },
    { key: 'lastSyncedAt', header: 'Last Synced', render: (r) => <span className="font-mono">{r.lastSyncedAt ? formatDate(r.lastSyncedAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button type="button" className="btn btn-ghost" onClick={() => openDetail(r)} aria-label={`View ${r.firstName} ${r.lastName}`}>
          View
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Employee Roster</h2>
          <div className="mono-label mt-0.5">{data ? `${data.total} employees` : '…'} · mirrored from LGU-HRMS</div>
        </div>
        {canWrite ? (
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            Add Employee
          </button>
        ) : null}
      </div>

      <div className="card p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="mono-label" htmlFor="e-q">Search</label>
          <input id="e-q" className="input mt-1" placeholder="Name, employee #, email" value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} />
        </div>
        <div>
          <label className="mono-label" htmlFor="e-dept">Department</label>
          <input id="e-dept" className="input mt-1" placeholder="e.g. Engineering" value={filters.department} onChange={(e) => { setPage(1); setFilters({ ...filters, department: e.target.value }); }} />
        </div>
        <div>
          <label className="mono-label" htmlFor="e-status">Status</label>
          <select id="e-status" className="input mt-1" value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      <MasterTable columns={columns} rows={data?.items ?? []} empty="No employees match the filters. Configure HRMS sync or add one manually." />

      <div className="flex items-center justify-between">
        <span className="mono-label">Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || busy}>Previous</button>
          <button type="button" className="btn btn-outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || busy}>Next</button>
        </div>
      </div>

      <Modal open={Boolean(detail)} title="Employee Detail" onClose={() => setDetail(null)}>
        {detail ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-ink">{detail.lastName}, {detail.firstName}</div>
                <div className="mono-label mt-0.5">{detail.employeeNumber} · {detail.department ?? 'Unassigned'} · {detail.position ?? '—'}</div>
              </div>
              <Badge value={detail.status} />
            </div>
            <div className="mono-label">Recent Attendance</div>
            {detailRecords === null ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : detailRecords.length === 0 ? (
              <div className="text-sm text-muted">No attendance records yet.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {detailRecords.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b border-line pb-1">
                    <span className="font-mono text-muted">{formatDate(r.date)}</span>
                    <span className="font-mono">{formatTime(r.timeIn)} – {formatTime(r.timeOut)}</span>
                    <span className="font-mono text-muted">{r.hours ?? '—'}h</span>
                    <Badge value={r.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal open={addOpen} title="Add Employee" onClose={() => setAddOpen(false)}>
        <form onSubmit={submitCreate} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mono-label" htmlFor="a-num">Employee Number</label>
              <input id="a-num" className="input mt-1" placeholder="2024-013" value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} required />
            </div>
            <div>
              <label className="mono-label" htmlFor="a-first">First Name</label>
              <input id="a-first" className="input mt-1" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mono-label" htmlFor="a-last">Last Name</label>
              <input id="a-last" className="input mt-1" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </div>
            <div>
              <label className="mono-label" htmlFor="a-email">Email</label>
              <input id="a-email" type="email" className="input mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mono-label" htmlFor="a-dept2">Department</label>
              <input id="a-dept2" className="input mt-1" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <label className="mono-label" htmlFor="a-pos">Position</label>
              <input id="a-pos" className="input mt-1" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create Employee'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
