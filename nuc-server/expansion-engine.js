const crypto = require('crypto');
const db = require('./db');
const { rollLoot, logEvent } = require('./game-engine');

const BOX_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Legendary', 'Celestial'];
const BOSS_TIERS = ['Neighborhood', 'Borough', 'City', 'Province', 'Country', 'Floor'];
const BOX_RARITY = {
  Bronze: 'common',
  Silver: 'uncommon',
  Gold: 'rare',
  Platinum: 'rare',
  Legendary: 'legendary',
  Celestial: 'legendary',
};
const SPONSORS = [
  ['borant_budget', 'Borant Budget Broadband', 4],
  ['donut_telecom', 'Princess Donut Telecommunications', 5],
  ['questionable_networking', 'Questionable Networking Solutions', 6],
];
const FLOOR_RULES = [
  {
    key: 'tutorial',
    name: 'Generously Misleading Tutorial',
    description: 'Extra accuracy and recovery. The mercy is temporary.',
    accuracy: 8, damage: 0, enemyDamage: -2, xp: 1, stamina: 0,
  },
  {
    key: 'fog',
    name: 'Fog of Questionable Discovery',
    description: 'Hidden monsters are stronger, but exploration pays more.',
    accuracy: -2, damage: 0, enemyDamage: 0, xp: 1.1, stamina: 0,
  },
  {
    key: 'boss_rush',
    name: 'Management-Mandated Boss Rush',
    description: 'Bosses hit harder and award better boxes.',
    accuracy: 0, damage: 1, enemyDamage: 2, xp: 1.15, stamina: 0,
  },
  {
    key: 'ratings',
    name: 'Ratings Week',
    description: 'Audience growth is doubled. Dignity remains unmonetized.',
    accuracy: 0, damage: 0, enemyDamage: 0, xp: 1, stamina: 0,
  },
  {
    key: 'nemesis',
    name: 'Nemesis Migration',
    description: 'Repeat enemies gain power and produce better rewards.',
    accuracy: -3, damage: 1, enemyDamage: 1, xp: 1.2, stamina: 0,
  },
  {
    key: 'dual_radio',
    name: 'Dual-Radio Power Surge',
    description: 'The USB radio adds damage and charged-attack power.',
    accuracy: 4, damage: 3, enemyDamage: 0, xp: 1.1, stamina: 1,
  },
  {
    key: 'unstable',
    name: 'Unstable Signal Zone',
    description: 'Critical hits and incoming damage both increase.',
    accuracy: -4, damage: 4, enemyDamage: 3, xp: 1.25, stamina: 1,
  },
];

function stableNumber(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest().readUInt32BE(0);
}

function currentFloorRule(floor) {
  const index = Math.max(0, (Number(floor || 1) - 1) % FLOOR_RULES.length);
  return { floor: Number(floor || 1), ...FLOOR_RULES[index] };
}

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM world_settings WHERE key=?').get(key);
  if (row) return row.value;
  db.prepare('INSERT OR IGNORE INTO world_settings (key,value) VALUES (?,?)').run(key, fallback);
  return fallback;
}

function homeSsid() {
  return process.env.DUNGEON_HOME_SSID || setting('home_safe_ssid', 'JuelichHome');
}

function isHomeNetwork(ssid) {
  return Boolean(ssid) && String(ssid).trim().toLowerCase() === homeSsid().trim().toLowerCase();
}

function trustedSsids() {
  const configured = process.env.DUNGEON_TRUSTED_SSIDS
    || setting('trusted_ssids', "VJ's iPhone,VJ’s iPhone");
  return configured.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
}

function isTrustedDevice(ssid) {
  return Boolean(ssid) && trustedSsids().includes(String(ssid).trim().toLowerCase());
}

function mobileMerchantKind(network = {}) {
  const ssid = String(typeof network === 'string' ? network : network.ssid || '').trim();
  const vendor = String(typeof network === 'object' ? network.vendor || '' : '').trim();
  const name = ssid.toLowerCase();
  const maker = vendor.toLowerCase();
  if (/\biphone\b|\bipad\b|\bios\b/.test(name)) return 'iPhone Merchant';
  if (/\bandroid(?:ap)?\b|\bgalaxy\b|\bpixel\b|\boneplus\b|\boppo\b|\bredmi\b|\bxiaomi\b|\bhuawei\b|\bmotorola\b|\bmoto\s*[a-z0-9]+\b|\bphone\b|\bmobile hotspot\b/.test(name)) {
    return 'Android Merchant';
  }
  if (/\bapple\b/.test(maker) && /\bhotspot\b|\biphone\b|\bipad\b/.test(name)) return 'iPhone Merchant';
  if (/\bsamsung\b|\bgoogle\b|\boneplus\b|\boppo\b|\bxiaomi\b|\bhuawei\b|\bmotorola\b/.test(maker)
      && /\bhotspot\b|\bandroid\b|\bgalaxy\b|\bpixel\b|\bphone\b/.test(name)) {
    return 'Android Merchant';
  }
  return null;
}

function isMobileMerchant(network) {
  return Boolean(mobileMerchantKind(network));
}

function visitTravellingMerchant(network) {
  const now = Date.now();
  let previous = {};
  try {
    previous = JSON.parse(setting('travelling_merchant', '{}') || '{}');
  } catch {
    previous = {};
  }
  const kind = mobileMerchantKind(network);
  const merchant = {
    active: true,
    kind,
    ssid: String(network.ssid || 'Mysterious Phone'),
    bssid: String(network.bssid || ''),
    signal: Number(network.signal || -100),
    lastSeen: now,
    offer: kind === 'iPhone Merchant'
      ? 'Suspiciously Premium Benefactor Box'
      : 'Questionably Sideloaded Adventurer Box',
  };
  db.prepare(`INSERT INTO world_settings(key,value) VALUES ('travelling_merchant',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(merchant));
  if (previous.bssid !== merchant.bssid || now - Number(previous.lastSeen || 0) > 10 * 60 * 1000) {
    logEvent('merchant',
      `${merchant.kind} "${merchant.ssid}" entered the dungeon. Prices are fictional; judgment is complimentary.`,
      merchant);
  }
  return merchant;
}

function addAudience(event, context = {}) {
  const c = db.prepare('SELECT floor FROM crawler WHERE id=1').get();
  const rule = currentFloorRule(c.floor);
  const multiplier = rule.key === 'ratings' ? 2 : 1;
  const cr = Math.max(1, Number(context.cr || 1));
  let views = 2 + cr;
  let followers = 0;
  let favorites = 0;
  if (event === 'discover') views += 4;
  if (event === 'battle') views += 8 + cr * 2;
  if (event === 'critical') views += 20;
  if (event === 'victory') {
    views += 35 + cr * 5;
    followers += 1 + Math.floor(cr / 4);
    if (context.isBoss) favorites += 1;
  }
  if (event === 'defeat') views += 55;
  views *= multiplier;
  followers *= multiplier;
  const current = db.prepare('SELECT * FROM audience WHERE id=1').get();
  const rating = Math.max(0, Number(current.rating || 0) + views + followers * 10 + favorites * 50);
  const live = Math.max(1, Number(current.followers || 0) * 3 + Number(current.favorites || 0) * 25 + c.floor * 10);
  db.prepare(`UPDATE audience SET views=views+?,followers=followers+?,favorites=favorites+?,
    rating=?,peak_viewers=MAX(peak_viewers,?),last_event=?,updated_at=datetime('now') WHERE id=1`)
    .run(views, followers, favorites, rating, live, event);
  return db.prepare('SELECT * FROM audience WHERE id=1').get();
}

function trainSkill(code, amount = 1) {
  let skill = db.prepare('SELECT * FROM skills WHERE code=?').get(code);
  if (!skill) return null;
  let xp = Number(skill.xp || 0) + Math.max(1, Math.floor(amount));
  let level = Number(skill.level || 1);
  let next = Number(skill.xp_next || 20);
  let gained = 0;
  while (xp >= next && level < 20) {
    xp -= next;
    level += 1;
    gained += 1;
    next = Math.floor(next * 1.55);
  }
  db.prepare(`UPDATE skills SET level=?,xp=?,xp_next=?,trained_at=datetime('now') WHERE code=?`)
    .run(level, xp, next, code);
  if (gained) {
    const message = `${skill.name} reached level ${level}. Repetition has accidentally become expertise.`;
    logEvent('skill_up', message, { code, level });
  }
  return { ...skill, level, xp, xp_next: next, gained };
}

function skillLevels() {
  return Object.fromEntries(db.prepare('SELECT code,level FROM skills').all().map(s => [s.code, Number(s.level || 1)]));
}

function skillBonuses() {
  const s = skillLevels();
  return {
    accuracy: Math.floor((s.signal_sense || 1) / 2),
    closeDamage: Math.floor((s.close_quarters || 1) / 3),
    chargeDamage: (s.stalking || 1) * 2,
    criticalChance: Math.floor((s.critical_negotiation || 1) / 2),
    damageReduction: Math.floor((s.improvised_armor || 1) / 3),
    retreatHealing: (s.tactical_retreat || 1) * 2,
    donutBonus: Math.floor((s.donut_diplomacy || 1) / 3),
    discoveryBonus: Math.floor((s.cartography || 1) / 2),
  };
}

function bossTierFor(monster, crawler, isBoss = true) {
  if (!isBoss) return '';
  const cr = Number(monster.cr || 1);
  let index = cr >= 15 ? 2 : cr >= 7 ? 1 : 0;
  if (crawler.floor >= 4 && cr >= 12) index = Math.max(index, 3);
  if (crawler.floor >= 6 && (monster.nemesis || cr >= 18)) index = Math.max(index, 4);
  if (crawler.floor >= 10) index = Math.max(index, 5);
  return BOSS_TIERS[Math.min(BOSS_TIERS.length - 1, index)];
}

function boxTierForBoss(bossTier) {
  const index = Math.max(0, BOSS_TIERS.indexOf(bossTier));
  return BOX_TIERS[index];
}

function awardBox({ type = 'Adventurer', tier = 'Bronze', source = '', bssid = '' } = {}) {
  const normalizedTier = BOX_TIERS.includes(tier) ? tier : 'Bronze';
  const result = db.prepare(`INSERT INTO loot_boxes
    (box_type,tier,source,monster_bssid) VALUES (?,?,?,?)`)
    .run(type, normalizedTier, source, bssid);
  const box = db.prepare('SELECT * FROM loot_boxes WHERE id=?').get(Number(result.lastInsertRowid));
  logEvent('loot_box', `${normalizedTier} ${type} Box acquired. It remains sealed until Carl reaches safety.`, { box });
  return box;
}

function itemStats(item) {
  const tier = { common: 1, uncommon: 2, rare: 4, legendary: 7 }[item.rarity] || 1;
  return {
    power: item.type === 'weapon' ? tier : 0,
    defense: item.type === 'armor' ? tier : 0,
  };
}

function openSealedBoxes(reason = 'safe room') {
  const boxes = db.prepare("SELECT * FROM loot_boxes WHERE status='sealed' ORDER BY id LIMIT 8").all();
  if (!boxes.length) return [];
  const opened = [];
  for (const box of boxes) {
    const rarity = BOX_RARITY[box.tier] || 'common';
    const item = rollLoot(box.box_type === 'Boss' ? 'Boss' : 'Unknown Horror', box.source, rarity);
    const stats = itemStats(item);
    const result = db.prepare(`INSERT INTO loot
      (monster_bssid,item_name,item_type,rarity,flavor_text,power,defense,equipped)
      VALUES (?,?,?,?,?,?,?,0)`)
      .run(box.monster_bssid || '', item.name, item.type, item.rarity, item.flavor,
        stats.power, stats.defense);
    const contents = { ...item, ...stats, id: Number(result.lastInsertRowid) };
    db.prepare("UPDATE loot_boxes SET status='opened',contents=?,opened_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(contents), box.id);
    opened.push({ box, item: contents });
    logEvent('box_opened',
      `${box.tier} ${box.box_type} Box opened in the ${reason}: ${contents.name}. Donut has concerns.`,
      { box, item: contents, reason });
  }
  trainSkill('donut_diplomacy', boxes.length * 2);
  return opened;
}

function evaluateSponsors() {
  const crawler = db.prepare('SELECT floor,kills FROM crawler WHERE id=1').get();
  const audience = db.prepare('SELECT * FROM audience WHERE id=1').get();
  const unlocked = [];
  for (const [code, name, floor] of SPONSORS) {
    if (crawler.floor < floor) continue;
    const existing = db.prepare('SELECT * FROM sponsors WHERE code=?').get(code);
    if (!existing) {
      db.prepare('INSERT INTO sponsors (code,name,floor_unlocked,favor) VALUES (?,?,?,?)')
        .run(code, name, floor, Math.floor(audience.rating / 100));
      const sponsor = db.prepare('SELECT * FROM sponsors WHERE code=?').get(code);
      unlocked.push(sponsor);
      logEvent('sponsor', `${name} now sponsors Carl. Their legal department has already resigned.`, { sponsor });
    } else {
      db.prepare('UPDATE sponsors SET favor=? WHERE code=?')
        .run(Math.floor(audience.rating / 100), code);
    }
  }
  return unlocked;
}

function sponsorRewards() {
  const crawler = db.prepare('SELECT kills FROM crawler WHERE id=1').get();
  const sponsors = db.prepare('SELECT * FROM sponsors WHERE active=1 ORDER BY id').all();
  const boxes = [];
  for (const sponsor of sponsors) {
    const interval = Math.max(4, 8 - sponsor.id);
    if (!crawler.kills || crawler.kills % interval !== 0) continue;
    const duplicate = db.prepare(
      "SELECT id FROM loot_boxes WHERE source=? AND acquired_at >= datetime('now','-2 minutes')"
    ).get(sponsor.name);
    if (duplicate) continue;
    const tier = sponsor.favor >= 10 ? 'Gold' : sponsor.favor >= 4 ? 'Silver' : 'Bronze';
    boxes.push(awardBox({ type: 'Benefactor', tier, source: sponsor.name }));
    db.prepare('UPDATE sponsors SET boxes_sent=boxes_sent+1 WHERE id=?').run(sponsor.id);
  }
  return boxes;
}

function enterSafeRoom(ssid) {
  if (!isHomeNetwork(ssid)) return null;
  const now = Date.now();
  const last = Number(setting('last_safe_room_event', '0')) || 0;
  db.prepare(`UPDATE crawler SET health=max_health,stamina=max_stamina,
    mood='safe but supervised',last_recovery=datetime('now') WHERE id=1`).run();
  const opened = openSealedBoxes('home safe room');
  if (now - last > 10 * 60 * 1000) {
    db.prepare(`INSERT INTO world_settings(key,value) VALUES ('last_safe_room_event',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(now));
    logEvent('safe_room',
      `${ssid} recognized as a Safe Room. Violence suspended; Donut assumes command.`,
      { ssid, opened: opened.length });
  }
  return { status: 'safe_room', ssid, opened, crawler: db.prepare('SELECT * FROM crawler WHERE id=1').get() };
}

function onNetwork(network, isNew = false) {
  if (isNew) {
    addAudience('discover', { cr: network.cr });
    trainSkill('cartography', 3);
  }
  return isHomeNetwork(network.ssid) ? enterSafeRoom(network.ssid) : null;
}

function onBattle(event) {
  addAudience(event.critical ? 'critical' : 'battle', { cr: event.cr });
  trainSkill('signal_sense', 1);
  if (Number(event.signal || -100) >= -60) trainSkill('close_quarters', 1);
  if (event.dwellSeconds >= 60) trainSkill('stalking', 2);
  if (event.critical) trainSkill('critical_negotiation', 3);
  if (event.enemyHits) trainSkill('improvised_armor', 1);
}

function onDefeat(event) {
  addAudience('defeat', { cr: event.cr });
  const skill = trainSkill('tactical_retreat', 3);
  const heal = Math.max(5, Number(skill?.level || 1) * 2);
  db.prepare('UPDATE crawler SET health=MIN(max_health,health+?) WHERE id=1').run(heal);
}

function onVictory(monster) {
  const crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  addAudience('victory', { cr: monster.cr, isBoss: monster.is_boss });
  const box = monster.is_boss
    ? awardBox({
        type: 'Boss',
        tier: boxTierForBoss(monster.boss_tier || bossTierFor(monster, crawler, true)),
        source: monster.ssid || monster.monster_type,
        bssid: monster.bssid,
      })
    : awardBox({ type: 'Adventurer', tier: 'Bronze', source: monster.ssid || monster.monster_type, bssid: monster.bssid });
  evaluateSponsors();
  const benefactor = sponsorRewards();
  return { box, benefactor };
}

function state() {
  const crawler = db.prepare('SELECT floor FROM crawler WHERE id=1').get();
  evaluateSponsors();
  const boxes = db.prepare(`SELECT * FROM loot_boxes ORDER BY id DESC LIMIT 20`).all();
  const sealedCount = db.prepare("SELECT COUNT(*) count FROM loot_boxes WHERE status='sealed'").get().count;
  const safeSsid = homeSsid();
  const safeActive = Boolean(db.prepare(
    "SELECT id FROM monsters WHERE lower(ssid)=lower(?) AND last_seen >= datetime('now','-2 minutes')"
  ).get(safeSsid));
  let travellingMerchant = {};
  try {
    travellingMerchant = JSON.parse(setting('travelling_merchant', '{}') || '{}');
  } catch {
    travellingMerchant = {};
  }
  travellingMerchant.active = Boolean(
    travellingMerchant.lastSeen && Date.now() - Number(travellingMerchant.lastSeen) < 3 * 60 * 1000
  );
  return {
    audience: db.prepare('SELECT * FROM audience WHERE id=1').get(),
    lootBoxes: boxes,
    sealedBoxes: sealedCount,
    skills: db.prepare('SELECT * FROM skills ORDER BY level DESC,name').all(),
    sponsors: db.prepare('SELECT * FROM sponsors WHERE active=1 ORDER BY id').all(),
    floorRule: currentFloorRule(crawler.floor),
    safeRoom: { ssid: safeSsid, active: safeActive },
    travellingMerchant,
    bossTiers: BOSS_TIERS,
  };
}

module.exports = {
  currentFloorRule, isHomeNetwork, isTrustedDevice, isMobileMerchant,
  visitTravellingMerchant, enterSafeRoom, addAudience, trainSkill,
  skillBonuses, bossTierFor, awardBox, openSealedBoxes, evaluateSponsors,
  onNetwork, onBattle, onDefeat, onVictory, state,
};
