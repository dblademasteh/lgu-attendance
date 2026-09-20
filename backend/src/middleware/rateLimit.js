// In-memory fixed-window limiter — single-process only; for multi-instance
// prod replace with a Redis counter (mirrors lgu-hrms rateLimit.js posture).
const buckets = new Map();

export function makeLimiter(windowMs, max) {
  return function limiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    // Bound map growth from spoofed/spread IPs.
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) {
        if (now > v.resetAt) buckets.delete(k);
      }
    }
    if (entry.count > max) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } });
    }
    return next();
  };
}

export const authLimiter = makeLimiter(15 * 60 * 1000, 30);
export const apiLimiter = makeLimiter(60 * 1000, 600);
export const webhookLimiter = makeLimiter(60 * 1000, 30);
