"""Tiny offline-capable dashboard served directly by Donut."""
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from config import LOCAL_DASHBOARD_PORT, NUC_BASE

_cache = {"crawler": {}, "monsters": [], "loot": [], "events": [], "offline": True}
_lock = threading.Lock()

PAGE = r"""<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Donut Dungeon</title><style>
body{margin:0;background:#090b10;color:#e8e3d3;font:15px monospace}
header{padding:18px;background:#151923;border-bottom:2px solid #d6a84b}
h1{margin:0;color:#f0cf75}.grid{display:grid;gap:12px;padding:12px}
.card{background:#141821;border:1px solid #414a5b;padding:12px}
.stats{display:flex;gap:16px;flex-wrap:wrap}.gold{color:#f0cf75}
.bar{height:10px;background:#252b38;margin:5px 0}.fill{height:100%;background:#d6a84b}
.monster{border-left:4px solid #a94343;margin:8px 0;padding:7px;background:#1b1f29}
.dead{opacity:.45;border-color:#4c9864}.engaged{border-color:#d6a84b}
small{color:#8993a5}.offline{color:#e07171}
</style></head><body><header><h1>DONUT DUNGEON</h1>
<div id="connection"></div></header><main class="grid">
<section class="card"><h2>CRAWLER</h2><div id="crawler"></div></section>
<section class="card"><h2>DUNGEON ROOMS</h2><div id="monsters"></div></section>
<section class="card"><h2>LOOT</h2><div id="loot"></div></section>
</main><script>
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const bar=(v,m)=>`<div class=bar><div class=fill style="width:${Math.min(100,v/Math.max(1,m)*100)}%"></div></div>`;
async function draw(){let s=await(await fetch('/api/state')).json(),c=s.crawler||{};
document.querySelector('#connection').innerHTML=s.offline?'<span class=offline>NUC OFFLINE — CACHED STATE</span>':'TAILSCALE SYNCED';
document.querySelector('#crawler').innerHTML=`<b class=gold>${esc(c.name||'Carl')}</b>
<div class=stats><span>LVL ${c.level||1}</span><span>FLOOR ${c.floor||1}</span><span>KILLS ${c.kills||0}</span><span>MOOD ${esc(c.mood||'curious')}</span></div>
<small>HEALTH ${c.health||0}/${c.max_health||100}</small>${bar(c.health||0,c.max_health||100)}
<small>STAMINA ${c.stamina||0}/${c.max_stamina||100}</small>${bar(c.stamina||0,c.max_stamina||100)}`;
document.querySelector('#monsters').innerHTML=(s.monsters||[]).map(m=>`<div class="monster ${esc(m.status)}">
<b>${m.is_boss?'BOSS — ':''}${esc(m.monster_type)}</b><br>${esc(m.ssid||'[Hidden]')}
<br><small>${esc(m.room_id)} · ${m.signal} dBm · HP ${m.hp||0}/${m.max_hp||0}</small>${bar(m.hp||0,m.max_hp||1)}</div>`).join('')||'No monsters nearby.';
document.querySelector('#loot').innerHTML=(s.loot||[]).slice(0,10).map(x=>`<div>${x.equipped?'⚔ ':''}<b>${esc(x.item_name)}</b> <small>${esc(x.rarity)}</small></div>`).join('')||'No loot yet.'}
draw();setInterval(draw,5000);
</script></body></html>"""


def _sync():
    global _cache
    while True:
        try:
            with urllib.request.urlopen(f"{NUC_BASE}/api/state", timeout=5) as response:
                state = json.loads(response.read())
                state["offline"] = False
                with _lock:
                    _cache = state
        except Exception:
            with _lock:
                _cache["offline"] = True
        time.sleep(10)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/state":
            with _lock:
                payload = json.dumps(_cache).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        else:
            payload = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        return


def dashboard_loop():
    threading.Thread(target=_sync, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", LOCAL_DASHBOARD_PORT), Handler)
    print(f"[DASHBOARD] Local dashboard: http://0.0.0.0:{LOCAL_DASHBOARD_PORT}")
    server.serve_forever()
