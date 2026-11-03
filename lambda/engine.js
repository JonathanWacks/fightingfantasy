'use strict';

/**
 * Gamebook engine. Pure logic, no Alexa dependencies:
 *
 *   handle(state, action, rng) -> { state, speech, reprompt, shouldEnd }
 *
 * `state` is a plain JSON object (safe to persist). `action` is one of:
 *   launch | new | yes | no | continue | choose{n} | say{text, id} | options
 *   attack | escape | luck | eat | drink | potion{which} | reroll | status
 *   inventory | repeat | help | stop | unknown
 * `say` is free speech ("go left", "the iron door"); `id` is an Alexa
 * dynamic-entity id ("opt2") when Alexa resolved one.
 * `rng` returns a float in [0, 1); injectable for tests.
 *
 * The result has `markup` (with sound, mood and voice tags, see markup.js) for
 * Alexa, and `speech`, the same text as plain words. Blank lines ("\n\n")
 * separate paragraphs; Alexa turns them into pauses.
 */

const defaultAdventure = require('./adventure');
const { matchChoice, entitiesFor } = require('./choices');
const { parseUtterance } = require('./textInput');
const { sfx, sectionText, toPlain } = require('./markup');

const STATE_VERSION = 1;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const POTIONS = {
  skill: 'the potion of skill, which restores your skill',
  strength: 'the potion of strength, which restores your stamina',
  fortune: 'the potion of fortune, which restores your luck and raises it by one',
};
const POTION_ORDER = ['skill', 'strength', 'fortune'];
// When an action intent arrives while the player is choosing a path, try it as words.
const CHOICE_WORDS = {
  attack: 'attack fight',
  escape: 'escape run flee',
  continue: 'go on keep going carry on move on',
};

const d6 = (rng) => 1 + Math.floor(rng() * 6);
const roll2 = (rng) => d6(rng) + d6(rng);
const word = (n) => NUMBER_WORDS[n] || String(n);
const clone = (o) => JSON.parse(JSON.stringify(o));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function listOr(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

function listAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function createEngine(adventure = defaultAdventure) {
  const section = (id) => adventure.sections[id];

  // ---------- helpers on state ----------

  function hasItem(s, item) {
    return s.inventory.includes(item);
  }

  function meets(s, req) {
    if (!req) return true;
    if (req.item && !hasItem(s, req.item)) return false;
    if (req.gold && s.gold < req.gold) return false;
    if (req.flag && !s.flags[req.flag]) return false;
    if (req.notFlag && s.flags[req.notFlag]) return false;
    return true;
  }

  function visibleChoices(s) {
    const sec = section(s.section);
    return (sec.choices || []).filter((c) => meets(s, c.requires));
  }

  function adjust(s, stat, amount, raiseInitial) {
    const initKey = `initial${cap(stat)}`;
    if (raiseInitial) s[initKey] += amount;
    s[stat] = Math.min(s[stat] + amount, s[initKey]);
    if (stat !== 'stamina') s[stat] = Math.max(s[stat], 0);
  }

  function applyEffects(s, effects = []) {
    for (const e of effects) {
      for (const stat of ['stamina', 'skill', 'luck']) {
        if (typeof e[stat] === 'number') adjust(s, stat, e[stat], e.raiseInitial);
      }
      if (typeof e.gold === 'number') s.gold = Math.max(0, s.gold + e.gold);
      if (typeof e.provisions === 'number') s.provisions = Math.max(0, s.provisions + e.provisions);
      if (e.addItem && !hasItem(s, e.addItem)) s.inventory.push(e.addItem);
      if (e.removeItem) s.inventory = s.inventory.filter((i) => i !== e.removeItem);
      if (e.setFlag) s.flags[e.setFlag] = true;
    }
  }

  // ---------- prompts ----------

  function choicePrompt(s) {
    const choices = visibleChoices(s).map((c) => c.text);
    return `Will you ${listOr(choices)}?`;
  }

  function numberedOptions(s) {
    const choices = visibleChoices(s);
    return choices.map((c, i) => `Option ${word(i + 1)}: ${c.text}.`).join(' ') +
      ' Answer in your own words, or say the number.';
  }

  function combatPrompt(s) {
    const c = s.combat;
    const opts = ['attack'];
    if (c.lastRound === 'hit' || c.lastRound === 'wounded') opts.push('test your luck');
    if (c.escape) opts.push('escape');
    return `${cap(listOr(opts))}?`;
  }

  function prompt(s) {
    switch (s.phase) {
      case 'rolled':
        return 'Say yes to accept these scores, or say roll again.';
      case 'potion':
        return 'Which potion will you take: skill, strength, or fortune?';
      case 'section': {
        const sec = section(s.section);
        return sec.next ? 'Say continue.' : choicePrompt(s);
      }
      case 'test':
        return s.test === 'luck' ? 'Say test my luck.' : 'Say roll the dice to test your skill.';
      case 'combat':
        return combatPrompt(s);
      case 'dead':
      case 'won':
        return 'Would you like to play again?';
      default:
        return 'Say new game to begin.';
    }
  }

  // ---------- flow ----------

  function newCharacter(rng) {
    const skill = d6(rng) + 6;
    const stamina = roll2(rng) + 12;
    const luck = d6(rng) + 6;
    return {
      v: STATE_VERSION,
      phase: 'rolled',
      section: null,
      skill, initialSkill: skill,
      stamina, initialStamina: stamina,
      luck, initialLuck: luck,
      provisions: 10,
      gold: 0,
      inventory: [],
      flags: {},
      potion: null,
      potionDoses: 0,
      combat: null,
      test: null,
    };
  }

  function rolledSpeech(s) {
    return (
      `I have rolled your adventurer. Your skill is ${s.skill}, your stamina is ${s.stamina}, ` +
      `and your luck is ${s.luck}.`
    );
  }

  function enemyIntro(e) {
    return `${cap(e.name)}: skill ${e.skill}, stamina ${e.stamina}.`;
  }

  function die(s, out) {
    s.phase = 'dead';
    s.combat = null;
    out.push(sfx('@death') + 'Your adventure ends here.');
  }

  /** Move to a section, apply its effects, and set the phase. Returns speech parts. */
  function enter(s, id, out = []) {
    const sec = section(id);
    s.section = id;
    s.combat = null;
    s.test = null;
    out.push(sectionText(sec));
    applyEffects(s, sec.effects);
    if (s.stamina <= 0) {
      die(s, out);
      return out;
    }
    if (sec.ending === 'win') {
      s.phase = 'won';
      out.push(sfx('@win') + 'Congratulations, hero.');
    } else if (sec.ending === 'death') {
      s.phase = 'dead';
      out.push(sfx('@death') + 'Your adventure ends here.');
    } else if (sec.combat) {
      s.phase = 'combat';
      s.combat = {
        enemies: clone(sec.combat.enemies),
        idx: 0,
        win: sec.combat.win,
        escape: sec.combat.escape || null,
        lastRound: null,
      };
      const first = s.combat.enemies[0];
      out.push(
        (sec.sound ? '' : sfx('@combatStart')) +
        (s.combat.enemies.length > 1
          ? `Your foes: ${s.combat.enemies.map(enemyIntro).join(' ')}`
          : enemyIntro(first))
      );
    } else if (sec.testLuck) {
      s.phase = 'test';
      s.test = 'luck';
    } else if (sec.testSkill) {
      s.phase = 'test';
      s.test = 'skill';
    } else {
      s.phase = 'section';
    }
    if (s.phase !== 'won' && s.phase !== 'dead') out.push(prompt(s));
    return out;
  }

  function describe(s) {
    if (s.phase === 'combat') {
      const e = s.combat.enemies[s.combat.idx];
      return [
        `You are fighting the ${e.name}, which has ${e.stamina} stamina left. Your stamina is ${s.stamina}.`,
        prompt(s),
      ];
    }
    if (s.phase === 'section' || s.phase === 'test') return [sectionText(section(s.section), { sound: false }), prompt(s)];
    if (s.phase === 'rolled') return [rolledSpeech(s), prompt(s)];
    if (s.phase === 'potion') return [potionOffer()];
    return [prompt(s)];
  }

  function potionOffer() {
    return (
      'Before you set out, choose one magic potion to carry. It holds two doses. ' +
      `You may take ${listOr(POTION_ORDER.map((p) => POTIONS[p]))}. ` +
      'Say skill, strength, or fortune.'
    );
  }

  function startGame(rng, out) {
    const s = newCharacter(rng);
    out.push(rolledSpeech(s), prompt(s));
    return s;
  }

  // ---------- individual actions ----------

  function testLuck(s, rng) {
    const r = roll2(rng);
    const lucky = r <= s.luck;
    const line = `${sfx('@test')}You roll ${r} against your luck of ${s.luck}. ` +
      (lucky ? `You are lucky!${sfx('@lucky')}` : `You are unlucky.${sfx('@unlucky')}`);
    s.luck = Math.max(0, s.luck - 1);
    return { lucky, line };
  }

  function combatRound(s, rng) {
    const c = s.combat;
    const e = c.enemies[c.idx];
    const mine = roll2(rng) + s.skill;
    const theirs = roll2(rng) + e.skill;
    const out = [`${sfx('@round')}Your attack strength is ${mine}. The ${e.name}'s is ${theirs}.`];
    if (mine > theirs) {
      e.stamina -= 2;
      c.lastRound = 'hit';
      out.push(sfx('@playerHits') + (e.stamina > 0 ? `You wound the ${e.name}. It has ${e.stamina} stamina left.` : `You wound the ${e.name}.`));
    } else if (theirs > mine) {
      s.stamina -= 2;
      c.lastRound = 'wounded';
      out.push(`${sfx('@playerHurt')}The ${e.name} wounds you. Your stamina is ${Math.max(s.stamina, 0)}.`);
    } else {
      c.lastRound = 'draw';
      out.push('You parry each other’s blows.');
    }
    return out;
  }

  /** After any change to combat stamina: resolve deaths, next enemy, or victory. */
  function settleCombat(s, out) {
    const c = s.combat;
    const e = c.enemies[c.idx];
    if (s.stamina <= 0) {
      out.push(`The ${e.name} strikes you down.`);
      die(s, out);
      return out;
    }
    if (e.stamina <= 0) {
      out.push(`You have slain the ${e.name}!`);
      c.idx += 1;
      c.lastRound = null;
      if (c.idx >= c.enemies.length) {
        return enter(s, c.win, out);
      }
      const next = c.enemies[c.idx];
      out.push(`Now the ${next.name} attacks. ${enemyIntro(next)}`);
    }
    out.push(prompt(s));
    return out;
  }

  function combatLuck(s, rng) {
    const c = s.combat;
    const e = c.enemies[c.idx];
    if (c.lastRound !== 'hit' && c.lastRound !== 'wounded') {
      return ['You can only test your luck in battle straight after a wound is struck.', prompt(s)];
    }
    const { lucky, line } = testLuck(s, rng);
    const out = [line];
    if (c.lastRound === 'hit') {
      if (lucky) { e.stamina -= 2; out.push(`A deadly blow! The ${e.name} loses two more stamina.`); }
      else { e.stamina += 1; out.push(`Only a graze. The ${e.name} regains one stamina.`); }
    } else if (lucky) {
      s.stamina = Math.min(s.stamina + 1, s.initialStamina);
      out.push('The blow glances off. You regain one stamina.');
    } else {
      s.stamina -= 1;
      out.push('The blow bites deep. You lose one more stamina.');
    }
    c.lastRound = null;
    out.push(`You have ${s.stamina > 0 ? s.stamina : 0} stamina; the ${e.name} has ${Math.max(e.stamina, 0)}.`);
    return settleCombat(s, out);
  }

  function eat(s) {
    if (s.phase === 'combat') return ['There is no time to eat in the middle of a fight!', prompt(s)];
    if (s.provisions <= 0) return ['You have no provisions left.', prompt(s)];
    if (s.stamina >= s.initialStamina) return ['You are already at full stamina. Save your food for later.', prompt(s)];
    s.provisions -= 1;
    s.stamina = Math.min(s.stamina + 4, s.initialStamina);
    return [
      `You eat a meal. Your stamina is now ${s.stamina}, and you have ${s.provisions} ${s.provisions === 1 ? 'meal' : 'meals'} left.`,
      prompt(s),
    ];
  }

  function drink(s) {
    if (!s.potion || s.potionDoses <= 0) return ['You have no potion left to drink.', prompt(s)];
    s.potionDoses -= 1;
    let line;
    if (s.potion === 'skill') {
      s.skill = s.initialSkill;
      line = `Your skill is restored to ${s.skill}.`;
    } else if (s.potion === 'strength') {
      s.stamina = s.initialStamina;
      line = `Your stamina is restored to ${s.stamina}.`;
    } else {
      s.initialLuck += 1;
      s.luck = s.initialLuck;
      line = `Your luck rises to ${s.luck}.`;
    }
    const left = s.potionDoses ? 'One dose remains.' : 'The flask is empty.';
    return [`${sfx('@drink')}You drink the potion of ${s.potion}. ${line} ${left}`, prompt(s)];
  }

  function status(s) {
    const parts = [
      `Skill ${s.skill} of ${s.initialSkill}. Stamina ${Math.max(s.stamina, 0)} of ${s.initialStamina}. Luck ${s.luck} of ${s.initialLuck}.`,
    ];
    if (s.phase === 'combat') {
      const e = s.combat.enemies[s.combat.idx];
      parts.push(`The ${e.name} has ${e.stamina} stamina.`);
    }
    return parts;
  }

  function inventory(s) {
    const items = [...s.inventory];
    items.unshift('your sword', 'your lantern');
    const extras = [
      `${s.provisions} ${s.provisions === 1 ? 'meal' : 'meals'} of provisions`,
      `${s.gold} gold ${s.gold === 1 ? 'piece' : 'pieces'}`,
    ];
    if (s.potion) {
      extras.push(s.potionDoses ? `the potion of ${s.potion} with ${word(s.potionDoses)} ${s.potionDoses === 1 ? 'dose' : 'doses'} left` : `an empty potion flask`);
    }
    return [`You are carrying ${listAnd(items.concat(extras))}.`];
  }

  function help(s) {
    const general =
      'At any time you can say status, inventory, eat, which uses a meal to restore four stamina, ' +
      'drink potion, repeat, or new game.';
    switch (s && s.phase) {
      case 'combat':
        return [
          'In a fight, each round you and your foe roll two dice and add your skill. Higher wins and ' +
            'deals two stamina damage. Straight after a wound you may test your luck: if lucky, your ' +
            'blow hurts more or theirs hurts less, but each test costs a point of luck.',
          general, prompt(s),
        ];
      case 'test':
        return [
          'To test your luck or skill, I roll two dice. If the total is equal to or less than your score, you succeed. ' +
            'Testing luck always costs one point of luck.',
          prompt(s),
        ];
      case 'rolled':
      case 'potion':
        return [
          'Skill is your fighting ability, stamina is your health, and luck helps you out of tight spots. ' +
            'If your stamina reaches zero, you die.',
          prompt(s),
        ];
      case 'section':
        return [
          'Say what you want to do in your own words, like "take the left passage", or say the number of an option. ' +
            'Say "what are my options" to hear them numbered.',
          general, prompt(s),
        ];
      default:
        return ['Say new game to create an adventurer and begin.'];
    }
  }

  // ---------- dispatcher ----------

  function respond(state, parts, opts = {}) {
    const markup = parts.filter(Boolean).join('\n\n');
    const speech = toPlain(markup);
    const reprompt = opts.reprompt || (state ? prompt(state) : 'Say new game to begin.');
    if (state && !opts.noRemember) {
      state.lastSpeech = markup;
      state.lastReprompt = reprompt;
    }
    return { state, speech, markup, reprompt, shouldEnd: Boolean(opts.end) };
  }

  function inProgress(s) {
    return Boolean(
      s && s.v === STATE_VERSION && s.phase && !['dead', 'won'].includes(s.phase) &&
        (s.section == null || section(s.section))
    );
  }

  function handle(prev, action, rng = Math.random) {
    const a = typeof action === 'string' ? { type: action } : action;
    let s = prev ? clone(prev) : null;
    if (s && !inProgress(s) && !['dead', 'won'].includes(s.phase)) s = null; // stale/corrupt save

    if (a.type === 'stop') {
      return respond(s, ['Farewell, adventurer.'], { end: true, noRemember: true });
    }

    if (a.type === 'launch') {
      if (inProgress(s)) {
        s.awaitingResume = true;
        return respond(s, [
          `Welcome back to ${adventure.title}. Your adventure is still under way. Would you like to continue it? Say yes to carry on, or new game to start again.`,
        ], { reprompt: 'Say yes to continue your adventure, or new game to start again.' });
      }
      const out = [`Welcome to ${adventure.title}.`, adventure.intro];
      s = startGame(rng, out);
      return respond(s, out);
    }

    if (a.type === 'new' || !s) {
      const out = s ? ['Very well, a new adventure begins.'] : [`Welcome to ${adventure.title}.`, adventure.intro];
      s = startGame(rng, out);
      return respond(s, out);
    }

    if (s.awaitingResume) {
      if (a.type === 'yes' || a.type === 'continue') {
        delete s.awaitingResume;
        return respond(s, ['Your adventure continues.', ...describe(s)]);
      }
      if (a.type === 'no') {
        const out = ['Very well, a new adventure begins.'];
        s = startGame(rng, out);
        return respond(s, out);
      }
      delete s.awaitingResume; // any other command just resumes and is handled below
    }

    // Free speech outside a choice: treat it like a typed command ("strength", "attack it").
    if (a.type === 'say' && !(s.phase === 'section' && !section(s.section).next)) {
      const parsed = parseUtterance(a.text || '');
      return handle(prev, parsed.type === 'say' ? { type: 'unknown' } : parsed, rng);
    }

    // While choosing a path, "fight" or "go on" usually arrive as the Attack or Continue
    // commands; if they clearly name one of the choices, take that choice.
    if (CHOICE_WORDS[a.type] && s.phase === 'section' && !section(s.section).next) {
      const m = matchChoice(visibleChoices(s), CHOICE_WORDS[a.type]);
      if (m && m.index !== undefined) return respond(s, enter(s, visibleChoices(s)[m.index].to));
    }

    // Commands that work in any phase.
    switch (a.type) {
      case 'options':
        if (!(s.phase === 'section' && !section(s.section).next)) return respond(s, [prompt(s)], { noRemember: true });
        break;
      case 'repeat':
        return respond(s, [s.lastSpeech || prompt(s)], { reprompt: s.lastReprompt });
      case 'help':
        return respond(s, help(s), { noRemember: true });
      case 'status':
        if (!['rolled', 'potion', 'dead', 'won'].includes(s.phase)) return respond(s, [...status(s), prompt(s)], { noRemember: true });
        break;
      case 'inventory':
        if (!['rolled', 'potion', 'dead', 'won'].includes(s.phase)) return respond(s, [...inventory(s), prompt(s)], { noRemember: true });
        break;
      case 'eat':
        if (!['rolled', 'potion', 'dead', 'won'].includes(s.phase)) return respond(s, eat(s));
        break;
      case 'drink':
        if (!['rolled', 'potion', 'dead', 'won'].includes(s.phase)) return respond(s, drink(s));
        break;
      default:
    }

    switch (s.phase) {
      case 'rolled':
        if (a.type === 'yes' || a.type === 'continue') {
          s.phase = 'potion';
          return respond(s, [potionOffer()]);
        }
        if (a.type === 'reroll' || a.type === 'no') {
          const out = [];
          s = startGame(rng, out);
          out[0] = out[0].replace('I have rolled your adventurer.', 'Rolling again.');
          return respond(s, out);
        }
        break;

      case 'potion': {
        let which = a.type === 'potion' ? a.which : null;
        if (a.type === 'choose' && a.n >= 1 && a.n <= 3) which = POTION_ORDER[a.n - 1];
        if (which && POTIONS[which]) {
          s.potion = which;
          s.potionDoses = 2;
          const out = [
            `You take the potion of ${which}. When you have a choice to make, answer in your own words, ` +
              'or say the number of the option. Now, your adventure begins.',
          ];
          return respond(s, enter(s, adventure.start, out));
        }
        break;
      }

      case 'section': {
        const sec = section(s.section);
        if (sec.next) {
          if (['continue', 'yes', 'choose'].indexOf(a.type) !== -1) return respond(s, enter(s, sec.next));
          break;
        }
        const choices = visibleChoices(s);
        if (a.type === 'options') return respond(s, [numberedOptions(s)], { noRemember: true });
        if (a.type === 'choose') {
          if (a.n >= 1 && a.n <= choices.length) return respond(s, enter(s, choices[a.n - 1].to));
          return respond(s, [`There is no option ${a.n}.`, numberedOptions(s)], { noRemember: true });
        }
        if (a.type === 'yes' && choices.length === 1) return respond(s, enter(s, choices[0].to));
        if (a.type === 'say') {
          const m = matchChoice(choices, a.text, a.id);
          if (m && m.index !== undefined) return respond(s, enter(s, choices[m.index].to));
          if (m && m.ambiguous && m.ambiguous.every((i) => choices[i].to === choices[m.ambiguous[0]].to)) {
            return respond(s, enter(s, choices[m.ambiguous[0]].to));
          }
          if (m && m.ambiguous) {
            const which = m.ambiguous.map((i) => choices[i].text);
            return respond(s, [`Do you mean ${listOr(which)}?`], { noRemember: true, reprompt: numberedOptions(s) });
          }
          if (a.type === 'say') {
            const parsed = parseUtterance(a.text || '');
            if (parsed.type !== 'say' && parsed.type !== 'unknown') return handle(prev, parsed, rng);
          }
          return respond(s, ['Sorry, I\u2019m not sure which you mean.', numberedOptions(s)], { noRemember: true });
        }
        break;
      }

      case 'test':
        if (s.test === 'luck' && ['luck', 'continue', 'yes', 'choose'].includes(a.type)) {
          const { lucky, line } = testLuck(s, rng);
          const t = section(s.section).testLuck;
          return respond(s, enter(s, lucky ? t.lucky : t.unlucky, [line]));
        }
        if (s.test === 'skill' && ['continue', 'yes', 'choose', 'luck'].includes(a.type)) {
          if (a.type === 'luck') return respond(s, ['This is a test of skill, not luck.', prompt(s)], { noRemember: true });
          const r = roll2(rng);
          const pass = r <= s.skill;
          const t = section(s.section).testSkill;
          const line = `${sfx('@test')}You roll ${r} against your skill of ${s.skill}. ` +
            (pass ? `You succeed!${sfx('@lucky')}` : `You fail.${sfx('@unlucky')}`);
          return respond(s, enter(s, pass ? t.pass : t.fail, [line]));
        }
        break;

      case 'combat':
        if (a.type === 'attack' || a.type === 'continue' || a.type === 'yes') {
          return respond(s, settleCombat(s, combatRound(s, rng)));
        }
        if (a.type === 'luck') return respond(s, combatLuck(s, rng));
        if (a.type === 'escape') {
          if (!s.combat.escape) return respond(s, ['There is no escape from this fight!', prompt(s)], { noRemember: true });
          s.stamina -= 2;
          const out = ['You turn and run, taking a wound as you go. You lose two stamina.'];
          if (s.stamina <= 0) { die(s, out); return respond(s, out); }
          return respond(s, enter(s, s.combat.escape, out));
        }
        break;

      case 'dead':
      case 'won':
        if (a.type === 'yes' || a.type === 'continue' || a.type === 'reroll') {
          const out = ['A new adventure begins.'];
          s = startGame(rng, out);
          return respond(s, out);
        }
        if (a.type === 'no') {
          return respond(s, ['Farewell, adventurer.'], { end: true, noRemember: true });
        }
        break;

      default:
    }

    const sorry = a.type === 'unknown' ? 'Sorry, I didn’t catch that.' : 'You can’t do that right now.';
    return respond(s, [sorry, prompt(s)], { noRemember: true });
  }

  /** Dynamic entities for the choices the player can make right now (empty if none). */
  function choiceEntities(s) {
    if (!s || s.phase !== 'section' || s.awaitingResume || section(s.section).next) return [];
    return entitiesFor(visibleChoices(s));
  }

  return { handle, prompt, visibleChoices, choiceEntities, newCharacter, enter, STATE_VERSION };
}

module.exports = Object.assign({ createEngine: createEngine }, createEngine());
