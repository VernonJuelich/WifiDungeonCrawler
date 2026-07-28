"""Ragnar-inspired, character-centric e-ink HUD for the safe WiFi RPG."""
import json
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
        progress = int(target.get("encounter_progress") or 0)
        required = max(1, int(target.get("encounter_required") or 100))
        line1 = f"{target.get('monster_type', 'Monster')}"
        line2 = f"{ssid}  {round(progress * 100 / required)}%"
    else:
        line1, line2 = "SCANNING THE DUNGEON", "No monster in range"
    draw.text((3, 51), _fit(line1, body, W - 6), font=body, fill=0)
    draw.text((3, 62), _fit(line2, body, W - 6), font=body, fill=0)

    portrait = _asset("bjorn1.bmp", (105, 83))
    _paste_center(image, portrait, 74)

    # Decorative divider inspired by Ragnar's frise strip.
    draw.line((1, 160, W - 2, 160), fill=0)
    for x in range(4, W - 4, 8):
        draw.line((x, 163, x + 3, 166), fill=0)
        draw.line((x + 3, 166, x + 6, 163), fill=0)
    draw.line((1, 169, W - 2, 169), fill=0)

    name = crawler.get("name") or "Carl"
    xp = int(crawler.get("xp") or 0)
    xp_next = max(1, int(crawler.get("xp_next") or 100))
    kills = int(crawler.get("kills") or 0)
    draw.text((3, 174), _fit(name.upper(), bold, 60), font=bold, fill=0)
    draw.text((76, 174), f"KILLS {kills}", font=tiny, fill=0)
    draw.rectangle((3, 188, W - 4, 194), outline=0)
    fill = int((W - 9) * min(1, xp / xp_next))
    if fill:
        draw.rectangle((5, 190, 5 + fill, 192), fill=0)
    draw.text((3, 197), f"XP {xp}/{xp_next}", font=tiny, fill=0)

    message = ""
    for event in events:
        if event.get("message"):
            message = event["message"]
            break
    if not message:
        message = QUIPS[_quip_index % len(QUIPS)]
        _quip_index += 1
    y = 211
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
