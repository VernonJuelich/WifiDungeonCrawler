/**
 * Safe encounter ranking based only on public beacon metadata.
 * Higher scores mean a more interesting nearby RPG encounter.
 */
function signalScore(signal) {
  return Math.max(0, Math.min(50, 100 + Number(signal || -100)));
}

function rarityScore(encryption) {
  const value = String(encryption || '').toLowerCase();
  if (value.includes('wpa3')) return 35;
  if (value.includes('wpa2')) return 25;
  if (value.includes('wpa')) return 18;
  if (value.includes('wep')) return 12;
  return 5;
}

function stableBonus(bssid) {
  let hash = 0;
  for (const char of String(bssid || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 16;
}

function scoreTarget(network) {
  const score = Math.round(
    signalScore(network.signal) +
    rarityScore(network.encryption) +
    stableBonus(network.bssid)
  );
  return { ...network, ai_score: Math.max(1, Math.min(100, score)) };
}

function scoreTargets(networks) {
  return [...networks].map(scoreTarget).sort((a, b) => b.ai_score - a.ai_score);
}

function getModelStats() {
  return {
    model: 'signal-encounter-v1',
    description: 'Ranks fictional battles using signal strength and monster rarity.',
    safe_mode: true,
  };
}

module.exports = { scoreTargets, getModelStats };
