'use strict';

/**
 * Beneath Ashen Tor — an original gamebook adventure, written for voice.
 *
 * Section schema
 *   text      what Alexa reads when you arrive
 *   effects   applied on arrival: { stamina | skill | luck | gold | provisions: n },
 *             { addItem: 'x' }, { removeItem: 'x' }, { setFlag: 'x' }
 *             skill/luck/stamina gains are capped at your starting score unless
 *             { raiseInitial: true } is also set on that effect.
 *   then ONE of:
 *     choices   [{ text, to, requires?: { item, gold, flag, notFlag }, say?: [phrases] }]
 *               `text` is read aloud ("Will you ... or ...?"). `say` lists other things
 *               the player might answer with; the choice's own words always work too.
 *     next      section id; the player says "continue"
 *     combat    { enemies: [{ name, skill, stamina }], win, escape? }
 *     testLuck  { lucky, unlucky }
 *     testSkill { pass, fail }
 *     ending    'win' | 'death'
 */
module.exports = {
  title: 'Beneath Ashen Tor',
  start: 1,
  intro:
    'For three winters the necromancer Malgrath has slept beneath Ashen Tor, ' +
    'and for three winters the sun has not fully risen over the valley. ' +
    'The village elders say the Dawnstone lies on his brow, deep in his crypt. ' +
    'Bring it back into the daylight and the long night ends. ' +
    'You have a sword, a lantern, a backpack of provisions, and your wits.',

  sections: {
    1: {
      text:
        'You stand at the foot of Ashen Tor in the grey half-light. An iron door, ' +
        'rusted and half open, leads into the hill. Above it, a scree slope climbs ' +
        'to a dark crack in the rock.',
      choices: [
        { text: 'squeeze through the iron door', to: 2, say: ['door', 'go in', 'enter'] },
        { text: 'climb the scree towards the crack', to: 3, say: ['climb', 'scree', 'slope', 'go up'] },
      ],
    },

    2: {
      text:
        'You enter a long entrance hall. Bones crunch under your boots. Two passages ' +
        'lead on: the left one smells of stagnant water, and from the right comes the ' +
        'flicker of torchlight and the sound of rough voices.',
      choices: [
        { text: 'take the damp left passage', to: 4, say: ['left', 'go left', 'water'] },
        { text: 'creep towards the torchlight', to: 5, say: ['right', 'go right', 'torch', 'torches', 'voices'] },
      ],
    },

    3: {
      text:
        'The scree shifts and slides beneath you with every step. Near the top, a large ' +
        'stone rolls under your foot.',
      testLuck: { lucky: 6, unlucky: 7 },
    },

    6: {
      text:
        'You keep your balance and haul yourself into the crack. Just inside lies the ' +
        'skeleton of an earlier adventurer. In his pack you find a coil of rope and two ' +
        'meals, still wrapped in waxed cloth. The tunnel winds down into the hill until ' +
        'it opens onto a narrow stone gallery.',
      effects: [{ addItem: 'rope' }, { provisions: 2 }],
      next: 9,
    },

    7: {
      text:
        'The slope gives way and you tumble back down, battered by the rocks. You lose ' +
        'three stamina. Bruised, you limp to the iron door and slip inside.',
      effects: [{ stamina: -3 }],
      next: 2,
    },

    9: {
      text:
        'From the gallery you look down into a guardroom. Two goblins squat over a game ' +
        'of knucklebones. A silver key hangs on a hook behind them. The gallery runs on ' +
        'into darkness.',
      choices: [
        { text: 'drop down and attack the goblins', to: 10, say: ['attack', 'fight', 'jump down'] },
        { text: 'tie your rope to a pillar and lower yourself silently to the key', to: 13, requires: { item: 'rope' }, say: ['use the rope', 'rope', 'climb down'] },
        { text: 'follow the gallery onward and leave the goblins alone', to: 11, say: ['keep going', 'go on', 'leave them', 'carry on'] },
      ],
    },

    4: {
      text:
        'The left passage slopes down into ankle-deep water. Something heavy splashes ' +
        'towards you, and a giant rat the size of a dog bursts from the gloom, ' +
        'teeth bared.',
      combat: { enemies: [{ name: 'giant rat', skill: 5, stamina: 5 }], win: 12 },
    },

    5: {
      text:
        'You peer around the corner into a guardroom. Two goblins squabble over a game ' +
        'of knucklebones. A silver key hangs on a hook behind them.',
      choices: [
        { text: 'charge in and attack', to: 10, say: ['attack', 'fight', 'charge'] },
        { text: 'try to sneak past and snatch the key', to: 14, say: ['sneak', 'steal the key', 'grab the key'] },
      ],
    },

    14: {
      text: 'You hold your breath and edge along the wall, keeping to the shadows.',
      testSkill: { pass: 13, fail: 15 },
    },

    15: {
      text:
        'Your scabbard scrapes against the stone. The goblins leap up, snarling, and ' +
        'grab their rusty blades.',
      next: 10,
    },

    10: {
      text: 'Steel rings in the guardroom. You must fight the goblins one at a time.',
      combat: {
        enemies: [
          { name: 'first goblin', skill: 5, stamina: 5 },
          { name: 'second goblin', skill: 6, stamina: 4 },
        ],
        win: 16,
      },
    },

    13: {
      text:
        'Without a sound you lift the silver key from its hook and slip away while the ' +
        'goblins argue over their game. Fortune favours the bold. You gain one luck.',
      effects: [{ addItem: 'silver key' }, { luck: 1 }],
      next: 17,
    },

    16: {
      text:
        'The goblins lie still. You take the silver key from its hook, and find five ' +
        'gold pieces in a greasy purse.',
      effects: [{ addItem: 'silver key' }, { gold: 5 }],
      next: 17,
    },

    11: {
      text:
        'The gallery ends at a crumbling stair, which brings you down beyond the ' +
        'guardroom without the goblins ever noticing you.',
      next: 17,
    },

    12: {
      text:
        'The rat floats away. Beyond it, a bloated corpse in old armour bobs against the ' +
        'wall. In its belt pouch you find three gold pieces and a small silver mirror, ' +
        'its glass unclouded despite the damp.',
      effects: [{ gold: 3 }, { addItem: 'silver mirror' }],
      choices: [
        { text: 'wade on to the north arch', to: 17, say: ['north', 'arch', 'go on', 'keep going'] },
        { text: 'go back and take the torch-lit passage instead', to: 5, say: ['go back', 'back', 'torchlight'] },
      ],
    },

    17: {
      text:
        'You reach a junction. To the east, an iron gate with a silver lock. To the west, ' +
        'worn steps spiral down into the roar of rushing water. Straight ahead, a low ' +
        'crawlway disappears into the rock.',
      choices: [
        { text: 'unlock the iron gate', to: 18, requires: { item: 'silver key', notFlag: 'armoury' }, say: ['gate', 'east', 'use the key', 'unlock'] },
        { text: 'take the steps down towards the water', to: 19, say: ['steps', 'stairs', 'west', 'go down', 'river'] },
        { text: 'squeeze into the crawlway', to: 39, say: ['crawl', 'crawlway', 'straight ahead', 'tunnel'] },
      ],
    },

    39: {
      text:
        'You wriggle forward on your belly for what feels like an age. Then you hear a ' +
        'grinding crack behind you, and another ahead. The roof settles, slowly and ' +
        'without mercy. Malgrath’s crypt has claimed another fool.',
      ending: 'death',
    },

    18: {
      text:
        'The silver key turns with a sigh. Inside is an old armoury. Most of the weapons ' +
        'have rusted away, but one sword gleams as if freshly forged, and a stoppered ' +
        'flask of holy water sits on a shelf. You take both. The blade sings in your ' +
        'hand: add one to your skill, even beyond its starting value.',
      effects: [
        { skill: 1, raiseInitial: true },
        { addItem: 'holy water' },
        { setFlag: 'armoury' },
      ],
      next: 17,
    },

    19: {
      text:
        'At the bottom of the steps an underground river races through a cavern. A tall ' +
        'skeletal ferryman leans on his pole beside a black boat. He holds out a bony ' +
        'hand. "Five gold to cross," he rasps.',
      choices: [
        { text: 'pay the ferryman five gold', to: 20, requires: { gold: 5 }, say: ['pay', 'pay him', 'give him the gold'] },
        { text: 'swim across the river', to: 21, say: ['swim'] },
        { text: 'refuse, and fight the ferryman for his boat', to: 22, say: ['fight', 'attack', 'refuse', 'attack the ferryman'] },
      ],
    },

    20: {
      text:
        'The ferryman takes your coins and poles you across in silence. On the far bank ' +
        'he bows, and the boat drifts away into the dark.',
      effects: [{ gold: -5 }],
      next: 23,
    },

    21: {
      text:
        'The water is bitterly cold and the current drags at you. You lose two stamina. ' +
        'Halfway across, something slick brushes against your leg.',
      effects: [{ stamina: -2 }],
      testLuck: { lucky: 24, unlucky: 25 },
    },

    24: {
      text: 'Whatever it was loses interest. You drag yourself, gasping, onto the far bank.',
      next: 23,
    },

    25: {
      text:
        'A blind cave eel clamps its jaws on your calf before you kick free. You lose ' +
        'four stamina, and stagger out onto the far bank.',
      effects: [{ stamina: -4 }],
      next: 23,
    },

    22: {
      text: 'The ferryman lifts his iron-shod pole and swings it at your head.',
      combat: { enemies: [{ name: 'skeletal ferryman', skill: 7, stamina: 7 }], win: 26 },
    },

    26: {
      text:
        'The ferryman collapses into a heap of bones. Among them you find eight gold ' +
        'pieces. You take the boat across yourself.',
      effects: [{ gold: 8 }],
      next: 23,
    },

    23: {
      text:
        'Beyond the river lies a Hall of Statues: six stone knights, swords lowered. The ' +
        'last of them holds a polished shield that shines like a moonlit pool. An ' +
        'archway on the far side leads deeper into the tor.',
      choices: [
        { text: 'take the polished shield', to: 27, requires: { notFlag: 'shield' }, say: ['shield', 'take the shield', 'grab the shield'] },
        { text: 'study the statues more closely', to: 28, requires: { notFlag: 'studied' }, say: ['statues', 'look at the statues', 'examine', 'read the words'] },
        { text: 'go through the archway', to: 29, say: ['archway', 'arch', 'go on', 'move on'] },
      ],
    },

    28: {
      text:
        'Words are carved into each plinth. Read together, they say: "His fire is death ' +
        'to all who face it, save those who show it back to him." You feel wiser for ' +
        'knowing it. Gain one luck.',
      effects: [{ luck: 1 }, { setFlag: 'studied' }],
      next: 23,
    },

    27: {
      text:
        'As your fingers close on the shield, the stone knight lurches into life with a ' +
        'grinding of stone, and raises its sword.',
      combat: { enemies: [{ name: 'stone knight', skill: 8, stamina: 8 }], win: 30, escape: 29 },
    },

    30: {
      text:
        'The stone knight shatters into rubble. You strap the polished shield to your arm. ' +
        'Its surface is a perfect mirror.',
      effects: [{ addItem: 'polished shield' }, { setFlag: 'shield' }],
      next: 23,
    },

    29: {
      text:
        'The passage beyond the archway is lined with skulls in niches. Halfway along, a ' +
        'flagstone clicks under your foot.',
      testLuck: { lucky: 31, unlucky: 32 },
    },

    31: {
      text: 'Darts hiss from the walls, but every one of them misses you. You hurry on.',
      next: 33,
    },

    32: {
      text: 'Darts hiss from the walls and two bite into your arm. You lose three stamina.',
      effects: [{ stamina: -3 }],
      next: 33,
    },

    33: {
      text:
        'The passage opens into a small chamber. In an alcove stands a shrine with a font ' +
        'of clear water, untouched by the crypt’s rot. Ahead, a great bronze door ' +
        'radiates a deathly cold.',
      choices: [
        { text: 'drink from the font', to: 34, requires: { notFlag: 'font' }, say: ['drink', 'font', 'shrine', 'drink the water'] },
        { text: 'approach the bronze door', to: 35, say: ['door', 'bronze door', 'go on'] },
      ],
    },

    34: {
      text:
        'The water is sweet and warm. Strength floods back into your limbs. Gain four ' +
        'stamina and two luck.',
      effects: [{ stamina: 4 }, { luck: 2 }, { setFlag: 'font' }],
      next: 33,
    },

    35: {
      text:
        'As you reach the bronze door, a howling shape of mist and malice pours out of ' +
        'the metal: a wraith, bound to guard its master’s rest.',
      choices: [
        { text: 'fight the wraith with your sword', to: 36, say: ['fight', 'attack', 'sword'] },
        { text: 'hurl the holy water at it', to: 37, requires: { item: 'holy water' }, say: ['holy water', 'throw the holy water', 'use the holy water'] },
      ],
    },

    36: {
      text: 'You raise your sword against the wraith. Its touch is like ice in your veins.',
      combat: { enemies: [{ name: 'wraith', skill: 8, stamina: 7 }], win: 38 },
    },

    37: {
      text:
        'The flask shatters against the wraith. It shrieks and boils away into nothing, ' +
        'and the bronze door swings slowly open.',
      effects: [{ removeItem: 'holy water' }],
      next: 38,
    },

    38: {
      text:
        'You step into the crypt of Malgrath. On a stone bier the necromancer sits up, ' +
        'his skin like old parchment. The Dawnstone glows on his brow. He lifts one ' +
        'withered hand, and black fire gathers in his palm.',
      choices: [
        { text: 'raise the polished shield', to: 40, requires: { item: 'polished shield' }, say: ['shield', 'use the shield', 'reflect it'] },
        { text: 'hold up the silver mirror', to: 40, requires: { item: 'silver mirror' }, say: ['mirror', 'use the mirror', 'reflect it'] },
        { text: 'throw yourself aside', to: 41, say: ['dodge', 'dive', 'jump aside', 'duck'] },
      ],
    },

    40: {
      text:
        'The black fire strikes the mirrored surface and rebounds into Malgrath’s ' +
        'face. He reels, screaming, half his power burned away. Now finish him!',
      combat: { enemies: [{ name: 'Malgrath', skill: 7, stamina: 6 }], win: 44 },
    },

    41: {
      text: 'You dive as the black fire roars towards you.',
      testLuck: { lucky: 42, unlucky: 43 },
    },

    42: {
      text: 'The fire scorches the floor where you stood. You spring up and charge the necromancer.',
      next: 45,
    },

    43: {
      text:
        'The fire catches your side and you cry out in agony. You lose six stamina. ' +
        'Gritting your teeth, you charge the necromancer.',
      effects: [{ stamina: -6 }],
      next: 45,
    },

    45: {
      text: 'Malgrath draws a blade of bone from his robes. He is old, but far from weak.',
      combat: { enemies: [{ name: 'Malgrath', skill: 9, stamina: 9 }], win: 44 },
    },

    44: {
      text:
        'Malgrath crumbles into dust and the Dawnstone falls ringing to the floor. As you ' +
        'lift it, the tor begins to tremble. You run, back through the halls, and burst ' +
        'out of the iron door just as the hillside slumps closed behind you. In your ' +
        'hand the Dawnstone blazes, and for the first time in three winters, the sun ' +
        'rises over the valley. You have won.',
      ending: 'win',
    },
  },
};
