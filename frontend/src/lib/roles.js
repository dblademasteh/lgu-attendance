// Mirrors backend/src/shared/constants.js. Centralising role groups here keeps the
// client's view of the world in sync with the server's RBAC.
//
// ADMIN > HR_MANAGER > DEPARTMENT_HEAD > AUDITOR > VIEWER
export const ROLES = {
  ADMIN: 'ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  DEPARTMENT_HEAD: 'DEPARTMENT_HEAD',
  AUDITOR: 'AUDITOR',
  VIEWER: 'VIEWER',
};

// Oversight roles: can read the live board, the employee roster, and reports.
// Regular employees (VIEWER) are intentionally excluded — they see only
// /attendance/my (their own day) and self-punch.
export const OVERSIGHT_ROLES = [
  ROLES.ADMIN,
  ROLES.HR_MANAGER,
  ROLES.DEPARTMENT_HEAD,
  ROLES.AUDITOR,
];

// Integration config (HRMS base URL, API key / webhook secret presence) is
// sensitive — only integration admins may read it.
export const SYNC_ROLES = [ROLES.ADMIN, ROLES.HR_MANAGER];

export const isOversight = (role) => OVERSIGHT_ROLES.includes(role);
export const canViewSync = (role) => SYNC_ROLES.includes(role);
