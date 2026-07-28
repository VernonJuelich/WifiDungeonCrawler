NUC_HOST = "100.121.89.115"
NUC_PORT = 9310
NUC_BASE = f"http://{NUC_HOST}:{NUC_PORT}"

WIFI_INTERFACE = "wlan1"
WIFI_FALLBACK_INTERFACE = "wlan0"

LOCAL_DB = "/home/bjorn/dungeon_state.db"

SCAN_INTERVAL = 12        # seconds between WiFi scans / automatic battle turns
SYNC_INTERVAL = 30        # seconds between NUC state syncs
MAX_TARGETING_CANDIDATES = 5
ENCOUNTER_COOLDOWN = 10    # allows one simulated turn on each successful scan
LOCAL_DASHBOARD_PORT = 8080

DEFAULT_SSID_PATTERNS = [
    "NETGEAR", "Linksys", "TP-Link", "ASUS", "Dlink", "D-Link",
    "Xfinity", "Spectrum", "ATT", "Verizon", "OPTUS", "Telstra",
    "TPG", "iiNet", "Belong",
]
