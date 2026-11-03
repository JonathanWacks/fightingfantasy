'use strict';

/**
 * A tiny markup layer between the engine and Alexa:
 *
 *   [[sfx:door_creak]]          play a sound (name from sounds.js, or a full URL)
 *   [[sfx:@round]]              play the sound for a game event (sounds.js EVENTS)
 *   [[mood:whisper]]...[[/mood]] deliver text in a mood
 *   [[as:ferryman]]...[[/as]]    speak text in a character's voice
 *
 * toPlain() strips it for cards and the terminal; toSsml() renders it for Alexa.
 */

const { EVENTS, soundUrl } = require('./sounds');

const MOODS = {
  whisper: ['<amazon:effect name="whispered">', '</amazon:effect>'],
  dread: ['<prosody rate="88%">', '</prosody>'],
  tense: ['<prosody rate="108%">', '</prosody>'],
  quiet: ['<prosody volume="soft">', '</prosody>'],
  triumph: ['<prosody rate="105%" volume="loud">', '</prosody>'],
};
const MAX_AUDIO = 5; // Alexa plays at most five audio clips per response
const TOKEN = /\[\[(\/?)(sfx|mood|as)(?::([^\]]*))?\]\]/g;

const sfx = (name) => (name ? `[[sfx:${name}]]` : '');
const mood = (m, text) => (m ? `[[mood:${m}]]${text}[[/mood]]` : text);
const as = (who, text) => `[[as:${who}]]${text}[[/as]]`;

/** Markup for a section's text: string, or a list of narration and { as, say } lines. */
function sectionText(sec, options) {
  const opts = options || {};
  const parts = Array.isArray(sec.text) ? sec.text : [sec.text];
  const body = parts
    .map((p) => (typeof p === 'string' ? p : as(p.as, p.say)))
    .join(' ')
    .replace(/ +/g, ' ');
  return (opts.sound === false ? '' : sfx(sec.sound)) + mood(sec.mood, body);
}

function toPlain(markup) {
  return String(markup).replace(TOKEN, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Split markup into text and audio segments, tracking mood and speaker. */
function segments(markup) {
  const out = [];
  const moods = [];
  const speakers = [];
  let last = 0;
  let m;
  const pushText = (text) => {
    if (text) out.push({ type: 'text', text, mood: moods[moods.length - 1] || null, as: speakers[speakers.length - 1] || null });
  };
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(markup))) {
    pushText(markup.slice(last, m.index));
    last = TOKEN.lastIndex;
    const closing = m[1] === '/';
    const kind = m[2];
    if (kind === 'sfx') out.push({ type: 'audio', name: m[3] });
    else if (kind === 'mood') { if (closing) moods.pop(); else moods.push(m[3]); }
    else if (closing) speakers.pop();
    else speakers.push(m[3]);
  }
  pushText(markup.slice(last));
  return out;
}

/** Terminal view: sounds shown as (♪ name), character lines prefixed with the speaker. */
function toTerminal(markup) {
  const { EVENTS: ev } = require('./sounds');
  return String(markup)
    .replace(/\[\[sfx:([^\]]*)\]\]/g, (m, name) => {
      const n = name.charAt(0) === '@' ? ev[name.slice(1)] : name;
      return n ? ` (\u266a ${n}) ` : '';
    })
    .replace(/\[\[as:([^\]]*)\]\]/g, (m, who) => ` ${who.toUpperCase()}: \u201c`)
    .replace(/\[\[\/as\]\]/g, '\u201d ')
    .replace(/\[\[mood:([^\]]*)\]\]/g, (m, md) => `(${md}) `)
    .replace(/\[\[\/mood\]\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Render markup as SSML (without the <speak> wrapper).
 * options: { narrator: 'Brian' | 'Alexa', voices: { who: 'Matthew' | { name, rate } }, sounds: {...} }
 */
function toSsml(markup, options) {
  const opts = options || {};
  const voices = opts.voices || {};
  let audio = 0;
  const pieces = [];
  let group = null; // consecutive text in the same voice shares one <voice> tag

  const voiceFor = (who) => {
    const v = who ? voices[who] : null;
    const spec = typeof v === 'string' ? { name: v } : (v || {});
    const name = spec.name || opts.narrator || null;
    return { name: name && name !== 'Alexa' ? name : null, rate: spec.rate || null, who };
  };
  const flush = () => {
    if (!group) return;
    let body = group.body.join('');
    if (group.rate) body = `<prosody rate="${group.rate}">${body}</prosody>`;
    pieces.push(group.name ? `<voice name="${group.name}">${body}</voice>` : body);
    group = null;
  };

  segments(markup).forEach((seg) => {
    if (seg.type === 'audio') {
      const name = seg.name && seg.name.charAt(0) === '@' ? EVENTS[seg.name.slice(1)] : seg.name;
      const url = soundUrl(name, opts.sounds);
      if (!url || audio >= MAX_AUDIO) return;
      audio += 1;
      flush();
      pieces.push(`<audio src="${escape(url)}"/>`);
      return;
    }
    let body = escape(seg.text).replace(/\s*\n\n\s*/g, ' <break time="600ms"/> ');
    const wrap = MOODS[seg.mood];
    if (wrap && body.trim()) body = wrap[0] + body + wrap[1];
    const v = voiceFor(seg.as);
    if (!group || group.name !== v.name || group.rate !== v.rate) {
      flush();
      group = { name: v.name, rate: v.rate, body: [] };
    }
    group.body.push(body);
  });
  flush();
  return pieces.join('').replace(/ +/g, ' ').trim();
}

module.exports = { sfx, mood, as, sectionText, toPlain, toSsml, toTerminal, segments, MOODS, MAX_AUDIO };
