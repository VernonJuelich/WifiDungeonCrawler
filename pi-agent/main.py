#!/usr/bin/env python3
"""
Dungeon Crawler — Pi Agent
Runs alongside Bjorn. Reads discovered networks, classifies monsters,
scores targets with AI targeting, uploads handshakes to NUC for cracking.

Usage:
  python3 main.py

Bjorn integration: drop this in /home/bjorn/dungeon/ and run as a service.
It tails Bjorn's network output and handshake directory.
"""

import os
import sys
import json
import time
import sqlite3
import glob
import threading

from config import (
    BJORN_NETWORKS_FILE, BJORN_HANDSHAKES_DIR,
    LOCAL_DB, SCAN_INTERVAL, SYNC_INTERVAL,
)
from monster import classify
from targeting import rank, mark_attempted
from nuc_client import (
    report_network, report_handshake_file,
    report_handshake_event, is_nuc_reachable,
)

# ── Local SQLite (character backup + seen tracking) ───────────────────────────
conn = sqlite3.connect(LOCAL_DB, check_same_thread=False)
conn.execute("""
    CREATE TABLE IF NOT EXISTS seen (
        bssid TEXT PRIMARY KEY,
        ssid TEXT,
        first_seen REAL,
        handshake_sent INTEGER DEFAULT 0
    )
""")
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

def mark_handshake_sent(bssid):
    conn.execute("UPDATE seen SET handshake_sent=1 WHERE bssid=?", (bssid,))
    conn.commit()

def was_handshake_sent(bssid):
    row = conn.execute("SELECT handshake_sent FROM seen WHERE bssid=?", (bssid,)).fetchone()
    return row and row[0] == 1

# ── Network reader (polls Bjorn's output) ─────────────────────────────────────
def read_bjorn_networks() -> list[dict]:
    if not os.path.exists(BJORN_NETWORKS_FILE):
        return []
    try:
        with open(BJORN_NETWORKS_FILE) as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "networks" in data:
            return data["networks"]
    except Exception as e:
        print(f"[AGENT] Failed to read Bjorn networks: {e}")
    return []

# ── Scan loop ─────────────────────────────────────────────────────────────────
def scan_loop():
    print("[AGENT] Scan loop started")
    while True:
        networks = read_bjorn_networks()
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
                if is_nuc_reachable():
                    resp = report_network({**net, **classification})
                    print(f"[AGENT] New monster: {classification['type']} — {net.get('ssid','[hidden]')} ({bssid})")
                    if resp:
                        print(f"[AGENT]   NUC says: {resp.get('narration','')[:80]}")

        # AI targeting: pick best targets
        targets = rank(networks)
        if targets:
            top = targets[0]
            print(f"[AGENT] Top target: {top.get('ssid','[hidden]')} ({top.get('bssid')}) — {top.get('monster_type')}")

        time.sleep(SCAN_INTERVAL)

# ── Handshake watcher ─────────────────────────────────────────────────────────
_sent_files: set = set()

def handshake_loop():
    print(f"[AGENT] Handshake watcher started — watching {BJORN_HANDSHAKES_DIR}")
    while True:
        if not os.path.isdir(BJORN_HANDSHAKES_DIR):
            time.sleep(10)
            continue

        for ext in ("*.cap", "*.pcapng", "*.pcap", "*.hccapx", "*.22000"):
            for cap_file in glob.glob(os.path.join(BJORN_HANDSHAKES_DIR, ext)):
                if cap_file in _sent_files:
                    continue

                filename = os.path.basename(cap_file)
                parts    = os.path.splitext(filename)[0].split("_")
                bssid    = parts[0].replace("-", ":")
                ssid     = "_".join(parts[1:]) if len(parts) > 1 else ""

                mark_attempted(bssid)
                _sent_files.add(cap_file)

                if was_handshake_sent(bssid):
                    continue

                print(f"[AGENT] New handshake: {ssid} ({bssid})")
                if is_nuc_reachable():
                    report_handshake_file(cap_file, bssid, ssid)
                    mark_handshake_sent(bssid)
                    print(f"[AGENT]   Sent to NUC for cracking")
                else:
                    print(f"[AGENT]   NUC unreachable, will retry")
                    _sent_files.discard(cap_file)

        time.sleep(5)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  DUNGEON CRAWLER — PI AGENT")
    print(f"  NUC: {__import__('config').NUC_BASE}")
    print("=" * 50)

    reachable = is_nuc_reachable()
    print(f"[AGENT] NUC reachable: {reachable}")

    t1 = threading.Thread(target=scan_loop, daemon=True)
    t2 = threading.Thread(target=handshake_loop, daemon=True)
    t1.start()
    t2.start()

    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        print("\n[AGENT] Shutting down. The dungeon sleeps.")
