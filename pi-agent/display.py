"""Ragnar-inspired, character-centric e-ink HUD for the safe WiFi RPG."""
import json
import glob
import os
import sys
import time
import urllib.request

sys.path.insert(0, "/home/bjorn/Bjorn/resources")
from waveshare_epd import epd2in13_V4
from PIL import Image, ImageDraw, ImageFont, ImageOps

from config import NUC_BASE

W, H = 122, 250
UPDATE_SEC = 30
ASSET_ROOT = "/home/bjorn/Bjorn/resources/images/static"

QUIPS = [
    "The audience demands battle.",
    "Stay in range, crawler.",
    "Every signal hides a monster.",
    "Loot awaits the persistent.",
    "The dungeon is always watching.",
]
_quip_index = 0


def _state():
    try:
        with urllib.request.urlopen(f"{NUC_BASE}/api/state", timeout=5) as response:
            return json.loads(response.read())
    except Exception:
        return {}


def _font(size=9, bold=False, viking=False):
    choices = []
    if viking:
        choices += [
            "/home/bjorn/Bjorn/resources/fonts/Viking.TTF",
            "/home/bjorn/Bjorn/resources/fonts/Cartoon.ttf",
        ]
    choices.append(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    )
    for path in choices:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _fit(text, font, width):
    text = str(text or "")
    while text and font.getlength(text) > width:
        text = text[:-1]
    return text


def _wrap(text, font, width, limit=2):
    words, lines, current = str(text or "").split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines[:limit]


def _asset(name, size, invert=False):
    path = os.path.join(ASSET_ROOT, name)
    try:
        image = Image.open(path).convert("L")
        if invert:
            image = ImageOps.invert(image)
        image.thumbnail(size, Image.Resampling.LANCZOS)
        return image.convert("1")
    except Exception:
        return None


def _paste_center(canvas, image, y):
    if image:
        canvas.paste(image, ((W - image.width) // 2, y))


def _character_frame(target, events, has_monsters):
    """Rotate Bjorn artwork by game state, Ragnar-style."""
    latest_type = (events[0].get("type") if events else "") or ""
    hour = time.localtime().tm_hour
    if hour < 6 or hour >= 22:
        folders = ("IDLE",)
    elif latest_type in ("victory", "loot"):
        folders = ("NetworkScanner", "IDLE")
    elif target and target.get("status") == "engaged":
        folders = ("NetworkScanner",)
    elif has_monsters:
        folders = ("NetworkScanner", "IDLE")
    else:
        folders = ("IDLE",)

    frames = []
    for folder in folders:
        frames.extend(sorted(glob.glob(
            f"/home/bjorn/Bjorn/resources/images/status/{folder}/*.bmp"
        )))

    if frames:
        frame_path = frames[int(time.time() // UPDATE_SEC) % len(frames)]
        try:
            frame = Image.open(frame_path).convert("L")
            frame.thumbnail((105, 83), Image.Resampling.LANCZOS)
            return frame.convert("1")
        except Exception:
            pass
    return _asset("bjorn1.bmp", (105, 83))


def _render(state):
    global _quip_index
    image = Image.new("1", (W, H), 1)
    draw = ImageDraw.Draw(image)
    tiny = _font(7)
    body = _font(8)
    bold = _font(9, bold=True)
    title = _font(15, bold=True, viking=True)

    crawler = state.get("crawler") or {}
    monsters = state.get("monsters") or []
    loot = state.get("loot") or []
    events = state.get("events") or []

    engaged = next((m for m in monsters if m.get("status") == "engaged"), None)
    target = engaged or next((m for m in monsters if m.get("status") != "dead"), None)

    # Ragnar-style outer frame, title, and compact counter strip.
    draw.rectangle((0, 0, W - 1, H - 1), outline=0)
    heading = "DUNGEON"
    draw.text(((W - title.getlength(heading)) / 2, 3), heading, font=title, fill=0)
    draw.line((1, 22, W - 2, 22), fill=0)

    stats = [
        ("target.bmp", len(monsters)),
        ("gold.bmp", len(loot)),
        ("level.bmp", crawler.get("level", 1)),
    ]
    x_positions = (5, 44, 84)
    for x, (icon_name, value) in zip(x_positions, stats):
        icon = _asset(icon_name, (15, 15))
        if icon:
            image.paste(icon, (x, 27))
        draw.text((x + 17, 29), str(value), font=bold, fill=0)
    draw.line((1, 47, W - 2, 47), fill=0)

    # Two compact status lines above a large central character.
    if target:
        ssid = target.get("ssid") or "[Hidden]"
        hp = int(target.get("hp") or 0)
        max_hp = max(1, int(target.get("max_hp") or 1))
        boss = "BOSS " if target.get("is_boss") else ""
        line1 = f"{boss}{target.get('monster_type', 'Monster')}"
        line2 = ssid
        hp_text = f"{hp}/{max_hp}"
    else:
        line1, line2 = "SCANNING THE DUNGEON", "No monster in range"
        hp_text = ""
    draw.text((3, 51), _fit(line1, body, W - 6), font=body, fill=0)
    hp_width = body.getlength(hp_text)
    draw.text((3, 62), _fit(line2, body, W - hp_width - 12), font=body, fill=0)
    if hp_text:
        draw.text((W - hp_width - 4, 62), hp_text, font=body, fill=0)

    portrait = _character_frame(target, events, bool(monsters))
    _paste_center(image, portrait, 74)

    name = crawler.get("name") or "Carl"
    xp = int(crawler.get("xp") or 0)
    xp_next = max(1, int(crawler.get("xp_next") or 100))
    kills = int(crawler.get("kills") or 0)
    mood = crawler.get("mood") or "curious"
    health = int(crawler.get("health") or 0)
    max_health = max(1, int(crawler.get("max_health") or 100))
    stamina = int(crawler.get("stamina") or 0)
    max_stamina = max(1, int(crawler.get("max_stamina") or 100))
    draw.text((3, 160), _fit(name.upper(), bold, 60), font=bold, fill=0)
    draw.text((76, 160), f"KILLS {kills}", font=tiny, fill=0)
    draw.text((3, 170), _fit(f"MOOD: {mood.upper()}", tiny, W - 6), font=tiny, fill=0)
    draw.text((3, 180), "HP", font=tiny, fill=0)
    draw.rectangle((19, 181, 57, 186), outline=0)
    draw.rectangle((20, 182, 20 + int(36 * health / max_health), 185), fill=0)
    draw.text((62, 180), "ST", font=tiny, fill=0)
    draw.rectangle((78, 181, W - 4, 186), outline=0)
    draw.rectangle((79, 182, 79 + int((W - 84) * stamina / max_stamina), 185), fill=0)
    message = ""
    for event in events:
        if event.get("message"):
            message = event["message"]
            break
    if not message:
        message = QUIPS[_quip_index % len(QUIPS)]
        _quip_index += 1
    y = 190
    for line in _wrap(message, tiny, W - 8, 3):
        draw.text((4, y), line, font=tiny, fill=0)
        y += 10

    return image


def display_loop():
    print("[DISPLAY] Initializing Ragnar-style RPG display...")
    try:
        epd = epd2in13_V4.EPD()
        epd.init()
        epd.Clear(0xFF)
    except Exception as error:
        print(f"[DISPLAY] Init failed: {error}")
        return

    while True:
        try:
            epd.display(epd.getbuffer(_render(_state())))
            print("[DISPLAY] Screen updated")
        except Exception as error:
            print(f"[DISPLAY] Update error: {error}")
        time.sleep(UPDATE_SEC)
