import nodemailer from 'nodemailer';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

export function verificationEmailHtml(name, eventName, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #dadce0;border-radius:12px;overflow:hidden">
<div style="height:6px;background:linear-gradient(90deg,#4285F4 25%,#EA4335 25% 50%,#FBBC04 50% 75%,#34A853 75%)"></div>
<div style="padding:24px"><b style="font-size:18px">&lt;/&gt; GDG on Campus · Chitkara University</b>
<h2>Verify your email</h2><p>Hi ${escapeHtml(name)}, tap the button to verify your email for <b>${escapeHtml(eventName)}</b>. Your seat is confirmed only after verification. The link expires in 1 hour.</p>
<p><a href="${escapeHtml(link)}" style="background:#4285F4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Verify My Email</a></p>
<p style="color:#5f6368;font-size:12px">Didn't register? Ignore this email.</p></div></div>`;
}

export async function sendVerificationEmail({ email, event, html }, env) {
  const port = Number(env.SMTP_PORT || 587);
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  if (!user || !pass || !env.MAIL_FROM) {
    throw Object.assign(new Error('SMTP credentials and sender are required.'), {
      code: 'SMTP_NOT_CONFIGURED',
    });
  }
  if (![465, 587].includes(port)) {
    throw Object.assign(new Error('SMTP_PORT must be 465 or 587.'), {
      code: 'SMTP_CONFIGURATION',
    });
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    localAddress: '0.0.0.0',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
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

