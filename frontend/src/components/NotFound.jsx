import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card p-8 text-center m-6">
      <div className="mono-label">404</div>
      <h2 className="font-semibold text-ink mt-1">Page not found</h2>
      <Link to="/dashboard" className="btn btn-outline mt-4">Back to Dashboard</Link>
    </div>
  );
}
