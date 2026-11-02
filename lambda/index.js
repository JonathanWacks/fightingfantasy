'use strict';

/**
 * Alexa skill entry point. Translates Alexa requests into engine actions and
 * engine output into speech. The game is saved after every turn when a
 * persistence store is available (Alexa-hosted skills get an S3 bucket
 * automatically), so players can stop and resume later.
 */

const Alexa = require('ask-sdk-core');
const { handle } = require('./engine');
const adventure = require('./adventure');

const STATE_KEY = 'game';

// ---------- persistence ----------

function buildPersistenceAdapter() {
  try {
    if (process.env.S3_PERSISTENCE_BUCKET) {
      const { S3PersistenceAdapter } = require('ask-sdk-s3-persistence-adapter');
      return new S3PersistenceAdapter({ bucketName: process.env.S3_PERSISTENCE_BUCKET });
    }
    if (process.env.DYNAMODB_PERSISTENCE_TABLE_NAME) {
      const { DynamoDbPersistenceAdapter } = require('ask-sdk-dynamodb-persistence-adapter');
      return new DynamoDbPersistenceAdapter({ tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME, createTable: false });
    }
  } catch (err) {
    console.warn('Persistence unavailable, games will not be saved between sessions:', err.message);
  }
  return null;
}

function loadState(handlerInput) {
  const am = handlerInput.attributesManager;
  const session = am.getSessionAttributes();
  if (session[STATE_KEY] !== undefined) return Promise.resolve(session[STATE_KEY]);
  return Promise.resolve()
    .then(() => am.getPersistentAttributes())
    .then((persistent) => (persistent && persistent[STATE_KEY]) || null)
    .catch(() => null) // no adapter configured, or the store is unreachable: play without saving
    .then((state) => {
      session[STATE_KEY] = state;
      am.setSessionAttributes(session);
      return state;
    });
}

function saveState(handlerInput, state) {
  const am = handlerInput.attributesManager;
  const session = am.getSessionAttributes();
  session[STATE_KEY] = state;
  am.setSessionAttributes(session);
  return Promise.resolve()
    .then(() => {
      const persistent = {};
      persistent[STATE_KEY] = state;
      am.setPersistentAttributes(persistent);
      return am.savePersistentAttributes();
    })
    .catch(() => {}); // persistence not configured; the session still holds the game
}

// ---------- speech ----------

function escapeSsml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toSsml(text) {
  return escapeSsml(text).replace(/\n\n/g, ' <break time="600ms"/> ');
}

// ---------- request -> action ----------

function slotValue(handlerInput, name) {
  const slot = Alexa.getSlot(handlerInput.requestEnvelope, name);
  if (!slot) return null;
  const authorities = (slot.resolutions && slot.resolutions.resolutionsPerAuthority) || [];
  const resolved = authorities[0];
  if (resolved && resolved.status && resolved.status.code === 'ER_SUCCESS_MATCH') {
    return resolved.values[0].value.id || resolved.values[0].value.name;
  }
  return slot.value || null;
}

const INTENT_ACTIONS = {
  AttackIntent: 'attack',
  EscapeIntent: 'escape',
  TestLuckIntent: 'luck',
  EatIntent: 'eat',
  DrinkPotionIntent: 'drink',
  StatusIntent: 'status',
  InventoryIntent: 'inventory',
  RollAgainIntent: 'reroll',
  NewGameIntent: 'new',
  ContinueIntent: 'continue',
  'AMAZON.YesIntent': 'yes',
  'AMAZON.NoIntent': 'no',
  'AMAZON.RepeatIntent': 'repeat',
  'AMAZON.HelpIntent': 'help',
  'AMAZON.StartOverIntent': 'new',
  'AMAZON.NextIntent': 'continue',
  'AMAZON.StopIntent': 'stop',
  'AMAZON.CancelIntent': 'stop',
  'AMAZON.NavigateHomeIntent': 'stop',
  'AMAZON.FallbackIntent': 'unknown',
};

function toAction(handlerInput) {
  const env = handlerInput.requestEnvelope;
  const type = Alexa.getRequestType(env);
  if (type === 'LaunchRequest') return { type: 'launch' };
  if (type !== 'IntentRequest') return { type: 'unknown' };
  const intent = Alexa.getIntentName(env);
  if (intent === 'ChooseOptionIntent') {
    const n = parseInt(slotValue(handlerInput, 'number'), 10);
    return Number.isNaN(n) ? { type: 'unknown' } : { type: 'choose', n };
  }
  if (intent === 'ChoosePotionIntent') {
    const which = (slotValue(handlerInput, 'potion') || '').toLowerCase();
    return which ? { type: 'potion', which } : { type: 'unknown' };
  }
  return { type: INTENT_ACTIONS[intent] || 'unknown' };
}

// ---------- handlers ----------

const GameHandler = {
  canHandle(handlerInput) {
    const type = Alexa.getRequestType(handlerInput.requestEnvelope);
    return type === 'LaunchRequest' || type === 'IntentRequest';
  },
  handle(handlerInput) {
    const action = toAction(handlerInput);
    let result;
    return loadState(handlerInput)
      .then((state) => {
        result = handle(state, action);
        return saveState(handlerInput, result.state);
      })
      .then(() => respondWith(handlerInput, result));
  },
};

function respondWith(handlerInput, result) {
  const rb = handlerInput.responseBuilder
    .speak(toSsml(result.speech))
    .withSimpleCard(adventure.title, result.speech.replace(/\n\n/g, '\n'));
  if (!result.shouldEnd) rb.reprompt(toSsml(result.reprompt));
  else rb.withShouldEndSession(true);
  return rb.getResponse();
}

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error('Error handling request:', error);
    return handlerInput.responseBuilder
      .speak('Sorry, something went wrong in the depths of the tor. Please try that again.')
      .reprompt('Please try again.')
      .getResponse();
  },
};

function buildSkill() {
  const builder = Alexa.SkillBuilders.custom()
    .addRequestHandlers(GameHandler, SessionEndedRequestHandler)
    .addErrorHandlers(ErrorHandler)
    .withCustomUserAgent('beneath-ashen-tor/1.0');
  const adapter = buildPersistenceAdapter();
  if (adapter) builder.withPersistenceAdapter(adapter);
  return builder;
}

exports.handler = buildSkill().lambda();
exports._internal = { toAction, toSsml, buildSkill };
