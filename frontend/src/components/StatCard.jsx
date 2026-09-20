export default function StatCard({ label, value, tone = '', hint }) {
  return (
    <div className="card p-4">
      <div className="mono-label">{label}</div>
      <div className={`stat-value mt-1 ${tone}`}>{value ?? '—'}</div>
      {hint ? <div className="text-xs text-muted mt-1">{hint}</div> : null}
    </div>
  );
}
