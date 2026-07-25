import urllib.request
import urllib.error
import json
import os
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

def report_network(network: dict) -> dict | None:
    return _post("/api/network", network)

def report_handshake_file(cap_path: str, bssid: str, ssid: str) -> dict | None:
    with open(cap_path, "rb") as f:
        data = f.read()
    return _post("/api/handshake", raw_body=data, headers={
        "x-bssid": bssid,
        "x-ssid": ssid,
        "Content-Length": str(len(data)),
    })

def report_handshake_event(bssid: str, ssid: str) -> dict | None:
    return _post("/api/handshake", headers={"x-bssid": bssid, "x-ssid": ssid}, raw_body=b"")

def report_event(event_type: str, data: dict) -> dict | None:
    return _post("/api/event", {"type": event_type, "data": data})

def is_nuc_reachable() -> bool:
    try:
        urllib.request.urlopen(f"{NUC_BASE}/api/state", timeout=5)
        return True
    except Exception:
        return False
