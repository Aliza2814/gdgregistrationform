import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const APP_NAME = 'gdg-registration-worker';

function authFor(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw Object.assign(new Error('Firebase service account is not configured.'), {
      code: 'FIREBASE_NOT_CONFIGURED',
    });
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw Object.assign(new Error('Firebase service account JSON is invalid.'), {
      code: 'FIREBASE_NOT_CONFIGURED',
    });
  }
  if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
    throw Object.assign(new Error('Firebase service account fields are incomplete.'), {
      code: 'FIREBASE_NOT_CONFIGURED',
    });
  }

  const app = getApps().find((candidate) => candidate.name === APP_NAME)
    || initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    }, APP_NAME);
  return getAuth(app);
}

export function verifyIdToken(token, env) {
  return authFor(env).verifyIdToken(token);
}

export function generateSignInLink(email, url, env) {
  return authFor(env).generateSignInWithEmailLink(email, {
    url,
    handleCodeInApp: true,
  });
}

