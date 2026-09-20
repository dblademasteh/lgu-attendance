import EmptyState from './EmptyState.jsx';

/** Generic dense data table — reuse instead of duplicating markup. */
export default function MasterTable({ columns, rows, empty = 'No records found' }) {
  if (!rows || rows.length === 0) return <EmptyState message={empty} />;
  return (
    <div className="card rounded-lg border border-line overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key ?? c.header}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key ?? c.header}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
