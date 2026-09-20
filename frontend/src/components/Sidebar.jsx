import { NavLink } from 'react-router-dom';
import { Landmark, LayoutDashboard, CalendarClock, Clock, Users, BarChart3, PlugZap, Fingerprint, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../stores/auth.js';
import { OVERSIGHT_ROLES, SYNC_ROLES } from '../lib/roles.js';

/* Sidebar mirrors lgu-hrms DESIGN.md (classic group sidebar): brand tile,
   mono-labeled groups, accent-tinted active links, collapsible w-64 ↔ w-[72px].
   On <md screens it becomes a slide-in drawer with a backdrop (hamburger toggle). */
const GROUPS = [
  {
    label: 'Monitoring',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: null },
      { to: '/my-attendance', label: 'My Attendance', icon: CalendarClock, roles: null },
      { to: '/attendance', label: 'Attendance', icon: Clock, roles: OVERSIGHT_ROLES },
    ],
  },
  {
    label: 'Workforce',
    items: [{ to: '/employees', label: 'Employees', icon: Users, roles: OVERSIGHT_ROLES }],
  },
  {
    label: 'Reporting',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart3, roles: OVERSIGHT_ROLES }],
  },
  {
    label: 'Integration',
    items: [
      { to: '/integration', label: 'HRMS Sync', icon: PlugZap, roles: SYNC_ROLES },
      { to: '/biometric-devices', label: 'Biometric Devices', icon: Fingerprint, roles: SYNC_ROLES },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon, roles: null }],
  },
];

function Brand({ expanded }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-line ${expanded ? '' : 'justify-center'}`}>
      <div className="w-10 h-10 rounded-[12px] bg-ink text-bg grid place-items-center shrink-0">
        <Landmark size={20} aria-hidden="true" />
      </div>
      {expanded && (
        <div className="min-w-0">
          <p className="font-display font-bold text-ink leading-tight truncate">LGU Attendance</p>
          <p className="mono-label text-[10px]">Monitoring & Reporting</p>
        </div>
      )}
    </div>
  );
}

function Nav({ expanded, onNavigate }) {
  const user = useAuth((s) => s.user);
  return (
    <nav className="flex-1 overflow-y-auto hide-scrollbar py-4" aria-label="Main navigation">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.roles || (user?.role && i.roles.includes(user.role)));
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mb-4">
            {expanded && (
              <div className="px-4 py-1 mono-label text-[10px] uppercase tracking-wider text-muted">{group.label}</div>
            )}
            <div className="space-y-1 px-2">
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={label}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors
                      ${isActive
                        ? 'bg-accent/10 text-accent font-semibold border-l-2 border-accent'
                        : 'text-ink hover:bg-bg/60 border-l-2 border-transparent'}
                      ${expanded ? '' : 'justify-center'}`}
                >
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  {expanded && <span className="truncate text-sm flex-1">{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Footer({ expanded }) {
  return (
    <div className={`border-t border-line p-3 ${expanded ? 'flex justify-center' : ''}`}>
      <p className="mono-label text-[10px] text-center">On-prem · RA 10173 · v1.0</p>
    </div>
  );
}

export default function Sidebar({ collapsed, mobileOpen, onMobileClose }) {
  const expanded = !collapsed;
  const drawerContent = () => (
    <>
      <Brand expanded />
      <Nav expanded onNavigate={onMobileClose} />
      <Footer expanded />
    </>
  );

  return (
    <>
      {/* Desktop rail — hidden below md */}
      <aside className={`bg-surface border-r border-line hidden md:flex flex-col shrink-0 transition-[width] duration-200 ${collapsed ? 'w-[72px]' : 'w-[260px]'}`}>
        {drawerContent()}
      </aside>

      {/* Mobile drawer — below md, fixed overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm cursor-default"
            onClick={onMobileClose}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <aside className="absolute inset-y-0 left-0 w-[260px] bg-surface border-r border-line flex flex-col shadow-lg">
            {drawerContent()}
          </aside>
        </div>
      )}
    </>
  );
}