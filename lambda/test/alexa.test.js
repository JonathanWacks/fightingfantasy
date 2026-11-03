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

const intent = (name, slots = {}, resolutions = {}) => ({
  type: 'IntentRequest',
  intent: {
    name,
    confirmationStatus: 'NONE',
    slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, Object.assign(
      { name: k, value: v, confirmationStatus: 'NONE' },
      resolutions[k] ? { resolutions: { resolutionsPerAuthority: resolutions[k] } } : {},
    )])),
  },
});

async function say(request, attrs) {
  const res = await skill.invoke(envelope(request, attrs, request.type === 'LaunchRequest'));
  return { ssml: res.response.outputSpeech.ssml, attrs: res.sessionAttributes, res };
}

test('full voice flow through the Alexa handler', async () => {
  let r = await say({ type: 'LaunchRequest' });
  assert.match(r.ssml, /^<speak><voice name="Brian">Welcome to Beneath Ashen Tor\./);
  assert.match(r.ssml, /<break time="600ms"\/>/);
  assert.equal(r.res.response.shouldEndSession, false);

  r = await say(intent('AMAZON.YesIntent'), r.attrs);
  assert.match(r.ssml, /choose one magic potion/);

  r = await say(intent('ChoosePotionIntent', { potion: 'fortune' }), r.attrs);
  assert.match(r.ssml, /potion of fortune/);
  assert.equal(r.attrs.game.section, 1);

  const directive = r.res.response.directives.find((d) => d.type === 'Dialog.UpdateDynamicEntities');
  assert.equal(directive.updateBehavior, 'REPLACE');
  assert.equal(directive.types[0].name, 'ChoiceType');
  assert.deepEqual(directive.types[0].values.map((v) => v.id), ['opt1', 'opt2']);

  // Alexa resolved "the crack" to our second dynamic entity.
  r = await say(intent('MakeChoiceIntent', { choice: 'the crack' }, {
    choice: [
      { authority: 'amzn1.er-authority.echo-sdk.amzn1.ask.skill.test.ChoiceType', status: { code: 'ER_SUCCESS_NO_MATCH' } },
      { authority: 'amzn1.er-authority.echo-sdk.dynamic.amzn1.ask.skill.test.ChoiceType', status: { code: 'ER_SUCCESS_MATCH' },
        values: [{ value: { id: 'opt2', name: 'climb the scree towards the crack' } }] },
    ],
  }), r.attrs);
  assert.equal(r.attrs.game.phase, 'test');
  assert.equal(r.res.response.directives[0].updateBehavior, 'CLEAR');

  // Start again at section 1 and answer with plain words and with a number.
  r.attrs.game.section = 1;
  r.attrs.game.phase = 'section';
  r = await say(intent('MakeChoiceIntent', { choice: 'squeeze through the door' }), r.attrs);
  assert.equal(r.attrs.game.section, 2);
  r = await say(intent('OptionsIntent'), r.attrs);
  assert.match(r.ssml, /Option one: take the damp left passage/);
  r.attrs.game.section = 1;
  r = await say(intent('ChooseOptionIntent', { number: '1' }), r.attrs);
  assert.equal(r.attrs.game.section, 2);

  r = await say(intent('StatusIntent'), r.attrs);
  assert.match(r.ssml, /Skill \d+ of \d+/);

  r = await say(intent('ChooseOptionIntent', { number: '?' }), r.attrs);
  assert.match(r.ssml, /didn’t catch that/);

  r = await say(intent('AMAZON.StopIntent'), r.attrs);
  assert.equal(r.res.response.shouldEndSession, true);
  assert.equal((r.res.response.directives || []).length, 0);
});

test('SSML special characters are escaped', () => {
  assert.equal(_internal.toSsml('a & b < c\n\nd'), '<voice name="Brian">a &amp; b &lt; c <break time="600ms"/> d</voice>');
});

test('SessionEndedRequest returns an empty response', async () => {
  const res = await skill.invoke(envelope({ type: 'SessionEndedRequest', reason: 'USER_INITIATED' }));
  assert.equal(res.response.outputSpeech, undefined);
});
