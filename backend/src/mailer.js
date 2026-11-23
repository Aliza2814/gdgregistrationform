import nodemailer from 'nodemailer';

function providerError(message, code, status) {
  return Object.assign(new Error(message), { code, ...(status ? { status } : {}) });
}

function safeProviderDetails(payload, status) {
  if (!payload || typeof payload !== 'object') {
    return { providerCode: `HTTP_${status}`, providerMessage: null };
  }
  const rawCode = payload.name || payload.code || payload.error?.code;
  const rawMessage = payload.message || payload.error?.message;
  const providerCode = typeof rawCode === 'string' ? rawCode.slice(0, 120) : `HTTP_${status}`;
  const providerMessage = typeof rawMessage === 'string'
    ? rawMessage.replace(/\b(re_[A-Za-z0-9_-]+|Bearer\s+\S+)\b/gi, '[REDACTED]').slice(0, 300)
    : null;
  return { providerCode, providerMessage };
}

async function sendWithResend({ email, event, html }, env, fetchImpl) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    throw providerError('Resend API key and sender are required.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [email],
        subject: `Verify your email for ${event.name}`,
        html,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    throw providerError(
      timedOut ? 'Email provider request timed out.' : 'Email provider request failed.',
      timedOut ? 'EMAIL_PROVIDER_TIMEOUT' : 'EMAIL_PROVIDER_NETWORK',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }
    const details = safeProviderDetails(payload, response.status);
    const error = providerError('Email provider rejected the message.', 'EMAIL_PROVIDER_REJECTED', response.status);
    error.providerCode = details.providerCode;
    error.providerMessage = details.providerMessage;
    throw error;
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw providerError('Email provider returned an invalid response.', 'EMAIL_PROVIDER_RESPONSE');
  }
  if (typeof result.id !== 'string' || !result.id) {
    throw providerError('Email provider response did not include a message ID.', 'EMAIL_PROVIDER_RESPONSE');
  }
  return { messageId: result.id };
}

async function sendWithSmtp({ email, event, html }, env) {
  const port = Number(env.SMTP_PORT || 465);
  if (!env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM || ![465, 587].includes(port)) {
    throw providerError('Valid SMTP credentials and sender are required.', 'SMTP_NOT_CONFIGURED');
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  try {
    return await transporter.sendMail({
      from: env.MAIL_FROM,
      to: email,
      subject: `Verify your email for ${event.name}`,
      html,
    });
  } finally {
    transporter.close();
  }
}

export async function sendVerificationEmail(message, env, fetchImpl = globalThis.fetch) {
  const provider = env.EMAIL_PROVIDER || 'smtp';
  if (provider === 'resend') {
    if (typeof fetchImpl !== 'function') {
      throw providerError('Fetch is unavailable for the email provider.', 'EMAIL_PROVIDER_UNAVAILABLE');
    }
    return sendWithResend(message, env, fetchImpl);
  }
  if (provider === 'smtp') return sendWithSmtp(message, env);
  throw providerError('EMAIL_PROVIDER must be smtp or resend.', 'EMAIL_PROVIDER_CONFIGURATION');
}
