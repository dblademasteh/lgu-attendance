import { reportService } from '../services/reportService.js';
import { AppError } from '../lib/errors.js';

export async function daily(req, res, next) {
  try {
    const result = await reportService.daily(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function summary(req, res, next) {
  try {
    const result = await reportService.summary(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function timesheet(req, res, next) {
  try {
    const result = await reportService.timesheet(req.params.employeeId, req.query);
    if (!result) throw new AppError('Employee not found', 404, 'NOT_FOUND');
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const csv = await reportService.exportCsv(req.query);
    const stamp = (req.query.from || req.query.date || 'all').replace(/:/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${stamp}.csv"`);
    return res.send(csv);
  } catch (e) {
    return next(e);
  }
}
