/**
 * Outbound agent core — the ONE implementation of cadence maths, merge-field
 * rendering and queue building.
 *
 * Runs unmodified in Node (the daily job, the CLI, the tests) and in the
 * browser (the published interface loads this file directly). There is
 * deliberately no second copy: the dates you see in the interface are computed
 * by the same code that decides which Gmail drafts get created.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OutboundCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- dates */

  var MS_PER_DAY = 86400000;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function parseDate(value) {
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    if (typeof value !== 'string' || !DATE_RE.test(value)) {
      throw new TypeError('Expected a YYYY-MM-DD date string, received: ' + JSON.stringify(value));
    }
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
      throw new RangeError('Not a real calendar date: ' + value);
    }
    return date;
  }

  function formatDate(date) { return date.toISOString().slice(0, 10); }
  function addDays(date, days) { return new Date(date.getTime() + days * MS_PER_DAY); }
  function isWeekend(date) { var d = date.getUTCDay(); return d === 0 || d === 6; }
  function isBlocked(date, holidays) { return isWeekend(date) || holidays.has(formatDate(date)); }

  function toBusinessDay(date, holidays) {
    var cursor = date;
    while (isBlocked(cursor, holidays)) cursor = addDays(cursor, 1);
    return cursor;
  }
  function nextBusinessDay(date, holidays) { return toBusinessDay(addDays(date, 1), holidays); }

  /**
   * Lay sequence steps onto real calendar dates.
   * Weekend/holiday touches shift forward; a shifted touch never collides with
   * the one before it.
   */
  function buildSchedule(args) {
    var steps = args.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new TypeError('buildSchedule requires a non-empty steps array');
    }
    var start = parseDate(args.startDate);
    var blocked = new Set((args.holidays || []).map(function (h) { return formatDate(parseDate(h)); }));
    var ordered = steps.slice().sort(function (a, b) { return a.dayOffset - b.dayOffset; });
    var out = [];
    var previous = null;

    ordered.forEach(function (step) {
      if (!Number.isInteger(step.dayOffset) || step.dayOffset < 0) {
        throw new RangeError('Step ' + (step.id || '?') + ' has an invalid dayOffset: ' + step.dayOffset);
      }
      var planned = addDays(start, step.dayOffset);
      var date = toBusinessDay(planned, blocked);
      var reason = date.getTime() === planned.getTime() ? null : 'non-working-day';

      if (previous && date.getTime() <= previous.getTime()) {
        date = nextBusinessDay(previous, blocked);
        reason = 'collision-with-previous-touch';
      }
      out.push(Object.assign({}, step, {
        date: formatDate(date),
        plannedDate: formatDate(planned),
        shifted: date.getTime() !== planned.getTime(),
        shiftReason: reason,
      }));
      previous = date;
    });
    return out;
  }

  function daysBetween(from, to) {
    return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / MS_PER_DAY);
  }

  function todayInZone(timeZone, now) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now || new Date());
  }

  /* --------------------------------------------------------------- render */

  var FIELD_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

  function fieldsIn(text) {
    if (typeof text !== 'string') return [];
    var found = [];
    var m;
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(text)) !== null) if (found.indexOf(m[1]) === -1) found.push(m[1]);
    return found;
  }

  /** Substitute {{fields}}; an unresolved field is reported, never silently blanked. */
  function render(text, vars) {
    vars = vars || {};
    if (typeof text !== 'string') return { text: '', missing: [] };
    var missing = [];
    var out = text.replace(FIELD_RE, function (match, name) {
      var value = vars[name];
      if (value === undefined || value === null || String(value).trim() === '') {
        if (missing.indexOf(name) === -1) missing.push(name);
        return match;
      }
      return String(value);
    });
    return { text: out, missing: missing };
  }

  function renderDeep(value, vars, missing) {
    if (typeof value === 'string') {
      var r = render(value, vars);
      r.missing.forEach(function (m) { if (missing.indexOf(m) === -1) missing.push(m); });
      return r.text;
    }
    if (Array.isArray(value)) return value.map(function (v) { return renderDeep(v, vars, missing); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = renderDeep(value[k], vars, missing); });
      return out;
    }
    return value;
  }

  /** Render one step. `ready` is false if anything is missing or over a char limit. */
  function renderStep(step, vars) {
    var missing = [];
    var subject = step.subject ? renderDeep(step.subject, vars, missing) : undefined;
    var body = step.body ? renderDeep(step.body, vars, missing) : undefined;
    var talkTrack = step.talkTrack ? renderDeep(step.talkTrack, vars, missing) : undefined;
    var limit = step.charLimit;
    var count = body ? body.length : 0;
    var overLimit = Boolean(limit && count > limit);
    return {
      id: step.id, channel: step.channel, action: step.action, name: step.name, intent: step.intent,
      subject: subject, body: body, talkTrack: talkTrack,
      charLimit: limit || null, charCount: count, overLimit: overLimit,
      missing: missing, ready: missing.length === 0 && !overLimit,
    };
  }

  /** Prospect values win over play-pack values, which win over sender defaults. */
  function buildVars(parts) {
    return Object.assign({}, parts.sender || {}, parts.play || {}, parts.prospect || {});
  }

  /* -------------------------------------------------------------- planner */

  var ACTIVE = 'active';
  var TERMINAL = ['replied', 'meeting-booked', 'bounced', 'stopped', 'unsubscribed'];

  function scheduleProspect(prospect, sequence, opts) {
    opts = opts || {};
    var scheduled = buildSchedule({
      startDate: prospect.startDate, steps: sequence.steps, holidays: opts.holidays || [],
    });
    var done = prospect.completed || [];
    var skipped = prospect.skipped || [];
    var today = opts.today;

    return scheduled.map(function (t) {
      var state;
      if (done.indexOf(t.id) !== -1) state = 'done';
      else if (skipped.indexOf(t.id) !== -1) state = 'skipped';
      else if (TERMINAL.indexOf(prospect.status) !== -1) state = 'cancelled';
      else if (today && t.date < today) state = 'overdue';
      else if (today && t.date === today) state = 'due';
      else state = 'upcoming';
      return Object.assign({}, t, { state: state, prospectId: prospect.id });
    });
  }

  function buildQueue(args) {
    var today = todayInZone(args.timeZone, args.now);
    var horizon = args.horizonDays === undefined ? 7 : args.horizonDays;
    var due = [], overdue = [], upcoming = [];

    args.prospects.forEach(function (prospect) {
      if (prospect.status !== ACTIVE) return;
      scheduleProspect(prospect, args.sequence, { holidays: args.holidays || [], today: today })
        .forEach(function (touch) {
          var item = Object.assign({}, touch, { prospect: prospect });
          if (touch.state === 'due') due.push(item);
          else if (touch.state === 'overdue') overdue.push(item);
          else if (touch.state === 'upcoming' && daysBetween(today, touch.date) <= horizon) upcoming.push(item);
        });
    });

    var byChannel = function (list) {
      return list.reduce(function (acc, i) { acc[i.channel] = (acc[i.channel] || 0) + 1; return acc; }, {});
    };
    var sortKey = function (a, b) {
      return a.date.localeCompare(b.date) || String(a.prospect.company).localeCompare(String(b.prospect.company));
    };
    due.sort(sortKey); overdue.sort(sortKey); upcoming.sort(sortKey);

    return {
      today: today, due: due, overdue: overdue, upcoming: upcoming,
      counts: {
        due: due.length, overdue: overdue.length, upcoming: upcoming.length,
        dueByChannel: byChannel(due), overdueByChannel: byChannel(overdue),
        activeProspects: args.prospects.filter(function (p) { return p.status === ACTIVE; }).length,
      },
    };
  }

  /** Email touches needing a Gmail draft within `days`. Rolling window, not all upfront. */
  function draftWindow(args) {
    var today = todayInZone(args.timeZone, args.now);
    var days = args.days === undefined ? 3 : args.days;
    var out = [];
    args.prospects.forEach(function (prospect) {
      if (prospect.status !== ACTIVE) return;
      scheduleProspect(prospect, args.sequence, { holidays: args.holidays || [], today: today })
        .forEach(function (touch) {
          if (touch.channel !== 'email') return;
          if (touch.state === 'done' || touch.state === 'skipped' || touch.state === 'cancelled') return;
          var lead = daysBetween(today, touch.date);
          if (lead <= days) out.push(Object.assign({}, touch, { prospect: prospect, leadDays: lead }));
        });
    });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  return {
    parseDate: parseDate, formatDate: formatDate, addDays: addDays, isWeekend: isWeekend,
    toBusinessDay: toBusinessDay, nextBusinessDay: nextBusinessDay, buildSchedule: buildSchedule,
    daysBetween: daysBetween, todayInZone: todayInZone,
    fieldsIn: fieldsIn, render: render, renderDeep: renderDeep, renderStep: renderStep, buildVars: buildVars,
    scheduleProspect: scheduleProspect, buildQueue: buildQueue, draftWindow: draftWindow,
    ACTIVE: ACTIVE, TERMINAL: TERMINAL,
  };
});
