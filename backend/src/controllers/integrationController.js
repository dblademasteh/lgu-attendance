import { syncService } from '../services/syncService.js';

export async function list(req, res, next) {
  try {
    const result = await syncService.listIntegrations();
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function get(req, res, next) {
  try {
    const result = await syncService.getIntegrationView(req.params.id);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function create(req, res, next) {
  try {
    const result = await syncService.createIntegration(req.body);
    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
}

export async function update(req, res, next) {
  try {
    // Before/after pair for the audit middleware (secrets redacted there).
    res.locals.auditBefore = await syncService.getIntegrationView(req.params.id).catch(() => null);
    const result = await syncService.updateIntegration(req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function remove(req, res, next) {
  try {
    res.locals.auditBefore = await syncService.getIntegrationView(req.params.id).catch(() => null);
    const result = await syncService.deleteIntegration(req.params.id);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function test(req, res, next) {
  try {
    const result = await syncService.testIntegration(req.params.id, req.body);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function run(req, res, next) {
  try {
    const result = await syncService.runPoll({
      integrationId: req.params.id,
      triggeredBy: req.user?.username ?? 'manual',
    });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}
