import test from 'node:test';
import assert from 'node:assert/strict';
import { sendVerificationEmail } from './mailer.js';

const message = {
  email: 'student@chitkara.edu.in',
  event: { name: 'Campus Workshop' },
  html: '<p>Verify your email</p>',
};

test('Resend sends the verification message through its HTTPS API', async () => {
  let request;
  const result = await sendVerificationEmail(message, {
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-api-key',
    MAIL_FROM: 'GDG <verified@example.com>',
  }, async (url, options) => {
    request = { url, options };
    return Response.json({ id: 'email-123' }, { status: 200 });
  });

  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-api-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'GDG <verified@example.com>',
    to: ['student@chitkara.edu.in'],
    subject: 'Verify your email for Campus Workshop',
    html: '<p>Verify your email</p>',
  });
  assert.deepEqual(result, { messageId: 'email-123' });
});

test('Resend configuration errors are explicit and make no request', async () => {
  let requested = false;
  await assert.rejects(
    sendVerificationEmail(message, { EMAIL_PROVIDER: 'resend' }, async () => {
      requested = true;
    }),
    { code: 'EMAIL_PROVIDER_NOT_CONFIGURED' },
  );
  assert.equal(requested, false);
});

test('Resend HTTP failures do not return provider response content', async () => {
  await assert.rejects(
    sendVerificationEmail(message, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-api-key',
      MAIL_FROM: 'GDG <verified@example.com>',
    }, async () => new Response('private provider response', { status: 403 })),
    (error) => error.code === 'EMAIL_PROVIDER_REJECTED'
      && error.status === 403
      && !error.message.includes('private provider response'),
  );
});

test('unsupported email providers fail explicitly', async () => {
  await assert.rejects(
    sendVerificationEmail(message, { EMAIL_PROVIDER: 'unknown' }),
    { code: 'EMAIL_PROVIDER_CONFIGURATION' },
  );
});
