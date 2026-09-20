import { employeeService } from '../services/employeeService.js';

export async function list(req, res, next) {
  try {
    const result = await employeeService.list(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function get(req, res, next) {
  try {
    const employee = await employeeService.get(req.params.id);
    return res.json(employee);
  } catch (e) {
    return next(e);
  }
}

export async function create(req, res, next) {
  try {
    const employee = await employeeService.create(req.body);
    return res.status(201).json(employee);
  } catch (e) {
    return next(e);
  }
}

export async function update(req, res, next) {
  try {
    // Before/after pair for the audit middleware.
    res.locals.auditBefore = await employeeService.get(req.params.id);
    const employee = await employeeService.update(req.params.id, req.body);
    return res.json(employee);
  } catch (e) {
    return next(e);
  }
}
