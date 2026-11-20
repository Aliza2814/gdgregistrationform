import { generateSignInLink, verifyIdToken } from './firebase-auth.js';
import { dayScholarEligible, EMAIL_DOMAIN, eventResponse, eventStatus, normalizeEmail, validate } from './logic.js';
import { sendVerificationEmail, verificationEmailHtml } from './mailer.js';

const INVALID_TOKEN_CODES = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
]);

const statusCodeFor = (status) => status === 'full' ? 'FULL' : 'CLOSED';
const confirmed = (eventName, already = false) => ({ ok: true, already, eventName });

function allowedOrigins(env) {
  return new Set([
    env.FRONTEND_URL,
    ...(env.ALLOWED_ORIGINS || '').split(','),
  ].filter(Boolean).map((origin) => origin.trim()));
}

function jsonResponse(payload, status, request, env) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function notFound(request, env) {
  return jsonResponse({ code: 'NOT_FOUND' }, 404, request, env);
}

async function requestBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 10 * 1024) {
    return { error: 'TOO_LARGE' };
  }
  try {
    return { value: text ? JSON.parse(text) : {} };
  } catch {
    return { error: 'INVALID_JSON' };
  }
}

async function eventById(db, id) {
  return db.prepare(`
    SELECT
      e.id,
      e.name,
      e.venue,
      e.starts_at AS startsAt,
      e.ends_at AS endsAt,
      e.deadline,
      e.capacity,
      e.registration_open AS registrationOpen,
      (
        SELECT COUNT(*)
        FROM registrations AS r
        WHERE r.event_id = e.id
      ) AS registeredCount
    FROM events AS e
    WHERE e.id = ?
  `).bind(id).first();
}

async function hashClientKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(db, request, route, max, now) {
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const clientHash = await hashClientKey(clientIp);
  const windowStart = Math.floor(now / 600000) * 600000;
  const result = await db.prepare(`
    INSERT INTO request_limits (route, client_hash, window_start, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT (route, client_hash) DO UPDATE SET
      request_count = CASE
        WHEN request_limits.window_start = excluded.window_start
          THEN request_limits.request_count + 1
        ELSE 1
      END,
      window_start = excluded.window_start
    RETURNING request_count
  `).bind(route, clientHash, windowStart).first();
  return Number(result.request_count) <= max;
}

async function authenticate(token, env, services) {
  let decoded;
  try {
    decoded = await services.verifyIdToken(String(token || ''), env);
  } catch (error) {
    if (INVALID_TOKEN_CODES.has(error.code)) return null;
    throw error;
  }
  const email = normalizeEmail(decoded.email);
  return decoded.email_verified === true && email.endsWith(EMAIL_DOMAIN) ? email : null;
}

async function startRegistration(request, env, services, eventId, now) {
  const db = env.DB;
  const rateAllowed = await rateLimit(db, request, 'start', 10, now);
  if (!rateAllowed) return jsonResponse({ code: 'RATE_LIMITED' }, 429, request, env);

  const parsed = await requestBody(request);
  if (parsed.error === 'TOO_LARGE') return jsonResponse({ code: 'INVALID' }, 413, request, env);
  if (parsed.error) return jsonResponse({ code: 'INVALID_JSON' }, 400, request, env);
  const { values, errors } = validate(parsed.value);
  if (Object.keys(errors).length) {
    return jsonResponse({ code: 'INVALID', errors }, 422, request, env);
  }

  const event = await eventById(db, eventId);
  if (!event) return notFound(request, env);
  const registeredCount = Number(event.registeredCount);
  const status = eventStatus(event, registeredCount, new Date(now));
  if (status !== 'open') {
    return jsonResponse({ code: statusCodeFor(status) }, 409, request, env);
  }
  if (values.accommodation === 'Day Scholar' && !dayScholarEligible(event.startsAt, event.endsAt)) {
    return jsonResponse({ code: 'DAY_SCHOLAR_INELIGIBLE' }, 403, request, env);
  }

  const duplicate = await db.prepare(`
    SELECT 1 AS registered
    FROM registrations
    WHERE event_id = ? AND email = ?
  `).bind(eventId, values.email).first();
  if (duplicate) return jsonResponse({ code: 'DUPLICATE' }, 409, request, env);

  const previous = await db.prepare(`
    SELECT last_sent_at AS lastSentAt
    FROM pending_verifications
    WHERE event_id = ? AND email = ?
  `).bind(eventId, values.email).first();
  if (previous && now - Number(previous.lastSentAt) < 60000) {
    const retryAfter = Math.ceil((60000 - (now - Number(previous.lastSentAt))) / 1000);
    return jsonResponse({ code: 'COOLDOWN', retryAfter }, 429, request, env);
  }

  let link;
  try {
    const frontendUrl = env.FRONTEND_URL;
    if (!frontendUrl) throw Object.assign(new Error('FRONTEND_URL is not configured.'), { code: 'CONFIGURATION' });
    link = await services.generateSignInLink(values.email, `${frontendUrl}/?event=${encodeURIComponent(eventId)}`, env);
  } catch (error) {
    console.error('[firebase] sign-in link generation failed', { eventId, code: error.code || 'UNKNOWN' });
    return jsonResponse({ code: 'EMAIL_FAILED' }, 502, request, env);
  }

  const requestId = crypto.randomUUID();
  const expiresAt = now + 60 * 60000;
  const reservation = await db.prepare(`
    INSERT INTO pending_verifications (
      event_id, email, name, year, department, accommodation,
      last_sent_at, expires_at, request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id, email) DO UPDATE SET
      name = excluded.name,
      year = excluded.year,
      department = excluded.department,
      accommodation = excluded.accommodation,
      last_sent_at = excluded.last_sent_at,
      expires_at = excluded.expires_at,
      request_id = excluded.request_id
    WHERE pending_verifications.last_sent_at <= ?
    RETURNING request_id
  `).bind(
    eventId,
    values.email,
    values.name,
    values.year,
    values.department,
    values.accommodation,
    now,
    expiresAt,
    requestId,
    now - 60000,
  ).first();

  if (!reservation) {
    const current = await db.prepare(`
      SELECT last_sent_at AS lastSentAt
      FROM pending_verifications
      WHERE event_id = ? AND email = ?
    `).bind(eventId, values.email).first();
    const retryAfter = current
      ? Math.max(1, Math.ceil((60000 - (now - Number(current.lastSentAt))) / 1000))
      : 60;
    return jsonResponse({ code: 'COOLDOWN', retryAfter }, 429, request, env);
  }

  try {
    await services.sendVerificationEmail({
      email: values.email,
      event,
      html: verificationEmailHtml(values.name, event.name, link),
    }, env);
  } catch (error) {
    try {
      await db.prepare(`
        DELETE FROM pending_verifications
        WHERE event_id = ? AND email = ? AND request_id = ?
      `).bind(eventId, values.email, requestId).run();
    } catch (cleanupError) {
      console.error('[pending] cleanup failed after email error', {
        eventId,
        code: cleanupError.code || 'UNKNOWN',
      });
    }
    console.error('[email] verification delivery failed', { eventId, code: error.code || 'UNKNOWN' });
    return jsonResponse({ code: 'EMAIL_FAILED' }, 502, request, env);
  }

  return jsonResponse({ ok: true, cooldown: 60 }, 200, request, env);
}

async function registrationStatus(request, env, services, eventId, now) {
  const db = env.DB;
  if (!await rateLimit(db, request, 'status', 30, now)) {
    return jsonResponse({ code: 'RATE_LIMITED' }, 429, request, env);
  }
  const parsed = await requestBody(request);
  if (parsed.error) return jsonResponse({ code: 'BAD_TOKEN' }, 401, request, env);
  const email = await authenticate(parsed.value?.idToken, env, services);
  if (!email) return jsonResponse({ code: 'BAD_TOKEN' }, 401, request, env);

  const event = await eventById(db, eventId);
  if (!event) return notFound(request, env);
  const registration = await db.prepare(`
    SELECT 1 AS registered
    FROM registrations
    WHERE event_id = ? AND email = ?
  `).bind(eventId, email).first();
  return jsonResponse({
    ok: true,
    registered: Boolean(registration),
    ...(registration ? { eventName: event.name } : {}),
  }, 200, request, env);
}

async function deletePendingForRegistration(db, eventId, email) {
  await db.prepare(`
    DELETE FROM pending_verifications
    WHERE event_id = ? AND email = ?
      AND EXISTS (
        SELECT 1 FROM registrations
        WHERE event_id = ? AND email = ?
      )
  `).bind(eventId, email, eventId, email).run();
}

async function confirmRegistration(request, env, services, eventId, now) {
  const db = env.DB;
  if (!await rateLimit(db, request, 'confirm', 30, now)) {
    return jsonResponse({ code: 'RATE_LIMITED' }, 429, request, env);
  }
  const parsed = await requestBody(request);
  if (parsed.error) return jsonResponse({ code: 'BAD_TOKEN' }, 401, request, env);
  const email = await authenticate(parsed.value?.idToken, env, services);
  if (!email) return jsonResponse({ code: 'BAD_TOKEN' }, 401, request, env);

  const event = await eventById(db, eventId);
  if (!event) return notFound(request, env);

  const existing = await db.prepare(`
    SELECT 1 AS registered
    FROM registrations
    WHERE event_id = ? AND email = ?
  `).bind(eventId, email).first();
  if (existing) {
    try {
      await deletePendingForRegistration(db, eventId, email);
    } catch (error) {
      console.error('[pending] cleanup failed after registration', { eventId, code: error.code || 'UNKNOWN' });
    }
    return jsonResponse(confirmed(event.name, true), 200, request, env);
  }

  const pending = await db.prepare(`
    SELECT name, year, department, accommodation, expires_at AS expiresAt
    FROM pending_verifications
    WHERE event_id = ? AND email = ?
  `).bind(eventId, email).first();
  if (!pending || Number(pending.expiresAt) <= now) {
    return jsonResponse({ code: 'EXPIRED' }, 410, request, env);
  }
  if (pending.accommodation === 'Day Scholar' && !dayScholarEligible(event.startsAt, event.endsAt)) {
    return jsonResponse({ code: 'DAY_SCHOLAR_INELIGIBLE' }, 403, request, env);
  }
  const status = eventStatus(event, Number(event.registeredCount), new Date(now));
  if (status !== 'open') {
    return jsonResponse({ code: statusCodeFor(status) }, 409, request, env);
  }

  const registrationId = crypto.randomUUID();
  const registrationInsert = db.prepare(`
    INSERT INTO registrations (
      id, event_id, email, name, year, department, accommodation, confirmed_at
    )
    SELECT
      ?, e.id, p.email, p.name, p.year, p.department, p.accommodation, ?
    FROM events AS e
    JOIN pending_verifications AS p
      ON p.event_id = e.id AND p.email = ?
    WHERE e.id = ?
      AND p.expires_at > ?
      AND e.registration_open = 1
      AND (e.deadline IS NULL OR e.deadline > ?)
      AND (
        p.accommodation <> 'Day Scholar'
        OR (
          CAST(strftime('%H', e.starts_at, '+330 minutes') AS INTEGER) * 60
            + CAST(strftime('%M', e.starts_at, '+330 minutes') AS INTEGER) <= 960
          AND CAST(strftime('%H', e.ends_at, '+330 minutes') AS INTEGER) * 60
            + CAST(strftime('%M', e.ends_at, '+330 minutes') AS INTEGER) <= 990
        )
      )
      AND (
        SELECT COUNT(*)
        FROM registrations AS current_registrations
        WHERE current_registrations.event_id = e.id
      ) < e.capacity
    ON CONFLICT (event_id, email) DO NOTHING
    RETURNING id
  `).bind(
    registrationId,
    new Date(now).toISOString(),
    email,
    eventId,
    now,
    new Date(now).toISOString(),
  );
  const cleanupPending = db.prepare(`
    DELETE FROM pending_verifications
    WHERE event_id = ? AND email = ?
      AND EXISTS (
        SELECT 1 FROM registrations
        WHERE event_id = ? AND email = ?
      )
  `).bind(eventId, email, eventId, email);
  const results = await db.batch([registrationInsert, cleanupPending]);
  if (results[0].results?.length) {
    return jsonResponse(confirmed(event.name), 200, request, env);
  }

  const saved = await db.prepare(`
    SELECT 1 AS registered
    FROM registrations
    WHERE event_id = ? AND email = ?
  `).bind(eventId, email).first();
  if (saved) return jsonResponse(confirmed(event.name, true), 200, request, env);

  const latest = await eventById(db, eventId);
  if (!latest) return notFound(request, env);
  const latestPending = await db.prepare(`
    SELECT expires_at AS expiresAt, accommodation
    FROM pending_verifications
    WHERE event_id = ? AND email = ?
  `).bind(eventId, email).first();
  if (!latestPending || Number(latestPending.expiresAt) <= now) {
    return jsonResponse({ code: 'EXPIRED' }, 410, request, env);
  }
  if (latestPending.accommodation === 'Day Scholar'
    && !dayScholarEligible(latest.startsAt, latest.endsAt)) {
    return jsonResponse({ code: 'DAY_SCHOLAR_INELIGIBLE' }, 403, request, env);
  }
  const latestStatus = eventStatus(latest, Number(latest.registeredCount), new Date(now));
  if (latestStatus !== 'open') {
    return jsonResponse({ code: statusCodeFor(latestStatus) }, 409, request, env);
  }

  console.error('[registration] conditional insert did not create a registration', { eventId });
  return jsonResponse({ code: 'SERVER' }, 500, request, env);
}

export function createWorker(services = {
  verifyIdToken,
  generateSignInLink,
  sendVerificationEmail,
}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get('Origin');
      const origins = allowedOrigins(env);
      if (origin && !origins.has(origin)) {
        return jsonResponse({ code: 'FORBIDDEN_ORIGIN' }, 403, request, env);
      }

      if (request.method === 'OPTIONS') {
        const headers = new Headers({
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        });
        if (origin) headers.set('Access-Control-Allow-Origin', origin);
        return new Response(null, { status: 204, headers });
      }

      const match = new URL(request.url).pathname.match(
        /^\/api\/events\/([^/]+)(?:\/registrations\/(start|status|confirm))?\/?$/,
      );
      if (!match) return notFound(request, env);

      let eventId;
      try {
        eventId = decodeURIComponent(match[1]);
      } catch {
        return notFound(request, env);
      }
      if (!eventId || eventId.length > 128) return notFound(request, env);

      const action = match[2];
      const now = Date.now();
      try {
        if (!action && request.method === 'GET') {
          const event = await eventById(env.DB, eventId);
          if (!event) return notFound(request, env);
          return jsonResponse(
            eventResponse(event, Number(event.registeredCount), new Date(now)),
            200,
            request,
            env,
          );
        }
        if (action && request.method === 'POST') {
          if (action === 'start') return await startRegistration(request, env, services, eventId, now);
          if (action === 'status') return await registrationStatus(request, env, services, eventId, now);
          return await confirmRegistration(request, env, services, eventId, now);
        }
        return notFound(request, env);
      } catch (error) {
        console.error('[api] request failed', {
          path: new URL(request.url).pathname,
          code: error.code || 'UNKNOWN',
        });
        return jsonResponse({ code: 'SERVER' }, 500, request, env);
      }
    },
  };
}

export default createWorker();

