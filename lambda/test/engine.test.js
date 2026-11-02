'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adventure = require('../adventure');
const { validate } = require('../validate');
const { handle, visibleChoices, newCharacter } = require('../engine');

/** Deterministic PRNG so failures are reproducible. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG that returns die faces from a script: [6, 1] -> rolls of 6 then 1. */
function dice(...faces) {
  let i = 0;
  return () => (faces[i++ % faces.length] - 1) / 6 + 0.01;
}

function readyCharacter(overrides = {}) {
  let r = handle(null, 'launch', seeded(1));
  r = handle(r.state, 'yes');
  r = handle(r.state, { type: 'potion', which: 'strength' });
  Object.assign(r.state, overrides);
  return r;
}

test('adventure has no broken links, dead ends or unreachable sections', () => {
  const { errors, warnings } = validate(adventure);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('character scores are rolled within gamebook ranges', () => {
  const rng = seeded(42);
  for (let i = 0; i < 500; i++) {
    const c = newCharacter(rng);
    assert.ok(c.skill >= 7 && c.skill <= 12);
    assert.ok(c.stamina >= 14 && c.stamina <= 24);
    assert.ok(c.luck >= 7 && c.luck <= 12);
  }
});

test('launch -> accept -> potion -> first section', () => {
  let r = handle(null, 'launch', seeded(3));
  assert.equal(r.state.phase, 'rolled');
  assert.match(r.speech, /Welcome to Beneath Ashen Tor/);
  r = handle(r.state, 'yes');
  assert.equal(r.state.phase, 'potion');
  r = handle(r.state, { type: 'choose', n: 3 });
  assert.equal(r.state.potion, 'fortune');
  assert.equal(r.state.section, 1);
  assert.match(r.speech, /Say one to squeeze through the iron door, or two/);
});

test('roll again produces a fresh character', () => {
  let r = handle(null, 'launch', dice(1));
  assert.equal(r.state.skill, 7);
  r = handle(r.state, 'reroll', dice(6));
  assert.equal(r.state.skill, 12);
  assert.match(r.speech, /^Rolling again/);
});

test('options with unmet requirements are hidden and renumbered', () => {
  const r = readyCharacter();
  r.state.section = 17;
  r.state.phase = 'section';
  assert.deepEqual(visibleChoices(r.state).map((c) => c.to), [19, 39]);
  r.state.inventory.push('silver key');
  assert.deepEqual(visibleChoices(r.state).map((c) => c.to), [18, 19, 39]);
  const next = handle(r.state, { type: 'choose', n: 1 });
  assert.equal(next.state.section, 18);
  assert.equal(next.state.skill, r.state.skill + 1);
  assert.equal(next.state.initialSkill, r.state.initialSkill + 1);
});

test('invalid option number keeps you where you are', () => {
  const r = readyCharacter();
  const next = handle(r.state, { type: 'choose', n: 7 });
  assert.equal(next.state.section, 1);
  assert.match(next.speech, /There is no option 7/);
});

test('combat: win a round, then a lucky test doubles the damage', () => {
  let r = readyCharacter({ skill: 10, luck: 12 });
  r = handle(r.state, { type: 'choose', n: 1 }); // to 2
  r = handle(r.state, { type: 'choose', n: 1 }); // to 4, giant rat (skill 5, stamina 5)
  assert.equal(r.state.phase, 'combat');
  r = handle(r.state, 'attack', dice(3, 3, 3, 3)); // 16 vs 11
  assert.equal(r.state.combat.enemies[0].stamina, 3);
  assert.match(r.speech, /test your luck/);
  r = handle(r.state, 'luck', dice(1, 1)); // lucky: 3 -> 1
  assert.equal(r.state.luck, 11);
  assert.equal(r.state.combat.enemies[0].stamina, 1);
  assert.match(r.speech, /A deadly blow/);
  r = handle(r.state, 'attack', dice(3, 3, 3, 3));
  assert.match(r.speech, /You have slain the giant rat/);
  assert.equal(r.state.section, 12);
  assert.ok(r.state.inventory.includes('silver mirror'));
});

test('combat: losing a round costs two stamina, and death ends the game', () => {
  let r = readyCharacter({ skill: 7, stamina: 2 });
  r = handle(r.state, { type: 'choose', n: 1 });
  r = handle(r.state, { type: 'choose', n: 1 });
  r = handle(r.state, 'attack', dice(1, 1, 6, 6)); // 9 vs 17
  assert.equal(r.state.phase, 'dead');
  assert.match(r.speech, /Your adventure ends here/);
  r = handle(r.state, 'yes', seeded(9));
  assert.equal(r.state.phase, 'rolled');
});

test('escape only where allowed, and it costs two stamina', () => {
  let r = readyCharacter();
  r = handle(r.state, { type: 'choose', n: 1 });
  r = handle(r.state, { type: 'choose', n: 1 });
  const noEscape = handle(r.state, 'escape');
  assert.match(noEscape.speech, /no escape/);

  const s = { ...r.state, section: 23, phase: 'section', combat: null };
  r = handle(s, { type: 'choose', n: 1 }); // take shield -> stone knight
  assert.equal(r.state.phase, 'combat');
  const before = r.state.stamina;
  r = handle(r.state, 'escape');
  assert.equal(r.state.stamina, before - 2);
  assert.equal(r.state.section, 29);
});

test('eating restores four stamina, capped, and not during combat', () => {
  let r = readyCharacter();
  r.state.stamina = r.state.initialStamina - 2;
  r = handle(r.state, 'eat');
  assert.equal(r.state.stamina, r.state.initialStamina);
  assert.equal(r.state.provisions, 9);
  r = handle(r.state, 'eat');
  assert.match(r.speech, /already at full stamina/);
  assert.equal(r.state.provisions, 9);
});

test('potion has two doses', () => {
  let r = readyCharacter();
  r.state.stamina = 3;
  r = handle(r.state, 'drink');
  assert.equal(r.state.stamina, r.state.initialStamina);
  r = handle(r.state, 'drink');
  r = handle(r.state, 'drink');
  assert.match(r.speech, /no potion left/);
});

test('test your luck section resolves and costs a luck point', () => {
  let r = readyCharacter({ luck: 9 });
  r = handle(r.state, { type: 'choose', n: 2 });
  assert.equal(r.state.phase, 'test');
  r = handle(r.state, 'luck', dice(6, 6)); // unlucky: fall
  assert.equal(r.state.section, 7);
  assert.match(r.speech, /You are unlucky/);
  r = handle(r.state, 'continue');
  assert.equal(r.state.section, 2);
  assert.equal(r.state.luck, 8);
  assert.equal(r.state.stamina, r.state.initialStamina - 3);
});

test('resuming a saved game on launch', () => {
  let r = readyCharacter();
  r = handle(r.state, { type: 'choose', n: 1 });
  const saved = JSON.parse(JSON.stringify(r.state));
  r = handle(saved, 'launch');
  assert.match(r.speech, /Welcome back/);
  r = handle(r.state, 'yes');
  assert.match(r.speech, /Your adventure continues/);
  assert.equal(r.state.section, 2);
  assert.equal(r.state.awaitingResume, undefined);
});

test('repeat replays the last thing said', () => {
  let r = readyCharacter();
  const last = r.speech;
  r = handle(r.state, 'status');
  r = handle(r.state, 'repeat');
  assert.equal(r.speech, last);
});

test('a stale or corrupt save starts a new game instead of crashing', () => {
  const r = handle({ v: 0, phase: 'section', section: 9999 }, 'launch', seeded(5));
  assert.equal(r.state.phase, 'rolled');
});

test('random bots finish thousands of games without errors, and some win', () => {
  const rng = seeded(2026);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const endings = { won: 0, dead: 0 };
  const visited = new Set();

  for (let game = 0; game < 3000; game++) {
    let r = handle(null, 'launch', rng);
    for (let step = 0; step < 400; step++) {
      const s = r.state;
      assert.ok(r.speech && !/undefined|NaN|\[object/.test(r.speech), `bad speech: ${r.speech}`);
      assert.ok(r.reprompt && !/undefined|NaN/.test(r.reprompt));
      if (s.section) visited.add(s.section);
      if (s.phase === 'won' || s.phase === 'dead') { endings[s.phase]++; break; }

      let action;
      if (s.stamina < s.initialStamina - 4 && s.provisions && s.phase !== 'combat' && rng() < 0.5) action = 'eat';
      else if (s.phase === 'rolled') action = 'yes';
      else if (s.phase === 'potion') action = { type: 'potion', which: pick(['skill', 'strength', 'fortune']) };
      else if (s.phase === 'test') action = s.test === 'luck' ? 'luck' : 'continue';
      else if (s.phase === 'combat') action = rng() < 0.15 ? pick(['luck', 'escape', 'drink', 'status']) : 'attack';
      else if (section(s).next) action = 'continue';
      else action = { type: 'choose', n: 1 + Math.floor(rng() * visibleChoices(s).length) };
      r = handle(s, action, rng);
      assert.ok(step < 399, 'game did not finish');
    }
  }
  assert.equal(endings.won + endings.dead, 3000);
  console.log(`# bot results: ${endings.won} wins, ${endings.dead} deaths`);
  assert.ok(endings.won > 100, `only ${endings.won} wins`);
  assert.deepEqual(
    Object.keys(adventure.sections).map(Number).filter((id) => !visited.has(id)),
    [],
    'every section is visited by some bot',
  );
});

function section(s) {
  return adventure.sections[s.section];
}
