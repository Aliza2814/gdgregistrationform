import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDatabase,
  confirm,
  createTestServices,
  EVENT_ID,
  initializeDatabase,
  seedEvent,
  start,
} from './helpers.js';

describe('event and accommodation rules', () => {
  beforeAll(initializeDatabase);
  beforeEach(clearDatabase);

  it('rejects Day Scholar registrations outside the allowed event hours', async () => {
    await seedEvent({
      startsAt: '2030-01-01T10:30:00.000Z',
      endsAt: '2030-01-01T11:30:00.000Z',
    });
    const { worker, sentEmails } = createTestServices();

    const result = await start(worker, EVENT_ID, 'student@chitkara.edu.in', {
      accommodation: 'Day Scholar',
    });

    expect(result).toEqual({ status: 403, body: { code: 'DAY_SCHOLAR_INELIGIBLE' } });
    expect(sentEmails).toHaveLength(0);
  });

  it('rechecks Day Scholar eligibility against current event times at confirmation', async () => {
    await seedEvent();
    const { worker } = createTestServices();
    await start(worker, EVENT_ID, 'student@chitkara.edu.in', { accommodation: 'Day Scholar' });
    await env.DB.prepare(`
      UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?
    `).bind('2030-01-01T10:30:00.000Z', '2030-01-01T11:30:00.000Z', EVENT_ID).run();

    const result = await confirm(worker, EVENT_ID);
    expect(result).toEqual({ status: 403, body: { code: 'DAY_SCHOLAR_INELIGIBLE' } });
  });

  it('blocks expired deadlines and closed registrations before allocating a seat', async () => {
    await seedEvent({ id: 'expired-event', deadline: '2000-01-01T00:00:00.000Z' });
    await seedEvent({ id: 'closed-event', registrationOpen: false });
    const { worker, sentEmails } = createTestServices();

    const expired = await start(worker, 'expired-event', 'student@chitkara.edu.in');
    const closed = await start(worker, 'closed-event', 'student2@chitkara.edu.in');

    expect(expired).toEqual({ status: 409, body: { code: 'CLOSED' } });
    expect(closed).toEqual({ status: 409, body: { code: 'CLOSED' } });
    expect(sentEmails).toHaveLength(0);
  });

  it('rechecks the deadline and registrationOpen flag at confirmation', async () => {
    await seedEvent({ id: 'deadline-event' });
    await seedEvent({ id: 'toggle-event' });
    const { worker } = createTestServices();
    await start(worker, 'deadline-event', 'student@chitkara.edu.in');
    await start(worker, 'toggle-event', 'student2@chitkara.edu.in');
    await env.DB.batch([
      env.DB.prepare('UPDATE events SET deadline = ? WHERE id = ?')
        .bind('2000-01-01T00:00:00.000Z', 'deadline-event'),
      env.DB.prepare('UPDATE events SET registration_open = 0 WHERE id = ?')
        .bind('toggle-event'),
    ]);

    const deadlineResult = await confirm(worker, 'deadline-event');
    const closedResult = await confirm(worker, 'toggle-event', 'token-student-2');

    expect(deadlineResult).toEqual({ status: 409, body: { code: 'CLOSED' } });
    expect(closedResult).toEqual({ status: 409, body: { code: 'CLOSED' } });
  });

  it('rejects a pending verification after its expiry', async () => {
    await seedEvent();
    const { worker } = createTestServices();
    await start(worker, EVENT_ID, 'student@chitkara.edu.in');
    await env.DB.prepare(`
      UPDATE pending_verifications SET expires_at = ? WHERE event_id = ? AND email = ?
    `).bind(Date.now() - 1, EVENT_ID, 'student@chitkara.edu.in').run();

    const result = await confirm(worker, EVENT_ID);
    expect(result).toEqual({ status: 410, body: { code: 'EXPIRED' } });
  });
});

