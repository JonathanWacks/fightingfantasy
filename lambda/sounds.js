'use strict';

/**
 * Sound effects from the Alexa Skills Kit Sound Library, by friendly name.
 * Preview them in the developer console Test tab, e.g. type:
 *   <speak><audio src="soundbank://soundlibrary/foley/amzn_sfx_wooden_door_creaks_open_01"/></speak>
 * An adventure can add or override names with its own `sounds: { name: uri }` map.
 */

const LIB = 'soundbank://soundlibrary/';

const SOUNDS = {
  // Combat and dice
  swing: 'foley/amzn_sfx_swoosh_fast_1x_01',
  hit: 'impacts/amzn_sfx_punch_01',
  hurt: 'impacts/amzn_sfx_punch_02',
  battle: 'battle/amzn_sfx_battle_group_clanks_01',
  clash: 'battle/amzn_sfx_battle_noisy_clanks_01',
  drumroll: 'musical/amzn_sfx_drum_and_cymbal_01',
  lucky: 'magic/amzn_sfx_fairy_sparkle_chimes_01',
  unlucky: 'musical/amzn_sfx_buzzer_small_01',

  // Outcomes
  victory: 'musical/amzn_sfx_trumpet_bugle_04',
  cheer: 'human/amzn_sfx_large_crowd_cheer_01',
  death: 'musical/amzn_sfx_church_bell_1x_02',
  drink: 'human/amzn_sfx_drinking_slurp_01',
  magic: 'magic/amzn_sfx_fairy_melodic_chimes_01',
  blast: 'magic/amzn_sfx_magic_blast_1x_01',

  // Places and things
  door_creak: 'foley/amzn_sfx_wooden_door_creaks_open_01',
  door_creak_long: 'foley/amzn_sfx_wooden_door_creaks_long_01',
  door_open: 'home/amzn_sfx_door_open_01',
  door_shut: 'home/amzn_sfx_door_shut_01',
  footsteps: 'home/amzn_sfx_footsteps_01',
  running: 'human/amzn_sfx_person_running_01',
  wind: 'nature/amzn_sfx_strong_wind_whistling_01',
  thunder: 'nature/amzn_sfx_thunder_rumble_01',
  storm: 'nature/amzn_sfx_rain_thunder_01',
  drips: 'nature/amzn_sfx_water_dripping_01',
  droplets: 'nature/amzn_sfx_water_droplets_01',
  rowing: 'nature/amzn_sfx_oars_splashing_rowboat_01',
  wading: 'human/amzn_sfx_walking_in_mud_01',
  ghost: 'magic/amzn_sfx_ghost_spooky_01',
  ghost_wail: 'magic/amzn_sfx_ghost_spooky_03',
  wolf: 'animals/amzn_sfx_wolf_howl_01',
  growl: 'animals/amzn_sfx_dog_med_growl_1x_01',
  roar: 'animals/amzn_sfx_bear_groan_roar_01',
  march: 'battle/amzn_sfx_army_march_clank_7x_01',
  darts: 'foley/amzn_sfx_swoosh_fast_6x_01',
  bell: 'musical/amzn_sfx_church_bell_1x_01',
  drone: 'musical/amzn_sfx_musical_drone_intro_01',
};

/** Sounds the engine plays on game events. Set an entry to null to silence it. */
const EVENTS = {
  combatStart: 'battle',
  round: 'swing',
  playerHits: 'hit',
  playerHurt: 'hurt',
  test: 'drumroll',
  lucky: 'lucky',
  unlucky: null,
  drink: 'drink',
  win: 'victory',
  death: 'death',
};

/** Resolve a name (or a full soundbank/https URL) to a playable URL, or null. */
function soundUrl(name, overrides) {
  if (!name) return null;
  if (/^(soundbank|https):\/\//.test(name)) return name;
  const own = overrides && overrides[name];
  if (own) return /^(soundbank|https):\/\//.test(own) ? own : LIB + own;
  return SOUNDS[name] ? LIB + SOUNDS[name] : null;
}

module.exports = { SOUNDS, EVENTS, soundUrl };
