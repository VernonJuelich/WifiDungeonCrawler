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

from config import (
    WIFI_INTERFACE, LOCAL_DB, SCAN_INTERVAL, ENCOUNTER_COOLDOWN,
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
def scan_wifi_networks() -> list[dict]:
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "BSSID,SSID,SECURITY,SIGNAL,CHAN",
             "dev", "wifi", "list", "ifname", WIFI_INTERFACE, "--rescan", "yes"],
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
            ssid     = parts[1].replace("\x00", ":").strip()
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
        return networks
    except Exception as e:
        print(f"[AGENT] WiFi scan failed: {e}")
        return []

# ── Scan loop ─────────────────────────────────────────────────────────────────
def scan_loop():
    print("[AGENT] Scan loop started")
    while True:
        networks = scan_wifi_networks()
        if not networks:
            print("[AGENT] No networks from Bjorn yet...")
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
            if bssid and encounter_ready(bssid) and is_nuc_reachable():
                result = report_encounter(bssid, top.get("signal", -90))
                if result:
                    mark_encounter(bssid)
                    print(f"[AGENT] Battle: {result.get('status')} "
                          f"{result.get('progress', 0)}/{result.get('required', 100)}")

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
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        print("\n[AGENT] Shutting down. The dungeon sleeps.")
