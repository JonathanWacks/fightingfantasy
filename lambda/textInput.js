'use strict';

/** Maps typed text to engine actions, roughly mirroring the Alexa interaction model. Used by play.js. */

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

function parseUtterance(raw) {
  const t = String(raw).toLowerCase().trim();
  const n = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine)\b/);
  if (/^(quit|exit|stop|cancel)$/.test(t)) return { type: 'stop' };
  if (/new game|start (again|over)|restart/.test(t)) return { type: 'new' };
  if (/roll again|reroll/.test(t)) return { type: 'reroll' };
  if (/luck/.test(t)) return { type: 'luck' };
  if (/^(skill|strength|fortune)$/.test(t)) return { type: 'potion', which: t };
  if (/potion|drink/.test(t)) return { type: 'drink' };
  if (/\beat\b|meal|provisions/.test(t)) return { type: 'eat' };
  if (/attack|fight|strike|hit/.test(t)) return { type: 'attack' };
  if (/escape|flee|run away/.test(t)) return { type: 'escape' };
  if (/status|stats|stamina|how am i/.test(t)) return { type: 'status' };
  if (/inventory|carrying|backpack/.test(t)) return { type: 'inventory' };
  if (/repeat|again|what\?/.test(t)) return { type: 'repeat' };
  if (/help/.test(t)) return { type: 'help' };
  if (/^(yes|yeah|yep|sure|ok|okay)\b/.test(t)) return { type: 'yes' };
  if (/^(no|nope)\b/.test(t)) return { type: 'no' };
  if (/continue|go on|next|carry on|roll|dice|resume/.test(t)) return { type: 'continue' };
  if (n) return { type: 'choose', n: NUMBERS[n[1]] || Number(n[1]) };
  return { type: 'unknown' };
}

module.exports = { parseUtterance };
