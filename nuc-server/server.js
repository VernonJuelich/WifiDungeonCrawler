const express = require('express');
const path = require('path');
const EventEmitter = require('events');
const db = require('./db');
const { classifyMonster, rollLoot, addXP, checkAchievements, logEvent, getCrawlerState } = require('./game-engine');
const { narrate } = require('./narrator');
const crackPipeline = require('./crack-pipeline');
const { scoreTargets, getModelStats } = require('./ai-targeting');

const app = express();
const PORT = 9310;

// SSE event bus
const bus = new EventEmitter();
bus.setMaxListeners(50);
crackPipeline.setEmitter(bus);

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
  const { bssid, ssid, encryption, signal, channel, vendor, clients } = req.body;
  if (!bssid) return res.status(400).json({ error: 'bssid required' });

  const { type: monsterType, cr, xp: xpValue } = classifyMonster({ encryption, signal, ssid });

  const existing = db.prepare('SELECT id FROM monsters WHERE bssid=?').get(bssid);
  if (existing) {
    db.prepare(`UPDATE monsters SET last_seen=datetime('now'), signal=?, clients=? WHERE bssid=?`)
      .run(signal, clients || 0, bssid);
    return res.json({ status: 'updated', monsterType, cr });
  }

  // New monster!
  const monsterName = ssid || '[Hidden]';
  db.prepare(`INSERT INTO monsters (bssid,ssid,encryption,signal,channel,vendor,monster_type,monster_name,cr,xp_value)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(bssid, ssid, encryption, signal, channel, vendor || '', monsterType, monsterName, cr, xpValue);

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

// POST /api/handshake  — Pi sends a .cap file (multipart) or signals capture
app.post('/api/handshake', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const bssid = req.headers['x-bssid'];
  const ssid  = req.headers['x-ssid'] || '';
  if (!bssid) return res.status(400).json({ error: 'x-bssid header required' });

  if (req.body && req.body.length) {
    const fs = require('fs');
    const safeBssid = bssid.replace(/:/g, '-');
    const safeSsid  = ssid.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename  = `${safeBssid}_${safeSsid}.cap`;
    fs.writeFileSync(path.join(__dirname, 'handshakes', filename), req.body);
    // crack-pipeline watcher will pick it up automatically
    res.json({ status: 'queued', filename });
  } else {
    // Pi just signals a capture happened (no file upload), mark it
    db.prepare(`UPDATE monsters SET handshake_captured=1, status='wounded' WHERE bssid=?`).run(bssid);
    const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(bssid);
    res.json({ status: 'noted' });
    (async () => {
      const msg = await narrate('handshake', { ssid, monsterType: monster?.monster_type || 'Unknown' });
      logEvent('handshake', msg, { bssid, ssid });
      bus.emit('event', { type: 'handshake', message: msg, bssid, ssid });
    })();
  }
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

  // Attach AI scores to each monster for dashboard display
  const scored   = scoreTargets(monsters);
  const scoreMap = Object.fromEntries(scored.map(s => [s.bssid, s.ai_score]));
  const monstersWithAI = monsters.map(m => ({ ...m, ai_score: scoreMap[m.bssid] ?? null }));

  res.json({ crawler, monsters: monstersWithAI, loot, achievements, events });
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
  res.json({ targets: scoreTargets(candidates), model: 'bayesian-contextual-v1' });
});

app.get('/api/targeting/stats', (req, res) => {
  res.json(getModelStats());
});

app.get('/api/leaderboard', (req, res) => {
  const top = db.prepare('SELECT ssid, monster_type, xp_value, encryption FROM monsters WHERE cracked=1 ORDER BY xp_value DESC LIMIT 10').all();
  res.json(top);
});

// ── Start ───────────────────────────────────────────────────────────────────────
crackPipeline.startWatcher();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DUNGEON CRAWLER] NUC Server running on port ${PORT}`);
  console.log(`[DUNGEON CRAWLER] Dashboard: http://localhost:${PORT}`);
  console.log(`[DUNGEON CRAWLER] Pi connects via Tailscale: http://100.121.89.115:${PORT}`);
});
