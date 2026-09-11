'use strict';
/** Merge-field rendering. Implementation lives in ./core.js (shared with the browser interface). */
const core = require('./core.js');
module.exports = {
  fieldsIn: core.fieldsIn, render: core.render, renderDeep: core.renderDeep,
  renderStep: core.renderStep, buildVars: core.buildVars,
};
