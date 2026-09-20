import { employeeRepository } from '../repositories/employeeRepository.js';
import { AppError } from '../lib/errors.js';

function buildWhere({ q, department, status }) {
  const where = { deletedAt: null };
  if (status) where.status = status;
  if (department) where.department = { contains: department, mode: 'insensitive' };
  if (q) {
    where.OR = [
      { employeeNumber: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * Map an HRMS status onto EmploymentStatus. HRMS knows ACTIVE/INACTIVE/
 * RESIGNED/RETIRED; only ACTIVE stays active here — resigned, retired, and
 * any unknown status become INACTIVE so backfills and punches stop.
 */
function mapEmploymentStatus(raw) {
  return String(raw || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
}

/**
 * HRMS sends department/position as nested objects ({name}/{title}) on the
 * roster pull and omits them on webhooks. Normalize to the stored string —
 * objects to their display name, missing keys to undefined (keep on update).
 */
function departmentOf(v) {
  if (v === undefined) return undefined;
  if (v == null) return null;
  if (typeof v === 'object') return v.name ?? v.code ?? null;
  return v;
}

function positionOf(v) {
  if (v === undefined) return undefined;
  if (v == null) return null;
  if (typeof v === 'object') return v.title ?? v.name ?? null;
  return v;
}

/** HRMS employee uuid: `employeeId` on webhooks, `id` on roster-pull items. */
function hrmsExternalId(payload) {
  return payload.employeeId ?? payload.id ?? null;
}

export const employeeService = {
  async list(filters = {}) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = buildWhere(filters);
    const [items, total] = await Promise.all([
      employeeRepository.list({ skip: (page - 1) * limit, take: limit, where }),
      employeeRepository.count(where),
    ]);
    return { items, total, page, limit };
  },

  async get(id) {
    const employee = await employeeRepository.findById(id);
    if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
    return employee;
  },

  async create(data) {
    const existing = await employeeRepository.findByEmployeeNumberAny(data.employeeNumber);
    if (existing && !existing.deletedAt) {
      throw new AppError('An employee with that employee number already exists', 409, 'DUPLICATE');
    }
    const { monthlySalary, hiredDate, ...rest } = data;
    const payload = {
      ...rest,
      hiredDate: hiredDate ? new Date(`${hiredDate}T00:00:00.000Z`) : null,
      monthlySalary: monthlySalary ?? 0,
      syncSource: 'MANUAL',
    };
    if (existing) {
      // Revive a soft-deleted employee number (rehire).
      return employeeRepository.updateById(existing.id, { ...payload, deletedAt: null, status: 'ACTIVE' });
    }
    return employeeRepository.create(payload);
  },

  async update(id, data) {
    await employeeService.get(id);
    return employeeRepository.updateById(id, data);
  },

  /**
   * Upsert a roster entry from an HRMS payload (webhook or poll).
   * Join key: employeeNumber (HRMS User.externalId convention); falls back
   * to hrmsId lookup. Revives soft-deleted rows on rehire.
   * Non-destructive: on update, only fields PRESENT in the payload are
   * written — missing keys keep their stored values (a partial
   * employee.updated must never blank out names). Explicit null clears a
   * nullable field. Creates still apply defaults for required columns.
   */
  async upsertFromHrms(payload, source = 'POLL') {
    const employeeNumber = payload.employeeNumber;
    if (!employeeNumber) {
      throw new AppError('HRMS payload missing employeeNumber', 400, 'HRMS_PAYLOAD_INVALID');
    }
    const existing = await employeeRepository.findByEmployeeNumberAny(employeeNumber);
    if (!existing) {
      return employeeRepository.create({
        employeeNumber,
        hrmsId: hrmsExternalId(payload),
        firstName: payload.firstName ?? 'Unknown',
        lastName: payload.lastName ?? '',
        middleName: payload.middleName ?? null,
        email: payload.email ?? null,
        department: departmentOf(payload.department) ?? null,
        position: positionOf(payload.position) ?? null,
        status: mapEmploymentStatus(payload.status),
        syncSource: source,
        lastSyncedAt: new Date(),
      });
    }
    const data = {
      syncSource: source,
      lastSyncedAt: new Date(),
      deletedAt: null,
    };
    const extId = hrmsExternalId(payload);
    if (extId != null) data.hrmsId = extId;
    if (payload.firstName != null) data.firstName = payload.firstName;
    if (payload.lastName != null) data.lastName = payload.lastName;
    if (payload.middleName !== undefined) data.middleName = payload.middleName;
    if (payload.email !== undefined) data.email = payload.email;
    const dept = departmentOf(payload.department);
    if (dept !== undefined) data.department = dept;
    const pos = positionOf(payload.position);
    if (pos !== undefined) data.position = pos;
    if (payload.status !== undefined) data.status = mapEmploymentStatus(payload.status);
    return employeeRepository.updateById(existing.id, data);
  },

  /** employee.deleted webhook: soft-delete the mirrored roster entry. */
  async deactivateFromHrms(payload) {
    const existing = payload.employeeNumber
      ? await employeeRepository.findByEmployeeNumberAny(payload.employeeNumber)
      : (payload.employeeId ? await employeeRepository.findByHrmsId(payload.employeeId) : null);
    if (!existing) return null;
    return employeeRepository.updateById(existing.id, {
      status: 'INACTIVE',
      deletedAt: new Date(),
      syncSource: 'WEBHOOK',
      lastSyncedAt: new Date(),
    });
  },
};
