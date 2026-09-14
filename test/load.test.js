'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../src/load.js');

/** Build a throwaway data root with whichever files a case needs. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-load-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.mkdirSync(path.join(root, 'data'));
  const write = (rel, body) => fs.writeFileSync(path.join(root, rel), JSON.stringify(body));
  write('config/settings.json', { timeZone: 'America/Los_Angeles', marker: 'seed' });
  write('data/sequence-template.json', { steps: [{ id: 'T1', dayOffset: 0 }], marker: 'seed' });
  write('data/prospects.json', { prospects: [] });
  write('data/play-packs.json', { packs: [] });
  Object.entries(files || {}).forEach(([rel, body]) => write(rel, body));
  return root;
}

test('falls back to the committed seed when no live file exists', () => {
  const r = load(fixture());
  assert.strictEqual(r.settings.marker, 'seed');
  assert.strictEqual(r.sequence.marker, 'seed');
  assert.strictEqual(r.sources.settings.tier, 'seed');
  assert.strictEqual(r.sources.sequence.tier, 'seed');
});

test('live files from the console win over the seed', () => {
  const r = load(fixture({
    'config/settings-live.json': { timeZone: 'America/New_York', marker: 'live' },
    'data/sequence-live.json': { steps: [{ id: 'T1', dayOffset: 0 }], marker: 'live' },
  }));
  assert.strictEqual(r.settings.marker, 'live');
  assert.strictEqual(r.sequence.marker, 'live');
  assert.strictEqual(r.settings.timeZone, 'America/New_York');
  assert.strictEqual(r.sources.settings.tier, 'live');
});

test('each tier is resolved independently', () => {
  const r = load(fixture({ 'data/sequence-live.json': { steps: [], marker: 'live' } }));
  assert.strictEqual(r.sources.sequence.tier, 'live');
  assert.strictEqual(r.sources.settings.tier, 'seed', 'a live sequence must not imply live settings');
});

test('prospects and play packs default to empty rather than throwing', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'data/prospects.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(root, 'data/play-packs.json'), JSON.stringify({}));
  const r = load(root);
  assert.deepStrictEqual(r.prospects, []);
  assert.deepStrictEqual(r.packs, []);
});

test('play packs are indexed by id for lookup', () => {
  const r = load(fixture({ 'data/play-packs.json': { packs: [{ id: 'pk1', name: 'Infinite Capacity' }] } }));
  assert.strictEqual(r.packById.pk1.name, 'Infinite Capacity');
});
