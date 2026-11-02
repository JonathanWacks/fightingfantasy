'use strict';

/**
 * Play the adventure in a terminal, using the same engine as the Alexa skill.
 * Usage: node play.js
 * Type what you'd say to Alexa: "1", "attack", "test my luck", "eat", "status", ...
 */

const readline = require('readline');
const { handle } = require('./engine');
const { parseUtterance } = require('./textInput');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n> ' });
let state = null;

function say(result) {
  state = result.state;
  console.log(`\n${result.speech}`);
  if (result.shouldEnd) { rl.close(); return; }
  rl.prompt();
}

say(handle(state, 'launch'));
rl.on('line', (line) => say(handle(state, parseUtterance(line))));
