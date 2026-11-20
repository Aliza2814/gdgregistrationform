# GDG Registration Panel (small events, 100-200 seats)

Flow: form -> backend emails one Firebase sign-in link (no seat held) -> user opens link -> frontend gets Firebase ID token -> backend verifies token, rechecks rules, claims a seat atomically, and saves the registration. The page can recover registration status from MongoDB after a refresh; no second email is sent.

Why the link is sent by our backend, not Firebase: Firebase's own sender is capped at 5 sign-in emails/day on the free Spark plan. The Admin SDK only generates the link (separate, much higher limit), and we send it through SMTP.

## Setup
1. Firebase console: Authentication > Sign-in method > enable **Email link**. Add your site domain under Authorized domains.
2. Service account JSON -> `backend/.env` (`FIREBASE_SERVICE_ACCOUNT`). SMTP: Gmail app password works.
3. `cd backend && npm i && npm start` ; `cd frontend && npm i && npm run dev`
4. Seed one Event doc (name, venue, startsAt, endsAt, capacity, registrationOpen) and put its id in `VITE_EVENT_ID`.
5. UI without backend: `VITE_USE_MOCK=true`.

### Test email links on a phone
The email link redirects to `FRONTEND_URL`. `localhost` on a phone refers to the phone itself, not the computer running this app. For local testing, keep the phone and computer on the same Wi-Fi, set `FRONTEND_URL` in `backend/.env` to `http://<computer-LAN-IP>:5175`, and add that host (without the port) under Firebase Authentication > Settings > Authorized domains. Start the frontend with `npm run dev`; Vite listens on the network and proxies `/api` to the backend. Open `http://<computer-LAN-IP>:5175` on the phone.

For phones outside the same Wi-Fi, use a publicly reachable HTTPS frontend URL and set `FRONTEND_URL` to that URL. Add its host to Firebase Authorized domains too. A LAN address or `localhost` is not a public deployment URL.

## API needed from the Admin team (agree on this)
Event fields: name, venue, startsAt, endsAt (ISO, UTC), deadline?, capacity, registeredCount, registrationOpen.
`registeredCount` must be incremented only by this service (atomic), and capacity edits by admins take effect immediately.
Endpoints here: GET `/api/events/:id`, POST `.../registrations/start`, POST `.../registrations/status`, POST `.../registrations/confirm`.

The status endpoint requires a Firebase ID token and returns only whether that verified college email has a registration (plus the event name when registered). Confirmation is idempotent and returns `{ ok, already, eventName }`; it no longer sends or reports a second confirmation email. Event fields and the Admin Panel event contract are unchanged.

## No-billing public hosting
No provider has been verified to host this existing Express + Mongoose + SMTP backend unchanged, reliably, and without requiring a billing account:

- Firebase Spark can host the frontend, but Cloud Run requires the Blaze billing plan; Firebase Hosting alone does not run this API ([Firebase pricing](https://firebase.google.com/pricing), [Cloud Run pricing](https://cloud.google.com/run/pricing)).
- MongoDB Atlas M0 is a free database tier, not an API host ([MongoDB pricing](https://www.mongodb.com/pricing)).
- Cloudflare Workers Free has request/CPU limits and does not provide the `net.Server` API used by Express `app.listen()`. Its Node TLS compatibility is partial, so the existing Nodemailer SMTP path has not been verified there; using it would require a backend adaptation and additional testing ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)).
- Vercel Hobby eligibility for a public student-event registration site has not been verified, so it is not treated as a suitable option without confirming that use is allowed ([Vercel terms](https://vercel.com/legal/terms)).

Therefore, a public launch needs either a no-billing host verified for this backend or an approved backend adaptation. Do not configure production email links with a private LAN address. With the second email removed, 250 successful registrations require about 250 verification messages; Gmail's personal daily limit is 500 messages, but that quota is not a hosting or deliverability guarantee.

The backend tests cover idempotent confirmation, minimal status responses, verified-email checks, the final-seat race, Day Scholar revalidation, and expired deadlines. Real Firebase, MongoDB, and SMTP end-to-end behavior still requires configured service credentials.
