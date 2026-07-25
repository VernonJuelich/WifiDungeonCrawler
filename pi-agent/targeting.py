"""
AI targeting engine — runs entirely on the Pi.
Scores each visible network and returns a priority-ordered list.
No LLM needed: pure scoring heuristics that outperform random selection.
"""
import time
from monster import classify
from config import MAX_TARGETING_CANDIDATES

_attempt_cooldown: dict[str, float] = {}
COOLDOWN_SEC = 300  # don't re-target same network for 5 min after attempt

ENC_SCORE = {
    "wep":  90,   # easy crack, high priority
    "wpa":  60,
    "wpa2": 70,   # valuable kill
    "wpa3": 20,   # unlikely to crack, low priority
    "open": 10,   # no handshake possible
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
    # -30 dBm = 100 points, -90 dBm = 0 points
    return max(0, min(100, (signal + 90) * (100 / 60)))

def _client_score(clients: int) -> int:
    # Active clients = active handshakes = better capture chance
    return min(30, clients * 10)

def _default_ssid_bonus(ssid: str) -> int:
    from config import DEFAULT_SSID_PATTERNS
    import re
    if re.match("|".join(DEFAULT_SSID_PATTERNS), ssid or "", re.IGNORECASE):
        return 25  # default SSIDs often have weak passwords
    return 0

def _cooldown_penalty(bssid: str) -> int:
    last = _attempt_cooldown.get(bssid, 0)
    if time.time() - last < COOLDOWN_SEC:
        return -200  # heavily penalise recently attempted
    return 0

def score_network(network: dict) -> float:
    bssid   = network.get("bssid", "")
    enc     = network.get("encryption", "")
    signal  = network.get("signal", -80)
    clients = network.get("clients", 0)
    ssid    = network.get("ssid", "")

    return (
        _enc_score(enc)
        + _signal_score(signal)
        + _client_score(clients)
        + _default_ssid_bonus(ssid)
        + _cooldown_penalty(bssid)
    )

def rank(networks: list[dict]) -> list[dict]:
    scored = [(n, score_network(n)) for n in networks if n.get("bssid")]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [n for n, _ in scored[:MAX_TARGETING_CANDIDATES]]

def mark_attempted(bssid: str):
    _attempt_cooldown[bssid] = time.time()
