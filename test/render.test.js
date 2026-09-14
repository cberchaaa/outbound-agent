'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { render, renderStep, fieldsIn, buildVars } = require('../src/render.js');
const sequence = require('../data/sequence-template.json');

test('missing fields are reported and the token is left visible', () => {
  const r = render('Hi {{first_name}} at {{company}}', { first_name: 'Dana' });
  assert.deepStrictEqual(r.missing, ['company']);
  assert.ok(r.text.includes('{{company}}'), 'unresolved token must stay visible, never blank');
});

test('blank and whitespace-only values count as missing', () => {
  assert.deepStrictEqual(render('{{a}}', { a: '' }).missing, ['a']);
  assert.deepStrictEqual(render('{{a}}', { a: '   ' }).missing, ['a']);
  assert.deepStrictEqual(render('{{a}}', { a: null }).missing, ['a']);
  assert.deepStrictEqual(render('{{a}}', { a: 0 }).missing, [], '0 is a real value');
});

test('a step is not ready while any field is unresolved', () => {
  const step = sequence.steps.find((s) => s.id === 'T2');
  const partial = renderStep(step, { first_name: 'Dana' });
  assert.strictEqual(partial.ready, false);
  assert.ok(partial.missing.length > 0);
});

test('every merge field used in the sequence is declared in mergeFields', () => {
  const declared = new Set(Object.values(sequence.mergeFields).flat());
  const used = new Set();
  const walk = (v) => {
    if (typeof v === 'string') fieldsIn(v).forEach((f) => used.add(f));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sequence.steps);
  const undeclared = [...used].filter((f) => !declared.has(f));
  assert.deepStrictEqual(undeclared, [], `undeclared merge fields: ${undeclared.join(', ')}`);
});

test('a fully populated variable bag renders every step cleanly and within limits', () => {
  const vars = Object.fromEntries(
    Object.values(sequence.mergeFields).flat().map((f) => [f, `<${f}>`]),
  );
  for (const step of sequence.steps) {
    const r = renderStep(step, vars);
    assert.deepStrictEqual(r.missing, [], `${step.id} missing ${r.missing.join(', ')}`);
    assert.strictEqual(r.ready, true, `${step.id} not ready`);
  }
});

test('LinkedIn connection note is flagged when it exceeds the 300 character limit', () => {
  const step = sequence.steps.find((s) => s.id === 'T1');
  assert.strictEqual(step.charLimit, 300);
  const over = renderStep(step, {
    first_name: 'Dana', vertical: 'genomics', company: 'X',
    reframe_short: 'y'.repeat(400),
  });
  assert.strictEqual(over.overLimit, true);
  assert.strictEqual(over.ready, false, 'over-limit must block the touch even with no missing fields');
});

test('prospect values override play-pack values of the same name', () => {
  const vars = buildVars({
    sender: { vertical: 'sender' }, play: { vertical: 'play' }, prospect: { vertical: 'prospect' },
  });
  assert.strictEqual(vars.vertical, 'prospect');
});

test('call steps carry a voicemail script and a next step', () => {
  for (const step of sequence.steps.filter((s) => s.channel === 'call')) {
    assert.ok(step.talkTrack.voicemail, `${step.id} has no voicemail script`);
    assert.ok(step.talkTrack.nextStep, `${step.id} has no next step`);
    assert.ok(step.talkTrack.discovery.length >= 3, `${step.id} needs 3+ discovery questions`);
    assert.ok(step.talkTrack.objections.length >= 2, `${step.id} needs 2+ objection handles`);
  }
});
