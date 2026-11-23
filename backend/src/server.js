import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createApp } from './app.js';
import { sendVerificationEmail } from './mailer.js';

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

const mongoUri = requiredEnv('MONGODB_URI');
const frontendUrl = requiredEnv('FRONTEND_URL').replace(/\/+$/, '');
const frontend = new URL(frontendUrl);
if (frontend.pathname !== '/') throw new Error('FRONTEND_URL must be an origin without a path.');
if (process.env.NODE_ENV === 'production' && frontend.protocol !== 'https:') {
  throw new Error('FRONTEND_URL must use HTTPS in production.');
}
if (process.env.NODE_ENV === 'production') {
  let mongoHost;
  try {
    mongoHost = new URL(mongoUri).hostname;
  } catch {
    throw new Error('MONGODB_URI must be a valid MongoDB connection URL.');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(mongoHost)) {
    throw new Error('MONGODB_URI must point to a remote database in production; localhost is not available on Render.');
  }
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
} catch (error) {
  if (error.message === 'FIREBASE_SERVICE_ACCOUNT must be configured.') throw error;
  throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON.');
}
if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields.');
}
initializeApp({ credential: cert(serviceAccount) });

const firebaseAuth = getAuth();

const emailProvider = process.env.EMAIL_PROVIDER || 'smtp';
if (emailProvider === 'resend') {
  requiredEnv('RESEND_API_KEY');
  requiredEnv('MAIL_FROM');
} else if (emailProvider === 'smtp') {
  requiredEnv('SMTP_USER');
  requiredEnv('SMTP_PASS');
  requiredEnv('MAIL_FROM');
} else {
  throw new Error('EMAIL_PROVIDER must be smtp or resend.');
}

// Event is owned by the Admin Panel team. Align this schema with theirs (see API-CONTRACT in README).
const Event = mongoose.model('Event', new mongoose.Schema({ name: String, venue: String, startsAt: Date, endsAt: Date,
  deadline: Date, capacity: Number, registeredCount: { type: Number, default: 0 }, registrationOpen: { type: Boolean, default: true } }));
const regSchema = new mongoose.Schema({ eventId: mongoose.Types.ObjectId,
  rollNumber: String, email: { type: String, required: true, trim: true, lowercase: true }, name: String, year: String,
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
  verifyIdToken: (token) => firebaseAuth.verifyIdToken(token),
  generateSignInLink: (email, url) => firebaseAuth.generateSignInWithEmailLink(email, { url, handleCodeInApp: true }),
  sendVerificationEmail: (message) => sendVerificationEmail(message, process.env),
  frontendUrl,
});

await mongoose.connect(mongoUri);
await Registration.init();
await Pending.init();
api.listen(process.env.PORT || 4000, '0.0.0.0', () => console.log('API ready'));
