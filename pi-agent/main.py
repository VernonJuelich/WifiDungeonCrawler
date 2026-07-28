#!/usr/bin/env python3
"""
Dungeon Crawler — Pi Agent
Scans WiFi networks directly via nmcli on the BrosTrend adapter (wlan1),
classifies monsters, scores encounters, and plays simulated RPG battles.
It uses only public WiFi beacon metadata; all combat is fictional.

Usage:
  python3 main.py
"""

import time
import sqlite3
import threading
import subprocess
import re

from config import (
    WIFI_INTERFACE, WIFI_FALLBACK_INTERFACE, LOCAL_DB, SCAN_INTERVAL, ENCOUNTER_COOLDOWN,
)
from monster import classify
from targeting import rank
from nuc_client import report_network, report_encounter, is_nuc_reachable

# ── Local SQLite (character backup + seen tracking) ───────────────────────────
conn = sqlite3.connect(LOCAL_DB, check_same_thread=False)
conn.execute("""
    CREATE TABLE IF NOT EXISTS seen (
        bssid TEXT PRIMARY KEY,
        ssid TEXT,
        first_seen REAL,
        last_encounter REAL DEFAULT 0
    )
""")
seen_columns = {row[1] for row in conn.execute("PRAGMA table_info(seen)")}
if "last_encounter" not in seen_columns:
    conn.execute("ALTER TABLE seen ADD COLUMN last_encounter REAL DEFAULT 0")
conn.commit()
_active_target = None
_target_since = 0.0

def mark_seen(bssid, ssid):
    conn.execute(
        "INSERT OR IGNORE INTO seen (bssid, ssid, first_seen) VALUES (?,?,?)",
        (bssid, ssid, time.time())
    )
    conn.commit()

def already_seen(bssid):
    row = conn.execute("SELECT 1 FROM seen WHERE bssid=?", (bssid,)).fetchone()
    return row is not None

def encounter_ready(bssid):
    row = conn.execute("SELECT last_encounter FROM seen WHERE bssid=?", (bssid,)).fetchone()
    return not row or time.time() - (row[0] or 0) >= ENCOUNTER_COOLDOWN

def mark_encounter(bssid):
    conn.execute("UPDATE seen SET last_encounter=? WHERE bssid=?", (time.time(), bssid))
    conn.commit()

# ── WiFi scanner (nmcli on wlan1) ─────────────────────────────────────────────
def clean_ssid(value: str | None) -> str:
    """Turn driver/null padding into a normal hidden-network SSID."""
    ssid = str(value or "")
    ssid = re.sub(r"(?:\\x0{1,2})+", "", ssid, flags=re.IGNORECASE)
    ssid = ssid.replace("\x00", "")
    ssid = "".join(char for char in ssid if char.isprintable()).strip()
    return "" if ssid in ("", "--") else ssid

def active_scan_interface() -> str:
    """Prefer the USB radio, automatically falling back to built-in WiFi."""
    probe = subprocess.run(
        ["iw", "dev", WIFI_INTERFACE, "info"],
        capture_output=True, timeout=5
    )
    return WIFI_INTERFACE if probe.returncode == 0 else WIFI_FALLBACK_INTERFACE

def scan_wifi_networks() -> list[dict]:
    try:
        interface = active_scan_interface()
        result = subprocess.run(
            ["nmcli", "-t", "-f", "BSSID,SSID,SECURITY,SIGNAL,CHAN",
             "dev", "wifi", "list", "ifname", interface, "--rescan", "yes"],
            capture_output=True, text=True, timeout=30
        )
        networks = []
        for line in result.stdout.strip().splitlines():
            # nmcli escapes colons in field values as \: — swap them out to split safely
            safe  = line.replace("\\:", "\x00")
            parts = safe.split(":")
            if len(parts) < 4:
                continue
            bssid    = parts[0].replace("\x00", ":").upper().strip()
            ssid     = clean_ssid(parts[1].replace("\x00", ":"))
            security = parts[2].replace("\x00", ":").strip().upper()
            sig_pct  = parts[3].strip()
            chan     = parts[4].strip() if len(parts) > 4 else "?"

            # Convert nmcli signal % to approximate dBm
            sig_pct  = int(sig_pct) if sig_pct.isdigit() else 50
            signal   = (sig_pct // 2) - 100  # 100% → -50 dBm, 0% → -100 dBm

            if not security or security in ("--", ""):
                enc = "open"
            elif "WPA3" in security:
                enc = "WPA3"
            elif "WPA2" in security:
                enc = "WPA2"
            elif "WPA" in security:
                enc = "WPA"
            elif "WEP" in security:
                enc = "WEP"
            else:
                enc = "open"

            hidden = not ssid or ssid in ("--", "")

            if not bssid or bssid == "--":
                continue

            networks.append({
                "bssid":      bssid,
                "ssid":       "" if hidden else ssid,
                "encryption": enc,
                "signal":     signal,
                "channel":    chan,
                "hidden":     hidden,
            })
        # Never use raw iw fallback on wlan0: it may be carrying the uplink.
        return networks or (scan_wifi_with_iw(interface) if interface == WIFI_INTERFACE else [])
    except Exception as e:
        print(f"[AGENT] nmcli scan unavailable: {e}; trying passive iw scan")
        interface = active_scan_interface()
        return scan_wifi_with_iw(interface) if interface == WIFI_INTERFACE else []

def _channel_from_frequency(frequency: int) -> int:
    if frequency == 2484:
        return 14
    if 2412 <= frequency <= 2472:
        return (frequency - 2407) // 5
    if 5000 <= frequency <= 5895:
        return (frequency - 5000) // 5
    if 5955 <= frequency <= 7115:
        return (frequency - 5950) // 5
    return 0

def scan_wifi_with_iw(interface: str) -> list[dict]:
    """Passive beacon scan for adapters intentionally unmanaged by NetworkManager."""
    try:
        result = subprocess.run(
            ["iw", "dev", interface, "scan", "passive"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            print(f"[AGENT] iw scan failed: {result.stderr.strip()}")
            return []

        networks = []
        current = None
        for raw_line in result.stdout.splitlines():
            line = raw_line.strip()
            if line.startswith("BSS "):
                if current:
                    networks.append(current)
                bssid = line.split()[1].split("(")[0].upper()
                current = {
                    "bssid": bssid, "ssid": "", "encryption": "open",
                    "signal": -90, "channel": 0, "hidden": True,
                }
            elif current and line.startswith("SSID:"):
                current["ssid"] = clean_ssid(line[5:])
                current["hidden"] = not bool(current["ssid"])
            elif current and line.startswith("signal:"):
                try:
                    current["signal"] = int(float(line.split()[1]))
                except (ValueError, IndexError):
                    pass
            elif current and line.startswith("freq:"):
                try:
                    current["channel"] = _channel_from_frequency(int(line.split()[1]))
                except (ValueError, IndexError):
                    pass
            elif current and line.startswith("RSN:"):
                current["encryption"] = "WPA2"
            elif current and ("Authentication suites:" in line and "SAE" in line):
                current["encryption"] = "WPA3"
            elif current and line.startswith("WPA:") and current["encryption"] == "open":
                current["encryption"] = "WPA"
        if current:
            networks.append(current)
        return networks
    except Exception as e:
        print(f"[AGENT] Passive iw scan failed: {e}")
        return []

# ── Scan loop ─────────────────────────────────────────────────────────────────
def scan_loop():
    global _active_target, _target_since
    print("[AGENT] Scan loop started")
    while True:
        networks = scan_wifi_networks()
        if not networks:
            print("[AGENT] No WiFi beacons detected yet...")
            time.sleep(SCAN_INTERVAL)
            continue

        # Classify and report new monsters to NUC
        for net in networks:
            bssid = net.get("bssid")
            if not bssid:
                continue

            classification = classify(net)
            net["monster_type"] = classification["type"]
            net["cr"]           = classification["cr"]
            net["xp_value"]     = classification["xp"]

            if not already_seen(bssid):
                mark_seen(bssid, net.get("ssid", ""))
                print(f"[AGENT] New monster: {classification['type']} — {net.get('ssid','[hidden]')} ({bssid})")

            # Always refresh the NUC record so encounters work after either side restarts.
            if is_nuc_reachable():
                report_network({**net, **classification})

        # AI targeting: pick best targets
        targets = rank(networks)
        if targets:
            top = targets[0]
            bssid = top.get("bssid")
            print(f"[AGENT] Top encounter: {top.get('ssid','[hidden]')} ({bssid}) — {top.get('monster_type')}")
            if bssid != _active_target:
                _active_target = bssid
                _target_since = time.time()
                print(f"[AGENT] Entered a new dungeon room: channel {top.get('channel', '?')}")
            dwell_seconds = int(time.time() - _target_since)
            if bssid and encounter_ready(bssid) and is_nuc_reachable():
                result = report_encounter(bssid, top.get("signal", -90), dwell_seconds)
                if result:
                    mark_encounter(bssid)
                    print(f"[AGENT] Battle: {result.get('status')} "
                          f"monster {result.get('hp', '?')}/{result.get('maxHp', '?')} "
                          f"crawler HP {result.get('crawlerHealth', '?')}")

        time.sleep(SCAN_INTERVAL)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  DUNGEON CRAWLER — PI AGENT")
    print(f"  NUC: {__import__('config').NUC_BASE}")
    print("=" * 50)

    reachable = is_nuc_reachable()
    print(f"[AGENT] NUC reachable: {reachable}")

    t1 = threading.Thread(target=scan_loop, daemon=True)
    t1.start()

    try:
        from display import display_loop
        t3 = threading.Thread(target=display_loop, daemon=True)
        t3.start()
        print("[AGENT] Display thread started")
    except Exception as e:
        print(f"[AGENT] Display unavailable: {e}")

    try:
        from local_dashboard import dashboard_loop
        t4 = threading.Thread(target=dashboard_loop, daemon=True)
        t4.start()
        print("[AGENT] Local dashboard thread started")
    except Exception as e:
        print(f"[AGENT] Local dashboard unavailable: {e}")

    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        print("\n[AGENT] Shutting down. The dungeon sleeps.")
