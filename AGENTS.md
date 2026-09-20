# LGU Attendance — Agent Guide

## Commands
- Frontend dev: `cd frontend && npm run dev` → http://localhost:5174
- Frontend build must pass: `cd frontend && npm run build` (only real "verify" gate)
- Backend dev: `cd backend && npm run dev` → http://localhost:4100
- Backend prod start: `cd backend && npm run start` (node src/server.js)
- Syntax-check backend fast: `cd backend && node --check src/routes/<name>.js` (no boot needed)
- DB up: `docker compose up -d db` (dead DB container = 500s on login; publishes **5440**)
- Prisma migrate: `cd backend && npx prisma migrate dev`
- Prisma generate: stop backend watch first, then `cd backend && npx prisma generate`
- Seed: `cd backend && node prisma/seed.js` after migrate (idempotent: users per role + default rule + holidays + demo roster with 14 days of attendance)
- No ESLint/typecheck/test runner — verify with `npm run build` + `node --check` + color lint
- Color lint: `Get-ChildItem frontend/src -Recurse -Include *.jsx,*.js | Select-String -Pattern '#[0-9a-fA-F]{3,8}\b|slate-|gray-|bg-white|text-white'`
- npm lifecycle-script gate: `npm install-scripts approve bcrypt prisma @prisma/engines @prisma/client` then `npm install` (bcrypt node-gyp + prisma engines need them)

## Purpose & Integration
- Attendance monitoring & reporting system connected to **LGU-HRMS via API** (same tech stack: Express 5, React 19, Vite 5, Tailwind 4, Prisma/PostgreSQL 16)
- Ingest: HRMS **webhooks** (`employee.created|updated|deleted` — the only events HRMS emits today; `biometric.punch|punch_batch` + `leave.created|updated|deleted` are accepted for device-direct posts and future HRMS emission, leaves mirror to `LeaveRequest` rows with `hrmsId` join key driving `ON_LEAVE`; HMAC-SHA256 signed via `X-HRMS-Signature`, receiver `POST /api/v1/webhooks/hrms` — public but signature-secured, optional `INTEGRATION_ALLOWED_IPS`, `webhookLimiter` 30/min/IP) + **scheduled polling** (`HRMS_SYNC_POLLER=1`, `HRMS_SYNC_INTERVAL_MIN`, poller in `server.js` with graceful stop) + manual `POST /sync/run`
- Out: roster pull reads `GET {HRMS_BASE_URL}/integrations/employees` with `x-api-key` (`employees:read` scope); collected punches/corrections/backfills forwarded fire-and-forget to `POST {HRMS}/integrations/attendance/punch|bulk` with `x-api-key` (`attendance:ingest` scope, HRMS body shapes — punch `{employeeNumber,punchType,at,deviceId?,source?}`, bulk `{records:[{employeeNumber,date,timeIn?,timeOut?,hours?,remark?,source?}]}`; OUTBOUND SyncLog, never rolls back local writes — HRMS-originated webhook punches are never echoed back, loop prevention); reverse consumption via `GET /external/attendance` + `GET /external/summary` with `Bearer <ApiKey>` (sha256-hashed `ApiKey` table, scope-checked `requireApiKey()`)
- Connect UI: HRMS speaks API keys + webhooks only (no OAuth/OIDC — verified by probing `:4000`); Settings > Integration has an ADMIN-only **HRMS Connection** card (`GET/PATCH /sync/config`, `POST /sync/test`) — base URL/key/secret/poller/forwarding persisted AES-GCM-encrypted in `IntegrationConfig` (`lib/secrets.js`, key = `CONFIG_ENCRYPTION_KEY` else JWT_SECRET-derived), applied hot via cached `getHrmsConfig()` + `applyPollerConfig()` (env stays the fallback until first save; secrets masked as set-flags + last-4 previews, audit-redacted)
- Every sync recorded in `SyncLog` (`WEBHOOK`/`POLL` × `INBOUND`/`PULL`/`OUTBOUND` × `SUCCESS`/`PARTIAL`/`FAILED`; `/sync/logs` filters status+source+direction)

## Architecture
- Frontend: React 19 + Vite 5 plain JS, Tailwind 4 design tokens in `frontend/src/index.css` (mirrors lgu-hrms token system), no hardcoded colors
- Backend: Express 5 ESM, port **4100**, Prisma Postgres **5440**, JWT access ~15m + refresh rotation (`typ: 'refresh'` claim)
- One record per employee per day (`@@unique([employeeId, date])`) — the shape reports aggregate over
- Manila-day logic + HH:MM parsing live in `backend/src/lib/time.js` (mirrors lgu-hrms); dates stored UTC, displayed Asia/Manila
- Late/undertime from `AttendanceRule` `workStartMins/workEndMins/lunchStartMins/lunchEndMins/graceMinutes` (defaults 08:00–17:00, 12:00–13:00, 15m grace); precedence HALF_DAY (<4h) > LATE > UNDERTIME > PRESENT; out<in throws VALIDATION_ERROR (day-shift assumption)
- Punch state machine (mirrors lgu-hrms kiosk): AUTO resolves IN on empty day / OUT on open row; explicit IN/OUT enforce guards (`ALREADY_CLOCKED_IN/OUT`); `/attendance/punch` is self-service only (JWT `externalId` = employeeNumber, client-sent `employeeNumber` stripped) — punching for others goes through `/punch-manual` (ADMIN/HR_MANAGER/DEPARTMENT_HEAD)
- Punch geolocation: self-service punches send `geo {lat,lng,accuracy}` and are **strict** — rejected without a fix (`LOCATION_REQUIRED`) and geofenced (`OUTSIDE_GEOFENCE`, `LOCATION_INACCURATE`, `LOCATION_INVALID`) by `backend/src/lib/geo.js` (haversine + accuracy cap vs `AttendanceRule.officeLat/officeLng/geofenceRadiusM/maxAccuracyM`; browsers don't expose Android's mock flag so guard = finite/range + accuracy>0 + cap). Locations stored as `AttendanceRecord.geoIn/geoOut` JSON. Manual punches record geo but never enforce. Runtime config lives in **Settings > Attendance** (`GET/PATCH /attendance/rule/geofence`, ADMIN/HR_MANAGER, Zod `geofenceUpdateSchema` — enable requires lat+lng); seed/env (`OFFICE_LAT/LNG`, `GEOFENCE_RADIUS_M`) is only the provisioning default.
- Absentee backfill `POST /attendance/mark-absent {date}`: skips holidays, approved leaves → ON_LEAVE, gaps → ABSENT, idempotent

## Auth & RBAC
- JWT verified by `backend/src/middleware/auth.js` `requireAuth`; mounted globally after `/auth` + `/external` + `/webhooks/hrms` in `routes/index.js`
- Role gating: single `requireRole()` in `middleware/rbac.js` — do not re-add a copy in auth.js
- Roles: ADMIN > HR_MANAGER > DEPARTMENT_HEAD > AUDITOR > VIEWER; `/reports` → ADMIN+HR_MANAGER+DEPARTMENT_HEAD+AUDITOR (mirrors lgu-hrms); `/attendance` writes + `/employees` writes → ADMIN/HR_MANAGER (+DEPARTMENT_HEAD for attendance); `/sync/run` + `/api-keys` (ADMIN for keys)
- Frontend mirrors it: `Protected roles={...}` in `App.jsx` + role-filtered `Sidebar.jsx` groups; `/reports` hidden for VIEWER
- Audit middleware `middleware/audit.js` writes append-only `AuditLog` on mutating requests (global mount only, before/after snapshots — `after` from captured response, `before` via `res.locals.auditBefore`, failed attempts logged with `error: true`, write failures to stderr never swallowed, secrets redacted via `redact()`)

## Validation (Zod)
- `middleware/validate.js` handles body+params+query; query uses `defineProperty` (Express 5 getter)
- Contracts live in `backend/src/shared/contracts/`: auth, employees, attendance, reports, sync, apiKeys
- Webhook signature is verified against the **raw body** (`req.rawBody` captured in `server.js` json `verify`) BEFORE the contract parses
- Dates = `YYYY-MM-DD` regex, coerced to UTC in services, never `new Date(raw)`

## Conventions
- Frontend changes preserve design tokens; zero hardcoded colors (`bg-white`, `text-white`, `slate-`, `gray-` are forbidden)
- Toasts: `const toast = useToast()` + `toast('msg','type')` — never `const { push } = useToast()`
- ConfirmDialog props: `message|confirmLabel|danger` — never `description|confirmText|variant`
- One concern per file: routes = HTTP + validation, repositories = queries, services/controllers = business logic; keep routes thin
- All mutating endpoints must write AuditLog (exactly once — global mount only, no per-route duplicates)
- Soft delete via `deletedAt` (employee revival on rehire handled in `employeeService`)
- API-key raw values are shown once at creation; sha256 at rest; never log keys (audit snapshots redact `key`)
- Ports: backend 4100, frontend 5174, db 5440 — kept clear of lgu-hrms (4000/5173/5432); storage key `lgu-attendance-auth`, theme key `lgu-attendance-theme`

## Do / Don't
**Do:**
- Wire to the API layer first and verify the component actually calls it; reuse `frontend/src/api/*` modules
- Reuse existing components (`MasterTable`, `Modal`, `ConfirmDialog`, `Badge`, `StatCard`, `EmptyState`, `useToast`) before writing new markup
- Use Prisma Decimal for money, YYYY-MM-DD + UTC for dates, Zod for all external input
- Toast every user action, confirm destructive actions, keep one `.btn-primary` per view, preserve design tokens
- Verify with `npm run build` + `node --check` + color lint before finishing; commit per unit with conventional messages (`feat|fix|chore|polish|refactor|docs`)

**Don't:**
- Don't ship mocks or hardcoded workflows (the demo roster in seed.js is labeled test data, seeded into the DB like lgu-hrms does)
- Don't swallow errors, don't leak stack traces/DB internals, don't log secrets or tokens
- Don't bypass RBAC or the audit trail; don't hardcode colors/spacing/font sizes
- Don't introduce a second styling system (no CSS-in-JS, no UI kit), no decorative animation
- Don't run duplicate dev watchers (file locks break prisma generate on Windows)
