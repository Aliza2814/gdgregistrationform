import { useEffect, useRef, useState } from 'react';
import { api, MOCK } from './api.js';
import { validate, parts } from './util.js';

const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const DEPTS = ['CSE', 'CSE (AI/ML)', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil', 'Biotechnology', 'Other'];
const DRAFT_KEY = 'gdg_reg_draft';
const EMPTY_FORM = { rollNumber: '', name: '', email: '', year: '', department: '', accommodation: '' };
const MSG = {
  DUPLICATE: 'Already registered. This email has already been used for this event.',
  FULL: 'All seats were taken. Registration is now full.',
  CLOSED: 'Registration has closed.',
  DAY_SCHOLAR_INELIGIBLE: 'Day scholars can only join events that start by 4:00 PM and end by 4:30 PM.',
  NETWORK: 'Cannot reach the server. Check your connection and try again.',
  TIMEOUT: 'The request timed out. Check your inbox before retrying; if no email arrives, wait for the cooldown and retry.',
  EMAIL_FAILED: 'We could not send the email. Try again in a minute.',
  EXPIRED: 'This link has expired. Submit the form again to get a new one.',
  BAD_TOKEN: 'This link is not valid. Submit the form again.',
  COOLDOWN: 'Please wait a minute before requesting another email.',
  OUTCOME_UNKNOWN: 'We could not confirm whether your seat was saved. Check your registration status before retrying.',
  'auth/expired-action-code': 'This link has expired. If you already opened it, retry the status check.',
  'auth/invalid-action-code': 'This link was already used or is no longer valid. Retry the status check.',
};
const say = (e) => MSG[e?.code] || 'Something went wrong. Please try again.';
const fmt = (d, o) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
const getDraft = () => {
  try { return { ...EMPTY_FORM, ...JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') }; }
  catch { return EMPTY_FORM; }
};
const saveDraft = (value) => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
const cleanRegistrationState = () => {
  localStorage.removeItem('gdg_reg_email');
  sessionStorage.removeItem(DRAFT_KEY);
};
const eventUrl = () => {
  const eventId = new URLSearchParams(location.search).get('event');
  return `${location.pathname}${eventId ? `?event=${encodeURIComponent(eventId)}` : ''}`;
};

const Dots = () => <span className="dots" aria-hidden><i /><i /><i /><i /></span>;

function Countdown({ to }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const p = parts(new Date(to) - now);
  return <div className="count" role="timer" aria-label="Time until event">{Object.entries(p).map(([k, v]) =>
    <div key={k}><b>{String(v).padStart(2, '0')}</b><span>{k}</span></div>)}</div>;
}

function Seats({ ev }) {
  const pct = Math.min(100, (ev.registered / ev.capacity) * 100);
  const tone = ev.available === 0 ? 'red' : ev.available <= ev.capacity * 0.15 ? 'yellow' : 'green';
  return <div className="seats">
    <div className="nums"><span><b>{ev.capacity}</b> total</span><span><b>{ev.registered}</b> registered</span><span className={tone}><b>{ev.available}</b> left</span></div>
    <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={ev.capacity} aria-valuenow={ev.registered}><div className={tone} style={{ width: pct + '%' }} /></div>
  </div>;
}

function Field({ label, error, children }) {
  return <label className="field"><span>{label}</span>{children}{error && <em role="alert">{error}</em>}</label>;
}

function Form({ ev, onSent }) {
  const [v, setV] = useState(getDraft);
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false), [top, setTop] = useState('');
  function update(next) {
    setV(next);
    saveDraft(next);
  }
  const set = (k) => (e) => update({ ...v, [k]: e.target.value });
  const blocked = v.accommodation === 'Day Scholar' && !ev.dayScholarEligible;
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const ve = validate(v); setErr(ve); setTop('');
    if (Object.keys(ve).length || blocked) return;
    setBusy(true);
    try {
      localStorage.setItem('gdg_reg_email', v.email.trim().toLowerCase());
      await api.start(v);
      onSent({ ...v, email: v.email.trim().toLowerCase() });
    } catch (x) { x.errors ? setErr(x.errors) : setTop(say(x)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} noValidate>
    <Field label="Roll number" error={err.rollNumber}><input value={v.rollNumber} onChange={set('rollNumber')} placeholder="e.g. 2525BCS001" autoCapitalize="characters" /></Field>
    <Field label="Full name" error={err.name}><input value={v.name} onChange={set('name')} autoComplete="name" /></Field>
    <Field label="College email" error={err.email}><input type="email" value={v.email} onChange={set('email')} placeholder="name@chitkara.edu.in" autoComplete="email" /></Field>
    <div className="two">
      <Field label="Year" error={err.year}><select value={v.year} onChange={set('year')}><option value="">Select</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></Field>
      <Field label="Department" error={err.department}><select value={v.department} onChange={set('department')}><option value="">Select</option>{DEPTS.map((d) => <option key={d}>{d}</option>)}</select></Field>
    </div>
    <fieldset><legend>Accommodation</legend>
      {['Day Scholar', 'Hosteler'].map((a) => <label key={a} className={'pill' + (v.accommodation === a ? ' on' : '')}>
        <input type="radio" name="acc" checked={v.accommodation === a} onChange={() => update({ ...v, accommodation: a })} />{a}</label>)}
      {err.accommodation && <em role="alert">{err.accommodation}</em>}
    </fieldset>
    {blocked && <p className="note warn" role="alert">{MSG.DAY_SCHOLAR_INELIGIBLE} This event runs {fmt(ev.startsAt, { timeStyle: 'short' })} to {fmt(ev.endsAt, { timeStyle: 'short' })}.</p>}
    {top && <p className="note bad" role="alert">{top}</p>}
    <button className="primary" disabled={busy || blocked}>{busy ? 'Sending verification email…' : 'Send verification email'}</button>
  </form>;
}

function CheckEmail({ data, onBack }) {
  const [left, setLeft] = useState(60), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); }, [left]);
  async function resend() {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await api.start(data); setLeft(60); setMsg('Verification email sent again.'); }
    catch (x) { setMsg(say(x)); if (x.retryAfter) setLeft(x.retryAfter); }
    finally { setBusy(false); }
  }
  return <div className="state">
    <h2>Check your inbox</h2>
    <p>We sent a verification link to <b>{data.email}</b>. Open it on this device to finish. Your seat is confirmed only after you tap the link.</p>
    <p className="muted">Can't find it? Check spam. The link works for 1 hour.</p>
    {MOCK && <button className="ghost" onClick={() => onBack('verify')}>Dev: simulate link click</button>}
    <div className="row"><button className="ghost" disabled={left > 0 || busy} onClick={resend}>{busy ? 'Sending…' : left > 0 ? `Resend in ${left}s` : 'Resend email'}</button>
      <button className="ghost" onClick={() => onBack('form')}>Change email</button></div>
    {msg && <p className="note" role="status">{msg}</p>}
  </div>;
}

function Verify({ onDone, onBack }) {
  const [ask, setAsk] = useState(false), [email, setEmail] = useState(localStorage.getItem('gdg_reg_email') || '');
  const [err, setErr] = useState(''), [token, setToken] = useState(''), [busy, setBusy] = useState(false);
  function finish(result) {
    cleanRegistrationState();
    onDone({ ...result, restored: result.restored || false });
  }
  async function checkRegistration(idToken) {
    setToken(idToken); setBusy(true); setErr('');
    try {
      const status = await api.status(idToken);
      if (status.registered) return finish({ ...status, restored: true });
      finish(await api.confirm(idToken));
    } catch (x) { setErr(say(x)); }
    finally { setBusy(false); }
  }
  async function run(addr) {
    setBusy(true); setErr('');
    try {
      const idToken = MOCK ? 'mock' : await (await import('./firebase.js')).tokenFromLink(addr);
      await checkRegistration(idToken);
    } catch (x) {
      if (x.code === 'auth/invalid-email') {
        setAsk(true); setErr('That email does not match the link.');
      } else if (!MOCK) {
        try {
          const idToken = await (await import('./firebase.js')).currentUserToken();
          if (idToken) {
            setToken(idToken);
            const status = await api.status(idToken);
            if (status.registered) finish({ ...status, restored: true });
            else setErr(say(x));
          } else setErr(say(x));
        } catch (statusError) { setErr(say(statusError)); }
      } else setErr(say(x));
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const stored = localStorage.getItem('gdg_reg_email');
    if (stored || MOCK) run(stored || '');
    else setAsk(true);
  }, []);

  if (ask) return <form className="state" onSubmit={(e) => { e.preventDefault(); setAsk(false); run(email.trim().toLowerCase()); }}>
    <h2>Verify your email</h2><p>You opened the link on a different device. Enter the email you registered with.</p>
    <Field label="College email" error={err}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
    <button className="primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify email'}</button>
  </form>;
  if (err) return <div className="state"><h2>Registration status</h2><p role="alert">{err}</p>
    {token && <button className="primary" disabled={busy} onClick={() => checkRegistration(token)}>{busy ? 'Checking…' : 'Check again'}</button>}
    <button className="ghost" onClick={onBack}>Return to registration</button></div>;
  return <div className="state"><div className="spin" /><p>{busy ? 'Checking your registration…' : 'Opening verification link…'}</p></div>;
}

export default function App() {
  const [ev, setEv] = useState(null), [view, setView] = useState('checking'), [data, setData] = useState(null);
  const [res, setRes] = useState(null), [fatal, setFatal] = useState(''), [refreshError, setRefreshError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const eventRef = useRef(null);

  async function loadEvent() {
    try {
      const result = await api.getEvent();
      eventRef.current = result;
      setEv(result); setFatal(''); setRefreshError('');
    } catch (x) {
      if (eventRef.current) setRefreshError(say(x));
      else setFatal(say(x));
    }
  }
  async function restoreSession() {
    setView('checking'); setRecoveryError('');
    if (MOCK) { setView('form'); return; }
    try {
      const { isLink, currentUserToken } = await import('./firebase.js');
      if (isLink()) { setView('verify'); return; }
      const idToken = await currentUserToken();
      if (!idToken) { setView('form'); return; }
      const status = await api.status(idToken);
      if (status.registered) {
        cleanRegistrationState();
        setRes({ ...status, restored: true });
        setView('done');
      } else setView('form');
    } catch (x) {
      setRecoveryError(say(x));
      setView('restore-error');
    }
  }
  useEffect(() => {
    loadEvent();
    const t = setInterval(loadEvent, 30000);
    restoreSession();
    return () => clearInterval(t);
  }, []);

  if (fatal) return <main className="wrap"><div className="state"><h2>Can't load the event</h2><p>{fatal}</p><button className="primary" onClick={loadEvent}>Try again</button></div></main>;
  if (!ev) return <main className="wrap"><div className="state"><div className="spin" /><p>Loading event…</p></div></main>;
  const closed = ev.status !== 'open' && view !== 'verify' && view !== 'done';
  const returnToForm = () => {
    history.replaceState(null, '', eventUrl());
    setView('form');
  };
  return <main className="wrap">
    <header><div className="brand"><span className="code">&lt;/&gt;</span> GDG on Campus <Dots /></div><small>Chitkara University</small></header>
    <section className="hero">
      <h1>{ev.name}</h1>
      <p className="when">{fmt(ev.startsAt, { dateStyle: 'full' })}<br />{fmt(ev.startsAt, { timeStyle: 'short' })} to {fmt(ev.endsAt, { timeStyle: 'short' })}{ev.venue && ` · ${ev.venue}`}</p>
      <Countdown to={ev.startsAt} />
      <Seats ev={ev} />
      {refreshError && <p className="note warn" role="status">{refreshError} <button className="ghost" onClick={loadEvent}>Refresh event</button></p>}
    </section>
    <section className="card">
      {view === 'checking' ? <div className="state"><div className="spin" /><p>Checking your registration…</p></div>
        : view === 'restore-error' ? <div className="state"><h2>Can't check registration yet</h2><p role="alert">{recoveryError}</p>
          <button className="primary" onClick={restoreSession}>Try again</button></div>
        : view === 'done' ? <div className="state ok"><div className="tick">✓</div><h2>Registration successful!</h2>
          <p>Your seat is confirmed.</p></div>
        : view === 'verify' ? <Verify onDone={(r) => { setRes(r); setView('done'); history.replaceState(null, '', eventUrl()); loadEvent(); }}
          onBack={returnToForm} />
        : closed ? <div className="state"><h2>{ev.status === 'full' ? 'Registration is full' : 'Registration is closed'}</h2>
          <p>{ev.status === 'full' ? `All ${ev.capacity} seats are taken.` : 'This event is no longer accepting registrations.'} Follow GDG on Campus for the next one.</p></div>
        : view === 'sent' ? <CheckEmail data={data} onBack={(v) => v === 'verify' ? setView('verify') : setView('form')} />
        : <><h2>Reserve your seat</h2><Form ev={ev} onSent={(d) => { setData(d); setView('sent'); }} /></>}
    </section>
  </main>;
}
