# LGU Attendance

Attendance **monitoring and reporting system** for Philippine Local Government Units, connected to **LGU-HRMS** via API.

Built with the same tech stack as [`lgu-hrms`](../lgu-hrms): **Express 5 + plain-JS React 19** (Vite 5) and a **Tailwind 4 design-token system**.

```
HRMS (Express 5 :4000)
   â”‚  â‘ webhooks employee.created/updated/deleted (HMAC-SHA256, real-time push)
   â”‚  â‘¡scheduled/manual roster pull GET /api/v1/employees (polling fallback)
   â–¼
Attendance API (Express 5 :4100) â”€â”€ PostgreSQL 16 (Prisma, db lgu_attendance)
   â”‚  Route â†’ Controller â†’ Service â†’ Repository Â· Zod contracts Â· RBAC Â· append-only AuditLog
   â–¼
React 19 SPA (:5174) â€” Live Board Â· Attendance Â· Employees Â· Reports Â· HRMS Sync
```

---

## Quick Start

Requirements: **Docker Desktop** (running), **Node.js 18+**.

### 1. Provision the database

PostgreSQL 16 container published on `localhost:5440` (kept clear of the HRMS db on `5432`), database `lgu_attendance`:

```powershell
docker compose up -d db
```

### 2. Configure the backend

```powershell
copy backend\.env.example backend\.env
```

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5440/lgu_attendance?schema=public` | bundled container |
| `PORT` | `4100` | clear of HRMS `:4000` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | long random strings | access ~15m + refresh rotation |
| `HRMS_BASE_URL` | `http://localhost:4000` | lgu-hrms API base, no trailing slash |
| `HRMS_API_KEY` | *(from HRMS â†’ Settings â†’ Integrations â†’ API Keys)* | scope `employees:read`, tenant-scoped |
| `HRMS_WEBHOOK_SECRET` | *(from HRMS â†’ Settings â†’ Integrations â†’ Webhooks, shown once)* | HMAC-SHA256, min 48 chars |
| `HRMS_SYNC_POLLER` | `1` to enable | scheduled polling fallback |
| `HRMS_SYNC_INTERVAL_MIN` | `15` | poll interval when enabled |
| `INTEGRATION_ALLOWED_IPS` | comma-separated IPs/CIDRs | optional webhook allowlist |

### 3. Apply migrations + seed

```powershell
cd backend
npx prisma migrate dev          # create/apply migrations from schema.prisma
node prisma/seed.js             # idempotent: users per role, default rule, holidays, demo roster + 14 days of attendance
```

Sign in with **`admin` / `admin123`** (override via `SEED_DEFAULT_PASSWORD`). Seeded roles: `admin`, `hr_manager`, `dept_head`, `auditor`, `viewer`.

### 4. Run the app

```powershell
# Terminal 1 - API (http://localhost:4100)
cd backend
npm run dev

# Terminal 2 - Web (http://localhost:5174)
cd frontend
npm run dev
```

Prod-build sanity check: `cd frontend && npm run build`.

---

## Connecting to LGU-HRMS

1. **API key (polling source):** In HRMS â†’ Settings â†’ Integrations â†’ **API Keys**, create a read key with scope `employees:read`. Paste it into `backend/.env` â†’ `HRMS_API_KEY`. Rotate every 90 days.
2. **Webhook (real-time push):** In HRMS â†’ Settings â†’ Integrations â†’ **Webhooks**, add a webhook pointing to `{this-system-host}/api/v1/webhooks/hrms` for events `employee.created`, `employee.updated`, `employee.deleted`. Copy the secret (shown **only once**) into `HRMS_WEBHOOK_SECRET` and restart the backend.
3. **Polling fallback:** set `HRMS_SYNC_POLLER=1` â€” the backend pulls the full roster every `HRMS_SYNC_INTERVAL_MIN` minutes and upserts by `employeeNumber`. Trigger a manual pull via **HRMS Sync â†’ Run Sync Now** or `POST /api/v1/sync/run`.
4. **Consumption (reverse direction):** external systems (e.g. HRMS payroll) read attendance back with a Bearer API key created under **HRMS Sync â†’ API Keys** (ADMIN only): `GET /api/v1/external/attendance` (scope `attendance:read`) and `GET /api/v1/external/summary` (scope `reports:read`).

Every webhook/poll is recorded in the `SyncLog` table (**HRMS Sync** page).

---

## API surface (`/api/v1`)

| Area | Endpoints | Auth |
|---|---|---|
| Health | `GET /health` | public |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` | public / JWT |
| Employees | `GET /employees`, `GET /employees/:id` Â· writes ADMIN/HR_MANAGER | JWT |
| Attendance | `GET /attendance`, `GET /attendance/today`, `GET /attendance/my`, `POST /attendance/punch` Â· `POST /attendance/punch-manual`, `POST /attendance/mark-absent`, `PATCH /attendance/:id` (ADMIN/HR_MANAGER/DEPARTMENT_HEAD) | JWT |
| Reports | `GET /reports/daily`, `GET /reports/summary`, `GET /reports/timesheet/:employeeId`, `GET /reports/export` (CSV) | JWT â€” ADMIN/HR_MANAGER/DEPARTMENT_HEAD/AUDITOR |
| Sync | `GET /sync/status`, `GET /sync/logs` Â· `POST /sync/run` (ADMIN/HR_MANAGER) | JWT |
| API keys | `GET/POST/DELETE /api-keys` | JWT â€” ADMIN |
| Webhooks | `POST /webhooks/hrms` | HMAC-SHA256 signature (`X-HRMS-Signature`), 30 req/min/IP |
| External | `GET /external/attendance`, `GET /external/summary` | Bearer API key (scope-checked) |

---

## Domain model

- **Employee** â€” roster mirrored from HRMS (`hrmsId` + `employeeNumber` join key, `syncSource`/`lastSyncedAt` provenance)
- **AttendanceRecord** â€” one row per employee per day; `timeIn`/`timeOut`/`hours`, status `PRESENT|LATE|UNDERTIME|HALF_DAY|ABSENT|ON_LEAVE`, `minutesLate`/`undertimeMinutes`, `source` provenance
- **AttendanceRule** â€” work window + lunch + grace (defaults 08:00â€“17:00, 12:00â€“13:00, 15m) driving late/undertime computation
- **LeaveRequest** / **Holiday** â€” approved leaves mark `ON_LEAVE`; holidays skip absentee backfill
- **SyncLog** â€” webhook receipts (INBOUND) + roster pulls (PULL), `SUCCESS|PARTIAL|FAILED`
- **User** / **AuditLog** / **ApiKey** â€” JWT sessions for the UI, append-only audit trail, hashed machine-consumer keys

Manila-day logic lives in `backend/src/lib/time.js` (mirrors lgu-hrms): dates stored UTC, computed/displayed Asia/Manila. Attendance rate = physically showed up (present + late + undertime + half-day) / active roster.

---

## Common pitfalls

- **API 500 on login** â†’ the Postgres container is down: `docker compose up -d db`, confirm `docker ps` shows `0.0.0.0:5440->5432/tcp`.
- **npm blocks install scripts** (bcrypt/prisma engines) â†’ run `npm install-scripts approve bcrypt prisma @prisma/engines @prisma/client` in `backend/`, then `npm install` again.
- **`EPERM` regenerating Prisma Client** â†’ stop the backend (`node --watch` locks the engine DLL on Windows), then `npx prisma generate`.
- **Webhook 401 `INVALID_SIGNATURE`** â†’ `HRMS_WEBHOOK_SECRET` mismatch or missing; re-copy from HRMS (rotate if lost) and restart.
- **Sync `FAILED` with `HRMS_NOT_CONFIGURED`** â†’ set `HRMS_BASE_URL` + `HRMS_API_KEY` first.
- **Port collisions** â†’ this system uses 4100/5174/5440 to stay clear of lgu-hrms (4000/5173/5432).

## Structure

- `backend/` â€” Express 5 API (port 4100), Prisma + PostgreSQL 16 schema, RBAC/audit/Zod middleware, layered controllers/services/repositories, HRMS webhook receiver + poller
- `frontend/` â€” React 19 + Vite 5 SPA (port 5174), Tailwind 4 design tokens in `src/index.css`, pages: Dashboard (Live Board), Attendance, Employees, Reports, Integration (HRMS Sync)

## Docs

- `AGENTS.md` â€” living build spec + codebase map (**start here**)
- HRMS integration reference: `../lgu-hrms/INTEGRATION_GUIDE.md`
