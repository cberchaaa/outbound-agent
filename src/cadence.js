'use strict';
/** Date engine. Implementation lives in ./core.js (shared with the browser interface). */
const core = require('./core.js');
module.exports = {
  parseDate: core.parseDate, formatDate: core.formatDate, addDays: core.addDays,
  isWeekend: core.isWeekend, toBusinessDay: core.toBusinessDay, nextBusinessDay: core.nextBusinessDay,
  buildSchedule: core.buildSchedule, daysBetween: core.daysBetween, todayInZone: core.todayInZone,
};
