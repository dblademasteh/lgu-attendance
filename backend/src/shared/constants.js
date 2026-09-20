// Single source of truth for statuses/roles/sources — prefer these constants
// over magic strings (mirrors LGU-HRMS conventions).

export const ROLES = {
  ADMIN: 'ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  DEPARTMENT_HEAD: 'DEPARTMENT_HEAD',
  AUDITOR: 'AUDITOR',
  VIEWER: 'VIEWER',
};

export const ATTENDANCE_STATUSES = {
  PRESENT: 'PRESENT',
  LATE: 'LATE',
  UNDERTIME: 'UNDERTIME',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  ON_LEAVE: 'ON_LEAVE',
};

export const ATTENDANCE_SOURCES = {
  MANUAL: 'MANUAL',
  PUNCH: 'PUNCH',
  DEVICE: 'DEVICE',
  IMPORT: 'IMPORT',
  HRMS: 'HRMS',
};

export const SYNC_EVENTS = {
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DELETED: 'employee.deleted',
  BIOMETRIC_PUNCH: 'biometric.punch',
  BIOMETRIC_PUNCH_BATCH: 'biometric.punch_batch',
  LEAVE_CREATED: 'leave.created',
  LEAVE_UPDATED: 'leave.updated',
  LEAVE_DELETED: 'leave.deleted',
};

export const API_KEY_SCOPES = ['attendance:read', 'reports:read'];

/** Route roles — mirrors lgu-hrms /reports gating. */
export const REPORT_ROLES = [ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.AUDITOR];

/** Roles allowed to punch for others / correct records. */
export const ATTENDANCE_WRITE_ROLES = [ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.DEPARTMENT_HEAD];

export const SYNC_WRITE_ROLES = [ROLES.ADMIN, ROLES.HR_MANAGER];

/** UI-facing derived state for employees with no attendance row today. */
export const NO_RECORD = 'NO_RECORD';
