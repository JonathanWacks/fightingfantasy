'use strict';

/** Maps typed text to engine actions, roughly mirroring the Alexa interaction model. Used by play.js. */

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

function parseUtterance(raw) {
  const t = String(raw).toLowerCase().trim();
  const n = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine)\b/);
  if (/^(quit|exit|stop|cancel)$/.test(t)) return { type: 'stop' };
  if (/new game|start (again|over)|restart/.test(t)) return { type: 'new' };
  if (/roll again|reroll/.test(t)) return { type: 'reroll' };
  if (/\bluck\b/.test(t)) return { type: 'luck' };
  if (/\btest (my|your) skill\b/.test(t)) return { type: 'continue' };
  const potion = t.match(/\b(skill|strength|fortune)\b/);
  if (potion && t.split(' ').length <= 6) return { type: 'potion', which: potion[1] };
  if (/\b(potion|drink)\b/.test(t)) return { type: 'drink' };
  if (/\b(eat|meal|provisions)\b/.test(t)) return { type: 'eat' };
  if (/\b(attack|fight|strike|hit)\b/.test(t)) return { type: 'attack' };
  if (/\b(escape|flee|run away)\b/.test(t)) return { type: 'escape' };
  if (/status|stats|stamina|how am i/.test(t)) return { type: 'status' };
  if (/inventory|carrying|backpack/.test(t)) return { type: 'inventory' };
  if (/options|choices/.test(t)) return { type: 'options' };
  if (/\b(repeat|again)\b/.test(t)) return { type: 'repeat' };
  if (/help/.test(t)) return { type: 'help' };
  if (/^(yes|yeah|yep|sure|ok|okay)\b/.test(t)) return { type: 'yes' };
  if (/^(no|nope)\b/.test(t)) return { type: 'no' };
  if (/\b(continue|go on|next|carry on|roll|dice|resume)\b/.test(t)) return { type: 'continue' };
  if (n && t.split(' ').length <= 3) return { type: 'choose', n: NUMBERS[n[1]] || Number(n[1]) };
  return t ? { type: 'say', text: t } : { type: 'unknown' };
}

module.exports = { parseUtterance };
