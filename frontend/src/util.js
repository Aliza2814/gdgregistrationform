// Mirrors backend/src/logic.js for instant feedback. The backend is the authority.
export const DOMAIN = '@chitkara.edu.in';
export function validate(v) {
  const e = {};
  if (!/^[A-Za-z0-9-]{4,20}$/.test(v.rollNumber.trim())) e.rollNumber = 'Enter a valid roll number (4-20 letters or numbers).';
  if (v.name.trim().length < 2) e.name = 'Enter your full name.';
  const email = v.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !email.endsWith(DOMAIN)) e.email = `Use your college email ending in ${DOMAIN}.`;
  if (!['1st Year', '2nd Year', '3rd Year', '4th Year'].includes(v.year)) e.year = 'Select your year.';
  if (!v.department) e.department = 'Select your department.';
  if (!v.accommodation) e.accommodation = 'Choose Day Scholar or Hosteler.';
  return e;
}
export function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { Days: Math.floor(s / 86400), Hours: Math.floor(s / 3600) % 24, Minutes: Math.floor(s / 60) % 60, Seconds: s % 60 };
}
