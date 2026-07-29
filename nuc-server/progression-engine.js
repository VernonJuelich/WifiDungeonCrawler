const db = require('./db');
const { addXP } = require('./game-engine');
const expansion = require('./expansion-engine');
const TOWN_INTERVAL_SECONDS = 2 * 60 * 60;

const QUEST_ADJECTIVES = [
  'Unreasonably Dangerous', 'Administratively Mandatory', 'Probably Cursed',
  'Heroically Pointless', 'Suspiciously Damp', 'Audience Approved',
];
const QUEST_NOUNS = [
  'WiFi Menace', 'Invisible Landlord', 'Roaming Goblin Union',
  'Dungeon Dead Zone', 'Overconfident Wyvern', 'Signal-Stealing Horror',
];
const TOWN_DISTRICTS = [
  'The Crooked Anvil', 'Goblin Market', 'Guild Hall of Excessive Forms',
  "Donut's Royal Promenade", 'The Questionable Apothecary', 'Buffering Square',
];
const DONUT_ERRANDS = [
  'judged three shopkeepers and purchased nothing',
  'won a staring contest against a taxidermied basilisk',
  'demanded a royal discount and somehow received an apology',
  'reviewed the fish selection with open contempt',
  'started a rumour that Carl cannot read price tags',
  'was carried between shops because the pavement looked provincial',
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
  let crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const trip = Number(crawler.town_trips || 0) + 1;
  const seed = trip + Number(crawler.kills || 0) * 3 + Number(crawler.floor || 1) * 7;
  const district = TOWN_DISTRICTS[seed % TOWN_DISTRICTS.length];
  const donutErrand = DONUT_ERRANDS[(seed * 5) % DONUT_ERRANDS.length];
  const merchant = expansion.state().travellingMerchant || {};
  let incident;
  let incidentGold = 0;
  let incidentXp = 0;
  switch (seed % 6) {
    case 0: {
      const lost = Math.min(12 + crawler.level, Math.max(0, crawler.gold + sale.gold));
      incidentGold = -lost;
      incident = `A licensed pickpocket collected ${lost} gold as a convenience fee.`;
      break;
    }
    case 1:
      incidentGold = 8 + crawler.floor * 2;
      incident = `Carl was mistaken for hired entertainment and earned ${incidentGold} gold.`;
      break;
    case 2:
      incidentXp = 12 + crawler.level * 3;
      incident = `A retired crawler taught Carl one useful stance: +${incidentXp} XP.`;
      break;
    case 3:
      incidentGold = 15;
      incident = 'Donut won a municipal argument. The settlement was 15 gold and one written apology.';
      break;
    case 4:
      db.prepare('UPDATE crawler SET max_stamina=max_stamina+2 WHERE id=1').run();
      incident = 'A suspicious tonic permanently added 2 stamina. Its ingredients remain legally confidential.';
      break;
    default:
      incident = 'The Guild inspected Carl, stamped the wrong form, and declared the visit mostly lawful.';
  }
  if (incidentXp) addXP(incidentXp);

  const discount = merchant.active ? 0.75 : 1;
  const availableGold = Math.max(0, crawler.gold + sale.gold + incidentGold);
  const options = [
    { name: 'weapon tempering', cost: Math.ceil((35 + crawler.level * 8) * discount), field: 'weapon_power', amount: 1 },
    { name: 'armor reinforcement', cost: Math.ceil((35 + crawler.level * 8) * discount), field: 'armor_power', amount: 1 },
    { name: 'an aggressively pocketed satchel', cost: Math.ceil((55 + crawler.level * 6) * discount), field: 'inventory_capacity', amount: 2 },
    { name: 'questionable vitality treatment', cost: Math.ceil((50 + crawler.level * 7) * discount), field: 'max_health', amount: 5 },
  ];
  const wanted = options[(trip - 1) % options.length];
  const bought = availableGold >= wanted.cost;
  if (bought) {
    db.prepare(`UPDATE crawler SET ${wanted.field}=${wanted.field}+? WHERE id=1`).run(wanted.amount);
  }
  const purchase = bought
    ? `${wanted.name} for ${wanted.cost} gold${merchant.active ? ` from ${merchant.kind}` : ''}`
    : `nothing; ${wanted.name} cost ${wanted.cost} gold and poverty remained undefeated`;
  const spent = bought ? wanted.cost : 0;

  db.prepare(`
    UPDATE crawler SET gold=max(0,gold+?+?-?),town_trips=town_trips+1,
      health=max_health,stamina=max_stamina,mood=?,
      last_town_visit=datetime('now') WHERE id=1
  `).run(sale.gold, incidentGold, spent, bought ? 'retail therapy' : 'window shopping');
  const opened = expansion.openSealedBoxes('town guild hall');
  expansion.evaluateSponsors();
  crawler = db.prepare('SELECT * FROM crawler WHERE id=1').get();
  const message = `Town trip #${trip}: ${district}. Sold ${sale.count} items for ${sale.gold} gold. `
    + `${incident} Purchased ${purchase}. Donut ${donutErrand}. `
    + `${opened.length} sealed box${opened.length === 1 ? '' : 'es'} opened; treasury now ${crawler.gold} gold.`;
  const receipt = {
    trip, district, sold: sale.count, saleGold: sale.gold, incident,
    incidentGold, incidentXp, purchase, spent, donutErrand,
    boxesOpened: opened.length, finalGold: crawler.gold,
  };
  record('town', message, receipt);
  return { message, ...receipt, opened };
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
