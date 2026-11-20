import { env } from 'cloudflare:workers';
import schema from '../migrations/0001_initial.sql?raw';
import { createWorker } from '../src/worker.js';

export const EVENT_ID = 'test-event';
export const EVENT_NAME = 'Campus Workshop';
export const FORM = {
  name: 'Student Example',
  year: '2nd Year',
  department: 'CSE',
  accommodation: 'Hosteler',
};

const identities = new Map([
  ['token-student', { email: 'student@chitkara.edu.in', email_verified: true }],
  ['token-student-2', { email: 'student2@chitkara.edu.in', email_verified: true }],
  ['token-unverified', { email: 'student@chitkara.edu.in', email_verified: false }],
]);

export function createTestServices() {
  const sentEmails = [];
  const generatedLinks = [];
  const services = {
    verifyIdToken: async (token) => {
      const identity = identities.get(token);
      if (!identity) throw Object.assign(new Error('Invalid test token.'), { code: 'auth/invalid-id-token' });
      return identity;
    },
    generateSignInLink: async (email, url) => {
      const link = `https://firebase.example.test/sign-in?email=${encodeURIComponent(email)}`;
      generatedLinks.push({ email, url, link });
      return link;
    },
    sendVerificationEmail: async (message) => {
      sentEmails.push(message);
      return { messageId: 'test-message-id' };
    },
  };
  return { worker: createWorker(services), sentEmails, generatedLinks };
}

export async function initializeDatabase() {
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }
}

export async function clearDatabase() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pending_verifications'),
    env.DB.prepare('DELETE FROM registrations'),
    env.DB.prepare('DELETE FROM request_limits'),
    env.DB.prepare('DELETE FROM events'),
  ]);
}

export async function seedEvent({
  id = EVENT_ID,
  name = EVENT_NAME,
  startsAt = '2030-01-01T08:30:00.000Z',
  endsAt = '2030-01-01T10:00:00.000Z',
  deadline = '2030-01-02T00:00:00.000Z',
  capacity = 2,
  registrationOpen = true,
} = {}) {
  await env.DB.prepare(`
    INSERT INTO events (
      id, name, venue, starts_at, ends_at, deadline, capacity, registration_open
    ) VALUES (?, ?, 'Hall A', ?, ?, ?, ?, ?)
  `).bind(id, name, startsAt, endsAt, deadline, capacity, registrationOpen ? 1 : 0).run();
}

export async function request(worker, eventId, action, body, method = 'POST') {
  const path = `/api/events/${encodeURIComponent(eventId)}${action ? `/registrations/${action}` : ''}`;
  const response = await worker.fetch(new Request(`https://worker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
  }), env);
  return { status: response.status, body: await response.json() };
}

export function registrationForm(email, overrides = {}) {
  return { ...FORM, email, ...overrides };
}

export async function start(worker, eventId, email, overrides = {}) {
  return request(worker, eventId, 'start', registrationForm(email, overrides));
}

export async function confirm(worker, eventId, token = 'token-student') {
  return request(worker, eventId, 'confirm', { idToken: token });
}

export async function registrationCount(eventId) {
  const result = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?
  `).bind(eventId).first();
  return Number(result.count);
}

