'use strict';

/**
 * Natural-language choices.
 *
 * Each choice can list extra phrases the player might say:
 *   { text: 'creep towards the torchlight', to: 5, say: ['torchlight', 'right'] }
 * Choices without `say` still work: their own words are used.
 *
 * - entitiesFor(choices) builds the values sent to Alexa as dynamic entities.
 * - matchChoice(choices, utterance) finds which choice the player meant.
 */

const STOPWORDS = new Set((
  'a an the and or to of on in into onto at by for from with without towards toward ' +
  'your you yours my me i it its it\'s this that these those them they their there ' +
  'will shall would want wanna let lets let\'s go going try please then just now ' +
  'up down out off over through across along away back instead again some any'
).split(' '));
// Directions are meaningful on their own even though some are also prepositions above.
const KEEP = new Set(['up', 'down', 'back', 'left', 'right', 'north', 'south', 'east', 'west', 'forward', 'across', 'through']);

const ORDINALS = {
  first: 1, one: 1, '1st': 1,
  second: 2, two: 2, '2nd': 2,
  third: 3, three: 3, '3rd': 3,
  fourth: 4, four: 4, '4th': 4,
  fifth: 5, five: 5, '5th': 5,
};

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, '\'')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(text) {
  return normalise(text).split(' ').filter((w) => w && (KEEP.has(w) || !STOPWORDS.has(w)));
}

/** Light stemming so "goblins" matches "goblin" and "climbing" matches "climb". */
function stem(word) {
  const s = word.replace(/(ing|ed)$/, '').replace(/s$/, '').replace(/e$/, '');
  return s.length >= 3 ? s : word;
}

/** Phrase after the last article: "squeeze through the iron door" -> "iron door". */
function tailPhrase(text) {
  const words = normalise(text).split(' ');
  let i = -1;
  words.forEach((w, idx) => { if (w === 'the' || w === 'a' || w === 'an') i = idx; });
  const tail = words.slice(i + 1);
  // Only multi-word tails ("iron door"): a lone noun like "goblins" is too vague to own.
  return i >= 0 && tail.length >= 2 && tail.length <= 3 ? tail.join(' ') : null;
}

function phrasesFor(choice, withTail) {
  const out = [];
  const add = (p) => { const n = normalise(p); if (n && out.indexOf(n) === -1) out.push(n); };
  add(choice.text);
  (choice.say || []).forEach(add);
  if (withTail !== false) {
    const tail = tailPhrase(choice.text);
    if (tail) add(tail);
  }
  return out;
}

/** Dynamic-entity values for Alexa. Ids are 1-based positions: "opt1", "opt2"... */
function entitiesFor(choices) {
  return choices.map((c, i) => {
    const phrases = phrasesFor(c);
    return {
      id: 'opt' + (i + 1),
      name: { value: phrases[0], synonyms: phrases.slice(1).slice(0, 20) },
    };
  });
}

/**
 * Returns { index } (0-based) for a clear match, { ambiguous: [indexes] } for a tie,
 * or null when nothing matches.
 */
function matchChoice(choices, utterance, entityId) {
  if (entityId) {
    const m = /^opt(\d+)$/.exec(entityId);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= choices.length) return { index: Number(m[1]) - 1 };
  }
  const said = normalise(utterance);
  if (!said) return null;

  // "the first one", "the last one", "number two"
  const words = said.split(' ');
  if (words.indexOf('last') !== -1 && words.length <= 4) return { index: choices.length - 1 };
  for (const w of words) {
    if (ORDINALS[w] && words.length <= 4 && ORDINALS[w] <= choices.length) return { index: ORDINALS[w] - 1 };
  }
  const n = parseInt(said, 10);
  if (!Number.isNaN(n) && String(n) === said && n >= 1 && n <= choices.length) return { index: n - 1 };

  // Exact phrase hits are strongest.
  const exact = [];
  choices.forEach((c, i) => {
    if (phrasesFor(c, false).some((p) => said === p || (' ' + said + ' ').indexOf(' ' + p + ' ') !== -1)) exact.push(i);
  });
  if (exact.length === 1) return { index: exact[0] };

  // Otherwise score by shared content words.
  const saidStems = contentWords(said).map(stem);
  if (!saidStems.length) return null;
  const pool = exact.length > 1 ? exact : choices.map((c, i) => i);
  const scores = pool.map((i) => {
    const vocab = new Set();
    phrasesFor(choices[i]).forEach((p) => contentWords(p).forEach((w) => vocab.add(stem(w))));
    return saidStems.filter((w) => vocab.has(w)).length;
  });
  const best = Math.max.apply(null, scores);
  if (best <= 0) return exact.length > 1 ? { ambiguous: exact } : null;
  const winners = pool.filter((i, k) => scores[k] === best);
  return winners.length === 1 ? { index: winners[0] } : { ambiguous: winners };
}

module.exports = { entitiesFor, matchChoice, normalise, phrasesFor };
