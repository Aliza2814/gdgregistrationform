export const EMAIL_DOMAIN = '@chitkara.edu.in';

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ');

export function validate(body) {
  const values = {
    name: clean(body?.name),
    email: normalizeEmail(body?.email),
    year: clean(body?.year),
    department: clean(body?.department),
    accommodation: clean(body?.accommodation),
  };
  const errors = {};

  if (values.name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+$/.test(values.email) || !values.email.endsWith(EMAIL_DOMAIN)) {
    errors.email = `Use your college email ending in ${EMAIL_DOMAIN}.`;
  }
  if (!['1st', '2nd', '3rd', '4th', '1st Year', '2nd Year', '3rd Year', '4th Year'].includes(values.year)) {
    errors.year = 'Select your year.';
  }
  if (!values.department) errors.department = 'Select your department.';
  if (!['Day Scholar', 'Hosteler'].includes(values.accommodation)) {
    errors.accommodation = 'Choose Day Scholar or Hosteler.';
  }
  return { values, errors };
}

const istMinutes = (date) => Math.floor((new Date(date).getTime() + 330 * 60000) / 60000) % 1440;

export function dayScholarEligible(startsAt, endsAt) {
  return istMinutes(startsAt) <= 16 * 60 && istMinutes(endsAt) <= 16 * 60 + 30;
}

export function eventStatus(event, registeredCount, now = new Date()) {
  if (!event.registrationOpen) return 'closed';
  if (event.deadline && new Date(event.deadline) <= now) return 'closed';
  if (registeredCount >= event.capacity) return 'full';
  return 'open';
}

export function eventResponse(event, registeredCount, now = new Date()) {
  const status = eventStatus(event, registeredCount, now);
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    deadline: event.deadline,
    capacity: event.capacity,
    registered: registeredCount,
    registeredCount,
    available: Math.max(0, event.capacity - registeredCount),
    registrationOpen: Boolean(event.registrationOpen),
    status,
    dayScholarEligible: dayScholarEligible(event.startsAt, event.endsAt),
  };
}

