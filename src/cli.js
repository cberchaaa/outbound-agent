'use strict';
/**
 * Command line surface for the daily job.
 *
 *   node src/cli.js brief            what to do today (human-readable)
 *   node src/cli.js brief --json     same, as JSON for the digest builder
 *   node src/cli.js drafts           email touches needing a Gmail draft
 *   node src/cli.js schedule <id>    one prospect's full 15-touch schedule
 *   node src/cli.js validate         check every active prospect renders cleanly
 *
 * Every command accepts --date=YYYY-MM-DD to evaluate "today" as another day.
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildQueue, draftWindow, scheduleProspect } = require('./planner.js');
const { renderStep, buildVars } = require('./render.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const CHANNEL_ICON = { email: '[EMAIL]', linkedin: '[LINKEDIN]', call: '[CALL]' };

function load() {
  const settings = read('config/settings.json');
  const sequence = read('data/sequence-template.json');
  const prospects = read('data/prospects.json').prospects || [];
  const packs = read('data/play-packs.json').packs || [];
  const packById = Object.fromEntries(packs.map((p) => [p.id, p]));
  return { settings, sequence, prospects, packs, packById };
}

/** Resolve the full variable bag for one prospect, or explain why it can't be. */
function varsFor(prospect, packById, settings) {
  const pack = packById[prospect.playPackId];
  return {
    pack,
    vars: buildVars({
      sender: settings.sender || {},
      play: pack ? pack.fields || {} : {},
      prospect,
    }),
  };
}

function nowFrom(argv) {
  const flag = argv.find((a) => a.startsWith('--date='));
  if (!flag) return undefined;
  const d = flag.split('=')[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`--date must be YYYY-MM-DD, got ${d}`);
  return new Date(`${d}T12:00:00Z`);
}

function cmdBrief(argv) {
  const { settings, sequence, prospects, packById } = load();
  const now = nowFrom(argv);
  const q = buildQueue({
    prospects, sequence,
    timeZone: settings.timeZone,
    holidays: settings.holidays,
    horizonDays: settings.upcomingHorizonDays,
    now,
  });

  const decorate = (item) => {
    const { pack, vars } = varsFor(item.prospect, packById, settings);
    const step = sequence.steps.find((s) => s.id === item.id);
    const rendered = renderStep(step, vars);
    return { ...item, rendered, playPack: pack ? pack.name : null };
  };

  const payload = {
    today: q.today,
    counts: q.counts,
    overdue: q.overdue.map(decorate),
    due: q.due.map(decorate),
    upcoming: q.upcoming.map(decorate),
  };

  if (argv.includes('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  const line = (i) => {
    const p = i.prospect;
    const flag = !i.rendered.ready ? '  !! NOT READY: ' + (i.rendered.overLimit
      ? `over ${i.rendered.charLimit} chars`
      : `missing ${i.rendered.missing.join(', ')}`) : '';
    return `  ${CHANNEL_ICON[i.channel]} ${i.id} ${p.first_name} ${p.last_name || ''} (${p.title || 'no title'}) @ ${p.company}\n      ${i.name} - ${i.date}${flag}`;
  };

  console.log(`\nOUTBOUND BRIEF - ${q.today} (${settings.timeZone})`);
  console.log('='.repeat(64));
  console.log(`Active prospects: ${q.counts.activeProspects}   Due: ${q.counts.due}   Overdue: ${q.counts.overdue}\n`);
  if (q.counts.due + q.counts.overdue === 0) {
    console.log('Nothing due. Next 7 days:');
    payload.upcoming.slice(0, 10).forEach((i) => console.log(line(i)));
  }
  if (payload.overdue.length) {
    console.log(`OVERDUE (${payload.overdue.length})`);
    payload.overdue.forEach((i) => console.log(line(i)));
    console.log('');
  }
  if (payload.due.length) {
    console.log(`DUE TODAY (${payload.due.length})`);
    payload.due.forEach((i) => console.log(line(i)));
  }
  console.log('');
  return payload;
}

function cmdDrafts(argv) {
  const { settings, sequence, prospects, packById } = load();
  const w = draftWindow({
    prospects, sequence,
    timeZone: settings.timeZone,
    holidays: settings.holidays,
    days: settings.draftLeadDays,
    now: nowFrom(argv),
  });
  const out = w.map((item) => {
    const { vars } = varsFor(item.prospect, packById, settings);
    const step = sequence.steps.find((s) => s.id === item.id);
    const rendered = renderStep(step, vars);
    return {
      prospectId: item.prospect.id,
      to: item.prospect.email,
      stepId: item.id,
      date: item.date,
      leadDays: item.leadDays,
      subject: rendered.subject,
      body: rendered.body,
      ready: rendered.ready && Boolean(item.prospect.email),
      blockedBy: [
        ...rendered.missing.map((m) => `missing:${m}`),
        ...(item.prospect.email ? [] : ['missing:email']),
      ],
    };
  });
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function cmdSchedule(argv) {
  const { settings, sequence, prospects } = load();
  const id = argv.find((a) => !a.startsWith('--'));
  const p = prospects.find((x) => x.id === id || x.email === id);
  if (!p) throw new Error(`No prospect matching "${id}". Known ids: ${prospects.map((x) => x.id).join(', ') || '(none)'}`);
  const rows = scheduleProspect(p, sequence, { holidays: settings.holidays });
  console.log(`\n${p.first_name} ${p.last_name || ''} @ ${p.company} - start ${p.startDate} - status ${p.status}\n`);
  rows.forEach((r) => console.log(`  ${r.date}  Day ${String(r.dayOffset + 1).padStart(2)}  ${CHANNEL_ICON[r.channel].padEnd(10)} ${r.id.padEnd(4)} ${r.name}${r.shifted ? `  (shifted: ${r.shiftReason})` : ''}`));
  console.log('');
  return rows;
}

function cmdValidate() {
  const { settings, sequence, prospects, packById } = load();
  let problems = 0;
  for (const p of prospects.filter((x) => x.status === 'active')) {
    const { pack, vars } = varsFor(p, packById, settings);
    if (!pack) {
      console.log(`FAIL ${p.id} (${p.company}): play pack "${p.playPackId}" not found`);
      problems++;
      continue;
    }
    for (const step of sequence.steps) {
      const r = renderStep(step, vars);
      if (!r.ready) {
        console.log(`FAIL ${p.id} (${p.company}) ${step.id}: ${r.overLimit ? `over ${r.charLimit} chars (${r.charCount})` : `missing ${r.missing.join(', ')}`}`);
        problems++;
      }
    }
  }
  console.log(problems === 0
    ? `OK - ${prospects.filter((x) => x.status === 'active').length} active prospects render cleanly across all 15 touches.`
    : `\n${problems} problem(s) found. Fix these before drafts are created.`);
  return problems;
}

const [, , command, ...argv] = process.argv;
const commands = { brief: cmdBrief, drafts: cmdDrafts, schedule: cmdSchedule, validate: cmdValidate };
if (!commands[command]) {
  console.error(`Usage: node src/cli.js <brief|drafts|schedule|validate> [--date=YYYY-MM-DD] [--json]`);
  process.exit(1);
}
try {
  const result = commands[command](argv);
  if (command === 'validate' && result > 0) process.exit(1);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
