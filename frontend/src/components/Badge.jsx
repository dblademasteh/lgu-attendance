// Status badge — token tint classes only (no hardcoded colors).
const TONES = {
  // attendance
  PRESENT: 'badge-success',
  LATE: 'badge-warning',
  UNDERTIME: 'badge-warning',
  HALF_DAY: 'badge-accent',
  ABSENT: 'badge-error',
  ON_LEAVE: 'badge-accent',
  NO_RECORD: 'badge-muted',
  // employees / users
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-muted',
  // biometric devices
  ONLINE: 'badge-success',
  OFFLINE: 'badge-muted',
  // sync
  SUCCESS: 'badge-success',
  PARTIAL: 'badge-warning',
  FAILED: 'badge-error',
  WEBHOOK: 'badge-accent',
  POLL: 'badge-muted',
  INBOUND: 'badge-accent',
  PULL: 'badge-muted',
  OUTBOUND: 'badge-accent',
  // roles
  ADMIN: 'badge-accent',
  HR_MANAGER: 'badge-success',
  DEPARTMENT_HEAD: 'badge-accent',
  AUDITOR: 'badge-warning',
  VIEWER: 'badge-muted',
};

export default function Badge({ value, label }) {
  const tone = TONES[value] ?? 'badge-muted';
  return <span className={`badge ${tone}`}>{label ?? String(value ?? '').replaceAll('_', ' ')}</span>;
}
