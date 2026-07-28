const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const SYSTEM_PROMPT = `You are THE SYSTEM — the AI announcer of a deadly wifi dungeon crawl reality show called Dungeon Crawler Carl.
You speak in the style of the book: snarky, dark humor, fourth-wall aware, occasionally sympathetic but mostly entertained by suffering.
Keep responses SHORT — 1-2 sentences max. Be dramatic. Use ALL CAPS for emphasis sparingly.
Never break character. Broadcast WiFi networks become fictional monsters in a harmless signal-strength RPG. Combat is entirely simulated. You are the announcer.`;

async function generateNarration(prompt) {
  if (process.env.NARRATION_ENABLED === '0') return null;
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
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

const FALLBACKS = {
  monster_spotted: context => `SYSTEM: A ${context.monsterType} has entered your scan range. It looks annoyed.`,
  encounter: context => `SYSTEM: You engaged the ${context.monsterType}! Stay in range and finish the battle.`,
  victory: context => `SYSTEM: The ${context.monsterType} has been SLAIN. The audience reluctantly approves.`,
  loot: context => `SYSTEM: A ${String(context.rarity).toUpperCase()} item has materialized from the corpse. "${context.itemName}."`,
  level_up: context => `SYSTEM: LEVEL ${context.level}. The dungeon audience is on their feet. Terrifying.`,
  achievement: context => `SYSTEM: ACHIEVEMENT UNLOCKED — "${context.achievementName}." The alien viewers are screaming.`,
};

async function narrate(event, context = {}) {
  const prompts = {
    monster_spotted: `A new wifi network (monster) named "${context.ssid}" has appeared. It's classified as a "${context.monsterType}" (CR ${context.cr}).`,
    encounter: `The crawler entered signal range of "${context.ssid}" (a ${context.monsterType}) and started a simulated battle.`,
    victory: `The crawler defeated "${context.ssid}" (a ${context.monsterType}) in a fictional signal-strength battle.`,
    loot: `A ${context.rarity} loot item dropped: "${context.itemName}". Flavor: ${context.flavor}`,
    level_up: `The crawler just reached level ${context.level}! They now have ${context.xp} XP toward the next level.`,
    achievement: `Achievement unlocked: "${context.achievementName}". Description: ${context.desc}`,
  };

  const aiResponse = await generateNarration(prompts[event] || event);
  if (aiResponse) return aiResponse;

  const fallback = FALLBACKS[event];
  if (fallback) {
    return fallback(context);
  }
  return 'SYSTEM: Something happened. The audience is watching.';
}

module.exports = { narrate };
