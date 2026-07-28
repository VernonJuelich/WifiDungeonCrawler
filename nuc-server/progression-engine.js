const db = require('./db');
const { addXP } = require('./game-engine');
const TOWN_INTERVAL_SECONDS = 2 * 60 * 60;

const QUEST_ADJECTIVES = [
  'Unreasonably Dangerous', 'Administratively Mandatory', 'Probably Cursed',
  'Heroically Pointless', 'Suspiciously Damp', 'Audience Approved',
];
const QUEST_NOUNS = [
  'WiFi Menace', 'Invisible Landlord', 'Roaming Goblin Union',
  'Dungeon Dead Zone', 'Overconfident Wyvern', 'Signal-Stealing Horror',
];

function record(type, message, data = {}) {
  db.prepare('INSERT INTO events (type,message,data) VALUES (?,?,?)')
    .run(type, message, JSON.stringify(data));
}

function activeQuest() {
  return db.prepare("SELECT * FROM quests WHERE status='active' ORDER BY id DESC LIMIT 1").get();
}

function createQuest(act = 1) {
  const seed = Number(db.prepare('SELECT quests_completed FROM crawler WHERE id=1').get().quests_completed || 0);
  const adjective = QUEST_ADJECTIVES[seed % QUEST_ADJECTIVES.length];
  const noun = QUEST_NOUNS[(seed * 3 + act) % QUEST_NOUNS.length];
  const required = 4 + act * 2 + (seed % 3);
  const title = `${adjective} ${noun}`;
  const description = `Defeat ${required} monsters while pretending this constitutes a coherent narrative.`;
  const rewardXp = 80 + act * 60 + required * 12;
  const rewardGold = 20 + act * 15 + required * 4;
  const result = db.prepare(`
    INSERT INTO quests (act,title,description,required,reward_xp,reward_gold)
    VALUES (?,?,?,?,?,?)
  `).run(act, title, description, required, rewardXp, rewardGold);
  const quest = db.prepare('SELECT * FROM quests WHERE id=?').get(Number(result.lastInsertRowid));
  record('quest_start', `New quest: ${title}. ${description}`, { quest });
  return quest;
}

function ensureQuest() {
  return activeQuest() || createQuest(db.prepare('SELECT act FROM crawler WHERE id=1').get().act || 1);
}

function advanceQuest(amount = 1) {
  let quest = ensureQuest();
  const progress = Math.min(quest.required, quest.progress + amount);
  db.prepare('UPDATE quests SET progress=? WHERE id=?').run(progress, quest.id);
  if (progress < quest.required) return { quest: { ...quest, progress }, completed: false };

  db.prepare("UPDATE quests SET status='completed',completed_at=datetime('now') WHERE id=?").run(quest.id);
  db.prepare(`
    UPDATE crawler SET gold=gold+?,quests_completed=quests_completed+1 WHERE id=1
  `).run(quest.reward_gold);
  addXP(quest.reward_xp);
  let crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const newAct = Math.floor(crawler.quests_completed / 3) + 1;
  if (newAct > crawler.act) {
    db.prepare('UPDATE crawler SET act=? WHERE id=1').run(newAct);
    record('act_up', `ACT ${newAct}: The plot thickens, mostly because nobody edited it.`, { act: newAct });
  }
  record('quest_complete',
    `Quest complete: ${quest.title}. Reward: ${quest.reward_xp} XP and ${quest.reward_gold} gold.`,
    { quest: { ...quest, progress }, act: newAct });
  const next = createQuest(newAct);
  return { quest: next, completed: true, completedQuest: { ...quest, progress }, act: newAct };
}

function inventoryState() {
  const crawler = db.prepare('SELECT inventory_capacity FROM crawler WHERE id=1').get();
  const count = db.prepare('SELECT COUNT(*) count FROM loot WHERE sold=0').get().count;
  return { count, capacity: crawler.inventory_capacity, full: count >= crawler.inventory_capacity };
}

function visitTownIfNeeded(force = false) {
  const inventory = inventoryState();
  if (!inventory.full && !force) return null;
  const sale = db.prepare(`
    SELECT COALESCE(SUM(CASE rarity
      WHEN 'legendary' THEN 90 WHEN 'rare' THEN 40 WHEN 'uncommon' THEN 18 ELSE 7 END),0) gold,
      COUNT(*) count FROM loot WHERE sold=0 AND equipped=0
  `).get();
  db.prepare('UPDATE loot SET sold=1 WHERE sold=0 AND equipped=0').run();
  const crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const upgradeCost = 25 + crawler.level * 10;
  const upgrade = sale.gold >= upgradeCost;
  const weapon = upgrade && crawler.town_trips % 2 === 0 ? 1 : 0;
  const armor = upgrade && !weapon ? 1 : 0;
  db.prepare(`
    UPDATE crawler SET gold=gold+?-?,town_trips=town_trips+1,
      weapon_power=weapon_power+?,armor_power=armor_power+?,
      health=max_health,stamina=max_stamina,mood='refreshed',
      last_town_visit=datetime('now') WHERE id=1
  `).run(sale.gold, upgrade ? upgradeCost : 0, weapon, armor);
  const purchase = upgrade ? (weapon ? 'weapon polishing' : 'armor tailoring') : 'absolutely nothing useful';
  const message = `Town trip: sold ${sale.count} items for ${sale.gold} gold and purchased ${purchase}.`;
  record('town', message, { sold: sale.count, gold: sale.gold, purchase });
  return { message, sold: sale.count, gold: sale.gold, purchase };
}

function visitTownIfDue() {
  const crawler = db.prepare('SELECT last_town_visit,created_at FROM crawler WHERE id=1').get();
  const timestamp = crawler.last_town_visit || crawler.created_at;
  const lastVisit = Date.parse(`${timestamp || ''}Z`) || Date.now();
  if (Math.floor((Date.now() - lastVisit) / 1000) < TOWN_INTERVAL_SECONDS) return null;
  return visitTownIfNeeded(true);
}

function snapshot() {
  const c = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  db.prepare(`
    INSERT INTO stat_history(level,xp,kills,floor,gold,health) VALUES (?,?,?,?,?,?)
  `).run(c.level, c.xp, c.kills, c.floor, c.gold, c.health);
}

function applyOfflineProgress() {
  const c = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const last = Date.parse(`${c.last_active || c.last_recovery || ''}Z`) || Date.now();
  const seconds = Math.min(8 * 3600, Math.max(0, Math.floor((Date.now() - last) / 1000)));
  db.prepare("UPDATE crawler SET last_active=datetime('now') WHERE id=1").run();
  if (seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  const xp = minutes * Math.max(1, Math.floor(c.level / 2) + 1);
  const gold = Math.floor(minutes / 5);
  db.prepare(`
    UPDATE crawler SET gold=gold+?,offline_seconds=offline_seconds+?,
      health=max_health,stamina=max_stamina,mood='well rested' WHERE id=1
  `).run(gold, seconds);
  addXP(xp);
  const message = `While you were gone for ${minutes} minutes, Carl trained unsupervised: +${xp} XP, +${gold} gold.`;
  record('offline', message, { seconds, xp, gold });
  snapshot();
  return { seconds, xp, gold, message };
}

function progressionState() {
  const quest = ensureQuest();
  return {
    quest,
    inventory: inventoryState(),
    history: db.prepare('SELECT * FROM stat_history ORDER BY id DESC LIMIT 96').all().reverse(),
  };
}

module.exports = {
  ensureQuest, advanceQuest, inventoryState, visitTownIfNeeded, visitTownIfDue,
  snapshot, applyOfflineProgress, progressionState,
};
