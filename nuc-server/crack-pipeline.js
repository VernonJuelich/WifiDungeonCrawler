const chokidar = require('chokidar');
const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { rollLoot, addXP, checkAchievements, logEvent } = require('./game-engine');
const { narrate } = require('./narrator');

const HANDSHAKE_DIR = path.join(__dirname, 'handshakes');
const CRACKED_DIR = path.join(__dirname, 'cracked');
const HASHCAT_BIN = 'C:\\tools\\hashcat\\hashcat-7.1.2\\hashcat.exe';
const WORDLISTS = [
  'C:\\wordlists\\rockyou.txt',
  'C:\\wordlists\\custom.txt',
].filter(p => fs.existsSync(p));

let eventEmitter = null;

function setEmitter(emitter) {
  eventEmitter = emitter;
}

function broadcast(type, data) {
  if (eventEmitter) eventEmitter.emit(type, data);
}

async function crackWithHashcat(capFile, bssid) {
  if (!WORDLISTS.length) {
    console.log('[CRACK] No wordlists found. Install rockyou.txt to C:\\wordlists\\');
    return null;
  }
  return new Promise((resolve) => {
    const potFile = path.join(CRACKED_DIR, `${bssid.replace(/:/g, '')}.pot`);
    const args = ['-m', '22000', capFile, WORDLISTS[0], '--potfile-path', potFile, '--quiet', '--status'];

    const hashcat = exec(`"${HASHCAT_BIN}" ${args.join(' ')}`, { timeout: 300000 }, (err, stdout) => {
      if (fs.existsSync(potFile)) {
        const pot = fs.readFileSync(potFile, 'utf8').trim();
        if (pot) {
          const password = pot.split(':').pop();
          resolve(password);
          return;
        }
      }
      resolve(null);
    });
  });
}

async function crackWithAircrack(capFile, bssid) {
  if (!WORDLISTS.length) return null;
  return new Promise((resolve) => {
    const args = ['-b', bssid, '-w', WORDLISTS[0], capFile];
    exec(`aircrack-ng ${args.join(' ')}`, { timeout: 300000 }, (err, stdout) => {
      const match = stdout && stdout.match(/KEY FOUND!\s*\[\s*(.+?)\s*\]/);
      resolve(match ? match[1] : null);
    });
  });
}

async function processHandshake(capFile) {
  const filename = path.basename(capFile, path.extname(capFile));
  // Filename format expected: BSSID_SSID.cap (e.g. aa-bb-cc-dd-ee-ff_MyNetwork.cap)
  const parts = filename.split('_');
  const bssid = parts[0].replace(/-/g, ':');
  const ssid = parts.slice(1).join('_');

  console.log(`[CRACK] Processing: ${ssid} (${bssid})`);

  const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(bssid);
  if (!monster) {
    console.log(`[CRACK] No monster record for ${bssid}, skipping game events`);
  }

  db.prepare('UPDATE monsters SET handshake_captured=1, status="wounded" WHERE bssid=?').run(bssid);

  const handshakeMsg = await narrate('handshake', {
    ssid, monsterType: monster?.monster_type || 'Unknown Horror',
  });
  logEvent('handshake', handshakeMsg, { bssid, ssid });
  broadcast('event', { type: 'handshake', message: handshakeMsg, bssid, ssid });

  // Try hashcat first, fall back to aircrack-ng
  let password = await crackWithHashcat(capFile, bssid);
  if (!password) password = await crackWithAircrack(capFile, bssid);

  if (password) {
    await handleKill(bssid, ssid, password, monster);
  } else {
    const failMsg = await narrate('crack_fail', { ssid, monsterType: monster?.monster_type || 'Unknown' });
    logEvent('crack_fail', failMsg, { bssid, ssid });
    broadcast('event', { type: 'crack_fail', message: failMsg, bssid, ssid });
  }

  // Move cap file to cracked dir
  const dest = path.join(CRACKED_DIR, path.basename(capFile));
  try { fs.renameSync(capFile, dest); } catch {}
}

async function handleKill(bssid, ssid, password, monster) {
  db.prepare('UPDATE monsters SET cracked=1, status="dead", password=? WHERE bssid=?').run(password, bssid);
  db.prepare('UPDATE crawler SET kills=kills+1 WHERE id=1').run();

  const xpGain = monster?.xp_value || 200;
  const { level, leveled } = addXP(xpGain);

  const killMsg = await narrate('kill', { ssid, monsterType: monster?.monster_type || 'Unknown Horror', password });
  logEvent('kill', killMsg, { bssid, ssid, password, xp: xpGain });
  broadcast('event', { type: 'kill', message: killMsg, bssid, ssid, password, xp: xpGain });

  // Drop loot
  const loot = rollLoot(monster?.monster_type, ssid);
  db.prepare('INSERT INTO loot (monster_bssid, item_name, item_type, rarity, flavor_text) VALUES (?,?,?,?,?)')
    .run(bssid, loot.name, loot.type, loot.rarity, loot.flavor);

  const lootMsg = await narrate('loot', { itemName: loot.name, rarity: loot.rarity, flavor: loot.flavor });
  logEvent('loot', lootMsg, { item: loot });
  broadcast('event', { type: 'loot', message: lootMsg, item: loot });

  if (leveled) {
    const lvlMsg = await narrate('level_up', { level });
    logEvent('level_up', lvlMsg, { level });
    broadcast('event', { type: 'level_up', message: lvlMsg, level });
  }

  // Check achievements
  const enc = (monster?.encryption || '').toLowerCase();
  const achievementChecks = [];

  const totalKills = db.prepare('SELECT kills FROM crawler WHERE id=1').get().kills;
  if (totalKills === 1) achievementChecks.push('first_blood');
  if (totalKills >= 100) achievementChecks.push('century');
  if (enc.includes('wep')) achievementChecks.push('goblin_slayer');
  if (enc.includes('wpa') && !enc.includes('wpa2') && !enc.includes('wpa3')) achievementChecks.push('troll_hunter');
  if (enc.includes('wpa2')) achievementChecks.push('dragon_hunter');
  if (enc.includes('wpa3')) achievementChecks.push('lich_king');
  if (monster?.monster_type === 'Common Peasant') achievementChecks.push('peasant_slayer');

  const totalLoot = db.prepare('SELECT COUNT(*) as c FROM loot').get().c;
  if (totalLoot >= 10) achievementChecks.push('hoarder');

  for (const code of achievementChecks) {
    const ach = checkAchievements(code);
    if (ach) {
      const achMsg = await narrate('achievement', { achievementName: ach.name, desc: ach.description });
      logEvent('achievement', achMsg, { achievement: ach });
      broadcast('event', { type: 'achievement', message: achMsg, achievement: ach });
    }
  }
}

function startWatcher() {
  console.log(`[CRACK] Watching ${HANDSHAKE_DIR} for new captures...`);
  const watcher = chokidar.watch(HANDSHAKE_DIR, {
    ignored: /^\./,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcher.on('add', (filePath) => {
    if (['.cap', '.pcapng', '.pcap', '.hccapx', '.22000'].includes(path.extname(filePath).toLowerCase())) {
      processHandshake(filePath);
    }
  });
}

module.exports = { startWatcher, setEmitter, handleKill };
