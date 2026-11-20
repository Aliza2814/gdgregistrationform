// DEV ONLY. Simulates the shared backend while the Admin Panel API is not ready.
const day = 86400000, at = (h) => { const d = new Date(Date.now() + 3 * day); d.setHours(h, 0, 0, 0); return d.toISOString(); };
let registered = 87;
let registrationExists = false;
let currentEmail = '';
const ev = () => ({ name: 'Intro to Gemini API Workshop', venue: 'Seminar Hall, Block C', startsAt: at(14), endsAt: at(17), capacity: 150,
  registered, available: 150 - registered, status: registered >= 150 ? 'full' : 'open', dayScholarEligible: false });
const wait = (v) => new Promise((r) => setTimeout(() => r(v), 600));
export const mockApi = {
  getEvent: () => wait(ev()),
  start: (d) => d.email.startsWith('dup') || (registrationExists && d.email === currentEmail)
    ? Promise.reject({ code: 'DUPLICATE' }) : (currentEmail = d.email.trim().toLowerCase(), wait({ ok: true, cooldown: 60 })),
  status: () => wait({ ok: true, registered: registrationExists, ...(registrationExists ? { eventName: ev().name } : {}) }),
  confirm: () => { if (!registrationExists) registered++; registrationExists = true; return wait({ ok: true, already: false, eventName: ev().name }); },
};
