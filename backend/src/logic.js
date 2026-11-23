// Pure rules shared by routes and tests.
export const EMAIL_DOMAIN = '@chitkara.edu.in';
export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

export function validate(b) {
  const v = { rollNumber: clean(b.rollNumber).toUpperCase(), name: clean(b.name), email: normalizeEmail(b.email), year: clean(b.year),
    department: clean(b.department), accommodation: clean(b.accommodation) };
  const errors = {};
  if (!/^[A-Za-z0-9-]{4,20}$/.test(v.rollNumber))
    errors.rollNumber = 'Enter a valid roll number (4-20 letters or numbers).';
  if (v.name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+$/.test(v.email) || !v.email.endsWith(EMAIL_DOMAIN))
    errors.email = `Use your college email ending in ${EMAIL_DOMAIN}.`;
  if (!['1st', '2nd', '3rd', '4th', '1st Year', '2nd Year', '3rd Year', '4th Year'].includes(v.year))
    errors.year = 'Select your year.';
  if (!v.department) errors.department = 'Select your department.';
  if (!['Day Scholar', 'Hosteler'].includes(v.accommodation)) errors.accommodation = 'Choose Day Scholar or Hosteler.';
  return { values: v, errors };
}

// Minutes since midnight in IST, independent of server timezone.
const istMinutes = (d) => Math.floor((new Date(d).getTime() + 330 * 60000) / 60000) % 1440;

// Day scholars: start <= 4:00 PM AND end <= 4:30 PM.
export function dayScholarEligible(startsAt, endsAt) {
  return istMinutes(startsAt) <= 16 * 60 && istMinutes(endsAt) <= 16 * 60 + 30;
}

export function eventStatus(ev, now = new Date()) {
  if (!ev.registrationOpen) return 'closed';
  if (ev.deadline && new Date(ev.deadline) <= now) return 'closed';
  if (ev.registeredCount >= ev.capacity) return 'full';
  return 'open';
}
