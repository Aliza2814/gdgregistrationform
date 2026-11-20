import 'dotenv/config';
import mongoose from 'mongoose';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { createApp } from './app.js';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const mail = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT, secure: +process.env.SMTP_PORT === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });

// Event is owned by the Admin Panel team. Align this schema with theirs (see API-CONTRACT in README).
const Event = mongoose.model('Event', new mongoose.Schema({ name: String, venue: String, startsAt: Date, endsAt: Date,
  deadline: Date, capacity: Number, registeredCount: { type: Number, default: 0 }, registrationOpen: { type: Boolean, default: true } }));
const regSchema = new mongoose.Schema({ eventId: mongoose.Types.ObjectId,
  email: { type: String, required: true, trim: true, lowercase: true }, name: String, year: String,
  department: String, accommodation: String, confirmedAt: { type: Date, default: Date.now } });
regSchema.index({ eventId: 1, email: 1 }, { unique: true }); // one registration per email per event
const Registration = mongoose.model('Registration', regSchema);
// Pending = verified-email not yet proven. Holds NO seat; auto-deleted by TTL so abandoned attempts never block anyone.
const pendSchema = new mongoose.Schema({ eventId: mongoose.Types.ObjectId,
  email: { type: String, required: true, trim: true, lowercase: true }, data: Object,
  lastSentAt: Date, expiresAt: Date });
pendSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
pendSchema.index({ eventId: 1, email: 1 }, { unique: true });
const Pending = mongoose.model('Pending', pendSchema);

const api = createApp({
  Event,
  Registration,
  Pending,
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  generateSignInLink: (email, url) => admin.auth().generateSignInWithEmailLink(email, { url, handleCodeInApp: true }),
  sendVerificationEmail: ({ email, event, html }) => mail.sendMail({
    from: process.env.MAIL_FROM, to: email, subject: `Verify your email for ${event.name}`, html,
  }),
  frontendUrl: process.env.FRONTEND_URL,
});

await mongoose.connect(process.env.MONGODB_URI);
await Registration.init();
await Pending.init();
api.listen(process.env.PORT || 4000, () => console.log('API ready'));
