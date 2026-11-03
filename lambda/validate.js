'use strict';

/**
 * Checks an adventure for broken links, dead ends and unreachable sections.
 * Usage: node validate.js   (exits non-zero on errors)
 */

const { soundUrl } = require('./sounds');
const { MOODS } = require('./markup');

function validate(adventure) {
  const errors = [];
  const warnings = [];
  const { sections } = adventure;
  const ids = Object.keys(sections).map(Number);
  const exists = (id) => Object.prototype.hasOwnProperty.call(sections, id);

  if (!exists(adventure.start)) errors.push(`start section ${adventure.start} does not exist`);

  const links = (sec) => {
    const out = [];
    if (sec.next != null) out.push(sec.next);
    (sec.choices || []).forEach((c) => out.push(c.to));
    if (sec.combat) { out.push(sec.combat.win); if (sec.combat.escape != null) out.push(sec.combat.escape); }
    if (sec.testLuck) out.push(sec.testLuck.lucky, sec.testLuck.unlucky);
    if (sec.testSkill) out.push(sec.testSkill.pass, sec.testSkill.fail);
    return out;
  };

  for (const id of ids) {
    const sec = sections[id];
    const parts = Array.isArray(sec.text) ? sec.text : [sec.text];
    if (!sec.text || !parts.length) errors.push(`${id}: missing text`);
    parts.forEach((p) => {
      if (typeof p === 'string') return;
      if (!p || typeof p.say !== 'string' || !p.as) errors.push(`${id}: character lines need { as, say }`);
      else if (!(adventure.voices || {})[p.as]) errors.push(`${id}: no voice called "${p.as}" in voices`);
    });
    if (sec.sound && !soundUrl(sec.sound, adventure.sounds)) errors.push(`${id}: unknown sound "${sec.sound}"`);
    if (sec.mood && !MOODS[sec.mood]) errors.push(`${id}: unknown mood "${sec.mood}" (use ${Object.keys(MOODS).join(', ')})`);
    const kinds = ['choices', 'next', 'combat', 'testLuck', 'testSkill', 'ending'].filter((k) => sec[k] != null);
    if (kinds.length !== 1) errors.push(`${id}: must have exactly one of choices/next/combat/testLuck/testSkill/ending (has ${kinds.join(', ') || 'none'})`);
    if (sec.choices) {
      if (sec.choices.length === 0) errors.push(`${id}: empty choices`);
      if (sec.choices.length > 9) errors.push(`${id}: more than nine choices`);
      if (!sec.choices.some((c) => !c.requires)) errors.push(`${id}: every choice has a requirement, so the player could get stuck`);
      const owner = {};
      sec.choices.forEach((c, i) => {
        if (c.say !== undefined && !Array.isArray(c.say)) errors.push(`${id}: choice ${i + 1} "say" must be a list of phrases`);
        (c.say || []).forEach((p) => {
          const key = String(p).toLowerCase().trim();
          if (owner[key] !== undefined && sec.choices[owner[key]].to !== c.to) {
            warnings.push(`${id}: "${p}" is listed for two different choices; players saying it will be asked which they mean`);
          }
          owner[key] = i;
        });
      });
    }
    if (sec.ending && !['win', 'death'].includes(sec.ending)) errors.push(`${id}: unknown ending ${sec.ending}`);
    for (const to of links(sec)) if (!exists(to)) errors.push(`${id}: links to missing section ${to}`);
  }

  const seen = new Set();
  const stack = [adventure.start];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !exists(id)) continue;
    seen.add(id);
    stack.push(...links(sections[id]));
  }
  for (const id of ids) if (!seen.has(id)) warnings.push(`${id}: unreachable`);
  if (!ids.some((id) => sections[id].ending === 'win')) errors.push('no winning ending');

  return { errors, warnings };
}

module.exports = { validate };

if (require.main === module) {
  const { errors, warnings } = validate(require('./adventure'));
  warnings.forEach((w) => console.warn(`warning: ${w}`));
  errors.forEach((e) => console.error(`error: ${e}`));
  if (errors.length) process.exit(1);
  console.log('Adventure OK');
}
