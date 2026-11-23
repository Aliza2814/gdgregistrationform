import test from 'node:test';
import assert from 'node:assert/strict';
import { dayScholarEligible as ok, validate } from './logic.js';
const ist = (h, m = 0) => new Date(Date.UTC(2026, 11, 1, h - 5, m - 30)); // IST wall-clock -> UTC
test('day scholar rule', () => {
  assert.ok(ok(ist(10), ist(14)));
  assert.ok(ok(ist(14), ist(16)));
  assert.ok(ok(ist(15), ist(16, 30)));
  assert.ok(!ok(ist(16, 30), ist(18)));
  assert.ok(!ok(ist(14), ist(17)));
  assert.ok(!ok(ist(10), ist(17)));
});
test('validation', () => {
  const bad = validate({ rollNumber: ' ', name: ' ', email: 'a@gmail.com' });
  assert.ok(bad.errors.rollNumber && bad.errors.name && bad.errors.email && bad.errors.year);
  for (const email of ['person@gmail.com', 'person@chitkara.edu.in.evil', 'person@@chitkara.edu.in']) {
    assert.ok(validate({ rollNumber: '2525BCS001', name: 'Test User', email, year: '1st Year', department: 'CSE', accommodation: 'Hosteler' }).errors.email);
  }
  const good = validate({ rollNumber: ' 2525bcs001 ', name: '  Aliza  K ', email: ' ALIZA@Chitkara.edu.in ', year: '2nd Year', department: 'CSE', accommodation: 'Hosteler' });
  assert.deepEqual(good.errors, {});
  assert.equal(good.values.email, 'aliza@chitkara.edu.in');
  assert.equal(good.values.rollNumber, '2525BCS001');
});
