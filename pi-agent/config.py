NUC_HOST = "100.121.89.115"
NUC_PORT = 9310
NUC_BASE = f"http://{NUC_HOST}:{NUC_PORT}"

BJORN_DATA_DIR = "/var/lib/bjorn"
BJORN_NETWORKS_FILE = f"{BJORN_DATA_DIR}/networks.json"
BJORN_HANDSHAKES_DIR = "/home/bjorn/handshakes"

LOCAL_DB = "/home/bjorn/dungeon_state.db"

SCAN_INTERVAL = 15        # seconds between network polls
SYNC_INTERVAL = 30        # seconds between NUC state syncs
MAX_TARGETING_CANDIDATES = 5

DEFAULT_SSID_PATTERNS = [
    "NETGEAR", "Linksys", "TP-Link", "ASUS", "Dlink", "D-Link",
    "Xfinity", "Spectrum", "ATT", "Verizon", "OPTUS", "Telstra",
    "TPG", "iiNet", "Belong",
]
