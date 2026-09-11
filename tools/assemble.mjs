/**
 * Assembles local data files from an artifact-database dump.
 *
 * The console (the published artifact) is the source of truth. The daily job
 * dumps its collections to data/sync/ with `read_db --out_dir`, then runs this
 * to produce the files the CLI reads. Keeping this a separate, dumb step means
 * the daily job never hand-transcribes a prospect record.
 *
 *   node tools/assemble.mjs            # reads data/sync/, writes data/ + config/
 *   node tools/assemble.mjs --dry-run  # report only
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = join(ROOT, 'data', 'sync');
const dryRun = process.argv.includes('--dry-run');

function readDir(sub) {
  const dir = join(SYNC, sub);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      // read_db may wrap the body; accept either shape.
      return raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
    });
}

function write(rel, body) {
  const target = join(ROOT, rel);
  if (dryRun) { console.log(`would write ${rel}`); return; }
  writeFileSync(target, JSON.stringify(body, null, 2) + '\n');
  console.log(`wrote ${rel}`);
}

const stamp = new Date().toISOString();

const prospects = readDir('prospects');
const packs = readDir('playpacks');
const sequences = readDir('sequence');
const configs = readDir('config');

// Prospects and play packs always mirror the console, even when empty.
write('data/prospects.json', { syncedAt: stamp, source: 'artifact-db', prospects });
write('data/play-packs.json', { syncedAt: stamp, source: 'artifact-db', packs });

// Sequence and settings only overwrite when the console actually has them,
// so a failed or partial dump can never blank the cadence definition.
const sequence = sequences.find((s) => Array.isArray(s.steps) && s.steps.length);
if (sequence) write('data/sequence-template.json', sequence);
else console.log('no sequence in dump — keeping the committed data/sequence-template.json');

const settings = configs.find((c) => c && c.timeZone);
if (settings) write('config/settings.json', settings);
else console.log('no settings in dump — keeping the committed config/settings.json');

console.log(`\n${prospects.length} prospect(s), ${packs.length} play pack(s) assembled.`);
const active = prospects.filter((p) => p.status === 'active').length;
console.log(`${active} active.`);
