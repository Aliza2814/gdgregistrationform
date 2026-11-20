import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDatabase,
  confirm,
  createTestServices,
  EVENT_ID,
  EVENT_NAME,
  initializeDatabase,
  request,
  seedEvent,
  start,
} from './helpers.js';

describe('Firebase email-link verification flow', () => {
  beforeAll(initializeDatabase);
  beforeEach(clearDatabase);

  it('generates and sends one Firebase verification email, then verifies and registers', async () => {
    await seedEvent();
    const { worker, generatedLinks, sentEmails } = createTestServices();
    const result = await start(worker, EVENT_ID, 'student@chitkara.edu.in');

    expect(result.status).toBe(200);
    expect(generatedLinks).toHaveLength(1);
    expect(generatedLinks[0].url).toBe(`http://localhost:5175/?event=${EVENT_ID}`);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].html).toContain(generatedLinks[0].link);

    const confirmed = await confirm(worker, EVENT_ID);
    expect(confirmed.body).toEqual({ ok: true, already: false, eventName: EVENT_NAME });
    expect(sentEmails).toHaveLength(1);
  });

  it('rejects invalid and unverified Firebase tokens without creating a registration', async () => {
    await seedEvent();
    const { worker } = createTestServices();

    const invalid = await confirm(worker, EVENT_ID, 'not-a-token');
    const unverified = await request(worker, EVENT_ID, 'confirm', { idToken: 'token-unverified' });

    expect(invalid).toEqual({ status: 401, body: { code: 'BAD_TOKEN' } });
    expect(unverified).toEqual({ status: 401, body: { code: 'BAD_TOKEN' } });
  });
});

