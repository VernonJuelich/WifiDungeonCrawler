const crypto = require('crypto');
const db = require('./db');
const { addXP, checkAchievements, logEvent } = require('./game-engine');

const DAILY = [
  ['discover', 'Open Some Questionable Doors', 'Discover new dungeon rooms.', 5],
  ['battle', 'Aggressive Negotiations', 'Complete automatic battle turns.', 8],
  ['victory', 'Reduce Local Router Population', 'Defeat nearby monsters.', 3],
];
const REGION_A = ['Forbidden', 'Damp', 'Overpriced', 'Unlicensed', 'Shouting', 'Suspicious'];
const REGION_B = ['Food Court', 'Router Catacombs', 'Mesh District', 'Parking Level', 'Dead Zone', 'Basement'];
const BOSS_TITLES = ['Devourer of Bandwidth', 'The Unrebooted', 'Keeper of Buffering', 'Lord of Channel Six'];

function hash(text, length = 12) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, length);
}

function today() { return new Date().toISOString().slice(0, 10); }
function weekKey() {
  const d = new Date();
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - first) / 86400000) + first.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ensureDailyQuests() {
  const date = today();
  for (const [code, title, description, required] of DAILY) {
    db.prepare(`INSERT OR IGNORE INTO daily_quests
      (quest_date,code,title,description,required,reward_gold,reward_xp)
      VALUES (?,?,?,?,?,?,?)`).run(date, code, title, description, required, 15 + required * 2, 25 + required * 5);
  }
  return db.prepare('SELECT * FROM daily_quests WHERE quest_date=? ORDER BY id').all(date);
}

function advanceDaily(code, amount = 1) {
  ensureDailyQuests();
  const quest = db.prepare('SELECT * FROM daily_quests WHERE quest_date=? AND code=?').get(today(), code);
  if (!quest || quest.status === 'completed') return null;
  const progress = Math.min(quest.required, quest.progress + amount);
  db.prepare('UPDATE daily_quests SET progress=? WHERE id=?').run(progress, quest.id);
  if (progress < quest.required) return { ...quest, progress };
  db.prepare("UPDATE daily_quests SET status='completed' WHERE id=?").run(quest.id);
  db.prepare('UPDATE crawler SET gold=gold+? WHERE id=1').run(quest.reward_gold);
  addXP(quest.reward_xp);
  const message = `Daily quest complete: ${quest.title}. Donut accepts the reward on your behalf.`;
  logEvent('daily_complete', message, { quest: { ...quest, progress } });
  return { ...quest, progress, status: 'completed', message };
}

function regionFor(networks) {
  const keys = [...new Set((networks || []).map(n => n.bssid).filter(Boolean))].sort().slice(0, 8);
  if (!keys.length) return null;
  const fingerprint = hash(keys.join('|'), 16);
  let region = db.prepare('SELECT * FROM regions WHERE fingerprint=?').get(fingerprint);
  if (!region) {
    const seed = parseInt(fingerprint.slice(0, 8), 16);
    const name = `The ${REGION_A[seed % REGION_A.length]} ${REGION_B[(seed >> 3) % REGION_B.length]}`;
    const id = `R-${fingerprint.slice(0, 6).toUpperCase()}`;
    db.prepare('INSERT INTO regions (id,name,fingerprint,room_count) VALUES (?,?,?,?)')
      .run(id, name, fingerprint, keys.length);
    region = db.prepare('SELECT * FROM regions WHERE id=?').get(id);
    logEvent('region', `New region discovered: ${name}. Property values immediately decline.`, { region });
  } else {
    db.prepare("UPDATE regions SET last_seen=datetime('now'),visits=visits+1,room_count=MAX(room_count,?) WHERE id=?")
      .run(keys.length, region.id);
  }
  db.prepare(`UPDATE monsters SET region_id=? WHERE bssid IN (${keys.map(() => '?').join(',')})`)
    .run(region.id, ...keys);
  return region;
}

function loreName(monster) {
  if (monster.lore_title) return monster.lore_title;
  const seed = parseInt(hash(monster.bssid, 8), 16);
  const title = monster.is_boss
    ? BOSS_TITLES[seed % BOSS_TITLES.length]
    : ['of the Weak Signal', 'the Needlessly Secured', 'of Mild Inconvenience', 'the Blinking'][seed % 4];
  return `${monster.ssid || 'The Hidden One'}, ${title}`;
}

function recordNetwork(network, isNew = false) {
  const monster = db.prepare('SELECT * FROM monsters WHERE bssid=?').get(network.bssid);
  if (!monster) return;
  const title = loreName(monster);
  db.prepare(`UPDATE monsters SET sightings=sightings+?,best_signal=MAX(best_signal,?),
    last_signal=?,lore_title=? WHERE bssid=?`)
    .run(isNew ? 0 : 1, Number(network.signal || -100), Number(network.signal || -100), title, network.bssid);
  if (isNew) advanceDaily('discover');
  evaluateAchievements();
}

function companionAction(context = {}) {
  const c = db.prepare('SELECT * FROM companion WHERE id=1').get();
  const seed = parseInt(hash(`${context.bssid}:${context.turn}:${c.friendship}`, 4), 16) % 100;
  let action = null;
  if (context.crawlerHealth < 45 && seed < 18) {
    const amount = 5 + c.level;
    db.prepare('UPDATE crawler SET health=MIN(max_health,health+?) WHERE id=1').run(amount);
    db.prepare("UPDATE companion SET heals=heals+1,friendship=friendship+2,mood='smug',last_action='heal' WHERE id=1").run();
    action = { type: 'heal', amount, message: `Donut heals Carl for ${amount}. Please do not mistake this for affection.` };
  } else if (seed < 10) {
    db.prepare("UPDATE companion SET friendship=friendship+1,mood='violent',last_action='critical' WHERE id=1").run();
    action = { type: 'critical', bonus: 4 + c.level, message: 'Donut identifies a weak point and looks disappointed you missed it.' };
  }
  if (action) logEvent('companion', action.message, action);
  return action;
}

function onBattle(monster, battle) {
  db.prepare('UPDATE monsters SET encounters=encounters+1 WHERE bssid=?').run(monster.bssid);
  advanceDaily('battle');
  return companionAction({
    bssid: monster.bssid, turn: battle.dwellSeconds,
    crawlerHealth: battle.crawlerHealth,
  });
}

function onVictory(monster, item) {
  advanceDaily('victory');
  const companion = db.prepare('SELECT * FROM companion WHERE id=1').get();
  const rare = ['rare', 'legendary'].includes(item?.rarity);
  const friendship = rare ? 4 : 1;
  db.prepare(`UPDATE companion SET friendship=friendship+?,finds=finds+1,
    level=1+CAST((friendship+?)/25 AS INTEGER),mood=? WHERE id=1`)
    .run(friendship, friendship, rare ? 'delighted' : 'judgmental');
  evaluateAchievements();
}

function onDefeat(monster) {
  db.prepare('UPDATE monsters SET defeats=defeats+1,nemesis=CASE WHEN defeats+1>=2 THEN 1 ELSE nemesis END WHERE bssid=?')
    .run(monster.bssid);
  evaluateAchievements();
}

function townTheft() {
  const companion = db.prepare('SELECT * FROM companion WHERE id=1').get();
  if ((companion.friendship + companion.steals) % 3) return null;
  const gold = 3 + companion.level * 2;
  db.prepare('UPDATE crawler SET gold=gold+? WHERE id=1').run(gold);
  db.prepare("UPDATE companion SET steals=steals+1,mood='innocent',last_action='steal' WHERE id=1").run();
  const message = `Donut acquired ${gold} gold in town. There were no witnesses willing to testify.`;
  logEvent('companion', message, { type: 'steal', gold });
  return { message, gold };
}

function unlock(code, name, description) {
  if (db.prepare('SELECT 1 FROM achievements WHERE code=?').get(code)) return null;
  db.prepare('INSERT INTO achievements (code,name,description) VALUES (?,?,?)').run(code, name, description);
  logEvent('achievement', `${name}: ${description}`, { code, name, description });
  return { code, name, description };
}

function evaluateAchievements() {
  const c = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const discovered = db.prepare('SELECT COUNT(*) count FROM monsters').get().count;
  const recurring = db.prepare('SELECT MAX(sightings) count FROM monsters').get().count || 0;
  const legendary = db.prepare("SELECT COUNT(*) count FROM loot WHERE rarity='legendary'").get().count;
  const nemeses = db.prepare('SELECT COUNT(*) count FROM monsters WHERE nemesis=1').get().count;
  if (discovered >= 50) unlock('probably_important', 'That Was Probably Important', 'Discovered 50 networks and remembered almost none of their names.');
  if (recurring >= 5) unlock('local_celebrity', 'Local Celebrity', 'Met the same monster at least five times.');
  if (legendary) unlock('donut_approves', 'Donut Approves', 'Found legendary loot. Approval remains provisional.');
  if (nemeses) unlock('its_personal', 'Now It Is Personal', 'Created a recurring nemesis through repeated humiliation.');
  if (c.health === 1) unlock('technically_alive', 'Technically Still Alive', 'Survived with exactly one health point.');
}

function weeklyRecap() {
  const key = weekKey();
  const existing = db.prepare('SELECT * FROM weekly_recaps WHERE week_key=?').get(key);
  if (existing) return existing;
  const since = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const stats = db.prepare(`SELECT
    SUM(type='victory') victories,SUM(type='defeat') defeats,SUM(type='loot') loot,
    SUM(type='town') towns FROM events WHERE created_at>=?`).get(since);
  const c = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const message = `${c.name} survived ${stats.victories || 0} victories, ${stats.defeats || 0} humiliations, `
    + `${stats.loot || 0} questionable acquisitions, and ${stats.towns || 0} retail incidents. Donut remains unrepentant.`;
  db.prepare('INSERT INTO weekly_recaps (week_key,message,data) VALUES (?,?,?)').run(key, message, JSON.stringify(stats));
  return db.prepare('SELECT * FROM weekly_recaps WHERE week_key=?').get(key);
}

function recentRecap() {
  const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  const stats = db.prepare(`SELECT
    SUM(type='victory') victories,
    SUM(type='defeat') defeats,
    SUM(type='loot') loot,
    SUM(type='town') towns,
    SUM(type='level_up') levels,
    SUM(type IN ('monster_spotted','region')) discoveries
    FROM events WHERE created_at>=?`).get(since);
  const result = Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, Number(value || 0)])
  );
  if (result.victories === 0) {
    result.message = 'No victories today. A bold strategy, assuming the strategy was administrative avoidance.';
  } else if (result.defeats > result.victories) {
    result.message = `${result.victories} wins and ${result.defeats} humiliations. The audience calls this character development.`;
  } else if (result.loot > result.victories * 2) {
    result.message = `${result.victories} victories produced ${result.loot} loot drops. Carl has mistaken hoarding for a build strategy.`;
  } else {
    result.message = `${result.victories} victories, ${result.defeats} humiliations, and standards remain technically above ground.`;
  }
  return result;
}

function prestige() {
  const c = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  if (c.floor < 10 && c.level < 20) return { error: 'Reach floor 10 or level 20 first.' };
  const points = Math.max(1, Math.floor(c.level / 10) + Math.floor(c.floor / 10));
  db.prepare(`UPDATE crawler SET prestige=prestige+1,prestige_points=prestige_points+?,
    level=1,xp=0,xp_next=100,kills=0,floor=1,act=1,quests_completed=0,
    max_health=100+(prestige_points+?)*5,max_stamina=100+(prestige_points+?)*3,
    health=100+(prestige_points+?)*5,stamina=100+(prestige_points+?)*3,
    title='Repeatedly Unsupervised' WHERE id=1`).run(points, points, points, points, points);
  db.prepare("UPDATE quests SET status='retired' WHERE status='active'").run();
  const message = `PRESTIGE ${c.prestige + 1}: Carl restarts with ${points} permanent points and absolutely no lessons learned.`;
  logEvent('prestige', message, { points });
  return { points, message };
}

function setControl(action, value) {
  const allowed = ['paused', 'difficulty', 'display_page', 'equipment_priority'];
  if (!allowed.includes(action)) return { error: 'Unknown control.' };
  if (action === 'paused') db.prepare('UPDATE crawler SET paused=? WHERE id=1').run(value ? 1 : 0);
  if (action === 'difficulty') {
    if (!['relaxed', 'normal', 'brutal'].includes(value)) return { error: 'Invalid difficulty.' };
    db.prepare('UPDATE crawler SET difficulty=? WHERE id=1').run(value);
  }
  if (action === 'display_page') {
    if (!['auto', 'battle', 'character', 'quest', 'donut', 'loot', 'summary', 'recap'].includes(value)) return { error: 'Invalid display page.' };
    db.prepare('UPDATE crawler SET display_page=? WHERE id=1').run(value);
  }
  if (action === 'equipment_priority') {
    if (!['balanced', 'power', 'defense'].includes(value)) return { error: 'Invalid equipment priority.' };
    db.prepare('UPDATE crawler SET equipment_priority=? WHERE id=1').run(value);
  }
  return db.prepare('SELECT paused,difficulty,display_page,equipment_priority FROM crawler WHERE id=1').get();
}

function state() {
  ensureDailyQuests();
  const monsters = db.prepare(`SELECT * FROM monsters ORDER BY nemesis DESC,is_boss DESC,last_seen DESC`).all();
  const regions = db.prepare('SELECT * FROM regions ORDER BY last_seen DESC LIMIT 20').all();
  return {
    companion: db.prepare('SELECT * FROM companion WHERE id=1').get(),
    dailyQuests: db.prepare('SELECT * FROM daily_quests WHERE quest_date=? ORDER BY id').all(today()),
    regions,
    map: regions.map((r, index) => ({ ...r, x: (index * 37) % 100, y: (index * 61) % 100 })),
    nemeses: monsters.filter(m => m.nemesis).slice(0, 5),
    bosses: monsters.filter(m => m.is_boss).slice(0, 5),
    weeklyRecap: weeklyRecap(),
    recentRecap: recentRecap(),
  };
}

module.exports = {
  ensureDailyQuests, advanceDaily, regionFor, recordNetwork, onBattle, onVictory,
  onDefeat, townTheft, evaluateAchievements, weeklyRecap, recentRecap, prestige, setControl, state,
};
