'use strict';
/** Work-queue building. Implementation lives in ./core.js (shared with the browser interface). */
const core = require('./core.js');
module.exports = {
  scheduleProspect: core.scheduleProspect, buildQueue: core.buildQueue,
  draftWindow: core.draftWindow, ACTIVE: core.ACTIVE, TERMINAL: new Set(core.TERMINAL),
};
