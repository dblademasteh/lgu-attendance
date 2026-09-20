import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { today as fetchToday, myToday, punch } from '../api/attendance.js';
import StatCard from '../components/StatCard.jsx';
import Badge from '../components/Badge.jsx';
import MasterTable from '../components/MasterTable.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { useAuth } from '../stores/auth.js';
import { isOversight } from '../lib/roles.js';

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function departmentBreakdown(rows) {
  const map = new Map();
  for (const r of rows) {
    const dept = r.employee?.department ?? 'Unassigned';
    if (!map.has(dept)) map.set(dept, { department: dept, present: 0, late: 0, absent: 0, other: 0 });
    const b = map.get(dept);
    if (r.status === 'PRESENT') b.present += 1;
    else if (r.status === 'LATE' || r.status === 'UNDERTIME' || r.status === 'HALF_DAY') b.late += 1;
    else if (r.status === 'ABSENT') b.absent += 1;
    else if (r.status === 'ON_LEAVE') b.other += 1;
  }
  return [...map.values()].sort((a, b) => a.department.localeCompare(b.department));
}

export default function Dashboard() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const [board, setBoard] = useState(null);
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // My own record loads for every authenticated, linked employee regardless of
    // role — a regular employee (VIEWER) still sees + clocks their day.
    try {
      const mineResult = await myToday().catch(() => null);
      setMine(mineResult);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load your attendance', 'error');
    }
    // The shared live board is oversight-only; otherwise clear it so the
    // board UI doesn't render for a regular employee.
    if (!isOversight(user?.role)) {
      setBoard(null);
      return;
    }
    try {
      const boardResult = await fetchToday();
      setBoard(boardResult);
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Failed to load the live board', 'error');
    }
  }, [toast, user?.role]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // live monitoring: refresh every 30s
    return () => clearInterval(timer);
  }, [load]);

  const doPunch = async () => {
    setBusy(true);
    try {
      const result = await punch({ direction: 'AUTO' });
      toast(`Clocked ${result.direction} at ${formatTime(result.record.timeIn ?? result.record.timeOut)}`, 'success');
      await load();
    } catch (e) {
      toast(e?.response?.data?.error?.message ?? 'Punch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = board?.counts ?? {};
  const present = counts.PRESENT ?? 0;
  const late = counts.LATE ?? 0;
  const undertime = counts.UNDERTIME ?? 0;
  const absent = counts.ABSENT ?? 0;
  const onLeave = counts.ON_LEAVE ?? 0;
  const noRecord = counts.NO_RECORD ?? 0;
  const totalRoster = board?.rows?.length ?? 0;
  const attended = present + late + undertime;
  const rate = totalRoster > 0 ? Math.round((attended / totalRoster) * 1000) / 10 : null;
  const breakdown = board ? departmentBreakdown(board.rows) : [];
  const maxDept = Math.max(1, ...breakdown.map((b) => b.present + b.late + b.absent + b.other));

  const columns = [
    { key: 'employeeNumber', header: 'Emp #', render: (r) => <span className="font-mono">{r.employee?.employeeNumber ?? '—'}</span> },
    { key: 'name', header: 'Employee', render: (r) => `${r.employee?.lastName ?? ''}, ${r.employee?.firstName ?? ''}` },
    { key: 'department', header: 'Department', render: (r) => r.employee?.department ?? 'Unassigned' },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'timeIn', header: 'Time In', render: (r) => <span className="font-mono">{formatTime(r.timeIn)}</span> },
    { key: 'timeOut', header: 'Time Out', render: (r) => <span className="font-mono">{formatTime(r.timeOut)}</span> },
    { key: 'hours', header: 'Hours', render: (r) => <span className="font-mono">{r.hours ?? '—'}</span> },
    { key: 'late', header: 'Late (m)', render: (r) => <span className="font-mono">{r.minutesLate || '—'}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink">{board ? 'Live Board' : 'My Attendance'}</h2>
          <div className="mono-label mt-0.5">
            {board
              ? `Today · ${board.date ?? '…'} · auto-refresh 30s`
              : 'Your punches (self-service)'}
          </div>
        </div>
        {mine?.employee ? (
          <button type="button" className="btn btn-primary" onClick={doPunch} disabled={busy}>
            <CalendarClock size={15} aria-hidden="true" />
            {mine.record?.timeIn && !mine.record?.timeOut ? 'Clock Out' : 'Clock In'}
          </button>
        ) : null}
      </div>

      {board ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="Present" value={present} tone="text-success" />
          <StatCard label="Late" value={late} tone="text-warning" />
          <StatCard label="Undertime" value={undertime} tone="text-warning" />
          <StatCard label="Absent" value={absent} tone="text-error" />
          <StatCard label="On Leave" value={onLeave} />
          <StatCard label="Rate" value={rate == null ? '—' : `${rate}%`} hint={`${attended}/${totalRoster} showed up`} />
        </div>
      ) : null}

      {mine?.employee ? (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="mono-label">My Attendance Today</div>
              <div className="text-sm text-ink mt-1">
                {mine.record
                  ? `In ${formatTime(mine.record.timeIn)} · Out ${formatTime(mine.record.timeOut)} · ${mine.record.hours ?? '—'}h`
                  : 'No punch yet today.'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mine.record ? <Badge value={mine.record.status} /> : <Badge value="NO_RECORD" label="No record" />}
            </div>
          </div>
        </div>
      ) : null}

      {board ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <MasterTable columns={columns} rows={board?.rows ?? []} empty="No employees on the roster yet — configure HRMS sync or seed demo data." />
          </div>
          <div className="card p-4">
            <div className="mono-label">By Department (today)</div>
            <div className="flex flex-col gap-3 mt-3">
              {breakdown.length === 0 ? (
                <div className="text-sm text-muted">No data yet.</div>
              ) : (
                breakdown.map((b) => {
                  const total = b.present + b.late + b.absent + b.other;
                  return (
                    <div key={b.department}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink font-medium">{b.department}</span>
                        <span className="font-mono text-muted">{total}</span>
                      </div>
                      <div className="flex h-2 mt-1 rounded-full overflow-hidden bg-line" aria-hidden="true">
                        <div style={{ width: `${(b.present / maxDept) * 100}%` }} className="bg-success/70" />
                        <div style={{ width: `${(b.late / maxDept) * 100}%` }} className="bg-warning/70" />
                        <div style={{ width: `${(b.absent / maxDept) * 100}%` }} className="bg-error/70" />
                        <div style={{ width: `${(b.other / maxDept) * 100}%` }} className="bg-accent/70" />
                      </div>
                      <div className="mono-label mt-1">
                        {b.present} present · {b.late} late · {b.absent} absent{b.other > 0 ? ` · ${b.other} leave` : ''}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
