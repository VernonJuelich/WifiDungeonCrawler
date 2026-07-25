"""
Targeting engine — tries NUC AI scoring first, falls back to local heuristics.
The NUC uses historical crack data to score candidates via Bayesian inference.
Local scoring is the same rule-based system as before, used when NUC unreachable.
"""
import time
import re
import logging
from config import MAX_TARGETING_CANDIDATES, DEFAULT_SSID_PATTERNS

log = logging.getLogger(__name__)

_attempt_cooldown: dict[str, float] = {}
COOLDOWN_SEC = 300  # don't re-target same network for 5 min

# ── Local fallback scores (same as original) ─────────────────────────────────

ENC_SCORE = {
    "wep":  90,
    "wpa":  60,
    "wpa2": 70,
    "wpa3": 20,
    "open": 10,
    "none": 10,
    "":     10,
}

def _enc_score(enc: str) -> int:
    enc = (enc or "").lower()
    for key, score in ENC_SCORE.items():
        if key and key in enc:
            return score
    return 10

def _signal_score(signal: int) -> int:
    return max(0, min(100, (signal + 90) * (100 / 60)))

def _client_score(clients: int) -> int:
    return min(30, clients * 10)

def _default_ssid_bonus(ssid: str) -> int:
    pattern = "|".join(DEFAULT_SSID_PATTERNS)
    if re.match(pattern, ssid or "", re.IGNORECASE):
        return 25
    return 0

def _cooldown_penalty(bssid: str) -> int:
    if time.time() - _attempt_cooldown.get(bssid, 0) < COOLDOWN_SEC:
        return -200
    return 0

def _local_score(network: dict) -> float:
    return (
        _enc_score(network.get("encryption", ""))
        + _signal_score(network.get("signal", -80))
        + _client_score(network.get("clients", 0))
        + _default_ssid_bonus(network.get("ssid", ""))
        + _cooldown_penalty(network.get("bssid", ""))
    )

# ── NUC AI scoring ────────────────────────────────────────────────────────────

def _rank_via_nuc(networks: list[dict]) -> list[dict] | None:
    """POST candidates to NUC, return AI-ranked list. Returns None on failure."""
    try:
        from nuc_client import post_json
        candidates = [
            {
                "bssid":      n.get("bssid"),
                "ssid":       n.get("ssid", ""),
                "encryption": n.get("encryption", ""),
                "signal":     n.get("signal", -90),
                "clients":    n.get("clients", 0),
            }
            for n in networks if n.get("bssid")
        ]
        resp = post_json("/api/targeting", {"candidates": candidates}, timeout=5)
        if resp and "targets" in resp:
            scored = resp["targets"]
            # Apply cooldown filter after AI ranking
            scored = [t for t in scored if _cooldown_penalty(t["bssid"]) == 0]
            log.info(f"[AI] NUC scored {len(scored)} targets — top: "
                     f"{scored[0]['ssid'] or scored[0]['bssid']} "
                     f"({scored[0]['ai_score']}%)" if scored else "[AI] No viable targets")
            # Merge AI scores back onto original network dicts
            score_map = {t["bssid"]: t["ai_score"] for t in scored}
            ranked = sorted(
                [n for n in networks if score_map.get(n.get("bssid", ""), 0) > 0],
                key=lambda n: score_map.get(n.get("bssid", ""), 0),
                reverse=True,
            )
            return ranked[:MAX_TARGETING_CANDIDATES]
    except Exception as e:
        log.warning(f"[AI] NUC targeting unavailable: {e}")
    return None

# ── Public API ────────────────────────────────────────────────────────────────

def rank(networks: list[dict]) -> list[dict]:
    """Return top candidates sorted by priority. Tries NUC AI, falls back locally."""
    candidates = [n for n in networks if n.get("bssid")]

    # Try NUC-based AI scoring first
    ai_ranked = _rank_via_nuc(candidates)
    if ai_ranked is not None:
        return ai_ranked

    # Local fallback
    log.info("[AI] Using local rule-based targeting")
    scored = [(n, _local_score(n)) for n in candidates]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [n for n, _ in scored[:MAX_TARGETING_CANDIDATES]]

def mark_attempted(bssid: str):
    _attempt_cooldown[bssid] = time.time()
