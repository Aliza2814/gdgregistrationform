import { initializeApp } from 'firebase/app';
import { getAuth, isSignInWithEmailLink, onAuthStateChanged, signInWithEmailLink } from 'firebase/auth';
const auth = () => getAuth(initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID }, 'reg'));
export const isLink = () => isSignInWithEmailLink(auth(), window.location.href);
export async function tokenFromLink(email) {
  const cred = await signInWithEmailLink(auth(), email, window.location.href);
  return cred.user.getIdToken();
}
export function currentUserToken() {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    let settled = false;
    const stop = () => { settled = true; unsubscribe(); };
    unsubscribe = onAuthStateChanged(auth(), (user) => {
      stop();
      if (!user) resolve(null);
      else user.getIdToken().then(resolve, reject);
    }, (error) => {
      stop();
      reject(error);
    });
    if (settled) unsubscribe();
  });
}
