import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { prisma } from './backend/src/lib/prisma.js';

const BASE = 'http://localhost:4100/api/v1';
const ECHO = 'http://localhost:4101';
const SECRET = 'verify-secret';
const APIKEY = 'verify-api-key';
const DEVICE_TOKEN = 'dev-secret-token';

const results = [];
function assert(cond, msg) {
  results.push({ ok: !!cond, msg });
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
}
function manilaDateKey(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
const todayKey = manilaDateKey();
const dayStart = new Date(`${todayKey}T00:00:00.000Z`);
const inIso = `${todayKey}T08:05:00+08:00`;
const outIso = `${todayKey}T17:30:00+08:00`;

// Echo server = stand-in for HRMS attendance-ingestion endpoint.
const echoCaptures = [];
const echoServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const sig = req.headers['x-hrms-signature'];
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(expected)); } catch { ok = false; }
    let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
    const authOk = req.headers.authorization === `Bearer ${APIKEY}`;
    echoCaptures.push({ url: req.url, sigOk: ok, authOk, payload: parsed });
    console.log(`[echo] ${req.method} ${req.url} sig=${ok} auth=${authOk} body=${body.slice(0, 280)}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});
await new Promise((r) => echoServer.listen(4101, '127.0.0.1', r));
console.log('[echo] HRMS echo server on :4101');

// Spawn backend with OUTBOUND forwarding enabled, pointing at the echo server.
const env = {
  ...process.env,
  PORT: '4100',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5440/lgu_attendance?schema=public',
  HRMS_BASE_URL: ECHO,
  HRMS_API_KEY: APIKEY,
  HRMS_WEBHOOK_SECRET: SECRET,
  HRMS_ATTENDANCE_INGEST_PATH: '/api/v1/attendance',
  HRMS_ATTENDANCE_FORWARD: '1',
  JWT_SECRET: 'dev-secret',
  INTEGRATION_ALLOWED_IPS: '',
  NODE_ENV: 'development',
};
const bs = spawn('node', ['src/server.js'], {
  cwd: 'C:/Users/EngrBry/Desktop/lgu-attendance/backend',
  env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let boot = '';
bs.stdout.on('data', (d) => { boot += d.toString(); process.stdout.write('[backend] ' + d.toString()); });
bs.stderr.on('data', (d) => { process.stderr.write('[backend:err] ' + d.toString()); });

async function waitHealth(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('backend did not boot. tail: ' + boot.slice(-800));
}
async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

try {
  await waitHealth();
  assert(true, 'backend boots on :4100 with FORWARD=1');

  // deterministic cleanup of prior run artifacts
  await prisma.biometricDevice.deleteMany({ where: { deviceId: 'DEV-01' } });
  await prisma.apiKey.deleteMany({ where: { name: 'verify-hr' } });
  await prisma.attendanceRecord.deleteMany({ where: { employee: { employeeNumber: '2024-002' }, date: dayStart } });
  await prisma.biometricPunch.deleteMany({ where: { employeeNumber: '2024-002', date: dayStart } });
  await prisma.syncLog.deleteMany({ where: { direction: 'OUTBOUND' } });

  const admin = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(admin.status === 200, `admin login 200 (got ${admin.status})`);
  const adminTok = admin.body.accessToken;
  const viewer = await req('POST', '/auth/login', { username: 'viewer', password: 'admin123' });
  assert(viewer.status === 200, `viewer login 200 (got ${viewer.status})`);
  const viewerTok = viewer.body.accessToken;
  assert(viewer.body?.accessToken, 'viewer login returned accessToken');

  const dev = await req('POST', '/admin/biometric-devices', { deviceId: 'DEV-01', name: 'Lobby', token: DEVICE_TOKEN, model: 'F18', ip: '10.0.1.42' }, adminTok);
  assert(dev.status === 201, `register device 201 (got ${dev.status})`);
  assert(dev.body.token === DEVICE_TOKEN, 'device token returned once at registration');
  assert(!dev.body.secretHash, 'secretHash never leaks to clients');

  // device auth negatives (no JWT path)
  const bad = await fetch(BASE + '/biometric/DEV-01/punches', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' }, body: JSON.stringify({ punches: [{ employeeNumber: '2024-002', timestamp: inIso, direction: 'IN' }] }) });
  assert(bad.status === 401, `bad device token -> 401 (got ${bad.status})`);
  const none = await fetch(BASE + '/biometric/DEV-01/punches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ punches: [{ employeeNumber: '2024-002', timestamp: inIso, direction: 'IN' }] }) });
  assert(none.status === 401, `missing device token -> 401 (got ${none.status})`);

  // RBAC: viewer cannot manage devices
  const viewerDev = await req('GET', '/admin/biometric-devices', undefined, viewerTok);
  assert(viewerDev.status === 403, `viewer GET /admin/biometric-devices -> 403 (got ${viewerDev.status})`);

  const key = await req('POST', '/api-keys', { name: 'verify-hr', scopes: ['attendance:read', 'reports:read'] }, adminTok);
  assert(key.status === 201 && key.body.key, `create external API key (got ${key.status})`);

  // 1) self-service punch (viewer -> Maria) forwarded to HRMS (choice B)
  const self = await req('POST', '/attendance/punch', { direction: 'IN', at: '08:05' }, viewerTok);
  assert(self.status === 200 && self.body.direction === 'IN', `viewer self-punch IN (got ${self.status}/${self.body.direction})`);
  await sleep(700);
  const selfFwd = echoCaptures.find((c) => c.payload && c.payload.event === 'punch' && c.payload.employeeNumber === '2024-002');
  assert(selfFwd && selfFwd.sigOk && selfFwd.authOk, 'self-punch forwarded to HRMS (HMAC + Bearer ok)');

  // 2) device server: terminal pushes batched IN/OUT -> pair + forward
  const devPunches = await req('POST', '/biometric/DEV-01/punches', {
    punches: [
      { employeeNumber: '2024-002', timestamp: inIso, direction: 'IN' },
      { employeeNumber: '2024-002', timestamp: outIso, direction: 'OUT' },
    ],
  }, DEVICE_TOKEN);
  assert(devPunches.status === 200 && devPunches.body.ok && devPunches.body.processed === 2, `device batch ingest ok+processed=2 (got ${devPunches.status}/${devPunches.body.processed})`);
  await sleep(800);
  const devFwd = echoCaptures.find((c) => c.payload && c.payload.event === 'biometric.punch_batch' && c.payload.punches && c.payload.punches.length === 2);
  assert(devFwd && devFwd.sigOk && devFwd.authOk, 'device batch forwarded to HRMS (HMAC + Bearer, 2 punches)');

  // paired record on the live board (device authoritative overrides self-punch)
  const board = await req('GET', '/attendance/today', undefined, adminTok);
  const maria = (board.body.rows || []).find((r) => r.employee?.employeeNumber === '2024-002');
  assert(maria, 'Maria appears on today board');
  assert(maria?.source === 'DEVICE', `board source DEVICE (got ${maria?.source})`);
  assert(maria?.status === 'PRESENT', `board status PRESENT (got ${maria?.status})`);
  assert(Math.abs((maria?.hours ?? 0) - 8.42) < 0.01, `board hours ~8.42 (got ${maria?.hours})`);
  assert(maria?.minutesLate === 0 && maria?.undertimeMinutes === 0, 'board no late/undertime');
  assert(maria?.timeIn && new Date(maria.timeIn).toISOString().slice(11, 16) === '00:05', `board timeIn 00:05Z (got ${maria?.timeIn})`);
  assert(maria?.timeOut && new Date(maria.timeOut).toISOString().slice(11, 16) === '09:30', `board timeOut 09:30Z (got ${maria?.timeOut})`);

  // external read via API key (HRMS-style consumer) + RBAC denial
  const extOk = await req('GET', `/external/attendance/2024-002?from=${todayKey}&to=${todayKey}`, undefined, key.body.key);
  assert(extOk.status === 200 && extOk.body.items?.[0]?.source === 'DEVICE', `external /attendance/:employee returns DEVICE record (got ${extOk.status}/${extOk.body.items?.[0]?.source})`);
  const extNoKey = await req('GET', `/external/attendance/2024-002?from=${todayKey}&to=${todayKey}`);
  assert(extNoKey.status === 401, `external without API key -> 401 (got ${extNoKey.status})`);

  // viewer self-service read only their own (RBAC harden)
  const myToday = await req('GET', '/attendance/my', undefined, viewerTok);
  assert(myToday.status === 200 && myToday.body.record?.source === 'DEVICE', `viewer /attendance/my sees own DEVICE record (got ${myToday.status}/${myToday.body.record?.source})`);

  // SyncLog: outbound forward + inbound recorded
  const logs = await req('GET', '/sync/logs?limit=40', undefined, adminTok);
  const outbound = (logs.body.items || []).filter((l) => l.direction === 'OUTBOUND');
  assert(outbound.length >= 2, `SyncLog >=2 OUTBOUND entries (got ${outbound.length})`);
  assert(outbound.every((l) => l.status === 'SUCCESS'), 'all outbound forwards SUCCESS');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('VERIFY ERROR:', e);
  process.exitCode = 1;
} finally {
  try {
    // leave the shared dev DB clean of test artifacts
    await prisma.biometricDevice.deleteMany({ where: { deviceId: 'DEV-01' } });
    await prisma.apiKey.deleteMany({ where: { name: 'verify-hr' } });
    await prisma.attendanceRecord.deleteMany({ where: { employee: { employeeNumber: '2024-002' }, date: dayStart } });
    await prisma.biometricPunch.deleteMany({ where: { employeeNumber: '2024-002', date: dayStart } });
    await prisma.syncLog.deleteMany({ where: { direction: 'OUTBOUND' } });
  } catch (e) { console.error('[cleanup] db cleanup error:', e.message); }
  try { await prisma.$disconnect(); } catch { }
  try { bs.kill('SIGTERM'); } catch { }
  echoServer.close();
  console.log('[cleanup] backend + echo stopped');
}