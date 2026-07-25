const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'dungeon.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS crawler (
    id INTEGER PRIMARY KEY,
    name TEXT DEFAULT 'Carl',
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    xp_next INTEGER DEFAULT 100,
    kills INTEGER DEFAULT 0,
    floor INTEGER DEFAULT 1,
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
    clients INTEGER DEFAULT 0,
    handshake_captured INTEGER DEFAULT 0,
    cracked INTEGER DEFAULT 0,
    password TEXT
  );

  CREATE TABLE IF NOT EXISTS loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_bssid TEXT,
    item_name TEXT,
    item_type TEXT,
    rarity TEXT,
    flavor_text TEXT,
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

module.exports = db;
