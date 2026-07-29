import urllib.request
import urllib.error
import json
from config import NUC_BASE

def _post(path: str, data: dict = None, raw_body: bytes = None, headers: dict = None) -> dict | None:
    url = f"{NUC_BASE}{path}"
    try:
        if raw_body is not None:
            req = urllib.request.Request(url, data=raw_body, method="POST")
            req.add_header("Content-Type", "application/octet-stream")
            for k, v in (headers or {}).items():
                req.add_header(k, v)
        else:
            body = json.dumps(data or {}).encode()
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[NUC] {path} failed: {e}")
        return None

def post_json(path: str, data: dict, timeout: int = 10) -> dict | None:
    """Generic JSON POST — used by AI targeting."""
    return _post(path, data)

def report_network(network: dict) -> dict | None:
    return _post("/api/network", network)

def report_encounter(bssid: str, signal: int, dwell_seconds: int = 0) -> dict | None:
    """Advance one simulated combat turn. No packets or credentials are sent."""
    return _post("/api/encounter", {
        "bssid": bssid, "signal": signal, "dwell_seconds": dwell_seconds,
    })

def report_event(event_type: str, data: dict) -> dict | None:
    return _post("/api/event", {"type": event_type, "data": data})

def is_nuc_reachable() -> bool:
    try:
        urllib.request.urlopen(f"{NUC_BASE}/api/state", timeout=5)
        return True
    except Exception:
        return False
