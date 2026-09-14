'use strict';
/**
 * Guards that keep this repo shareable.
 *
 * The system was first built for one person and then handed to a teammate. These tests exist so
 * that identity cannot creep back into shared files: every operator-specific value belongs in
 * config/settings.json (blank in the repo, filled per install) or in that operator's own console.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

test('settings ships with a blank operator, so a fork inherits nobody', () => {
  const s = JSON.parse(read('config/settings.json'));
  assert.ok(s.operator, 'config/settings.json needs an operator block');
  ['name', 'email', 'slackUserId'].forEach((k) => {
    assert.strictEqual(typeof s.operator[k], 'string', `operator.${k} must exist`);
    assert.strictEqual(s.operator[k], '', `operator.${k} must be blank in the committed file`);
  });
  assert.strictEqual(s.artifactUrl, '', 'artifactUrl must be blank — each operator publishes their own console');
  Object.entries(s.sender).forEach(([k, v]) => {
    assert.strictEqual(v, '', `sender.${k} must be blank in the committed file`);
  });
});

test('the runbook names no mailbox — it reads the operator from settings', () => {
  const found = read('docs/OPERATIONS.md').match(EMAIL_RE) || [];
  assert.deepStrictEqual(found, [], `docs/OPERATIONS.md hardcodes ${found.join(', ')}`);
});

test('the runbook and README carry no artifact URL', () => {
  for (const f of ['docs/OPERATIONS.md', 'README.md']) {
    assert.ok(
      !/claude\.ai\/code\/artifact\//.test(read(f)),
      `${f} hardcodes a console URL; it belongs in config/settings.json -> artifactUrl`,
    );
  }
});

test('the handoff guide only uses obvious placeholder addresses', () => {
  const PLACEHOLDERS = new Set(['you@company.com']);
  const real = (read('docs/HANDOFF.md').match(EMAIL_RE) || [])
    .filter((e) => !PLACEHOLDERS.has(e.toLowerCase()));
  assert.deepStrictEqual(real, [], `docs/HANDOFF.md contains a real-looking address: ${real.join(', ')}`);
});

test('the runbook still states the rules that make the job safe to automate', () => {
  const ops = read('docs/OPERATIONS.md');
  [
    'Never send an email',
    'Never contact a prospect on any channel',
    'Never create a draft from content that is not `ready`',
    'Never invent prospect facts',
    'Never mark a touch done',
  ].forEach((rule) => assert.ok(ops.includes(rule), `docs/OPERATIONS.md lost the rule: ${rule}`));
});
