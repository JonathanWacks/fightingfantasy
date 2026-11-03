'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adventure = require('../adventure');
const { handle, visibleChoices } = require('../engine');
const { toSsml, toPlain, sectionText, MAX_AUDIO } = require('../markup');
const fs = require('fs');
const path = require('path');
const { SOUND_FILES, EVENTS, soundUrl } = require('../sounds');

const opts = { narrator: 'Brian', voices: adventure.voices, sounds: adventure.sounds };

/** Minimal well-formedness check: tags balance and nest, only allowed tags, quoted attrs. */
function checkSsml(ssml) {
  const stack = [];
  const re = /<(\/?)([a-z:]+)((?:\s+[a-z]+="[^"<>]*")*)\s*(\/?)>/g;
  let m;
  let audio = 0;
  const stripped = ssml.replace(re, (all, close, tag, attrs, selfClose) => {
    assert.ok(['voice', 'audio', 'break', 'prosody', 'amazon:effect'].includes(tag), `unexpected tag ${tag}`);
    if (tag === 'audio') {
      audio += 1;
      assert.ok(!stack.includes('voice'), 'audio must not be inside a voice tag');
      assert.match(attrs, /src="https:\/\/cdn\.jsdelivr\.net\/gh\/JonathanWacks\/fightingfantasy@[0-9a-f]{40}\/audio\/[a-z_]+\.mp3"/);
    }
    if (selfClose) return '';
    if (close) assert.equal(stack.pop(), tag, `mismatched </${tag}> in ${ssml}`);
    else {
      if (tag === 'voice') assert.ok(!stack.includes('voice'), 'nested voice tags');
      stack.push(tag);
    }
    return '';
  });
  assert.deepEqual(stack, [], 'unclosed tags');
  assert.ok(!/[<>]/.test(stripped), `stray angle bracket in ${ssml}`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(stripped), 'unescaped ampersand');
  assert.ok(!/\[\[/.test(stripped), 'markup left in output');
  assert.ok(audio <= MAX_AUDIO, `${audio} audio clips`);
  return audio;
}

test('every named sound has an Alexa-ready MP3 in audio/', () => {
  const dir = path.join(__dirname, '..', '..', 'audio');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(files, SOUND_FILES.slice().sort(), 'audio/ and SOUND_FILES must list the same sounds');
  for (const name of SOUND_FILES) {
    assert.match(soundUrl(name), /^https:\/\/.+\/audio\/[a-z_]+\.mp3$/);
    const head = fs.readFileSync(path.join(dir, name + '.mp3')).subarray(0, 4);
    // MPEG-2 Layer III frame sync at 24 kHz: 0xFF 0xF3
    assert.ok(head[0] === 0xff && (head[1] & 0xe0) === 0xe0, `${name}.mp3 is not an MP3`);
  }
  for (const name of Object.values(EVENTS)) if (name) assert.ok(SOUND_FILES.includes(name), `event sound ${name}`);
  assert.equal(soundUrl('no_such_sound'), null);
  assert.equal(soundUrl('soundbank://soundlibrary/x/y'), 'soundbank://soundlibrary/x/y');
});

test('SOUND_BASE_URL moves where sounds are served from', () => {
  process.env.SOUND_BASE_URL = 'https://example.org/sfx/';
  try { assert.equal(soundUrl('wind'), 'https://example.org/sfx/wind.mp3'); }
  finally { delete process.env.SOUND_BASE_URL; }
});

test('narration, character voices, moods and sounds render as valid SSML', () => {
  const ssml = toSsml(sectionText(adventure.sections[38]), opts);
  checkSsml(ssml);
  assert.match(ssml, /^<audio src="https:\/\/cdn\.jsdelivr\.net\/gh\/JonathanWacks\/fightingfantasy@[0-9a-f]{40}\/audio\/thunder\.mp3"\/>/);
  assert.match(ssml, /<voice name="Brian"><prosody rate="88%">You step into the crypt/);
  assert.match(ssml, /<voice name="Matthew"><prosody rate="80%"><prosody rate="88%">Who wakes me\?/);
  assert.equal(toPlain(sectionText(adventure.sections[38])).indexOf('[['), -1);
});

test('Alexa voice mode emits no voice tags', () => {
  const ssml = toSsml(sectionText(adventure.sections[14]), { narrator: 'Alexa' });
  assert.equal(ssml, '<amazon:effect name="whispered">You hold your breath and edge along the wall, keeping to the shadows.</amazon:effect>');
});

test('audio is capped at five clips per response', () => {
  const ssml = toSsml('[[sfx:hit]]a[[sfx:hit]]b[[sfx:hit]]c[[sfx:hit]]d[[sfx:hit]]e[[sfx:hit]]f', opts);
  assert.equal(checkSsml(ssml), 5);
  assert.match(ssml, /f<\/voice>$/);
});

test('thousands of random responses all render valid SSML within Alexa limits', () => {
  let a = 99;
  const rng = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  let responses = 0;
  let clips = 0;
  for (let game = 0; game < 600; game++) {
    let r = handle(null, 'launch', rng);
    for (let step = 0; step < 300 && !['won', 'dead'].includes(r.state.phase); step++) {
      const s = r.state;
      let action;
      if (s.phase === 'rolled') action = 'yes';
      else if (s.phase === 'potion') action = { type: 'potion', which: 'strength' };
      else if (s.phase === 'test') action = s.test === 'luck' ? 'luck' : 'continue';
      else if (s.phase === 'combat') action = rng() < 0.2 ? 'luck' : 'attack';
      else if (adventure.sections[s.section].next) action = 'continue';
      else action = { type: 'choose', n: 1 + Math.floor(rng() * visibleChoices(s).length) };
      r = handle(s, rng() < 0.05 ? 'repeat' : action, rng);
      const ssml = toSsml(r.markup, opts);
      clips += checkSsml(ssml);
      assert.ok(ssml.length < 7500, 'response too long for Alexa');
      responses += 1;
    }
  }
  assert.ok(responses > 5000 && clips > 3000, `${responses} responses, ${clips} clips`);
});
