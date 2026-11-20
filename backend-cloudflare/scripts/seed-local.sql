INSERT OR IGNORE INTO events (
  id,
  name,
  venue,
  starts_at,
  ends_at,
  deadline,
  capacity,
  registration_open
) VALUES (
  'local-demo-event',
  'GDG Email Verification Test',
  'Online Test Environment',
  '2030-01-01T08:30:00.000Z',
  '2030-01-01T10:00:00.000Z',
  NULL,
  150,
  1
);

