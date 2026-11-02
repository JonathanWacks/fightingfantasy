'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.S3_PERSISTENCE_BUCKET; // run without a store
const { _internal } = require('../index');

const skill = _internal.buildSkill().create();

function envelope(request, sessionAttributes = {}, isNew = false) {
  return {
    version: '1.0',
    session: {
      new: isNew,
      sessionId: 'amzn1.echo-api.session.test',
      application: { applicationId: 'amzn1.ask.skill.test' },
      user: { userId: 'amzn1.ask.account.test' },
      attributes: sessionAttributes,
    },
    context: {
      System: {
        application: { applicationId: 'amzn1.ask.skill.test' },
        user: { userId: 'amzn1.ask.account.test' },
        device: { deviceId: 'device', supportedInterfaces: {} },
        apiEndpoint: 'https://api.amazonalexa.com',
      },
    },
    request: { requestId: 'req', timestamp: new Date().toISOString(), locale: 'en-GB', ...request },
  };
}

const intent = (name, slots = {}) => ({
  type: 'IntentRequest',
  intent: {
    name,
    confirmationStatus: 'NONE',
    slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v, confirmationStatus: 'NONE' }])),
  },
});

async function say(request, attrs) {
  const res = await skill.invoke(envelope(request, attrs, request.type === 'LaunchRequest'));
  return { ssml: res.response.outputSpeech.ssml, attrs: res.sessionAttributes, res };
}

test('full voice flow through the Alexa handler', async () => {
  let r = await say({ type: 'LaunchRequest' });
  assert.match(r.ssml, /^<speak>Welcome to Beneath Ashen Tor\./);
  assert.match(r.ssml, /<break time="600ms"\/>/);
  assert.equal(r.res.response.shouldEndSession, false);

  r = await say(intent('AMAZON.YesIntent'), r.attrs);
  assert.match(r.ssml, /choose one magic potion/);

  r = await say(intent('ChoosePotionIntent', { potion: 'fortune' }), r.attrs);
  assert.match(r.ssml, /potion of fortune/);
  assert.equal(r.attrs.game.section, 1);

  r = await say(intent('ChooseOptionIntent', { number: '1' }), r.attrs);
  assert.equal(r.attrs.game.section, 2);

  r = await say(intent('StatusIntent'), r.attrs);
  assert.match(r.ssml, /Skill \d+ of \d+/);

  r = await say(intent('ChooseOptionIntent', { number: '?' }), r.attrs);
  assert.match(r.ssml, /didn’t catch that/);

  r = await say(intent('AMAZON.StopIntent'), r.attrs);
  assert.equal(r.res.response.shouldEndSession, true);
});

test('SSML special characters are escaped', () => {
  assert.equal(_internal.toSsml('a & b < c\n\nd'), 'a &amp; b &lt; c <break time="600ms"/> d');
});

test('SessionEndedRequest returns an empty response', async () => {
  const res = await skill.invoke(envelope({ type: 'SessionEndedRequest', reason: 'USER_INITIATED' }));
  assert.equal(res.response.outputSpeech, undefined);
});
