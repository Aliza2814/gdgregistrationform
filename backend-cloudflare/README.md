# Cloudflare Workers + D1 registration prototype

This prototype is deliberately isolated from `../backend`, which remains the current Express/Mongoose implementation. It does not import, migrate, or connect to MongoDB.

The registration UI and visual design are unchanged. The only frontend edit changes the post-confirmation copy. The API uses the existing registration routes and response fields.

## Local setup

Requirements: Node.js 22.12+ (tested with Node 24) and npm. The Cloudflare Workers Vitest plugin uses Miniflare's local D1 runtime; Docker is not required.

```powershell
cd backend-cloudflare
npm install
npm run d1:local:migrate
npm run d1:local:seed
if (!(Test-Path .dev.vars)) { Copy-Item .dev.vars.example .dev.vars }
```

Fill `.dev.vars` with the Firebase service-account JSON, Gmail app-password credentials, and sender address. `.dev.vars` is ignored by Git. Never put these values in `frontend/`, `wrangler.toml`, or committed files. Firebase must have Email link sign-in enabled, and the frontend URL must be an authorized Firebase domain.

Start the Worker:

```powershell
npm run dev
```

In another terminal, point the existing frontend at it:

```powershell
cd frontend
$env:VITE_API_URL = 'http://127.0.0.1:8787'
$env:VITE_EVENT_ID = 'local-demo-event'
npm run dev
```

Open `http://localhost:5175`. The Worker redirects Firebase links to `http://localhost:5175/?event=...`; for a real local email-link round trip, use a Firebase project configured for that authorized domain and local Worker secrets. No test sends email or requires Firebase credentials.

Run the local D1-backed Worker tests with:

```powershell
cd backend-cloudflare
npm test
```

The tests use local D1 and stub Firebase token/link and mail operations. They do not contact Firebase or send email.

## Secrets and bindings

- `DB` is a D1 binding declared in `wrangler.toml`; its all-zero database ID is a local-only placeholder. Create a real D1 database and set its ID only when separately preparing a deployment.
- `FIREBASE_SERVICE_ACCOUNT`, `SMTP_USER`, and `SMTP_PASS` are Worker secrets in production and values in ignored `.dev.vars` for local work. `MAIL_FROM` is a non-secret Worker variable (or a local `.dev.vars` value). No frontend bundle receives them.
- `SMTP_HOST` defaults to `smtp.gmail.com`; `SMTP_PORT` defaults to `587` with STARTTLS. In a patched-Nodemailer local Workers probe, 587 passed while 465 did not connect; set 465 only after validating it in the target runtime. The Worker prefers IPv4 because the local runtime may return unreachable IPv6 SMTP addresses. Only the Firebase verification message is sent. Confirmation never sends mail.
- `FRONTEND_URL` and `ALLOWED_ORIGINS` are non-secret Worker variables. The allowed student-email domain remains enforced by the backend logic. Local defaults allow the existing Vite origin on port 5175.

For a future, separately approved remote setup, set the D1 database ID and use `wrangler secret put FIREBASE_SERVICE_ACCOUNT`, `wrangler secret put SMTP_USER`, and `wrangler secret put SMTP_PASS`. No remote secrets or resources were configured for this prototype.

## D1 model and atomicity

`events` stores the fields `id`, `name`, `venue`, `starts_at`, `ends_at`, `deadline`, `capacity`, and `registration_open`. `registeredCount` is derived from `registrations`, not stored as a second mutable counter.

`registrations` has a database-enforced `UNIQUE (event_id, email)` constraint. Confirmation inserts with a single conditional `INSERT ... SELECT`: it checks the pending email, expiry, event-open flag, deadline, Day Scholar schedule, and current registration count in the same SQL statement. The seat count is computed from registrations, and concurrent SQLite writes are serialized by D1. A D1 batch then removes the pending row atomically with the insert. Retries find the existing registration and return success without taking another seat.

Pending verification requests do not reserve seats. They expire after one hour; a one-minute cooldown is enforced with an atomic D1 upsert. Confirmation rechecks eligibility and the event rules so event changes after email delivery cannot bypass them.

## Public API contract

The registration Worker implements:

- `GET /api/events/:id`
- `POST /api/events/:id/registrations/start` — body: registration form
- `POST /api/events/:id/registrations/status` — body: `{ "idToken": "..." }`
- `POST /api/events/:id/registrations/confirm` — body: `{ "idToken": "..." }`

The event response preserves the fields the current UI needs (`registered`, `available`, `status`, and `dayScholarEligible`) and also provides `registeredCount` for the shared event contract. Status returns only registration status and, when registered, the event name. Confirm is idempotent and returns `{ "ok": true, "already": false, "eventName": "..." }`; retries return `already: true`.

## Proposed Admin Panel contract (documentation only)

The Admin Panel has not been changed and its implementation is not included in this repository. For a shared authoritative event source, its backend should either use the same D1 database and migration/schema or call an authenticated admin API owned by this Worker. Prefer the API boundary so the browser never receives D1 credentials and registration writes remain the only way to affect counts.

Shared event fields:

```json
{
  "id": "event-id",
  "name": "Event name",
  "venue": "Venue",
  "startsAt": "2030-01-01T08:30:00.000Z",
  "endsAt": "2030-01-01T10:00:00.000Z",
  "deadline": null,
  "capacity": 150,
  "registeredCount": 0,
  "registrationOpen": true
}
```

`registeredCount` is read-only and derived from registrations; event capacity and `registrationOpen` edits take effect on the next registration request. Proposed admin operations, not implemented in this registration-only prototype:

- `GET /api/admin/events/:id`
- `POST /api/admin/events`
- `PUT /api/admin/events/:id`

These routes must require a separate admin authorization check. This prototype does not grant student tokens admin access or implement Admin Panel writes.

