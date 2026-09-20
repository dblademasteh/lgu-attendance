import { authService } from '../services/authService.js';

export async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function refresh(req, res, next) {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function me(req, res, next) {
  try {
    return res.json({ user: req.user });
  } catch (e) {
    return next(e);
  }
}
