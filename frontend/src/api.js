const configuredBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const productionFallback = 'https://gdgregistrationform.onrender.com';
const BASE = configuredBase || (import.meta.env.PROD ? productionFallback : '');
const REQUEST_TIMEOUT_MS = 15000;
const real = async (path, opts) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let r, body;
  try {
    r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts, signal: controller.signal });
    try { body = await r.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      body = {};
    }
  } catch {
    throw { code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK' };
  } finally { clearTimeout(timeout); }
  if (!r.ok) throw body;
  return body;
};
const post = (path, data) => real(path, { method: 'POST', body: JSON.stringify(data) });
const id = import.meta.env.VITE_EVENT_ID;
const realApi = {
  getEvent: () => real(`/api/events/${id}`),
  start: (d) => post(`/api/events/${id}/registrations/start`, d),
  status: (idToken) => post(`/api/events/${id}/registrations/status`, { idToken }),
  confirm: (idToken) => post(`/api/events/${id}/registrations/confirm`, { idToken }),
};
// Mock is loaded only when explicitly enabled; production builds tree-shake it out.
export const MOCK = import.meta.env.VITE_USE_MOCK === 'true';
export const api = MOCK ? (await import('./mock/mockApi.js')).mockApi : realApi;
