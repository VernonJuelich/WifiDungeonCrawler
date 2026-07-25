import re
from config import DEFAULT_SSID_PATTERNS

_DEFAULT_RE = re.compile("|".join(DEFAULT_SSID_PATTERNS), re.IGNORECASE)

def classify(network: dict) -> dict:
    enc    = (network.get("encryption") or "").lower()
    signal = network.get("signal", -80)
    ssid   = network.get("ssid") or ""
    hidden = not ssid.strip()

    if hidden:
        return {"type": "Invisible Stalker", "cr": 8, "xp": 2300}

    if not enc or enc in ("open", "none", ""):
        return {"type": "Naked Slime", "cr": 0, "xp": 10}

    is_default = bool(_DEFAULT_RE.match(ssid))

    if "wpa3" in enc:
        cr = 21 if signal > -60 else 15
        return {"type": "The Lich", "cr": cr, "xp": 13000}

    if "wpa2" in enc:
        if is_default:
            return {"type": "Common Peasant", "cr": 2, "xp": 75}
        if signal > -50:
            return {"type": "Dungeon Wyvern", "cr": 8, "xp": 2900}
        if signal > -70:
            return {"type": "Dungeon Wyvern", "cr": 6, "xp": 1100}
        return {"type": "Dungeon Drake", "cr": 4, "xp": 700}

    if "wpa" in enc:
        if is_default:
            return {"type": "Common Peasant", "cr": 1, "xp": 50}
        return {"type": "Cave Troll", "cr": 4 if signal > -60 else 3, "xp": 200}

    if "wep" in enc:
        return {"type": "Armored Goblin", "cr": 2, "xp": 50}

    return {"type": "Unknown Horror", "cr": 5, "xp": 500}
