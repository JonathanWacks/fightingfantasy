'use strict';

/**
 * Play the adventure in a terminal, using the same engine as the Alexa skill.
 * Usage: node play.js
 * Type what you'd say to Alexa: "go left", "2", "attack", "test my luck", "eat", "status", ...
 */

const readline = require('readline');
const { handle } = require('./engine');
const { toTerminal } = require('./markup');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n> ' });
let state = null;

function say(result) {
  state = result.state;
  console.log(`\n${toTerminal(result.markup || result.speech)}`);
  if (result.shouldEnd) { rl.close(); return; }
  rl.prompt();
}

say(handle(state, 'launch'));
rl.on('line', (line) => {
  const text = line.trim();
  if (/^(quit|exit)$/i.test(text)) { rl.close(); return; }
  say(handle(state, text ? { type: 'say', text } : 'repeat'));
});
