import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../api/client.js';
import { daily as dailyReport, summary as summaryReport } from '../api/reports.js';
import StatCard from '../components/StatCard.jsx';
import Badge from '../components/Badge.jsx';
import MasterTable from '../components/MasterTable.jsx';
import { useToast } from '../hooks/useToast.jsx';

const DAYS_BACK = 13;

function todayKey() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysAgoKey(days) {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function Reports() {
  const toast = useToast();
  const [tab, setTab] = useState('summary');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState(daysAgoKey(DAYS_BACK));
  const [to, setTo] = useState(todayKey());
  const [date, setDate] = useState(todayKey());
  const [dailyData, setDailyData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = { department };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [dailyResult, summaryResult] = await Promise.all([
        dailyReport({ ...params, date }),
        summaryReport({ ...params, from, to }),
      ]);
      setDailyData(dailyResult);
      setSummaryData(summaryResult);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load reports', 'error');
    } finally {
      setBusy(false);
    }
  }, [date, from, to, department, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadCsv = async () => {
    setBusy(true);
    try {
      const res = await api.get('/reports/export', {
        params: { from, to, department, format: 'csv' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${from || 'all'}-to-${to || 'now'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('CSV downloaded', 'success');
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const d = dailyData?.counts ?? {};
  const s = summaryData?.counts ?? {};
  const totalHours = summaryData?.totalHours ?? null;

  const employeeColumns = [
    { key: 'employeeNumber', header: 'Emp #', render: (r) => <span className="font-mono">{r.employee?.employeeNumber ?? '—'}</span> },
    { key: 'name', header: 'Employee', render: (r) => `${r.employee?.lastName ?? ''}, ${r.employee?.firstName ?? ''}` },
    { key: 'department', header: 'Department', render: (r) => r.employee?.department ?? 'Unassigned' },
    { key: 'present', header: 'Present', render: (r) => <span className="font-mono">{r.presentDays}</span> },
    { key: 'late', header: 'Late', render: (r) => <span className="font-mono">{r.lateDays}</span> },
    { key: 'undertime', header: 'Undertime', render: (r) => <span className="font-mono">{r.undertimeDays}</span> },
    { key: 'half', header: 'Half-day', render: (r) => <span className="font-mono">{r.halfDays}</span> },
    { key: 'absent', header: 'Absent', render: (r) => <span className="font-mono text-error">{r.absentDays}</span> },
    { key: 'leave', header: 'On Leave', render: (r) => <span className="font-mono">{r.onLeaveDays}</span> },
    { key: 'hours', header: 'Hours', render: (r) => <span className="font-mono">{r.totalHours}</span> },
    { key: 'lateMins', header: 'Late (min)', render: (r) => <span className="font-mono">{r.totalLateMinutes}</span> },
  ];

  const deptColumns = [
    { key: 'department', header: 'Department' },
    { key: 'employees', header: 'Employees', render: (r) => <span className="font-mono">{r.employees}</span> },
    { key: 'PRESENT', header: 'Present', render: (r) => <span className="font-mono">{r.PRESENT}</span> },
    { key: 'LATE', header: 'Late', render: (r) => <span className="font-mono">{r.LATE}</span> },
    { key: 'ABSENT', header: 'Absent', render: (r) => <span className="font-mono text-error">{r.ABSENT}</span> },
    { key: 'ON_LEAVE', header: 'On Leave', render: (r) => <span className="font-mono">{r.ON_LEAVE}</span> },
    { key: 'totalHours', header: 'Hours', render: (r) => <span className="font-mono">{r.totalHours}</span> },
  ];

  const dailyDeptColumns = [
    { key: 'department', header: 'Department' },
    { key: 'PRESENT', header: 'Present', render: (r) => <span className="font-mono">{r.PRESENT}</span> },
    { key: 'LATE', header: 'Late', render: (r) => <span className="font-mono">{r.LATE}</span> },
    { key: 'UNDERTIME', header: 'Undertime', render: (r) => <span className="font-mono">{r.UNDERTIME}</span> },
    { key: 'ABSENT', header: 'Absent', render: (r) => <span className="font-mono text-error">{r.ABSENT}</span> },
    { key: 'ON_LEAVE', header: 'On Leave', render: (r) => <span className="font-mono">{r.ON_LEAVE}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Reports</h2>
          <div className="mono-label mt-0.5">Daily roll-up · range summary · CSV export</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={downloadCsv} disabled={busy}>
          <Download size={15} aria-hidden="true" />
          Download CSV
        </button>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Report tabs">
        {[
          { id: 'summary', label: 'Summary' },
          { id: 'daily', label: 'Daily' },
        ].map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`btn ${tab === id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {tab === 'summary' ? (
          <>
            <div>
              <label className="mono-label" htmlFor="r-from">From</label>
              <input id="r-from" type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mono-label" htmlFor="r-to">To</label>
              <input id="r-to" type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label className="mono-label" htmlFor="r-date">Date</label>
            <input id="r-date" type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div>
          <label className="mono-label" htmlFor="r-dept">Department</label>
          <input id="r-dept" className="input mt-1" placeholder="e.g. Engineering" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
      </div>

      {tab === 'summary' ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Records" value={Object.values(s).reduce((a, b) => a + b, 0)} />
            <StatCard label="Present" value={s.PRESENT ?? 0} tone="text-success" />
            <StatCard label="Late" value={s.LATE ?? 0} tone="text-warning" />
            <StatCard label="Absent" value={s.ABSENT ?? 0} tone="text-error" />
            <StatCard label="On Leave" value={s.ON_LEAVE ?? 0} />
            <StatCard label="Total Hours" value={totalHours ?? '—'} />
          </div>
          <MasterTable columns={employeeColumns} rows={summaryData?.employees ?? []} empty="No attendance data in this range." />
          <div>
            <div className="mono-label mb-2">Department Breakdown</div>
            <MasterTable columns={deptColumns} rows={summaryData?.byDepartment ?? []} empty="No department data." />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Date" value={dailyData?.date ?? '—'} />
            <StatCard label="Present" value={d.PRESENT ?? 0} tone="text-success" />
            <StatCard label="Late" value={d.LATE ?? 0} tone="text-warning" />
            <StatCard label="Undertime" value={d.UNDERTIME ?? 0} tone="text-warning" />
            <StatCard label="Absent" value={d.ABSENT ?? 0} tone="text-error" />
            <StatCard label="Rate" value={dailyData?.attendanceRate == null ? '—' : `${dailyData.attendanceRate}%`} hint={`${dailyData?.totalActive ?? 0} active employees`} />
          </div>
          <div>
            <div className="mono-label mb-2">Department Breakdown</div>
            <MasterTable columns={dailyDeptColumns} rows={dailyData?.byDepartment ?? []} empty="No department data for this date." />
          </div>
        </>
      )}
    </div>
  );
}
