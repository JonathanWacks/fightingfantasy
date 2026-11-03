# Beneath Ashen Tor — a voice gamebook for Alexa

An Alexa skill for playing a classic dice-and-paper style fantasy gamebook by voice. You roll **skill**, **stamina** and **luck**, pick a magic potion, then make your way beneath Ashen Tor to take the Dawnstone from the necromancer Malgrath. Along the way you fight monsters round by round, test your luck, eat provisions and collect items that open new paths.

> "Alexa, open ashen tor"

The adventure is original. The rules follow the familiar 1980s gamebook system.

## How to play

| Say | What happens |
|---|---|
| **yes** / **roll again** | Accept your rolled scores, or reroll them |
| **skill**, **strength** or **fortune** | Choose your potion (two doses) |
| **go left**, **the iron door**, **attack the goblins**… | Choose a path in your own words |
| **one**, **two**, **the last one**… | …or by number (the order Alexa read them) |
| **what are my options** | Hear the choices as a numbered list |
| **continue** | Move on when there is only one way forward |
| **attack** | Fight one combat round |
| **test my luck** | In a test-your-luck section; or straight after a wound in combat to make your blow hurt more (or theirs hurt less) |
| **escape** | Run from a fight, where that is allowed (costs 2 stamina) |
| **eat** | Eat a meal: +4 stamina (not during a fight) |
| **drink potion** | Use a dose of your potion |
| **status** / **inventory** | Hear your scores, or what you're carrying |
| **repeat**, **help**, **new game**, **stop** | Just what they say |

**Rules:** skill is 1d6+6, stamina 2d6+12, luck 1d6+6. In each combat round, you and your foe each roll 2d6 and add your skill. The higher total wounds the other for 2 stamina. To test your luck (or skill), roll 2d6: a total at or under your score succeeds. Every luck test costs 1 luck. At 0 stamina, you die.

Your game is saved after every turn. Next time you open the skill, it asks whether to carry on.

## Deploy as an Alexa-hosted skill (free, no AWS account)

1. Open the [Alexa developer console](https://developer.amazon.com/alexa/console/ask) and click **Create Skill**.
2. Name it *Beneath Ashen Tor*. Choose **English (UK)** or **English (US)**, the **Custom** model and **Alexa-Hosted (Node.js)**.
3. On the template page, choose **Import skill** and enter `https://github.com/JonathanWacks/fightingfantasy.git`.
4. When it's created, open the **Build** tab and click **Build model**.
5. In the **Test** tab, enable testing in *Development*. Then type or say "open ashen tor". The skill also works on any Echo signed in to the same Amazon account.

Alexa-hosted skills come with an S3 bucket (`S3_PERSISTENCE_BUCKET`), which the skill uses automatically to save games. If you host on your own Lambda instead, set that environment variable to a bucket the function can write to, or set `DYNAMODB_PERSISTENCE_TABLE_NAME` and add `ask-sdk-dynamodb-persistence-adapter`. Without either, the game still works but only lasts one session.

## Voices and sound

The story is read by a narrator voice: Amazon Polly's **Brian**, set by `narrator` in `adventure.js`. Characters can speak in voices of their own; in Ashen Tor the ferryman and Malgrath do. To go back to Alexa's own voice, set `narrator: 'Alexa'`, or add a `NARRATOR_VOICE` environment variable to the Lambda.

The engine plays sound effects from the Alexa Skills Kit Sound Library on game events. For example, there's a drum roll before every luck or skill test, a chime when you're lucky, a swish and thud each combat round, a bugle when you win and a tolling bell when you die. Sections can add their own sound and mood. All the sounds are listed in `lambda/sounds.js`, and you can swap any of them. To hear one first, paste `<speak><audio src="soundbank://soundlibrary/..."/></speak>` into the Test tab. Set an `EVENTS` entry to `null` to silence that event.

Alexa plays at most five sound clips in one response, so the renderer stops adding clips after the fifth.

## How spoken choices work

Alexa reads the choices naturally: *"Will you take the damp left passage, or creep towards the torchlight?"* Each time, the skill sends the current choices to Alexa as **dynamic entities** (`Dialog.UpdateDynamicEntities`). That biases Alexa's recognition towards those phrases, so "the torchlight", "go right" or "creep towards the torch" resolve to the right option. The engine then double-checks the words itself:

1. an option Alexa matched, or a number or ordinal ("two", "the last one")
2. an exact phrase from the choice's text or `say` list
3. the most shared words ("head for the torch" → torchlight)
4. a command such as "status" or "eat"
5. otherwise Alexa reads the numbered list

If two different choices fit equally well, Alexa asks "Do you mean … or …?". "Fight" and "go on" also pick a choice when one clearly matches, even though Alexa hears them as the Attack and Continue commands.

## Project layout

```
lambda/
  index.js        Alexa request handlers (ASK SDK v2) and save/load
  engine.js       the game rules — pure logic, no Alexa code
  choices.js      matching spoken answers to choices; dynamic-entity values
  markup.js       sound / mood / voice tags, rendered to SSML (or plain text)
  sounds.js       sound-effect names and the sounds played on game events
  adventure.js    the story: numbered sections, choices, fights, tests
  validate.js     checks the story for broken links and dead ends
  play.js         play in a terminal using the same engine
  test/           unit tests, random-bot playthroughs, Alexa request tests
skill-package/
  skill.json                          manifest
  interactionModels/custom/*.json     voice model (en-GB, en-US)
```

## Develop locally

```bash
cd lambda
npm install
npm test        # validate the adventure + run all tests
npm run play    # play in the terminal: type "1", "attack", "test my luck"…
```

## Writing your own adventure

Edit `lambda/adventure.js`. Each section has `text`, optional `effects`, and **exactly one** of these:

```js
choices:   [{ text: 'open the gate', to: 18, requires: { item: 'silver key' }, say: ['gate', 'use the key'] }]
next:      23                                   // player says "continue"
combat:    { enemies: [{ name: 'wraith', skill: 8, stamina: 7 }], win: 38, escape: 29 }
testLuck:  { lucky: 31, unlucky: 32 }
testSkill: { pass: 13, fail: 15 }
ending:    'win' | 'death'
```

Sound, mood and character voices:

```js
{
  sound: 'door_creak',                      // played on arrival (names in sounds.js, or a soundbank:// URL)
  mood: 'whisper',                          // whisper | dread | tense | quiet | triumph
  text: [
    'He holds out a bony hand, and rasps:',
    { as: 'ferryman', say: 'Five gold to cross.' },   // spoken in voices.ferryman
  ],
}
```

At the top of the adventure, `narrator: 'Brian'` and `voices: { ferryman: { name: 'Russell', rate: '85%' } }` choose the Polly voices; `sounds: { name: 'soundbank://…' }` adds your own sound names. The validator checks that every sound, mood and voice you use exists.

Effects: `{ stamina: -3 }`, `{ skill: 1, raiseInitial: true }`, `{ luck: 1 }`, `{ gold: 5 }`, `{ provisions: 2 }`, `{ addItem: 'rope' }`, `{ removeItem: 'holy water' }`, `{ setFlag: 'armoury' }`.

Requirements: `item`, `gold`, `flag` and `notFlag`. A choice whose requirement isn't met is left out of what Alexa reads, and the remaining options are renumbered. Run `npm test` after editing. The validator flags missing sections, unreachable sections, and choice lists where every option has a requirement (which could leave the player stuck).

Write each choice's `text` so it reads well after "Will you…": a short verb phrase in lower case. `say` is optional. Add it for short answers players are likely to give, such as directions ("left"), single nouns ("gate") or other verbs ("unlock"). The choice's own words always work. The validator warns when the same `say` phrase is listed for two choices that lead to different sections.

Keep section text short. It is read aloud, and two to four sentences works best.
