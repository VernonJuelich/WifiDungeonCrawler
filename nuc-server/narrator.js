const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MODEL = 'llama3.1:8b';

const SYSTEM_PROMPT = `You are THE SYSTEM — the AI announcer of a deadly wifi dungeon crawl reality show called Dungeon Crawler Carl.
You speak in the style of the book: snarky, dark humor, fourth-wall aware, occasionally sympathetic but mostly entertained by suffering.
Keep responses SHORT — 1-2 sentences max. Be dramatic. Use ALL CAPS for emphasis sparingly.
Never break character. The crawler is trying to crack wifi networks. Networks are monsters. You are the announcer.`;

async function generateNarration(prompt) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nSituation: ${prompt}\n\nTHE SYSTEM says:`,
      stream: false,
      options: { temperature: 0.9, num_predict: 80 },
    });

    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/generate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response ? parsed.response.trim() : null);
        } catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

const FALLBACKS = {
  monster_spotted: (name) => `SYSTEM: A ${name} has entered your scan range. It looks annoyed.`,
  handshake: (name) => `SYSTEM: You landed a hit on the ${name}! Handshake captured. Finish it.`,
  kill: (name) => `SYSTEM: The ${name} has been SLAIN. Its password was its only protection. Pathetic.`,
  loot: (item) => `SYSTEM: A ${item.rarity.toUpperCase()} item has materialized from the corpse. "${item.name}."`,
  level_up: (level) => `SYSTEM: LEVEL ${level}. The dungeon audience is on their feet. Terrifying.`,
  achievement: (name) => `SYSTEM: ACHIEVEMENT UNLOCKED — "${name}." The alien viewers are screaming.`,
  crack_fail: (name) => `SYSTEM: The ${name} resisted your wordlist. It mocks you silently.`,
};

async function narrate(event, context = {}) {
  const prompts = {
    monster_spotted: `A new wifi network (monster) named "${context.ssid}" has appeared. It's classified as a "${context.monsterType}" (CR ${context.cr}).`,
    handshake: `The crawler just captured a WPA handshake from "${context.ssid}" (a ${context.monsterType}). The crack pipeline is starting.`,
    kill: `The crawler just CRACKED the password for "${context.ssid}" (a ${context.monsterType}). Password was "${context.password}". Monster is dead.`,
    loot: `A ${context.rarity} loot item dropped: "${context.itemName}". Flavor: ${context.flavor}`,
    level_up: `The crawler just reached level ${context.level}! They now have ${context.xp} XP toward the next level.`,
    achievement: `Achievement unlocked: "${context.achievementName}". Description: ${context.desc}`,
    crack_fail: `The password crack failed for "${context.ssid}" (a ${context.monsterType}). The wordlist was exhausted.`,
  };

  const aiResponse = await generateNarration(prompts[event] || event);
  if (aiResponse) return aiResponse;

  const fallback = FALLBACKS[event];
  if (fallback) {
    const arg = context.monsterType || context.ssid || context.level || context.itemName || context.name || '';
    return fallback(arg, context);
  }
  return 'SYSTEM: Something happened. The audience is watching.';
}

module.exports = { narrate };
