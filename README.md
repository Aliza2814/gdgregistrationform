# GDG Registration Panel (small events, 100-200 seats)

Flow: form -> backend emails one Firebase sign-in link (no seat held) -> user opens link -> frontend gets Firebase ID token -> backend verifies token, rechecks rules, claims a seat atomically, and saves the registration. The page can recover registration status from MongoDB after a refresh; no second email is sent.

Firebase Admin generates the sign-in link; an email provider delivers it. Local development defaults to Gmail SMTP. Render deployment can use Resend's HTTPS API because Render Free blocks outbound SMTP on ports 25, 465, and 587.

## Setup
1. Firebase console: Authentication > Sign-in method > enable **Email link**. Add your site domain under Authorized domains.
2. Service account JSON -> `backend/.env` (`FIREBASE_SERVICE_ACCOUNT`). Local SMTP: Gmail app password works. Render: use `EMAIL_PROVIDER=resend`, a Resend API key, and a sender address verified with Resend.
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

## Hosting considerations

The existing Express + Mongoose backend can run as a Render Web Service when it has a reachable remote MongoDB and an email provider reachable over HTTPS:

- Firebase Spark can host the frontend, but Cloud Run requires the Blaze billing plan; Firebase Hosting alone does not run this API ([Firebase pricing](https://firebase.google.com/pricing), [Cloud Run pricing](https://cloud.google.com/run/pricing)).
- MongoDB Atlas M0 is a free database tier, not an API host ([MongoDB pricing](https://www.mongodb.com/pricing)).
- Cloudflare Workers Free has request/CPU limits and does not provide the `net.Server` API used by Express `app.listen()`. Its Node TLS compatibility is partial, so the existing Nodemailer SMTP path has not been verified there; using it would require a backend adaptation and additional testing ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)).
- Render offers free web services and static sites, but free web services sleep after inactivity, use ephemeral local storage, and block outbound SMTP on ports 25/465/587. This backend therefore supports Resend's HTTPS API for a Render deployment; confirm Resend's current plan and sender requirements before relying on it ([Render free services](https://render.com/docs/free)).
- Vercel Hobby eligibility for a public student-event registration site has not been verified, so it is not treated as a suitable option without confirming that use is allowed ([Vercel terms](https://vercel.com/legal/terms)).

Keep local and published configuration separate. The Render URL does not belong in the Firebase callback setting: the frontend's `VITE_API_URL` points to the Render API, while the backend's `FRONTEND_URL` points to the public frontend that opens from the email.

## Render environment configuration

Keep local values in `backend/.env` and `frontend/.env`; do not replace the local URLs. Render services get separate environment variables:

- **Backend Web Service** (Root Directory `backend`, build `npm ci`, start `npm start`): set `NODE_ENV=production`, `MONGODB_URI` to the Atlas `mongodb+srv://` connection string, `FIREBASE_SERVICE_ACCOUNT` to the service-account JSON, `FRONTEND_URL` to the public frontend origin, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `MAIL_FROM` to a sender verified with Resend. Enter secret values only in Render's private environment settings. Do not set `MONGODB_URI` to `localhost`; Render cannot connect to your development machine's MongoDB.
- **Frontend Static Site** (Root Directory `frontend`, build `npm ci && npm run build`, publish directory `dist`): set `VITE_API_URL` to the backend's public `https://<service>.onrender.com` URL, plus `VITE_EVENT_ID` and the `VITE_FIREBASE_*` web configuration. Vite embeds these values at build time; redeploy the frontend after changing them.
- Set Firebase Authentication's Authorized Domains to the public frontend hostname. `FRONTEND_URL` is the frontend callback/CORS origin; it is **not** the backend URL. The Render backend URL belongs in frontend `VITE_API_URL`.
- Keep the Atlas URI only in backend environment settings (`backend/.env` for local work, Render's private environment for production). Never add it to the frontend's `.env.production.example` or a `VITE_*` variable.

Templates: `backend/.env.render.example` and `frontend/.env.production.example`. Replace placeholders in Render's dashboard; do not commit actual production values.

Render Free web services can sleep after inactivity and have ephemeral local storage. Render Free blocks SMTP ports 25/465/587, which is why the backend supports Resend over HTTPS for Render. Confirm the email provider's current plan, sender-domain requirements, and quota before production use.

The backend tests cover idempotent confirmation, minimal status responses, verified-email checks, the final-seat race, Day Scholar revalidation, and expired deadlines. Real Firebase, remote MongoDB, and provider delivery still require a separately configured production environment.
