import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from './app.js';

const eventName = 'Campus Workshop';
const validId = 'valid-token';

function fixture({ capacity = 2, eligible = true } = {}) {
  const eventId = new mongoose.Types.ObjectId();
  const event = {
    _id: eventId,
    id: eventId.toString(),
    name: eventName,
    venue: 'Hall A',
    startsAt: new Date(eligible ? '2030-01-01T08:30:00Z' : '2030-01-01T10:30:00Z'),
    endsAt: new Date(eligible ? '2030-01-01T10:00:00Z' : '2030-01-01T11:30:00Z'),
    deadline: new Date('2030-01-02T00:00:00Z'),
    capacity,
    registeredCount: 0,
    registrationOpen: true,
  };
  const registrations = new Map();
  const pendings = new Map();
  const emails = [];

  const Event = {
    findById: async (id) => id.toString() === event.id ? event : null,
    findOneAndUpdate: async (filter, update) => {
      const deadline = filter.$or?.find((condition) => condition.deadline?.$gt)?.deadline.$gt;
      if (filter._id.toString() !== event.id || !event.registrationOpen
        || event.registeredCount >= event.capacity || (event.deadline && deadline && event.deadline <= deadline)) return null;
      event.registeredCount += update.$inc.registeredCount;
      return event;
    },
    updateOne: async (filter, update) => {
      if (filter._id.toString() === event.id) event.registeredCount += update.$inc.registeredCount;
    },
  };
  const Registration = {
    exists: async (filter) => {
      if (filter._id) return [...registrations.values()].some((row) => row._id.toString() === filter._id.toString()) ? { _id: filter._id } : null;
      return registrations.has(`${filter.eventId}:${filter.email}`) ? { _id: true } : null;
    },
    create: async (row) => {
      const key = `${row.eventId}:${row.email}`;
      if (registrations.has(key)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      registrations.set(key, row);
      return row;
    },
  };
  const Pending = {
    findOne: async (filter) => {
      const row = pendings.get(`${filter.eventId}:${filter.email}`);
      if (!row) return null;
      if (filter.expiresAt?.$gt && row.expiresAt <= filter.expiresAt.$gt) return null;
      return row;
    },
    findOneAndUpdate: async (filter, update) => {
      const key = `${filter.eventId}:${filter.email}`;
      const row = { _id: new mongoose.Types.ObjectId(), eventId: filter.eventId, email: filter.email, ...update };
      pendings.set(key, row);
      return row;
    },
    deleteOne: async (filter) => {
      if (filter.eventId && filter.email) pendings.delete(`${filter.eventId}:${filter.email}`);
      else {
        for (const [key, row] of pendings) if (row._id.toString() === filter._id.toString()) pendings.delete(key);
      }
    },
  };
  const app = createApp({
    Event, Registration, Pending,
    verifyIdToken: async (token) => {
      if (token === validId) return { email: 'student@chitkara.edu.in', email_verified: true };
      if (token === 'other-token') return { email: 'other@chitkara.edu.in', email_verified: true };
      if (token === 'unverified-token') return { email: 'student@chitkara.edu.in', email_verified: false };
      throw Object.assign(new Error('invalid token'), { code: 'auth/invalid-id-token' });
    },
    generateSignInLink: async (email) => `https://firebase.test/?email=${encodeURIComponent(email)}`,
    sendVerificationEmail: async (message) => { emails.push(message); return { messageId: 'message-id' }; },
    frontendUrl: 'https://registration.example.test',
  });
  return { app, event, eventId: event.id, registrations, pendings, emails };
}

async function listen(t, setup) {
  const server = setup.app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(base, eventId, endpoint, body = {}) {
  const response = await fetch(`${base}/api/events/${eventId}/registrations/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const form = (email, accommodation = 'Hosteler') => ({
  name: 'Student Example', email, year: '2nd Year', department: 'CSE', accommodation,
});
const start = (base, eventId, values) => call(base, eventId, 'start', values);
const confirm = (base, eventId, idToken = validId) => call(base, eventId, 'confirm', { idToken });

test('confirmation is idempotent, status is minimal, and no second email is sent', async (t) => {
  const state = fixture();
  const base = await listen(t, state);
  assert.equal((await start(base, state.eventId, form('STUDENT@chitkara.edu.in'))).status, 200);

  const first = await confirm(base, state.eventId);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true, already: false, eventName });
  assert.equal(state.event.registeredCount, 1);
  assert.equal(state.emails.length, 1);

  const status = await call(base, state.eventId, 'status', { idToken: validId });
  assert.deepEqual(status.body, { ok: true, registered: true, eventName });
  const retry = await confirm(base, state.eventId);
  assert.deepEqual(retry.body, { ok: true, already: true, eventName });
  assert.equal(state.event.registeredCount, 1);
  assert.equal(state.emails.length, 1);
  assert.equal((await start(base, state.eventId, form('student@chitkara.edu.in'))).body.code, 'DUPLICATE');
});

test('a verified college account is required for status and confirmation', async (t) => {
  const state = fixture();
  const base = await listen(t, state);
  const status = await call(base, state.eventId, 'status', { idToken: 'unverified-token' });
  const result = await confirm(base, state.eventId, 'unverified-token');
  assert.equal(status.status, 401);
  assert.equal(result.status, 401);
  assert.equal(state.event.registeredCount, 0);
});

test('only one student can claim the final seat', async (t) => {
  const state = fixture({ capacity: 1 });
  const base = await listen(t, state);
  await start(base, state.eventId, form('student@chitkara.edu.in'));
  await start(base, state.eventId, form('other@chitkara.edu.in'));
  const results = await Promise.all([
    confirm(base, state.eventId, validId),
    confirm(base, state.eventId, 'other-token'),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(state.event.registeredCount, 1);
  assert.equal(state.registrations.size, 1);
});

test('Day Scholar eligibility is rechecked at confirmation', async (t) => {
  const state = fixture({ eligible: true });
  const base = await listen(t, state);
  await start(base, state.eventId, form('student@chitkara.edu.in', 'Day Scholar'));
  state.event.startsAt = new Date('2030-01-01T10:30:00Z');
  state.event.endsAt = new Date('2030-01-01T11:30:00Z');
  const result = await confirm(base, state.eventId);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'DAY_SCHOLAR_INELIGIBLE');
  assert.equal(state.event.registeredCount, 0);
});

test('an expired event deadline blocks seat allocation', async (t) => {
  const state = fixture();
  const base = await listen(t, state);
  await start(base, state.eventId, form('student@chitkara.edu.in'));
  state.event.deadline = new Date('2000-01-01T00:00:00Z');
  const result = await confirm(base, state.eventId);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'CLOSED');
  assert.equal(state.event.registeredCount, 0);
});
