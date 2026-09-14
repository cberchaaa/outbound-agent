'use strict';
const test = require('node:test');
const assert = require('node:assert');
const c = require('../src/cadence.js');

const fifteen = Array.from({ length: 15 }, (_, i) => ({ id: `T${i + 1}`, dayOffset: i * 2 }));

test('parseDate rejects malformed and impossible dates', () => {
  assert.throws(() => c.parseDate('9/14/2026'), TypeError);
  assert.throws(() => c.parseDate('2026-9-14'), TypeError);
  assert.throws(() => c.parseDate(null), TypeError);
  assert.throws(() => c.parseDate('2026-02-30'), RangeError);
  assert.throws(() => c.parseDate('2027-02-29'), RangeError);
  assert.strictEqual(c.formatDate(c.parseDate('2028-02-29')), '2028-02-29'); // real leap day
});

test('15 touches every other day span 29 days before any shifting', () => {
  assert.strictEqual(fifteen.at(-1).dayOffset, 28);
  const s = c.buildSchedule({ startDate: '2026-09-14', steps: fifteen });
  assert.strictEqual(s.length, 15);
  assert.strictEqual(s[0].plannedDate, '2026-09-14');
  assert.strictEqual(s.at(-1).plannedDate, '2026-10-12');
});

test('no touch ever lands on a weekend', () => {
  // Sweep every possible start weekday so no start date can produce a weekend touch.
  for (let i = 0; i < 14; i++) {
    const start = c.formatDate(c.addDays(c.parseDate('2026-09-14'), i));
    for (const t of c.buildSchedule({ startDate: start, steps: fifteen })) {
      assert.ok(!c.isWeekend(c.parseDate(t.date)), `${start} -> ${t.id} on ${t.date} is a weekend`);
    }
  }
});

test('dates are strictly increasing — two touches never share a day', () => {
  for (let i = 0; i < 14; i++) {
    const start = c.formatDate(c.addDays(c.parseDate('2026-09-14'), i));
    const dates = c.buildSchedule({ startDate: start, steps: fifteen }).map((t) => t.date);
    for (let j = 1; j < dates.length; j++) {
      assert.ok(dates[j] > dates[j - 1], `${start}: ${dates[j]} not after ${dates[j - 1]}`);
    }
    assert.strictEqual(new Set(dates).size, 15);
  }
});

test('a weekend start shifts touch 1 forward to Monday', () => {
  const s = c.buildSchedule({ startDate: '2026-09-19', steps: fifteen }); // Saturday
  assert.strictEqual(s[0].date, '2026-09-21');
  assert.strictEqual(s[0].shiftReason, 'non-working-day');
  assert.ok(s[0].shifted);
});

test('holidays are treated as non-working days', () => {
  const s = c.buildSchedule({
    startDate: '2026-11-23', // Mon; US Thanksgiving 2026 falls Thu 11-26
    steps: fifteen,
    holidays: ['2026-11-26', '2026-11-27'],
  });
  const dates = s.map((t) => t.date);
  assert.ok(!dates.includes('2026-11-26'));
  assert.ok(!dates.includes('2026-11-27'));
});

test('steps are ordered by dayOffset regardless of input order', () => {
  const shuffled = [...fifteen].reverse();
  const s = c.buildSchedule({ startDate: '2026-09-14', steps: shuffled });
  assert.deepStrictEqual(s.map((t) => t.id), fifteen.map((t) => t.id));
});

test('invalid input is rejected rather than silently scheduled', () => {
  assert.throws(() => c.buildSchedule({ startDate: '2026-09-14', steps: [] }), TypeError);
  assert.throws(
    () => c.buildSchedule({ startDate: '2026-09-14', steps: [{ id: 'T1', dayOffset: -2 }] }),
    RangeError,
  );
  assert.throws(
    () => c.buildSchedule({ startDate: '2026-09-14', steps: [{ id: 'T1', dayOffset: 1.5 }] }),
    RangeError,
  );
});

test('todayInZone reports the Pacific calendar day, not UTC', () => {
  // 2026-09-12 03:00 UTC is still 2026-09-11 in Los Angeles.
  const instant = new Date('2026-09-12T03:00:00Z');
  assert.strictEqual(c.todayInZone('America/Los_Angeles', instant), '2026-09-11');
  assert.strictEqual(c.todayInZone('UTC', instant), '2026-09-12');
});

test('daysBetween is signed and whole-day accurate across a DST boundary', () => {
  assert.strictEqual(c.daysBetween('2026-09-14', '2026-09-16'), 2);
  assert.strictEqual(c.daysBetween('2026-09-16', '2026-09-14'), -2);
  assert.strictEqual(c.daysBetween('2026-10-30', '2026-11-06'), 7); // US DST ends 11-01
});
