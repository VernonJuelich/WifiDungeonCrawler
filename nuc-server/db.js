const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DUNGEON_DB || path.join(__dirname, 'dungeon.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS crawler (
    id INTEGER PRIMARY KEY,
    name TEXT DEFAULT 'Carl',
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    xp_next INTEGER DEFAULT 100,
    kills INTEGER DEFAULT 0,
    floor INTEGER DEFAULT 1,
    health INTEGER DEFAULT 100,
    max_health INTEGER DEFAULT 100,
    stamina INTEGER DEFAULT 100,
    max_stamina INTEGER DEFAULT 100,
    mood TEXT DEFAULT 'curious',
    weapon_power INTEGER DEFAULT 0,
    armor_power INTEGER DEFAULT 0,
    last_recovery TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monsters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bssid TEXT UNIQUE,
    ssid TEXT,
    encryption TEXT,
    signal INTEGER,
    channel INTEGER,
    vendor TEXT,
    monster_type TEXT,
    monster_name TEXT,
    cr INTEGER,
    xp_value INTEGER,
    status TEXT DEFAULT 'alive',
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    clients INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_bssid TEXT,
    item_name TEXT,
    item_type TEXT,
    rarity TEXT,
    flavor_text TEXT,
    power INTEGER DEFAULT 0,
    defense INTEGER DEFAULT 0,
    equipped INTEGER DEFAULT 0,
    acquired_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    description TEXT,
    count INTEGER DEFAULT 1,
    unlocked_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    message TEXT,
    data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO crawler (id, name) VALUES (1, 'Carl');
`);

// Lightweight migrations for existing installations.
const monsterColumns = new Set(
  db.prepare("PRAGMA table_info(monsters)").all().map(column => column.name)
);
if (!monsterColumns.has('encounter_progress')) {
  db.exec('ALTER TABLE monsters ADD COLUMN encounter_progress INTEGER DEFAULT 0');
}
if (!monsterColumns.has('encounter_required')) {
  db.exec('ALTER TABLE monsters ADD COLUMN encounter_required INTEGER DEFAULT 100');
}
if (!monsterColumns.has('victories')) {
  db.exec('ALTER TABLE monsters ADD COLUMN victories INTEGER DEFAULT 0');
}
for (const [name, definition] of [
  ['hp', 'INTEGER DEFAULT 0'],
  ['max_hp', 'INTEGER DEFAULT 0'],
  ['is_boss', 'INTEGER DEFAULT 0'],
  ['room_id', "TEXT DEFAULT ''"],
  ['dwell_seconds', 'INTEGER DEFAULT 0'],
  ['last_battle_at', 'TEXT'],
]) {
  if (!monsterColumns.has(name)) db.exec(`ALTER TABLE monsters ADD COLUMN ${name} ${definition}`);
}

const crawlerColumns = new Set(
  db.prepare("PRAGMA table_info(crawler)").all().map(column => column.name)
);
for (const [name, definition] of [
  ['health', 'INTEGER DEFAULT 100'],
  ['max_health', 'INTEGER DEFAULT 100'],
  ['stamina', 'INTEGER DEFAULT 100'],
  ['max_stamina', 'INTEGER DEFAULT 100'],
  ['mood', "TEXT DEFAULT 'curious'"],
  ['weapon_power', 'INTEGER DEFAULT 0'],
  ['armor_power', 'INTEGER DEFAULT 0'],
  ['last_recovery', 'TEXT'],
]) {
  if (!crawlerColumns.has(name)) db.exec(`ALTER TABLE crawler ADD COLUMN ${name} ${definition}`);
}

const lootColumns = new Set(
  db.prepare("PRAGMA table_info(loot)").all().map(column => column.name)
);
for (const [name, definition] of [
  ['power', 'INTEGER DEFAULT 0'],
  ['defense', 'INTEGER DEFAULT 0'],
  ['equipped', 'INTEGER DEFAULT 0'],
]) {
  if (!lootColumns.has(name)) db.exec(`ALTER TABLE loot ADD COLUMN ${name} ${definition}`);
}

module.exports = db;
