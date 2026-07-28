const express = require('express');
const path = require('path');
const EventEmitter = require('events');
const db = require('./db');
const { classifyMonster, rollLoot, addXP, checkAchievements, logEvent, getCrawlerState } = require('./game-engine');
const { narrate } = require('./narrator');
const battleEngine = require('./battle-engine');
const { scoreTargets, getModelStats } = require('./ai-targeting');
const progression = require('./progression-engine');
const world = require('./world-engine');

const app = express();
const PORT = Number(process.env.PORT || 9310);

function cleanSsid(value) {
  const ssid = String(value || '')
    .replace(/(?:\\x0{1,2})+/gi, '')
    .replace(/\0/g, '')
    .replace(/[\u0001-\u001f\u007f]/g, '')
    .trim();
  return !ssid || ssid === '--' ? '' : ssid;
}

// Repair malformed blank SSIDs previously reported by some USB WiFi drivers.
for (const monster of db.prepare('SELECT bssid,ssid FROM monsters').all()) {
  const cleaned = cleanSsid(monster.ssid);
  if (cleaned !== String(monster.ssid || '')) {
    db.prepare('UPDATE monsters SET ssid=?,monster_name=? WHERE bssid=?')
      .run(cleaned, cleaned || '[Hidden]', monster.bssid);
  }
}

// SSE event bus
const bus = new EventEmitter();
bus.setMaxListeners(50);
battleEngine.setEmitter(bus);
const offlineProgress = progression.applyOfflineProgress();
progression.ensureQuest();
setInterval(() => {
  db.prepare("UPDATE crawler SET last_active=datetime('now') WHERE id=1").run();
}, 60000).unref();
setInterval(() => {
  const town = progression.visitTownIfDue();
  if (town) {
    const theft = world.townTheft();
    bus.emit('event', { type: 'town', scheduled: true, ...town, theft });
  }
}, 60000).unref();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE stream for live dashboard updates ──────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  bus.on('event', listener);
  req.on('close', () => bus.off('event', listener));
});

// ── Pi agent endpoints ─────────────────────────────────────────────────────────

// POST /api/network  — Pi reports a network it sees
app.post('/api/network', async (req, res) => {
  const { bssid, encryption, signal, channel, vendor, clients } = req.body;
  const ssid = cleanSsid(req.body.ssid);
  if (!bssid) return res.status(400).json({ error: 'bssid required' });

  const { type: monsterType, cr, xp: xpValue } = classifyMonster({ encryption, signal, ssid });

  const existing = db.prepare('SELECT id FROM monsters WHERE bssid=?').get(bssid);
  if (existing) {
    db.prepare(`UPDATE monsters SET last_seen=datetime('now'),signal=?,clients=?,
      ssid=?,monster_name=?,encryption=?,channel=?,vendor=? WHERE bssid=?`)
      .run(signal, clients || 0, ssid, ssid || '[Hidden]', encryption, channel,
        vendor || '', bssid);
    world.recordNetwork({ bssid, signal }, false);
    world.regionFor(db.prepare("SELECT bssid FROM monsters WHERE last_seen >= datetime('now','-3 minutes')").all());
    return res.json({ status: 'updated', monsterType, cr });
  }

  // New monster!
  const monsterName = ssid || '[Hidden]';
  db.prepare(`INSERT INTO monsters (bssid,ssid,encryption,signal,channel,vendor,monster_type,monster_name,cr,xp_value)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(bssid, ssid, encryption, signal, channel, vendor || '', monsterType, monsterName, cr, xpValue);
  world.recordNetwork({ bssid, signal }, true);
  world.regionFor(db.prepare("SELECT bssid FROM monsters WHERE last_seen >= datetime('now','-3 minutes')").all());

  // Respond immediately — narration happens async via SSE
  res.json({ status: 'new_monster', monsterType, cr, xpValue });

  // Fire-and-forget: narrate + broadcast
  (async () => {
    const msg = await narrate('monster_spotted', { ssid: ssid || '[Hidden]', monsterType, cr });
    logEvent('monster_spotted', msg, { bssid, ssid, monsterType, cr });
    bus.emit('event', { type: 'monster_spotted', message: msg, bssid, ssid, monsterType, cr, signal });

    if (monsterType === 'Naked Slime') {
      const ach = checkAchievements('naked_truth');
      if (ach) {
        const achMsg = await narrate('achievement', { achievementName: ach.name, desc: ach.description });
        logEvent('achievement', achMsg, { achievement: ach });
        bus.emit('event', { type: 'achievement', message: achMsg, achievement: ach });
      }
    }

    if (monsterType === 'Invisible Stalker') {
      const ach = checkAchievements('ghost_detector');
      if (ach) {
        const achMsg = await narrate('achievement', { achievementName: ach.name, desc: ach.description });
        logEvent('achievement', achMsg, { achievement: ach });
        bus.emit('event', { type: 'achievement', message: achMsg, achievement: ach });
      }
    }
  })();
});

// POST /api/encounter — a safe game turn based only on public beacon metadata.
app.post('/api/encounter', async (req, res) => {
  const { bssid, signal = -90, dwell_seconds = 0 } = req.body || {};
  if (!bssid) return res.status(400).json({ error: 'bssid required' });
  const result = await battleEngine.advanceEncounter(bssid, signal, dwell_seconds);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// POST /api/event  — generic game events from Pi
app.post('/api/event', async (req, res) => {
  const { type, data } = req.body;
  logEvent(type, '', data);
  bus.emit('event', { type, ...data });
  res.json({ status: 'ok' });
});

// ── Dashboard API ───────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const crawler      = getCrawlerState();
  const monsters     = db.prepare('SELECT * FROM monsters ORDER BY last_seen DESC LIMIT 50').all();
  const loot         = db.prepare('SELECT * FROM loot ORDER BY acquired_at DESC LIMIT 20').all();
  const achievements = db.prepare('SELECT * FROM achievements ORDER BY unlocked_at DESC').all();
  const events       = db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 30').all();
  const progress     = progression.progressionState();
  const worldState   = world.state();

  // Attach AI scores to each monster for dashboard display
  const scored   = scoreTargets(monsters);
  const scoreMap = Object.fromEntries(scored.map(s => [s.bssid, s.ai_score]));
  const monstersWithAI = monsters.map(m => ({ ...m, ai_score: scoreMap[m.bssid] ?? null }));

  res.json({ crawler, monsters: monstersWithAI, loot, achievements, events, ...progress, ...worldState });
});

app.get('/api/chronicle', (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 500').all());
});

app.post('/api/crawler/name', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const clean = name.trim().slice(0, 32);
  db.prepare('UPDATE crawler SET name=? WHERE id=1').run(clean);
  res.json({ name: clean });
});

// ── AI Targeting ────────────────────────────────────────────────────────────
// Pi POSTs its candidate networks; NUC returns them AI-scored and ranked
app.post('/api/targeting', (req, res) => {
  const { candidates } = req.body;
  if (!Array.isArray(candidates) || !candidates.length)
    return res.status(400).json({ error: 'candidates array required' });
  const defeated = new Set(
    db.prepare("SELECT bssid FROM monsters WHERE status='dead'").all().map(row => row.bssid)
  );
  res.json({
    targets: scoreTargets(candidates).filter(candidate => !defeated.has(candidate.bssid)),
    model: 'signal-encounter-v1',
  });
});

app.get('/api/targeting/stats', (req, res) => {
  res.json(getModelStats());
});

app.get('/api/leaderboard', (req, res) => {
  const top = db.prepare("SELECT ssid, monster_type, xp_value, encryption FROM monsters WHERE status='dead' ORDER BY xp_value DESC LIMIT 10").all();
  res.json(top);
});

app.post('/api/control', (req, res) => {
  const { action, value } = req.body || {};
  if (action === 'town') {
    const result = progression.visitTownIfNeeded(true) || { message: 'Town refused entry. Inventory insufficiently embarrassing.' };
    return res.json(result);
  }
  if (action === 'heal') {
    db.prepare("UPDATE crawler SET health=max_health,stamina=max_stamina,mood='refreshed' WHERE id=1").run();
    logEvent('rest', 'Carl was ordered to rest. He filed a complaint with nobody.', {});
    return res.json({ status: 'rested' });
  }
  if (action === 'prestige') {
    const result = world.prestige();
    return res.status(result.error ? 400 : 200).json(result);
  }
  if (action === 'refresh') {
    logEvent('display_refresh', 'The display was ordered to refresh. Pixels report for duty.', {});
    bus.emit('event', { type: 'display_refresh', message: 'Display refresh requested.' });
    return res.json({ message: 'Display refresh queued.' });
  }
  const result = world.setControl(action, value);
  return res.status(result.error ? 400 : 200).json(result);
});

app.get('/api/monster/:bssid', (req, res) => {
  const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(req.params.bssid);
  if (!monster) return res.status(404).json({ error: 'monster not found' });
  const history = db.prepare("SELECT * FROM events WHERE data LIKE ? ORDER BY id DESC LIMIT 50")
    .all(`%${req.params.bssid}%`);
  res.json({ monster, history });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DUNGEON CRAWLER] NUC Server running on port ${PORT}`);
  console.log(`[DUNGEON CRAWLER] Dashboard: http://localhost:${PORT}`);
  console.log(`[DUNGEON CRAWLER] Pi connects via Tailscale: http://100.121.89.115:${PORT}`);
});
