const MONSTER_EMOJI = {
  'Naked Slime':       '🟢',
  'Armored Goblin':    '👺',
  'Cave Troll':        '👹',
  'Dungeon Wyvern':    '🐉',
  'Dungeon Drake':     '🦎',
  'The Lich':          '💀',
  'Common Peasant':    '👤',
  'Invisible Stalker': '👁',
  'Unknown Horror':    '❓',
};

let state = { monsters: [], loot: [], achievements: [], events: [], crawler: {} };

async function fetchState() {
  const res = await fetch('/api/state');
  state = await res.json();
  renderAll();
}

function renderAll() {
  renderCrawler(state.crawler);
  renderMonsters(state.monsters);
  renderEvents(state.events);
  renderLoot(state.loot);
  renderAchievements(state.achievements);
}

function renderCrawler(c) {
  if (!c) return;
  document.getElementById('crawler-name').textContent  = c.name || 'Carl';
  document.getElementById('crawler-level').textContent = c.level || 1;
  document.getElementById('crawler-xp').textContent    = c.xp || 0;
  document.getElementById('crawler-xp-next').textContent = c.xp_next || 100;
  document.getElementById('crawler-kills').textContent = c.kills || 0;
  document.getElementById('crawler-floor').textContent = c.floor || 1;
}

function groupMonsters(monsters) {
  const groups = new Map();
  const statusRank = { dead: 2, wounded: 1, alive: 0 };
  for (const m of monsters) {
    const key = m.ssid ? m.ssid : `__hidden__${m.bssid}`;
    if (!groups.has(key)) {
      groups.set(key, { ...m, bssids: [m.bssid], count: 1 });
    } else {
      const g = groups.get(key);
      g.bssids.push(m.bssid);
      g.count++;
      if (m.signal > g.signal) g.signal = m.signal;
      if (m.cr > g.cr) { g.cr = m.cr; g.monster_type = m.monster_type; }
      if ((statusRank[m.status] || 0) > (statusRank[g.status] || 0)) g.status = m.status;
    }
  }
  return Array.from(groups.values());
}

function renderMonsters(monsters) {
  const grid = document.getElementById('monster-grid');
  if (!monsters || !monsters.length) {
    grid.innerHTML = '<div class="empty-dungeon">No monsters detected. The dungeon is silent. That\'s worse.</div>';
    return;
  }
  const grouped = groupMonsters(monsters);
  grid.innerHTML = grouped.map(m => `
    <div class="monster-card ${m.status}" title="${m.bssids.join('\n')}">
      <span class="monster-emoji">${MONSTER_EMOJI[m.monster_type] || '❓'}</span>
      ${m.count > 1 ? `<span class="monster-count">×${m.count}</span>` : ''}
      <div class="monster-type">${m.monster_type}</div>
      <div class="monster-name">${escHtml(m.ssid || '[Hidden]')}</div>
      <div class="monster-stats">
        <span class="monster-cr">CR ${m.cr}</span>
        <span class="monster-sig">${m.signal} dBm</span>
      </div>
      <div class="monster-enc">${m.encryption || 'OPEN'}</div>
    </div>
  `).join('');
}

function renderEvents(events) {
  const log = document.getElementById('event-log');
  if (!events || !events.length) return;
  log.innerHTML = events.slice(0, 30).map(e => {
    const time = new Date(e.created_at).toLocaleTimeString();
    return `<div class="event-entry ${e.type}">
      <span class="event-time">${time}</span>
      <span class="event-msg">${escHtml(e.message)}</span>
    </div>`;
  }).join('');
}

function renderLoot(loot) {
  const el = document.getElementById('loot-list');
  if (!loot || !loot.length) {
    el.innerHTML = '<div class="empty-state">No loot yet. Get to work, crawler.</div>';
    return;
  }
  el.innerHTML = loot.slice(0, 20).map(l => `
    <div class="loot-item ${l.rarity}">
      <div class="loot-name">${escHtml(l.item_name)}</div>
      <div class="loot-flavor">${escHtml(l.flavor_text)}</div>
    </div>
  `).join('');
}

function renderAchievements(achievements) {
  const el = document.getElementById('achievement-list');
  if (!achievements || !achievements.length) {
    el.innerHTML = '<div class="empty-state">No achievements. You haven\'t done anything impressive yet.</div>';
    return;
  }
  el.innerHTML = achievements.map(a => `
    <div class="achievement-item">
      <div class="achievement-name">
        🏆 ${escHtml(a.name)}
        ${a.count > 1 ? `<span class="ach-count">×${a.count}</span>` : ''}
      </div>
      <div class="achievement-desc">${escHtml(a.description)}</div>
    </div>
  `).join('');
}

function showAnnouncement(msg) {
  const bar = document.getElementById('announcement-bar');
  const txt = document.getElementById('announcement-text');
  txt.textContent = msg;
  bar.classList.remove('hidden');
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => bar.classList.add('hidden'), 8000);
}

function showAchievementPopup(ach) {
  const pop = document.getElementById('achievement-popup');
  document.getElementById('popup-name').textContent =
    ach.count > 1 ? `${ach.name} ×${ach.count}` : ach.name;
  document.getElementById('popup-desc').textContent = ach.description || ach.desc;
  pop.classList.remove('hidden');
  clearTimeout(pop._timer);
  pop._timer = setTimeout(() => pop.classList.add('hidden'), 6000);
}

function showLootPopup(item) {
  const pop = document.getElementById('loot-popup');
  document.getElementById('loot-popup-rarity').textContent = `${item.rarity.toUpperCase()} ITEM ACQUIRED`;
  document.getElementById('loot-popup-name').textContent = item.name || item.item_name;
  document.getElementById('loot-popup-flavor').textContent = item.flavor || item.flavor_text;
  pop.classList.remove('hidden');
  clearTimeout(pop._timer);
  pop._timer = setTimeout(() => pop.classList.add('hidden'), 5000);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Live SSE ──────────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/events');

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);

    switch (data.type) {
      case 'monster_spotted':
        state.monsters.unshift({ bssid: data.bssid, ssid: data.ssid, monster_type: data.monsterType, cr: data.cr, signal: data.signal, status: 'alive' });
        renderMonsters(state.monsters);
        showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'handshake':
        updateMonsterStatus(data.bssid, 'wounded');
        showAnnouncement(data.message);
        addEventEntry(data);
        addCrackItem(data.bssid, data.ssid, 'running');
        break;

      case 'kill':
        updateMonsterStatus(data.bssid, 'dead');
        document.getElementById('crawler-kills').textContent =
          parseInt(document.getElementById('crawler-kills').textContent || 0) + 1;
        showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'loot':
        state.loot.unshift(data.item);
        renderLoot(state.loot);
        if (data.item) showLootPopup(data.item);
        addEventEntry(data);
        break;

      case 'achievement':
        if (data.achievement) {
          state.achievements.unshift(data.achievement);
          renderAchievements(state.achievements);
          showAchievementPopup(data.achievement);
        }
        addEventEntry(data);
        break;

      case 'level_up':
        document.getElementById('crawler-level').textContent = data.level;
        showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'crack_fail':
        addEventEntry(data);
        break;
    }
  };

  es.onerror = () => setTimeout(connectSSE, 3000);
}

function addEventEntry(data) {
  const log = document.getElementById('event-log');
  const div = document.createElement('div');
  div.className = `event-entry ${data.type}`;
  const time = new Date().toLocaleTimeString();
  div.innerHTML = `<span class="event-time">${time}</span><span class="event-msg">${escHtml(data.message)}</span>`;
  log.insertBefore(div, log.firstChild);
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

function updateMonsterStatus(bssid, status) {
  const monster = state.monsters.find(m => m.bssid === bssid);
  if (monster) monster.status = status;
  renderMonsters(state.monsters);
}

function addCrackItem(bssid, ssid, status) {
  const queue = document.getElementById('crack-queue');
  const empty = queue.querySelector('.empty-state');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = `crack-item crack-${status}`;
  div.id = `crack-${bssid}`;
  div.textContent = `${ssid || bssid} — cracking...`;
  queue.insertBefore(div, queue.firstChild);
}

// ── Crawler rename ────────────────────────────────────────────────────────────
function initRename() {
  const box   = document.getElementById('crawler-name-box');
  const label = document.getElementById('crawler-name');
  const input = document.getElementById('crawler-name-input');

  box.addEventListener('click', () => {
    input.value = label.textContent;
    label.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  });

  async function saveName() {
    const name = input.value.trim();
    input.classList.add('hidden');
    label.classList.remove('hidden');
    if (!name || name === label.textContent) return;
    const res = await fetch('/api/crawler/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      label.textContent = data.name;
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = label.textContent; input.blur(); }
  });
  input.addEventListener('blur', saveName);
}

// ── Init ──────────────────────────────────────────────────────────────────────
fetchState();
connectSSE();
initRename();
setInterval(fetchState, 30000);
