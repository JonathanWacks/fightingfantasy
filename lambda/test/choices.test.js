'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchChoice, entitiesFor } = require('../choices');
const { handle, choiceEntities } = require('../engine');
const adventure = require('../adventure');

const passages = [
  { text: 'take the damp left passage', to: 4, say: ['left', 'go left', 'water'] },
  { text: 'creep towards the torchlight', to: 5, say: ['right', 'torch'] },
];

test('matches exact phrases, synonyms and loose wording', () => {
  assert.deepEqual(matchChoice(passages, 'go left'), { index: 0 });
  assert.deepEqual(matchChoice(passages, 'Creep towards the torchlight.'), { index: 1 });
  assert.deepEqual(matchChoice(passages, 'I’ll head for the torch'), { index: 1 });
  assert.deepEqual(matchChoice(passages, 'the damp one'), { index: 0 });
  assert.deepEqual(matchChoice(passages, 'passages'), { index: 0 });
});

test('matches ordinals, numbers and dynamic-entity ids', () => {
  assert.deepEqual(matchChoice(passages, 'the first one'), { index: 0 });
  assert.deepEqual(matchChoice(passages, 'the last one'), { index: 1 });
  assert.deepEqual(matchChoice(passages, '2'), { index: 1 });
  assert.deepEqual(matchChoice(passages, 'whatever', 'opt2'), { index: 1 });
  assert.equal(matchChoice(passages, 'third'), null);
});

test('reports ties and non-matches', () => {
  const goblins = [
    { text: 'drop down and attack the goblins', to: 10 },
    { text: 'follow the gallery and leave the goblins alone', to: 11 },
  ];
  assert.deepEqual(matchChoice(goblins, 'goblins'), { ambiguous: [0, 1] });
  assert.equal(matchChoice(goblins, 'sing a song'), null);
});

test('entities carry option ids, the text and synonyms', () => {
  const e = entitiesFor([{ text: 'squeeze through the iron door', say: ['door', 'Enter!'] }]);
  assert.deepEqual(e, [{ id: 'opt1', name: { value: 'squeeze through the iron door', synonyms: ['door', 'enter', 'iron door'] } }]);
});

function atSection(id, extra) {
  let r = handle(null, 'launch');
  r = handle(r.state, 'yes');
  r = handle(r.state, { type: 'potion', which: 'strength' });
  return Object.assign(r.state, { section: id, phase: 'section' }, extra || {});
}

test('engine follows spoken choices', () => {
  let r = handle(atSection(1), { type: 'say', text: 'go through the door' });
  assert.equal(r.state.section, 2);
  r = handle(r.state, { type: 'say', text: 'left' });
  assert.equal(r.state.section, 4);
});

test('engine asks which you mean when words fit two different choices', () => {
  const r = handle(atSection(9), { type: 'say', text: 'the goblins' });
  assert.match(r.speech, /^Do you mean drop down and attack the goblins, or follow the gallery/);
  assert.equal(r.state.section, 9);
});

test('ties that lead to the same place just go there', () => {
  const s = atSection(38);
  s.inventory.push('polished shield', 'silver mirror');
  const r = handle(s, { type: 'say', text: 'reflect it' });
  assert.equal(r.state.section, 40);
});

test('unknown words fall back to commands, then to the numbered list', () => {
  let r = handle(atSection(1), { type: 'say', text: 'status' });
  assert.match(r.speech, /^Skill/);
  r = handle(atSection(1), { type: 'say', text: 'dance a jig' });
  assert.match(r.speech, /not sure which you mean/);
  assert.match(r.speech, /Option one: squeeze through the iron door\. Option two: climb/);
});

test('what are my options lists them numbered, and numbers still work', () => {
  let r = handle(atSection(2), 'options');
  assert.match(r.speech, /^Option one: take the damp left passage\. Option two: creep towards the torchlight\./);
  r = handle(r.state, { type: 'choose', n: 2 });
  assert.equal(r.state.section, 5);
});

test('attack and continue commands can pick a matching choice', () => {
  assert.equal(handle(atSection(5), 'attack').state.section, 10);
  assert.equal(handle(atSection(9), 'continue').state.section, 11);
  assert.match(handle(atSection(1), 'attack').speech, /can’t do that/);
});

test('yes takes the only available choice', () => {
  const s = atSection(23, { flags: { shield: true, studied: true } });
  assert.match(handle(s, 'yes', Math.random).speech, /skulls/);
});

test('free speech still works for potions and combat', () => {
  let r = handle(null, 'launch');
  r = handle(r.state, 'yes');
  r = handle(r.state, { type: 'say', text: 'the fortune potion please' });
  assert.equal(r.state.potion, 'fortune');
  r = handle(atSection(2), { type: 'say', text: 'left' }); // giant rat
  r = handle(r.state, { type: 'say', text: 'attack it' });
  assert.match(r.speech, /attack strength/);
});

test('choice entities are only offered while choosing', () => {
  assert.equal(choiceEntities(atSection(1)).length, 2);
  assert.equal(choiceEntities(atSection(7)).length, 0); // "continue" section
  assert.equal(choiceEntities(handle(null, 'launch').state).length, 0);
  for (const id of Object.keys(adventure.sections)) {
    choiceEntities(atSection(Number(id))).forEach((e) => {
      [e.name.value].concat(e.name.synonyms).forEach((p) => assert.match(p, /^[a-z0-9' ]+$/));
    });
  }
});
