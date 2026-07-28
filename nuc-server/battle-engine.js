const crypto = require('crypto');
const db = require('./db');
const { rollLoot, addXP, checkAchievements, logEvent } = require('./game-engine');
const { narrate } = require('./narrator');

let eventEmitter = null;
const FLOOR_KILLS = 5;

function setEmitter(emitter) { eventEmitter = emitter; }
function broadcast(type, data) {
  if (eventEmitter) eventEmitter.emit(type, data);
}

function seededByte(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest()[0];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isNight() {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 20;
}

function recoverCrawler(crawler) {
  const last = Date.parse(`${crawler.last_recovery || ''}Z`) || Date.now();
  const elapsed = Math.max(0, (Date.now() - last) / 1000);
  const health = Math.min(crawler.max_health, crawler.health + Math.floor(elapsed / 45));
  const stamina = Math.min(crawler.max_stamina, crawler.stamina + Math.floor(elapsed / 12) * 3);
  if (health !== crawler.health || stamina !== crawler.stamina) {
    db.prepare(`
      UPDATE crawler SET health=?, stamina=?, last_recovery=datetime('now') WHERE id=1
    `).run(health, stamina);
  }
  return { ...crawler, health, stamina };
}

function ensureMonsterStats(monster, crawler) {
  const bossByMilestone = crawler.kills > 0 && crawler.kills % FLOOR_KILLS === FLOOR_KILLS - 1;
  const rareBoss = seededByte(monster.bssid, 'boss') < 14;
  const isBoss = monster.is_boss || bossByMilestone || rareBoss;
  const maxHp = monster.max_hp || Math.max(25, 30 + monster.cr * 14) * (isBoss ? 2 : 1);
  const hp = monster.hp > 0 ? monster.hp : maxHp;
  const roomId = monster.room_id || `F${crawler.floor}-CH${monster.channel || 0}`;
  db.prepare(`
    UPDATE monsters SET hp=?, max_hp=?, is_boss=?, room_id=? WHERE bssid=?
  `).run(hp, maxHp, isBoss ? 1 : 0, roomId, monster.bssid);
  return { ...monster, hp, max_hp: maxHp, is_boss: isBoss ? 1 : 0, room_id: roomId };
}

function moodFor({ victory = false, defeated = false, critical = false, stamina, isBoss, signal }) {
  if (victory && isBoss) return 'legendary';
  if (victory) return critical ? 'triumphant' : 'proud';
  if (defeated) return 'wounded';
  if (stamina < 20) return 'exhausted';
  if (signal > -55) return 'aggressive';
  return isNight() ? 'cautious' : 'curious';
}

async function advanceEncounter(bssid, signal, dwellSeconds = 0) {
  let crawler = recoverCrawler(db.prepare('SELECT * FROM crawler WHERE id=1').get());
  let monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(bssid);
  if (!monster) return { error: 'monster_not_found' };
  monster = ensureMonsterStats(monster, crawler);

  if (monster.status === 'dead') {
    return { status: 'defeated', hp: 0, maxHp: monster.max_hp, crawler };
  }
  if (crawler.health <= 0) {
    return { status: 'recovering', hp: monster.hp, maxHp: monster.max_hp, crawler };
  }
  if (crawler.stamina < 8) {
    const mood = 'exhausted';
    db.prepare("UPDATE crawler SET mood=? WHERE id=1").run(mood);
    return { status: 'resting', hp: monster.hp, maxHp: monster.max_hp, crawler: { ...crawler, mood } };
  }

  const turn = Math.max(monster.dwell_seconds || 0, Number(dwellSeconds || 0));
  const roll = seededByte(bssid, turn, crawler.kills);
  const closeness = clamp(100 + Number(signal || -90), 5, 55);
  const accuracy = clamp(55 + closeness * 0.7 + crawler.level, 55, 96);
  const hit = (roll % 100) < accuracy;
  const critical = hit && ((roll >> 2) % 100) < (10 + Math.floor(closeness / 5));
  const nightBonus = isNight() ? 2 : 0;
  let damage = 0;
  if (hit) {
    damage = 4 + crawler.level + crawler.weapon_power + Math.floor(closeness / 8) + nightBonus;
    if (critical) damage *= 2;
  }

  // Staying close to a boss charges a periodic special attack.
  const bossCharge = monster.is_boss && dwellSeconds >= 60;
  if (bossCharge) damage += 20 + crawler.level * 2;

  const hp = Math.max(0, monster.hp - damage);
  const stamina = Math.max(0, crawler.stamina - (critical ? 10 : 8));
  const enemyRoll = seededByte(bssid, turn, 'counter');
  const enemyHits = hp > 0 && enemyRoll % 100 < clamp(35 + monster.cr * 2, 35, 78);
  const enemyDamage = enemyHits
    ? Math.max(1, 2 + Math.floor(monster.cr / 2) + (monster.is_boss ? 4 : 0) - crawler.armor_power)
    : 0;
  const crawlerHealth = Math.max(0, crawler.health - enemyDamage);
  const defeated = crawlerHealth <= 0;
  const victory = hp <= 0;
  const mood = moodFor({
    victory, defeated, critical, stamina, isBoss: monster.is_boss, signal,
  });

  db.prepare(`
    UPDATE monsters SET hp=?, status=?, signal=?, dwell_seconds=?,
      last_seen=datetime('now'), last_battle_at=datetime('now')
    WHERE bssid=?
  `).run(hp, victory ? 'dead' : 'engaged', signal, turn, bssid);
  db.prepare(`
    UPDATE crawler SET health=?, stamina=?, mood=?, last_recovery=datetime('now') WHERE id=1
  `).run(crawlerHealth, stamina, mood);

  const event = {
    type: victory ? 'victory' : 'battle_turn',
    bssid, ssid: monster.ssid, monsterType: monster.monster_type,
    hit, critical, damage, enemyHits, enemyDamage, bossCharge,
    hp, maxHp: monster.max_hp, isBoss: Boolean(monster.is_boss),
    signal, dwellSeconds: turn,
    crawlerHealth, crawlerMaxHealth: crawler.max_health,
    stamina, maxStamina: crawler.max_stamina, mood,
  };

  if ((monster.dwell_seconds || 0) === 0) {
    const message = await narrate('encounter', {
      ssid: monster.ssid || '[Hidden]', monsterType: monster.monster_type,
    });
    event.message = message;
    logEvent('encounter', message, event);
  }
  broadcast('event', event);

  if (defeated) {
    const message = `SYSTEM: ${crawler.name} falls! Bjorn drags the crawler away to recover.`;
    db.prepare("UPDATE monsters SET status='alive' WHERE bssid=?").run(bssid);
    logEvent('defeat', message, event);
    broadcast('event', { ...event, type: 'defeat', message });
    return { status: 'defeat', ...event };
  }

  if (victory) {
    const rewards = await handleVictory(monster, event);
    return { status: 'victory', ...event, ...rewards };
  }
  return { status: hit ? 'hit' : 'miss', ...event };
}

function itemStats(loot) {
  const tier = { common: 1, uncommon: 2, rare: 4, legendary: 7 }[loot.rarity] || 1;
  return {
    power: loot.type === 'weapon' ? tier : 0,
    defense: loot.type === 'armor' ? tier : 0,
  };
}

async function handleVictory(monster, battle) {
  db.prepare(`
    UPDATE monsters SET status='dead', hp=0, victories=victories+1 WHERE bssid=?
  `).run(monster.bssid);
  db.prepare('UPDATE crawler SET kills=kills+1 WHERE id=1').run();

  const xpGain = monster.xp_value || 200;
  const { level, leveled } = addXP(xpGain);
  const crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const newFloor = Math.floor(crawler.kills / FLOOR_KILLS) + 1;
  if (newFloor > crawler.floor) {
    db.prepare('UPDATE crawler SET floor=? WHERE id=1').run(newFloor);
    const floorMessage = `SYSTEM: FLOOR ${newFloor} UNLOCKED. The dungeon gets meaner from here.`;
    logEvent('floor_up', floorMessage, { floor: newFloor });
    broadcast('event', { type: 'floor_up', message: floorMessage, floor: newFloor });
  }

  const message = await narrate('victory', {
    ssid: monster.ssid || '[Hidden]', monsterType: monster.monster_type,
  });
  logEvent('victory', message, { ...battle, xp: xpGain });
  broadcast('event', { ...battle, type: 'victory', message, xp: xpGain, floor: newFloor });

  const loot = rollLoot(monster.monster_type, monster.ssid);
  const stats = itemStats(loot);
  const autoEquip = stats.power > crawler.weapon_power || stats.defense > crawler.armor_power;
  if (autoEquip) {
    if (stats.power) db.prepare("UPDATE loot SET equipped=0 WHERE power>0").run();
    if (stats.defense) db.prepare("UPDATE loot SET equipped=0 WHERE defense>0").run();
  }
  const result = db.prepare(`
    INSERT INTO loot (monster_bssid,item_name,item_type,rarity,flavor_text,power,defense,equipped)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(monster.bssid, loot.name, loot.type, loot.rarity, loot.flavor,
    stats.power, stats.defense, autoEquip ? 1 : 0);
  if (autoEquip) {
    db.prepare(`
      UPDATE crawler SET weapon_power=MAX(weapon_power,?), armor_power=MAX(armor_power,?),
        mood='delighted' WHERE id=1
    `).run(stats.power, stats.defense);
  }
  const item = { ...loot, ...stats, equipped: autoEquip, id: Number(result.lastInsertRowid) };
  const lootMessage = await narrate('loot', {
    itemName: loot.name, rarity: loot.rarity, flavor: loot.flavor,
  });
  logEvent('loot', lootMessage, { item });
  broadcast('event', { type: 'loot', message: lootMessage, item });

  if (leveled) {
    const levelMessage = await narrate('level_up', { level });
    logEvent('level_up', levelMessage, { level });
    broadcast('event', { type: 'level_up', message: levelMessage, level });
  }

  for (const code of [
    crawler.kills === 1 ? 'first_blood' : null,
    crawler.kills >= 100 ? 'century' : null,
    monster.monster_type === 'Common Peasant' ? 'peasant_slayer' : null,
    monster.monster_type === 'The Lich' ? 'lich_king' : null,
    monster.monster_type?.includes('Wyvern') ? 'dragon_hunter' : null,
  ].filter(Boolean)) {
    const achievement = checkAchievements(code);
    if (!achievement) continue;
    const achievementMessage = await narrate('achievement', {
      achievementName: achievement.name, desc: achievement.description,
    });
    logEvent('achievement', achievementMessage, { achievement });
    broadcast('event', { type: 'achievement', message: achievementMessage, achievement });
  }

  return { xp: xpGain, item, floor: newFloor };
}

module.exports = { setEmitter, advanceEncounter };
