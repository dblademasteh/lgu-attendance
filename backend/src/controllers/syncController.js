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
    const result = await syncService.runPoll({
      integrationId: req.body?.integrationId ?? null,
      triggeredBy: req.user?.username ?? 'manual',
    });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}
