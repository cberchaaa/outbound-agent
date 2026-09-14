'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildQueue, draftWindow, scheduleProspect } = require('../src/planner.js');
const sequence = require('../data/sequence-template.json');

const at = (iso) => new Date(iso);
const prospect = (over = {}) => ({
  id: 'p1', first_name: 'Dana', company: 'Acme', status: 'active',
  startDate: '2026-09-14', completed: [], ...over,
});

test('a touch due today lands in due, not overdue or upcoming', () => {
  const q = buildQueue({
    prospects: [prospect()], sequence, now: at('2026-09-14T17:00:00Z'), // 10am PT
  });
  assert.strictEqual(q.today, '2026-09-14');
  assert.strictEqual(q.counts.due, 1);
  assert.strictEqual(q.due[0].id, 'T1');
  assert.strictEqual(q.counts.overdue, 0);
});

test('untouched past steps accumulate as overdue', () => {
  const q = buildQueue({ prospects: [prospect()], sequence, now: at('2026-09-19T17:00:00Z') });
  assert.deepStrictEqual(q.overdue.map((t) => t.id), ['T1', 'T2', 'T3']);
  assert.strictEqual(q.counts.due, 0);
});

test('completed touches drop out of the queue', () => {
  const q = buildQueue({
    prospects: [prospect({ completed: ['T1', 'T2'] })], sequence, now: at('2026-09-19T17:00:00Z'),
  });
  assert.deepStrictEqual(q.overdue.map((t) => t.id), ['T3']);
});

test('a replied prospect is removed from the queue entirely', () => {
  for (const status of ['replied', 'meeting-booked', 'bounced', 'stopped', 'unsubscribed']) {
    const q = buildQueue({
      prospects: [prospect({ status })], sequence, now: at('2026-09-19T17:00:00Z'),
    });
    assert.strictEqual(q.counts.due + q.counts.overdue + q.counts.upcoming, 0, `${status} still queued`);
    assert.strictEqual(q.counts.activeProspects, 0);
  }
});

test('the queue counts work by channel so the digest can group it', () => {
  const q = buildQueue({ prospects: [prospect()], sequence, now: at('2026-09-19T17:00:00Z') });
  assert.deepStrictEqual(q.overdueByChannel ?? q.counts.overdueByChannel, {
    linkedin: 1, email: 1, call: 1,
  });
});

test('the horizon limits upcoming work to the next 7 days by default', () => {
  const q = buildQueue({ prospects: [prospect()], sequence, now: at('2026-09-14T17:00:00Z') });
  for (const t of q.upcoming) {
    assert.ok(t.date > '2026-09-14' && t.date <= '2026-09-21', `${t.id} on ${t.date} outside horizon`);
  }
});

test('draftWindow returns only email touches inside the lead window', () => {
  const w = draftWindow({ prospects: [prospect()], sequence, now: at('2026-09-14T17:00:00Z'), days: 3 });
  assert.ok(w.length > 0);
  assert.ok(w.every((t) => t.channel === 'email'), 'non-email touch in the draft window');
  assert.ok(w.every((t) => t.leadDays <= 3));
  assert.ok(w.some((t) => t.id === 'T2'), 'T2 (day+2) should be inside a 3-day window');
});

test('draftWindow skips prospects who are no longer active', () => {
  const w = draftWindow({
    prospects: [prospect({ status: 'replied' })], sequence, now: at('2026-09-14T17:00:00Z'),
  });
  assert.strictEqual(w.length, 0);
});

test('each prospect keeps their own start date', () => {
  const a = scheduleProspect(prospect({ id: 'a', startDate: '2026-09-14' }), sequence);
  const b = scheduleProspect(prospect({ id: 'b', startDate: '2026-10-05' }), sequence);
  assert.strictEqual(a[0].date, '2026-09-14');
  assert.strictEqual(b[0].date, '2026-10-05');
  assert.strictEqual(a.length, b.length);
});
