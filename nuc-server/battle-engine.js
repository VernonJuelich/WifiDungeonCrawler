const crypto = require('crypto');
const db = require('./db');
const { rollLoot, addXP, checkAchievements, logEvent } = require('./game-engine');
const { narrate } = require('./narrator');

let eventEmitter = null;

function setEmitter(emitter) {
  eventEmitter = emitter;
}

function broadcast(type, data) {
  if (eventEmitter) eventEmitter.emit(type, data);
}

function encounterRequired(monster) {
  return Math.max(35, Math.min(240, 35 + (Number(monster.cr) || 1) * 9));
}

function turnPower(monster, signal) {
  const strength = Math.max(1, Math.min(50, 100 + Number(signal || -90)));
  const seed = crypto
    .createHash('sha256')
    .update(`${monster.bssid}:${monster.encounter_progress || 0}`)
    .digest()[0];
  return Math.max(4, Math.round(strength * 0.45) + (seed % 7));
}

async function advanceEncounter(bssid, signal) {
  const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(bssid);
  if (!monster) return { error: 'monster_not_found' };

  const required = monster.encounter_required || encounterRequired(monster);
  if (monster.status === 'dead') {
    return { status: 'defeated', progress: required, required };
  }

  const power = turnPower(monster, signal);
  const progress = Math.min(required, (monster.encounter_progress || 0) + power);
  const firstTurn = (monster.encounter_progress || 0) === 0;

  db.prepare(`
    UPDATE monsters
       SET encounter_progress=?, encounter_required=?, signal=?,
           status=?, last_seen=datetime('now')
     WHERE bssid=?
  `).run(progress, required, signal, progress >= required ? 'dead' : 'engaged', bssid);

  if (firstTurn) {
    const message = await narrate('encounter', {
      ssid: monster.ssid || '[Hidden]',
      monsterType: monster.monster_type,
    });
    logEvent('encounter', message, { bssid, signal, progress, required });
    broadcast('event', {
      type: 'encounter', message, bssid, ssid: monster.ssid,
      progress, required, signal,
    });
  } else {
    broadcast('event', {
      type: 'battle_turn', bssid, ssid: monster.ssid,
      progress, required, power, signal,
    });
  }

  if (progress >= required) {
    await handleVictory({ ...monster, encounter_required: required }, signal);
    return { status: 'victory', progress, required, power };
  }

  return { status: 'engaged', progress, required, power };
}

async function handleVictory(monster, signal) {
  const bssid = monster.bssid;
  const ssid = monster.ssid || '[Hidden]';

  db.prepare(`
    UPDATE monsters
       SET status='dead', victories=victories+1,
           encounter_progress=encounter_required
     WHERE bssid=?
  `).run(bssid);
  db.prepare('UPDATE crawler SET kills=kills+1 WHERE id=1').run();

  const xpGain = monster.xp_value || 200;
  const { level, leveled } = addXP(xpGain);
  const message = await narrate('victory', {
    ssid,
    monsterType: monster.monster_type || 'Unknown Horror',
  });

  logEvent('victory', message, { bssid, ssid, xp: xpGain, signal });
  broadcast('event', { type: 'victory', message, bssid, ssid, xp: xpGain });

  const loot = rollLoot(monster.monster_type, ssid);
  db.prepare(`
    INSERT INTO loot (monster_bssid, item_name, item_type, rarity, flavor_text)
    VALUES (?,?,?,?,?)
  `).run(bssid, loot.name, loot.type, loot.rarity, loot.flavor);
  const lootMessage = await narrate('loot', {
    itemName: loot.name, rarity: loot.rarity, flavor: loot.flavor,
  });
  logEvent('loot', lootMessage, { item: loot });
  broadcast('event', { type: 'loot', message: lootMessage, item: loot });

  if (leveled) {
    const levelMessage = await narrate('level_up', { level });
    logEvent('level_up', levelMessage, { level });
    broadcast('event', { type: 'level_up', message: levelMessage, level });
  }

  const checks = [];
  const totalKills = db.prepare('SELECT kills FROM crawler WHERE id=1').get().kills;
  if (totalKills === 1) checks.push('first_blood');
  if (totalKills >= 100) checks.push('century');
  if (monster.monster_type === 'Common Peasant') checks.push('peasant_slayer');
  if ((monster.encryption || '').toLowerCase().includes('wpa3')) checks.push('lich_king');
  if ((monster.encryption || '').toLowerCase().includes('wpa2')) checks.push('dragon_hunter');
  if (db.prepare('SELECT COUNT(*) AS count FROM loot').get().count >= 10) checks.push('hoarder');

  for (const code of checks) {
    const achievement = checkAchievements(code);
    if (!achievement) continue;
    const achievementMessage = await narrate('achievement', {
      achievementName: achievement.name,
      desc: achievement.description,
    });
    logEvent('achievement', achievementMessage, { achievement });
    broadcast('event', {
      type: 'achievement', message: achievementMessage, achievement,
    });
  }
}

module.exports = { setEmitter, advanceEncounter };
