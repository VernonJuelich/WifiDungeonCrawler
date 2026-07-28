const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT || 11434);
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || 'qwen3:4b';
const recentLines = [];
const narratorStatus = {
  enabled: process.env.NARRATION_ENABLED !== '0',
  provider: 'ollama',
  configuredModel: MODEL,
  fallbackModel: FALLBACK_MODEL,
  activeModel: null,
  available: null,
  warming: false,
  generating: false,
  generated: 0,
  fallbacks: 0,
  lastError: null,
};

const SYSTEM_PROMPT = `You are a smug, theatrical announcer for a harmless WiFi dungeon RPG.
Write one short, original, sarcastic sentence. Celebrate failure as entertainment and
treat success as barely acceptable. Never explain yourself or leave character.`;

function requestNarration(model, prompt, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: `EVENT: ${prompt}
Do not repeat: ${recentLines.slice(-2).join(' / ') || 'nothing yet'}.
Broadcast only; no label or quotation marks.`,
      stream: false,
      think: false,
      keep_alive: '24h',
      options: { temperature: 0.95, repeat_penalty: 1.18, num_predict: 48 },
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
          if (res.statusCode >= 400) {
            return resolve({ text: null, error: parsed.error || `Ollama HTTP ${res.statusCode}` });
          }
          resolve({ text: parsed.response ? parsed.response.trim() : null, error: null });
        } catch {
          resolve({ text: null, error: 'Invalid Ollama response' });
        }
      });
    });

    req.on('error', error => resolve({ text: null, error: error.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ text: null, error: 'Ollama request timed out' });
    });
    req.write(body);
    req.end();
  });
}

function tidyNarration(text) {
  return String(text || '')
    .replace(/^(?:THE\s+)?ANNOUNCER\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

async function generateNarration(prompt) {
  if (!narratorStatus.enabled) return null;
  if (narratorStatus.warming) return null;
  narratorStatus.generating = true;
  const models = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
  for (const model of models) {
    const result = await requestNarration(model, prompt);
    const line = tidyNarration(result.text);
    if (line) {
      narratorStatus.activeModel = model;
      narratorStatus.available = true;
      narratorStatus.generated += 1;
      narratorStatus.lastError = null;
      recentLines.push(line);
      if (recentLines.length > 12) recentLines.shift();
      narratorStatus.generating = false;
      return line;
    }
    narratorStatus.lastError = result.error;
    // Loading a second model after a timeout can evict the primary model and
    // make every encounter slower. Only try the alternate if the model is absent.
    if (!/not found/i.test(String(result.error || ''))) break;
  }
  narratorStatus.generating = false;
  narratorStatus.available = false;
  return null;
}

async function warmNarrator() {
  if (!narratorStatus.enabled || narratorStatus.warming) return;
  if (narratorStatus.generating) {
    const retryTimer = setTimeout(warmNarrator, 1000);
    retryTimer.unref();
    return;
  }
  narratorStatus.warming = true;
  const result = await requestNarration(
    MODEL,
    'Reply with exactly: ANNOUNCER ONLINE.',
    35000
  );
  narratorStatus.warming = false;
  if (result.text) {
    narratorStatus.activeModel = MODEL;
    narratorStatus.available = true;
    narratorStatus.lastError = null;
  } else {
    narratorStatus.available = false;
    narratorStatus.lastError = result.error;
  }
}

function pick(options) {
  return options[Math.floor(Math.random() * options.length)];
}

const FALLBACKS = {
  monster_spotted: context => pick([
    `ANNOUNCER: A ${context.monsterType} appeared. Try not to embarrass yourself immediately.`,
    `ANNOUNCER: Incoming ${context.monsterType}. It has signal strength; Carl has optimism.`,
    `ANNOUNCER: A wild ${context.monsterType} has entered range and already regrets the neighbourhood.`,
    `ANNOUNCER: ${context.monsterType} detected. The audience has lowered its expectations as a precaution.`,
  ]),
  encounter: context => pick([
    `ANNOUNCER: You attacked a ${context.monsterType}. Confidence is adorable when unsupported by evidence.`,
    `ANNOUNCER: Combat begins. The ${context.monsterType} was not consulted, which makes two of you.`,
    `ANNOUNCER: Carl engages a ${context.monsterType}. Strategy remains listed as optional.`,
    `ANNOUNCER: Weapons ready. Judgment questionable. Ratings promising.`,
  ]),
  victory: context => pick([
    `ANNOUNCER: The ${context.monsterType} is dead. Even statistical accidents count, apparently.`,
    `ANNOUNCER: Victory! Please remain calm while we verify this was actually Carl.`,
    `ANNOUNCER: The ${context.monsterType} has fallen. Competence briefly visited and left no forwarding address.`,
    `ANNOUNCER: Carl won. Donut would like the record to show she supervised.`,
  ]),
  loot: context => pick([
    `ANNOUNCER: ${String(context.rarity).toUpperCase()} loot: "${context.itemName}." Finally, equipment worthy of someone else.`,
    `ANNOUNCER: "${context.itemName}" acquired. Taste was never part of the loot table.`,
    `ANNOUNCER: ${String(context.rarity).toUpperCase()} drop secured. Inventory dignity reduced accordingly.`,
    `ANNOUNCER: New loot! Donut has claimed appraisal rights and plausible deniability.`,
  ]),
  level_up: context => pick([
    `ANNOUNCER: LEVEL ${context.level}. Numbers go up; competence remains under review.`,
    `ANNOUNCER: Level ${context.level}! Carl is now statistically harder to replace.`,
    `ANNOUNCER: LEVEL UP. The dungeon has increased difficulty to compensate for this clerical error.`,
    `ANNOUNCER: Level ${context.level} achieved. Donut remains the senior party member emotionally.`,
  ]),
  achievement: context => pick([
    `ANNOUNCER: ACHIEVEMENT UNLOCKED — "${context.achievementName}." Standards have clearly collapsed.`,
    `ANNOUNCER: "${context.achievementName}" awarded. Participation trophies have become dangerously specific.`,
    `ANNOUNCER: Achievement unlocked. The committee denies having approved it.`,
    `ANNOUNCER: "${context.achievementName}." Frame it quickly before anyone audits the criteria.`,
  ]),
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
    narratorStatus.fallbacks += 1;
    return fallback(context);
  }
  narratorStatus.fallbacks += 1;
  return 'ANNOUNCER: Something happened. The audience is watching.';
}

function getNarratorStatus() {
  return { ...narratorStatus };
}

const warmupTimer = setTimeout(warmNarrator, 250);
warmupTimer.unref();

module.exports = { narrate, getNarratorStatus };
