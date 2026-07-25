const db = require('./db');

// Prior beliefs bootstrapped from real-world knowledge.
// Weight = how many observations the prior is worth.
// As real data accumulates the priors get diluted.
const ENC_PRIORS = {
  open:  { crack_rate: 0.00, weight: 20 },  // nothing to crack
  wep:   { crack_rate: 0.92, weight: 20 },  // trivially weak
  wpa:   { crack_rate: 0.28, weight: 10 },
  wpa2:  { crack_rate: 0.18, weight: 10 },
  wpa3:  { crack_rate: 0.01, weight: 20 },  // near impossible
};

const SIGNAL_PRIORS = {
  excellent: { bonus:  0.15 },   // >= -50 dBm
  good:      { bonus:  0.05 },   // >= -65
  fair:      { bonus:  0.00 },   // >= -75
  weak:      { bonus: -0.12 },   // < -75
};

const DEFAULT_SSID_RE = /^(NETGEAR|Linksys|TP-Link|ASUS|Dlink|D-Link|Xfinity|Spectrum|ATT|Verizon|OPTUS|Telstra|TPG|iiNet|Belong|BigPond)/i;

// ── Feature helpers ──────────────────────────────────────────────────────────

function normaliseEnc(enc) {
  const e = (enc || '').toLowerCase();
  if (e.includes('wpa3')) return 'wpa3';
  if (e.includes('wpa2')) return 'wpa2';
  if (e.includes('wpa'))  return 'wpa';
  if (e.includes('wep'))  return 'wep';
  return 'open';
}

function signalBand(dbm) {
  if (!dbm || dbm === 0) return 'weak';
  if (dbm >= -50) return 'excellent';
  if (dbm >= -65) return 'good';
  if (dbm >= -75) return 'fair';
  return 'weak';
}

function isDefault(ssid) {
  return DEFAULT_SSID_RE.test(ssid || '');
}

// Bayesian average — blends observed rate with prior
function bayesRate(successes, total, priorRate, priorWeight) {
  return (successes + priorRate * priorWeight) / (total + priorWeight);
}

// ── Historical stats from DB ─────────────────────────────────────────────────

function buildStats() {
  const rows = db.prepare('SELECT encryption, signal, ssid, clients, cracked, handshake_captured FROM monsters').all();

  const stats = {
    total:   rows.length,
    cracked: 0,
    enc:     {},
    band:    { excellent: { n: 0, cracked: 0 }, good: { n: 0, cracked: 0 }, fair: { n: 0, cracked: 0 }, weak: { n: 0, cracked: 0 } },
    default: { yes: { n: 0, cracked: 0 }, no:  { n: 0, cracked: 0 } },
  };

  for (const r of rows) {
    if (r.cracked) stats.cracked++;

    const enc = normaliseEnc(r.encryption);
    if (!stats.enc[enc]) stats.enc[enc] = { n: 0, cracked: 0, handshakes: 0 };
    stats.enc[enc].n++;
    if (r.cracked) stats.enc[enc].cracked++;
    if (r.handshake_captured) stats.enc[enc].handshakes++;

    const band = signalBand(r.signal);
    stats.band[band].n++;
    if (r.cracked) stats.band[band].cracked++;

    const defKey = isDefault(r.ssid) ? 'yes' : 'no';
    stats.default[defKey].n++;
    if (r.cracked) stats.default[defKey].cracked++;
  }

  return stats;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreOne(network, stats) {
  const enc    = normaliseEnc(network.encryption);
  const band   = signalBand(network.signal);
  const def    = isDefault(network.ssid);
  const clients = network.clients || 0;

  // Skip open — no handshake = no crack path
  if (enc === 'open') return 0;

  // Encryption base rate (Bayesian blend of prior + observed)
  const prior    = ENC_PRIORS[enc] || ENC_PRIORS.wpa2;
  const encData  = stats.enc[enc] || { n: 0, cracked: 0 };
  const baseRate = bayesRate(encData.cracked, encData.n, prior.crack_rate, prior.weight);

  // Signal lift (data-driven if enough observations, else use prior)
  const bandData = stats.band[band];
  const overallRate = stats.total > 0 ? stats.cracked / stats.total : 0.15;
  const signalLift = bandData.n >= 5
    ? (bandData.cracked / bandData.n) - overallRate
    : SIGNAL_PRIORS[band].bonus;

  // Default SSID lift (weak password likely)
  const defData = stats.default[def ? 'yes' : 'no'];
  const defPriorLift = def ? 0.22 : 0;
  const defLift = defData.n >= 5
    ? (defData.cracked / defData.n) - overallRate
    : defPriorLift;

  // Client count bonus — more clients → easier deauth → faster handshake
  const clientLift = Math.min(0.08, clients * 0.02);

  // WPA3 heavy penalty (almost uncrackable)
  const wpa3Penalty = enc === 'wpa3' ? -0.60 : 0;

  const raw = baseRate + signalLift + defLift + clientLift + wpa3Penalty;
  return Math.round(Math.max(0, Math.min(100, raw * 100)));
}

// ── Public API ───────────────────────────────────────────────────────────────

function scoreTargets(candidates) {
  const stats = buildStats();
  return candidates
    .map(c => ({
      bssid:    c.bssid,
      ssid:     c.ssid,
      ai_score: scoreOne(c, stats),
      features: {
        enc:        normaliseEnc(c.encryption),
        band:       signalBand(c.signal),
        is_default: isDefault(c.ssid),
        clients:    c.clients || 0,
      },
    }))
    .sort((a, b) => b.ai_score - a.ai_score);
}

function getModelStats() {
  const stats = buildStats();
  const overallRate = stats.total > 0 ? (stats.cracked / stats.total * 100).toFixed(1) : 0;

  return {
    model:        'bayesian-contextual-v1',
    observations: stats.total,
    total_cracked: stats.cracked,
    overall_crack_rate_pct: parseFloat(overallRate),
    by_encryption: Object.entries(stats.enc).map(([enc, d]) => ({
      enc,
      seen:      d.n,
      cracked:   d.cracked,
      handshakes: d.handshakes,
      crack_rate: d.n > 0 ? +(d.cracked / d.n * 100).toFixed(1) : null,
    })),
    by_signal: Object.entries(stats.band).map(([band, d]) => ({
      band,
      seen:    d.n,
      cracked: d.cracked,
      crack_rate: d.n > 0 ? +(d.cracked / d.n * 100).toFixed(1) : null,
    })),
    by_ssid_type: [
      { type: 'default', ...stats.default.yes,
        crack_rate: stats.default.yes.n > 0 ? +(stats.default.yes.cracked / stats.default.yes.n * 100).toFixed(1) : null },
      { type: 'custom',  ...stats.default.no,
        crack_rate: stats.default.no.n > 0  ? +(stats.default.no.cracked  / stats.default.no.n  * 100).toFixed(1) : null },
    ],
  };
}

module.exports = { scoreTargets, getModelStats, scoreOne };
