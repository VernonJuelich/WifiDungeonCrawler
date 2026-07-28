const MONSTER_ICON = {
  'Naked Slime':       '/icons/slime.svg',
  'Armoured Goblin':    '/icons/goblin.svg',
  'Cave Troll':        '/icons/troll.svg',
  'Dungeon Wyvern':    '/icons/wyvern.svg',
  'Dungeon Drake':     '/icons/drake.svg',
  'The Lich':          '/icons/lich.svg',
  'Common Peasant':    '/icons/peasant.svg',
  'Invisible Stalker': '/icons/stalker.svg',
  'Unknown Horror':    '/icons/horror.svg',
};

const EVENT_ICONS = {
  monster_spotted: '👁',
  encounter:       '⚔',
  battle_turn:     '⚡',
  victory:         '☠',
  defeat:          '✚',
  floor_up:        '⬆',
  loot:            '🎁',
  achievement:     '🏆',
  level_up:        '⬆',
  quest_start:     '📜',
  quest_progress:  '▰',
  quest_complete:  '✓',
  act_up:           '★',
  town:             '🏪',
  offline:          '⌛',
  'system-boot':   '⚡',
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
  renderProgression(state);
  renderEncounterQueue(state.monsters);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function signalStrength(dbm) {
  if (!dbm) return 0;
  if (dbm >= -50) return 4;
  if (dbm >= -65) return 3;
  if (dbm >= -75) return 2;
  return 1;
}

function signalBarsHtml(dbm) {
  const s = signalStrength(dbm);
  return `<div class="signal-bar-wrap signal-s${s}">
    <span></span><span></span><span></span><span></span>
  </div>`;
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const delta = Date.now() - new Date(isoStr + 'Z').getTime();
  if (delta < 60000) return 'now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  return `${Math.floor(delta / 3600000)}h ago`;
}

function aiTier(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'mid';
  if (score > 0)  return 'low';
  return 'zero';
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function cleanMessage(message) {
  return String(message || '').replace(/^(THE SYSTEM|SYSTEM|ANNOUNCER):\s*/i, '');
}

// ── Renderers ─────────────────────────────────────────────────────────────────
function renderCrawler(c) {
  if (!c) return;
  document.getElementById('crawler-name').textContent  = c.name || 'Carl';
  document.getElementById('crawler-level').textContent = c.level || 1;
  document.getElementById('crawler-kills').textContent = c.kills || 0;
  document.getElementById('crawler-floor').textContent = c.floor || 1;

  const xp = c.xp || 0;
  const xpNext = c.xp_next || 100;
  const pct = Math.min(100, (xp / xpNext) * 100).toFixed(1);
  document.getElementById('xp-fill').style.width = pct + '%';
  document.getElementById('xp-track-label').textContent = `${xp} / ${xpNext}`;
  const health = c.health ?? 100;
  const maxHealth = c.max_health || 100;
  document.getElementById('health-fill').style.width =
    Math.min(100, health / maxHealth * 100) + '%';
  document.getElementById('crawler-vitals').textContent =
    `HP ${health}/${maxHealth} · ST ${c.stamina ?? 100}/${c.max_stamina || 100} · ${(c.mood || 'curious').toUpperCase()}`;
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
      if ((m.signal || -99) > (g.signal || -99)) g.signal = m.signal;
      if ((m.cr || 0) > (g.cr || 0)) { g.cr = m.cr; g.monster_type = m.monster_type; }
      if ((statusRank[m.status] || 0) > (statusRank[g.status] || 0)) g.status = m.status;
      if ((m.ai_score || 0) > (g.ai_score || 0)) g.ai_score = m.ai_score;
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
  const grouped = groupMonsters(monsters)
    .sort((a, b) => (a.status === 'dead') - (b.status === 'dead') || (b.signal || -99) - (a.signal || -99))
    .slice(0, 24);
  grid.innerHTML = grouped.map(m => {
    const vendor  = m.vendor ? escHtml(m.vendor) : '';
    const channel = m.channel ? `CH ${m.channel}` : '';
    const clients = m.clients > 0 ? `${m.clients} client${m.clients !== 1 ? 's' : ''}` : '';
    const ago     = relativeTime(m.last_seen);

    return `
    <div class="monster-card ${m.status || 'alive'}" title="${escHtml(m.bssids.join('\n'))}">
      ${m.ai_score != null ? `<span class="ai-score ai-score-${aiTier(m.ai_score)}" title="Encounter priority">${m.ai_score}%</span>` : ''}
      ${m.count > 1 ? `<span class="monster-count">×${m.count}</span>` : ''}
      <div class="monster-icon-wrap">
        <img class="monster-icon monster-icon-${(m.monster_type||'').toLowerCase().replace(/\s+/g,'-')}"
          src="${MONSTER_ICON[m.monster_type] || '/icons/horror.svg'}"
          alt="${escHtml(m.monster_type)}"
          onerror="this.style.display='none'">
      </div>
      <div class="monster-type">${escHtml(m.monster_type || 'Unknown')}</div>
      <div class="monster-name">${escHtml(m.ssid || '[Hidden]')}</div>
      <div class="monster-row">
        <span class="monster-cr">CR ${m.cr ?? '?'}</span>
        ${signalBarsHtml(m.signal)}
        <span class="monster-enc">${escHtml((m.encryption || 'OPEN').toUpperCase())}</span>
      </div>
      ${(channel || clients) ? `
      <div class="monster-row" style="margin-top:4px">
        <span class="monster-ch">${channel}</span>
        <span class="monster-ch">${clients}</span>
      </div>` : ''}
      ${(vendor || ago) ? `
      <div class="monster-meta">
        <span>${vendor}</span>
        <span>${ago}</span>
      </div>` : ''}
    </div>`;
  }).join('');
}

function renderEvents(events) {
  const log = document.getElementById('event-log');
  if (!events || !events.length) return;
  const boot = `<div class="event-entry system-boot">
    <span class="event-icon">⚡</span>
    <span class="event-time">--:--:--</span>
    <span class="event-msg">SYSTEM ONLINE. The dungeon awaits. Try not to die.</span>
  </div>`;
  log.innerHTML = events.slice(0, 30).map(e => {
    const time = new Date(e.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const icon = EVENT_ICONS[e.type] || '·';
    return `<div class="event-entry ${escHtml(e.type || '')}">
      <span class="event-icon">${icon}</span>
      <span class="event-time">${time}</span>
      <span class="event-msg">${escHtml(cleanMessage(e.message || e.type))}</span>
    </div>`;
  }).join('') + boot;
}

function renderLoot(loot) {
  const el = document.getElementById('loot-list');
  if (!loot || !loot.length) {
    el.innerHTML = '<div class="empty-state">No loot yet. Get to work, crawler.</div>';
    return;
  }
  el.innerHTML = loot.slice(0, 20).map(l => `
    <div class="loot-item ${escHtml(l.rarity || 'common')}">
      <div class="loot-rarity">${escHtml(l.rarity || 'common')}</div>
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

function renderEncounterQueue(monsters) {
  const queue = document.getElementById('encounter-queue');
  const active = (monsters || []).filter(m => m.status === 'engaged').slice(0, 4);
  if (!active.length) {
    queue.innerHTML = '<div class="empty-state">Move within signal range to begin battle...</div>';
    return;
  }
  queue.innerHTML = active.map(m => {
    const max = Math.max(1, m.max_hp || 1);
    const remaining = Math.max(0, m.hp || 0);
    const progress = Math.max(0, Math.min(100, (1 - remaining / max) * 100));
    return `<div class="encounter-item encounter-running">
      <div class="encounter-title">${m.is_boss ? 'BOSS · ' : ''}${escHtml(m.ssid || '[Hidden]')}</div>
      <div class="progress-track"><div class="progress-fill battle-fill" style="width:${progress}%"></div>
        <span>${remaining} / ${max} HP</span></div>
    </div>`;
  }).join('');
}

function renderProgression(s) {
  const c = s.crawler || {};
  const q = s.quest || {};
  const inv = s.inventory || { count: 0, capacity: c.inventory_capacity || 10 };
  document.getElementById('act-label').textContent = `ACT ${c.act || 1}`;
  const qpct = Math.min(100, ((q.progress || 0) / Math.max(1, q.required || 1)) * 100);
  document.getElementById('quest-card').innerHTML = `
    <div class="quest-title">${escHtml(q.title || 'Awaiting bureaucratic destiny')}</div>
    <div class="quest-desc">${escHtml(q.description || '')}</div>
    <div class="progress-track"><div class="progress-fill quest-fill" style="width:${qpct}%"></div>
      <span>${q.progress || 0} / ${q.required || 0}</span></div>
    <div class="quest-reward">REWARD ${q.reward_xp || 0} XP · ${q.reward_gold || 0} GOLD</div>`;
  document.getElementById('inventory-count').textContent = `${inv.count}/${inv.capacity}`;
  document.getElementById('character-sheet').innerHTML = `
    <div class="sheet-grid">
      <span>STR</span><b>${c.strength || 5}</b><span>DEX</span><b>${c.dexterity || 5}</b>
      <span>VIT</span><b>${c.vitality || 5}</b><span>INT</span><b>${c.intelligence || 5}</b>
      <span>WEAPON</span><b>+${c.weapon_power || 0}</b><span>ARMOR</span><b>+${c.armor_power || 0}</b>
      <span>GOLD</span><b>${c.gold || 0}</b><span>TOWN TRIPS</span><b>${c.town_trips || 0}</b>
      <span>QUESTS</span><b>${c.quests_completed || 0}</b><span>OFFLINE</span><b>${Math.floor((c.offline_seconds || 0)/60)}m</b>
    </div>`;
  renderHistory(s.history || []);
}

function renderHistory(history) {
  const canvas = document.getElementById('history-chart');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(260, Math.floor(rect.width * devicePixelRatio));
  canvas.height = 130 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = canvas.width / devicePixelRatio, h = 130;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#2a1f4a'; ctx.strokeRect(8, 8, w - 16, h - 24);
  if (history.length < 2) {
    ctx.fillStyle = '#6a5a8a'; ctx.font = '11px monospace';
    ctx.fillText('History begins after the next victory.', 16, 68); return;
  }
  const series = [
    ['level', '#00ff88'], ['kills', '#ffd700'], ['gold', '#ff2f7b'],
  ];
  for (const [key, color] of series) {
    const max = Math.max(1, ...history.map(x => Number(x[key] || 0)));
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    history.forEach((x, i) => {
      const px = 9 + i * (w - 18) / (history.length - 1);
      const py = h - 17 - Number(x[key] || 0) / max * (h - 28);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
  ctx.font = '9px monospace';
  ctx.fillStyle = '#00ff88'; ctx.fillText('LEVEL', 10, 127);
  ctx.fillStyle = '#ffd700'; ctx.fillText('KILLS', 60, 127);
  ctx.fillStyle = '#ff2f7b'; ctx.fillText('GOLD', 105, 127);
}

// ── Popups ────────────────────────────────────────────────────────────────────
function showAnnouncement(msg) {
  const bar = document.getElementById('announcement-bar');
  const txt = document.getElementById('announcement-text');
  txt.textContent = cleanMessage(msg);
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
  document.getElementById('loot-popup-rarity').textContent = `${(item.rarity || 'common').toUpperCase()} ITEM ACQUIRED`;
  document.getElementById('loot-popup-name').textContent = item.name || item.item_name;
  document.getElementById('loot-popup-flavor').textContent = item.flavor || item.flavor_text;
  pop.classList.remove('hidden');
  clearTimeout(pop._timer);
  pop._timer = setTimeout(() => pop.classList.add('hidden'), 5000);
}

// ── Live SSE ──────────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/events');

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);

    switch (data.type) {
      case 'monster_spotted':
        state.monsters.unshift({ bssid: data.bssid, ssid: data.ssid, monster_type: data.monsterType, cr: data.cr, signal: data.signal, status: 'alive', encryption: data.encryption });
        renderMonsters(state.monsters);
        if (data.message) showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'encounter':
        updateMonsterStatus(data.bssid, 'engaged');
        if (data.message) showAnnouncement(data.message);
        addEventEntry(data);
        updateEncounterItem(data);
        break;

      case 'battle_turn':
        updateMonsterStatus(data.bssid, 'engaged');
        updateEncounterItem(data);
        updateVitals(data);
        break;

      case 'victory':
        updateMonsterStatus(data.bssid, 'dead');
        document.getElementById('crawler-kills').textContent =
          parseInt(document.getElementById('crawler-kills').textContent || 0) + 1;
        if (data.message) showAnnouncement(data.message);
        addEventEntry(data);
        updateVitals(data);
        break;

      case 'defeat':
        updateMonsterStatus(data.bssid, 'alive');
        updateVitals(data);
        if (data.message) showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'floor_up':
        document.getElementById('crawler-floor').textContent = data.floor;
        if (data.message) showAnnouncement(data.message);
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
          const existing = state.achievements.find(a => a.code === data.achievement.code);
          if (existing) { existing.count = data.achievement.count; }
          else { state.achievements.unshift(data.achievement); }
          renderAchievements(state.achievements);
          showAchievementPopup(data.achievement);
        }
        addEventEntry(data);
        break;

      case 'level_up':
        document.getElementById('crawler-level').textContent = data.level;
        if (data.message) showAnnouncement(data.message);
        addEventEntry(data);
        break;

      case 'quest_progress':
      case 'quest_complete':
      case 'act_up':
      case 'town':
      case 'offline':
        if (data.message) { showAnnouncement(data.message); addEventEntry(data); }
        fetchState();
        break;

    }
  };

  es.onerror = () => setTimeout(connectSSE, 3000);
}

function addEventEntry(data) {
  const log = document.getElementById('event-log');
  const div = document.createElement('div');
  div.className = `event-entry ${data.type || ''}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const icon = EVENT_ICONS[data.type] || '·';
  div.innerHTML = `<span class="event-icon">${icon}</span><span class="event-time">${time}</span><span class="event-msg">${escHtml(cleanMessage(data.message || data.type))}</span>`;
  log.insertBefore(div, log.firstChild);
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

function updateMonsterStatus(bssid, status) {
  const monster = state.monsters.find(m => m.bssid === bssid);
  if (monster) monster.status = status;
  renderMonsters(state.monsters);
}

function updateEncounterItem(data) {
  const queue = document.getElementById('encounter-queue');
  const empty = queue.querySelector('.empty-state');
  if (empty) empty.remove();
  const id = `encounter-${data.bssid.replace(/:/g,'')}`;
  let div = document.getElementById(id);
  if (!div) {
    div = document.createElement('div');
    div.className = 'encounter-item encounter-running';
    div.id = id;
    queue.insertBefore(div, queue.firstChild);
  }
  const pct = Math.min(100, Math.round((data.hp / Math.max(1, data.maxHp)) * 100));
  div.textContent = `${data.isBoss ? 'BOSS — ' : ''}${data.ssid || data.bssid} — HP ${data.hp}/${data.maxHp} (${pct}%)${data.critical ? ' CRITICAL!' : data.hit === false ? ' MISS' : ''}`;
}

function updateVitals(data) {
  const health = data.crawlerHealth ?? 0;
  const maxHealth = data.crawlerMaxHealth || 100;
  document.getElementById('health-fill').style.width =
    Math.min(100, health / maxHealth * 100) + '%';
  document.getElementById('crawler-vitals').textContent =
    `HP ${health}/${maxHealth} · ST ${data.stamina ?? 0}/${data.maxStamina || 100} · ${(data.mood || '').toUpperCase()}`;
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
