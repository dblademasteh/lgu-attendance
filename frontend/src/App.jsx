import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './stores/auth.js';
import { OVERSIGHT_ROLES, SYNC_ROLES } from './lib/roles.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Attendance from './pages/Attendance.jsx';
import MyAttendance from './pages/MyAttendance.jsx';
import Employees from './pages/Employees.jsx';
import Reports from './pages/Reports.jsx';
import Integration from './pages/Integration.jsx';
import BiometricDevices from './pages/BiometricDevices.jsx';
import Settings from './pages/Settings.jsx';
import NotFound from './components/NotFound.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const ROLES = { ADMIN: 'ADMIN', HR_MANAGER: 'HR_MANAGER', DEPARTMENT_HEAD: 'DEPARTMENT_HEAD', AUDITOR: 'AUDITOR', VIEWER: 'VIEWER' };

function Protected({ children, roles }) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) return <NotFound />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/my-attendance" element={<Protected><MyAttendance /></Protected>} />
            {/* Oversight only: a regular employee (VIEWER) sees only their own day on the dashboard. */}
            <Route path="/attendance" element={<Protected roles={OVERSIGHT_ROLES}><Attendance /></Protected>} />
            <Route path="/employees" element={<Protected roles={OVERSIGHT_ROLES}><Employees /></Protected>} />
            <Route path="/reports" element={<Protected roles={OVERSIGHT_ROLES}><Reports /></Protected>} />
            <Route path="/integration" element={<Protected roles={SYNC_ROLES}><Integration /></Protected>} />
            <Route path="/biometric-devices" element={<Protected roles={SYNC_ROLES}><BiometricDevices /></Protected>} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
