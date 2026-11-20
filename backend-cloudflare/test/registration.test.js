import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDatabase,
  confirm,
  createTestServices,
  EVENT_ID,
  EVENT_NAME,
  initializeDatabase,
  registrationCount,
  request,
  seedEvent,
  start,
} from './helpers.js';

describe('registration persistence and seat allocation', () => {
  beforeAll(initializeDatabase);
  beforeEach(clearDatabase);

  it('persists a confirmed seat, rejects duplicates, and safely retries an interrupted response', async () => {
    await seedEvent();
    const { worker, sentEmails } = createTestServices();
    const started = await start(worker, EVENT_ID, 'student@chitkara.edu.in');
    expect(started).toMatchObject({ status: 200, body: { ok: true, cooldown: 60 } });
    expect(sentEmails).toHaveLength(1);
    expect(await registrationCount(EVENT_ID)).toBe(0);

    await confirm(worker, EVENT_ID);
    const retry = await confirm(worker, EVENT_ID);
    expect(retry).toEqual({
      status: 200,
      body: { ok: true, already: true, eventName: EVENT_NAME },
    });

    const status = await request(worker, EVENT_ID, 'status', { idToken: 'token-student' });
    expect(status).toEqual({
      status: 200,
      body: { ok: true, registered: true, eventName: EVENT_NAME },
    });
    expect(await registrationCount(EVENT_ID)).toBe(1);
    expect(sentEmails).toHaveLength(1);

    const duplicate = await start(worker, EVENT_ID, 'student@chitkara.edu.in');
    expect(duplicate).toEqual({ status: 409, body: { code: 'DUPLICATE' } });
    expect(sentEmails).toHaveLength(1);
  });

  it('allows only one of two simultaneous confirmations to claim the final seat', async () => {
    await seedEvent({ capacity: 1 });
    const { worker } = createTestServices();
    await start(worker, EVENT_ID, 'student@chitkara.edu.in');
    await start(worker, EVENT_ID, 'student2@chitkara.edu.in');

    const results = await Promise.all([
      confirm(worker, EVENT_ID, 'token-student'),
      confirm(worker, EVENT_ID, 'token-student-2'),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409).body.code).toBe('FULL');
    expect(await registrationCount(EVENT_ID)).toBe(1);

    const event = await request(worker, EVENT_ID, null, null, 'GET');
    expect(event.body).toMatchObject({ registered: 1, registeredCount: 1, available: 0, status: 'full' });
    expect(event.body.registrationOpen).toBe(true);
  });

  it('uses the unique event/email key when the same verification is confirmed simultaneously', async () => {
    await seedEvent();
    const { worker } = createTestServices();
    await start(worker, EVENT_ID, 'student@chitkara.edu.in');

    const results = await Promise.all([
      confirm(worker, EVENT_ID),
      confirm(worker, EVENT_ID),
    ]);

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.map((result) => result.body.already).sort()).toEqual([false, true]);
    expect(await registrationCount(EVENT_ID)).toBe(1);
  });

  it('returns the saved registration after a verification link is reopened', async () => {
    await seedEvent();
    const { worker } = createTestServices();
    await start(worker, EVENT_ID, 'student@chitkara.edu.in');
    const first = await confirm(worker, EVENT_ID);
    const reopenedLinkRetry = await confirm(worker, EVENT_ID);

    expect(first.body).toEqual({ ok: true, already: false, eventName: EVENT_NAME });
    expect(reopenedLinkRetry.body).toEqual({ ok: true, already: true, eventName: EVENT_NAME });
    expect(await registrationCount(EVENT_ID)).toBe(1);
  });
});

