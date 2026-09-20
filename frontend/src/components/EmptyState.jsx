export default function EmptyState({ message = 'Nothing here yet', hint }) {
  return (
    <div className="card p-8 text-center">
      <div className="text-sm text-muted">{message}</div>
      {hint ? <div className="mono-label mt-2">{hint}</div> : null}
    </div>
  );
}
