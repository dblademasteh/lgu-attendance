import { syncService } from '../services/syncService.js';

export async function status(req, res, next) {
  try {
    const result = await syncService.status();
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function logs(req, res, next) {
  try {
    const result = await syncService.listLogs(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function run(req, res, next) {
  try {
    const result = await syncService.runPoll({ triggeredBy: req.user?.username ?? 'manual' });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function getConfig(req, res, next) {
  try {
    const result = await syncService.getConfig();
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function updateConfig(req, res, next) {
  try {
    // Before/after pair for the audit middleware (secrets redacted there).
    res.locals.auditBefore = await syncService.getConfig();
    const result = await syncService.updateConfig(req.body);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function testConnection(req, res, next) {
  try {
    const result = await syncService.testConnection(req.body);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}
