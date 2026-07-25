const db = require('./db');

const MONSTER_TABLE = [
  { type: 'Naked Slime',       enc: ['open'],        crMin: 0,  crMax: 0,  xp: 10,    sigBonus: false },
  { type: 'Armored Goblin',    enc: ['wep'],          crMin: 1,  crMax: 2,  xp: 50,    sigBonus: true  },
  { type: 'Cave Troll',        enc: ['wpa'],          crMin: 3,  crMax: 4,  xp: 200,   sigBonus: true  },
  { type: 'Dungeon Wyvern',    enc: ['wpa2'],         crMin: 5,  crMax: 8,  xp: 1100,  sigBonus: true  },
  { type: 'The Lich',          enc: ['wpa3'],         crMin: 15, crMax: 21, xp: 13000, sigBonus: true  },
  { type: 'Common Peasant',    enc: ['wpa','wpa2'],   crMin: 1,  crMax: 2,  xp: 75,    sigBonus: false, defaultSsid: true },
  { type: 'Invisible Stalker', enc: ['hidden'],       crMin: 6,  crMax: 10, xp: 2300,  sigBonus: true  },
];

const DEFAULT_SSID_PATTERNS = /^(NETGEAR|Linksys|TP-Link|ASUS|Dlink|D-Link|Xfinity|Spectrum|ATT|Verizon|OPTUS|Telstra|TPG|iiNet|Belong)/i;

const LOOT_TABLE = {
  common: [
    { name: 'Scroll of Passive Scanning',     type: 'scroll',  flavor: 'Slightly increases your situational awareness. Smells like ozone.' },
    { name: 'Chipped Copper Antenna',         type: 'weapon',  flavor: 'It\'s bent. It still works better than nothing.' },
    { name: 'Potion of Channel Clarity',      type: 'potion',  flavor: 'Reduces interference for 30 seconds. Tastes like metal.' },
    { name: 'Tattered Map Fragment',          type: 'misc',    flavor: 'Part of a larger map. Useless on its own. Probably.' },
    { name: 'Goblin\'s Old WEP Key',         type: 'misc',    flavor: 'Already cracked. Worth nothing. You take it anyway.' },
  ],
  uncommon: [
    { name: 'Silver Directional Antenna',     type: 'weapon',  flavor: '+3 to range. Forged in the fires of a Best Buy.' },
    { name: 'Amulet of Monitor Mode',         type: 'armor',   flavor: 'Passive: You can now see what others cannot.' },
    { name: 'Ring of Packet Capture',         type: 'armor',   flavor: 'Every handshake whispers to you. It\'s unsettling.' },
    { name: 'Elixir of Hash Speed',           type: 'potion',  flavor: '+500MH/s. Limited time. Side effects include fan noise.' },
  ],
  rare: [
    { name: 'Staff of Deauthentication',      type: 'weapon',  flavor: 'Legally and ethically problematic. Extremely effective.' },
    { name: 'Cloak of the Hidden SSID',       type: 'armor',   flavor: 'You disappear from scan lists. The monsters are confused.' },
    { name: 'Tome of rockyou.txt',            type: 'scroll',  flavor: '14 million words of pure uncut password wisdom.' },
    { name: 'Gauntlets of PMKID Extraction',  type: 'armor',   flavor: 'Skip the handshake entirely. Rude. Efficient.' },
  ],
  legendary: [
    { name: 'The Pwnagotchi\'s Soul',         type: 'artifact', flavor: 'A tiny AI that learned to beg for handshakes. It is lonely.' },
    { name: 'Alfa AWUS036ACH of Doom',        type: 'weapon',  flavor: 'Dual-band. High gain. The Lich has nightmares about this.' },
    { name: 'Grimoire of WPA3 Tears',         type: 'artifact', flavor: 'Pages are blank. Nobody has ever cracked WPA3. Nobody.' },
    { name: 'Crown of the Dungeon Floor',     type: 'artifact', flavor: 'You are the danger. You are Carl.' },
  ],
};

const ACHIEVEMENTS = [
  { code: 'first_blood',     name: 'First Blood',          desc: 'Captured your first handshake. The dungeon has taken notice.',          repeatable: false },
  { code: 'goblin_slayer',   name: 'Goblin Slayer',        desc: 'Cracked your first WEP network. It was barely a challenge.',            repeatable: false },
  { code: 'troll_hunter',    name: 'Troll Hunter',         desc: 'Cracked your first WPA network. Respectable.',                          repeatable: false },
  { code: 'dragon_hunter',   name: 'Dragon Hunter',        desc: 'Cracked your first WPA2 network. The dungeon trembles.',                repeatable: false },
  { code: 'lich_king',       name: 'Lich King',            desc: 'Cracked a WPA3 network. This should not have been possible. Are you okay?', repeatable: false },
  { code: 'hoarder',         name: 'Hoarder',              desc: 'Collected 10 items. Your inventory is getting heavy. Metaphorically.',  repeatable: false },
  { code: 'floor_clearer',   name: 'Floor Clearer',        desc: 'Cracked 5 networks in a single session. Carl would approve.',           repeatable: false },
  { code: 'century',         name: 'The Century',          desc: '100 kills. The alien audience is going insane. You are the show.',      repeatable: false },
  { code: 'ghost_detector',  name: 'Ghost Detector',       desc: 'Discovered a hidden SSID. Something was trying to hide from you.',      repeatable: true  },
  { code: 'naked_truth',     name: 'The Naked Truth',      desc: 'Found an open network. Who DOES that in this dungeon?',                 repeatable: true  },
  { code: 'peasant_slayer',  name: 'Peasant Slayer',       desc: 'Cracked a default-named router. Password was probably "admin".',        repeatable: true  },
  { code: 'speed_demon',     name: 'Speed Demon',          desc: 'Cracked a network in under 5 minutes. Efficiency is its own reward.',   repeatable: true  },
];

function classifyMonster(network) {
  const enc = (network.encryption || '').toLowerCase();
  const sig = network.signal || -80;
  const ssid = network.ssid || '';
  const hidden = !ssid || ssid.trim() === '';

  if (hidden) {
    return { type: 'Invisible Stalker', cr: 8, xp: 2300 };
  }

  if (enc.includes('open') || enc === '' || enc === 'none') {
    return { type: 'Naked Slime', cr: 0, xp: 10 };
  }

  const isDefault = DEFAULT_SSID_PATTERNS.test(ssid);

  if (enc.includes('wpa3')) {
    const cr = sig > -60 ? 21 : 15;
    return { type: 'The Lich', cr, xp: 13000 };
  }

  if (enc.includes('wpa2')) {
    if (isDefault) return { type: 'Common Peasant', cr: 2, xp: 75 };
    if (sig > -50) return { type: 'Dungeon Wyvern', cr: 8, xp: 2900 };
    if (sig > -70) return { type: 'Dungeon Wyvern', cr: 6, xp: 1100 };
    return { type: 'Dungeon Drake', cr: 4, xp: 700 };
  }

  if (enc.includes('wpa')) {
    if (isDefault) return { type: 'Common Peasant', cr: 1, xp: 50 };
    return { type: 'Cave Troll', cr: sig > -60 ? 4 : 3, xp: 200 };
  }

  if (enc.includes('wep')) {
    return { type: 'Armored Goblin', cr: 2, xp: 50 };
  }

  return { type: 'Unknown Horror', cr: 5, xp: 500 };
}

function rollLoot(monsterType, ssid) {
  const roll = Math.random() * 100;
  let rarity;
  if (roll < 60) rarity = 'common';
  else if (roll < 85) rarity = 'uncommon';
  else if (roll < 97) rarity = 'rare';
  else rarity = 'legendary';

  const pool = LOOT_TABLE[rarity];
  let item = pool[Math.floor(Math.random() * pool.length)];

  // Named item based on SSID for rare+
  if ((rarity === 'rare' || rarity === 'legendary') && ssid) {
    if (Math.random() > 0.5) {
      item = { ...item, name: `The ${ssid} Grimoire`, flavor: `A tome bound in the secrets of "${ssid}". It radiates mild menace.` };
    }
  }

  return { ...item, rarity };
}

function addXP(amount) {
  const crawler = db.prepare('SELECT * FROM crawler WHERE id = 1').get();
  let { xp, xp_next, level, kills } = crawler;

  xp += amount;
  let leveled = false;

  while (xp >= xp_next) {
    xp -= xp_next;
    level += 1;
    xp_next = Math.floor(xp_next * 1.5);
    leveled = true;
  }

  db.prepare('UPDATE crawler SET xp=?, xp_next=?, level=? WHERE id=1').run(xp, xp_next, level);
  return { level, leveled, xp, xp_next };
}

function checkAchievements(triggerCode) {
  const def = ACHIEVEMENTS.find(a => a.code === triggerCode);
  if (!def) return null;

  const existing = db.prepare('SELECT count FROM achievements WHERE code=?').get(triggerCode);

  if (existing) {
    if (!def.repeatable) return null;
    const newCount = existing.count + 1;
    db.prepare('UPDATE achievements SET count=? WHERE code=?').run(newCount, triggerCode);
    return { ...def, count: newCount };
  }

  db.prepare('INSERT INTO achievements (code, name, description, count) VALUES (?,?,?,1)').run(def.code, def.name, def.desc);
  return { ...def, count: 1 };
}

function logEvent(type, message, data = {}) {
  db.prepare('INSERT INTO events (type, message, data) VALUES (?,?,?)').run(type, message, JSON.stringify(data));
}

function getCrawlerState() {
  return db.prepare('SELECT * FROM crawler WHERE id=1').get();
}

module.exports = { classifyMonster, rollLoot, addXP, checkAchievements, logEvent, getCrawlerState, ACHIEVEMENTS };
