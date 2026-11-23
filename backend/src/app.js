import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { validate, normalizeEmail, dayScholarEligible, eventStatus, EMAIL_DOMAIN } from './logic.js';

const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const emailHtml = (name, eventName, link) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #dadce0;border-radius:12px;overflow:hidden">
<div style="height:6px;background:linear-gradient(90deg,#4285F4 25%,#EA4335 25% 50%,#FBBC04 50% 75%,#34A853 75%)"></div>
<div style="padding:24px"><b style="font-size:18px">&lt;/&gt; GDG on Campus · Chitkara University</b>
<h2>Verify your email</h2><p>Hi ${name.replace(/[<>&]/g, '')}, tap the button to verify your email for <b>${eventName}</b>. Your seat is confirmed only after verification. The link expires in 1 hour.</p>
<p><a href="${link}" style="background:#4285F4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Verify My Email</a></p>
<p style="color:#5f6368;font-size:12px">Didn't register? Ignore this email.</p></div></div>`;

const statusCodeFor = (status) => status === 'full' ? 'FULL' : 'CLOSED';
const confirmed = (eventName, already = false) => ({ ok: true, already, eventName });
const invalidTokenCodes = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
]);

export function createApp({ Event, Registration, Pending, verifyIdToken, generateSignInLink, sendVerificationEmail,
  frontendUrl }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: frontendUrl }), express.json({ limit: '10kb' }));

  const limit = (max) => rateLimit({ windowMs: 10 * 60000, max, standardHeaders: true, legacyHeaders: false });
  const authenticate = async (idToken) => {
    try {
      const decoded = await verifyIdToken(String(idToken || ''));
      const email = normalizeEmail(decoded.email);
      return decoded.email_verified === true && email.endsWith(EMAIL_DOMAIN) ? email : null;
    } catch (err) {
      if (invalidTokenCodes.has(err.code)) return null;
      throw err;
    }
  };

  app.get('/api/events/:id', route(async (req, res) => {
    const ev = mongoose.isValidObjectId(req.params.id) && await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ code: 'NOT_FOUND' });
    res.json({ id: ev.id, name: ev.name, venue: ev.venue, startsAt: ev.startsAt, endsAt: ev.endsAt, deadline: ev.deadline,
      capacity: ev.capacity, registered: ev.registeredCount, available: Math.max(0, ev.capacity - ev.registeredCount),
      status: eventStatus(ev), dayScholarEligible: dayScholarEligible(ev.startsAt, ev.endsAt) });
  }));

  app.post('/api/events/:id/registrations/start', limit(10), route(async (req, res) => {
    const { values, errors } = validate(req.body);
    if (Object.keys(errors).length) return res.status(422).json({ code: 'INVALID', errors });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND' });
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ code: 'NOT_FOUND' });
    const status = eventStatus(ev);
    if (status !== 'open') return res.status(409).json({ code: statusCodeFor(status) });
    if (values.accommodation === 'Day Scholar' && !dayScholarEligible(ev.startsAt, ev.endsAt))
      return res.status(403).json({ code: 'DAY_SCHOLAR_INELIGIBLE' });
    if (await Registration.exists({ eventId: ev._id, email: values.email }))
      return res.status(409).json({ code: 'DUPLICATE' });

    const prev = await Pending.findOne({ eventId: ev._id, email: values.email });
    if (prev && Date.now() - prev.lastSentAt < 60000)
      return res.status(429).json({ code: 'COOLDOWN', retryAfter: Math.ceil((60000 - (Date.now() - prev.lastSentAt)) / 1000) });

    let link;
    try {
      link = await generateSignInLink(values.email, `${frontendUrl}/?event=${ev.id}`);
    } catch (err) {
      console.error('[firebase] sign-in link generation failed', { eventId: ev.id, code: err.code || 'UNKNOWN' });
      return res.status(502).json({ code: 'EMAIL_FAILED' });
    }

    let pending;
    try {
      pending = await Pending.findOneAndUpdate({ eventId: ev._id, email: values.email },
        { data: values, lastSentAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60000) },
        { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (err) {
      console.error('[pending] verification request could not be stored', { eventId: ev.id, code: err.code || 'SERVER' });
      return res.status(500).json({ code: 'SERVER' });
    }

    try {
      const sent = await sendVerificationEmail({ email: values.email, event: ev,
        html: emailHtml(values.name, ev.name, link) });
      console.log('[email] verification sent', { eventId: ev.id, messageId: sent?.messageId || null });
    } catch (err) {
      try {
        await Pending.deleteOne({ _id: pending._id });
      } catch (cleanupError) {
        console.error('[pending] cleanup failed after email error', { eventId: ev.id, code: cleanupError.code || 'UNKNOWN' });
      }
      console.error('[email] verification delivery failed', {
        eventId: ev.id,
        code: err.code || 'UNKNOWN',
        providerCode: err.providerCode || null,
        providerMessage: err.providerMessage || null,
        status: err.status || null,
      });
      return res.status(502).json({ code: 'EMAIL_FAILED' });
    }
    res.json({ ok: true, cooldown: 60 });
  }));

  app.post('/api/events/:id/registrations/status', limit(30), route(async (req, res) => {
    const email = await authenticate(req.body.idToken);
    if (!email) return res.status(401).json({ code: 'BAD_TOKEN' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND' });
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ code: 'NOT_FOUND' });
    const registered = Boolean(await Registration.exists({ eventId: ev._id, email }));
    res.json({ ok: true, registered, ...(registered ? { eventName: ev.name } : {}) });
  }));

  app.post('/api/events/:id/registrations/confirm', limit(30), route(async (req, res) => {
    const email = await authenticate(req.body.idToken);
    if (!email) return res.status(401).json({ code: 'BAD_TOKEN' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND' });
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ code: 'NOT_FOUND' });

    if (await Registration.exists({ eventId: ev._id, email })) {
      await Pending.deleteOne({ eventId: ev._id, email });
      return res.json(confirmed(ev.name, true));
    }

    const now = new Date();
    const pend = await Pending.findOne({ eventId: ev._id, email, expiresAt: { $gt: now } });
    if (!pend) return res.status(410).json({ code: 'EXPIRED' });
    const data = pend.data;
    if (data.accommodation === 'Day Scholar' && !dayScholarEligible(ev.startsAt, ev.endsAt))
      return res.status(403).json({ code: 'DAY_SCHOLAR_INELIGIBLE' });
    const status = eventStatus(ev);
    if (status !== 'open') return res.status(409).json({ code: statusCodeFor(status) });

    const claimed = await Event.findOneAndUpdate({ _id: ev._id, registrationOpen: true,
      $expr: { $lt: ['$registeredCount', '$capacity'] },
      $or: [{ deadline: null }, { deadline: { $gt: now } }] },
    { $inc: { registeredCount: 1 } }, { new: true });
    if (!claimed) {
      if (await Registration.exists({ eventId: ev._id, email }))
        return res.json(confirmed(ev.name, true));
      const latest = await Event.findById(ev._id);
      return res.status(409).json({ code: latest ? statusCodeFor(eventStatus(latest)) : 'NOT_FOUND' });
    }

    const registrationId = new mongoose.Types.ObjectId();
    try {
      await Registration.create({ _id: registrationId, eventId: ev._id, email, ...data });
    } catch (err) {
      let thisAttemptSaved = false;
      try {
        thisAttemptSaved = Boolean(await Registration.exists({ _id: registrationId }));
      } catch (lookupError) {
        console.error('[registration] outcome lookup failed', { eventId: ev.id, code: lookupError.code || 'UNKNOWN' });
        return res.status(503).json({ code: 'OUTCOME_UNKNOWN' });
      }
      if (thisAttemptSaved) {
        try {
          await Pending.deleteOne({ eventId: ev._id, email });
        } catch (cleanupError) {
          console.error('[pending] cleanup failed after registration', { eventId: ev.id, code: cleanupError.code || 'UNKNOWN' });
        }
        return res.json(confirmed(ev.name));
      }

      try {
        await Event.updateOne({ _id: ev._id }, { $inc: { registeredCount: -1 } });
      } catch (rollbackError) {
        console.error('[capacity] seat rollback failed', { eventId: ev.id, code: rollbackError.code || 'UNKNOWN' });
        return res.status(500).json({ code: 'SERVER' });
      }
      if (err.code === 11000 && await Registration.exists({ eventId: ev._id, email }))
        return res.json(confirmed(ev.name, true));
      throw err;
    }

    try {
      await Pending.deleteOne({ eventId: ev._id, email });
    } catch (err) {
      console.error('[pending] cleanup failed after registration', { eventId: ev.id, code: err.code || 'UNKNOWN' });
    }
    res.json(confirmed(ev.name));
  }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ code: 'INVALID_JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE' });
    }
    console.error('[api] request failed', { path: req.path, code: err.code || 'UNKNOWN' });
    if (res.headersSent) return next(err);
    res.status(500).json({ code: 'SERVER' });
  });
  return app;
}
