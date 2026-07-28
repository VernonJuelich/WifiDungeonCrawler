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
CHARACTER_ROOT = "/home/bjorn/dungeon/assets/characters"

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


def _fit(text, font, width, ellipsis=False):
    text = str(text or "")
    if font.getlength(text) <= width:
        return text
    marker = "..." if ellipsis else ""
    while text and font.getlength(text + marker) > width:
        text = text[:-1]
    return text.rstrip() + marker


def _wrap(text, font, width, limit=2):
    words, lines, current = str(text or "").split(), [], ""
    for word in words:
        # Split unusually long names/words so they cannot cross the border.
        while font.getlength(word) > width:
            chunk = _fit(word, font, width)
            if current:
                lines.append(current)
                current = ""
            lines.append(chunk)
            word = word[len(chunk):]
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > limit:
        lines = lines[:limit]
        last = lines[-1]
        # Prefer removing a complete word instead of displaying half of one.
        while " " in last and font.getlength(last + "...") > width:
            last = last.rsplit(" ", 1)[0]
        lines[-1] = _fit(last, font, width - font.getlength("...")) + "..."
    return lines


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


def _character_frame(target, events, has_monsters, crawler):
    """Select a Dungeon Crawler Carl pose from the current game state."""
    latest_type = (events[0].get("type") if events else "") or ""
    latest_data = {}
    if events:
        try:
            latest_data = events[0].get("data") or {}
            if isinstance(latest_data, str):
                latest_data = json.loads(latest_data)
        except (TypeError, ValueError):
            latest_data = {}
    hour = time.localtime().tm_hour
    health = int(crawler.get("health") or 0)
    max_health = max(1, int(crawler.get("max_health") or 100))
    stamina = int(crawler.get("stamina") or 0)

    if latest_type == "dead":
        group = "dead"
    elif latest_type == "defeat":
        group = "dead"
    elif latest_type in ("level_up", "floor_up", "act_up"):
        group = "level-up"
    elif latest_type in ("victory", "achievement"):
        group = "victory"
    elif latest_type == "loot":
        group = "looting"
    elif latest_type == "town":
        group = "shopping"
    elif latest_type == "quest_complete":
        group = "reading"
    elif latest_type == "monster_spotted":
        group = "scared"
    elif latest_type == "offline":
        group = "drink-coffee"
    elif latest_type == "battle_turn" and latest_data.get("critical"):
        group = "critical-hit"
    elif latest_type == "battle_turn" and latest_data.get("enemyHits"):
        group = "take-damage"
    elif latest_type == "battle_turn" and latest_data.get("bossCharge"):
        group = "cast-spell"
    elif latest_type in ("encounter", "battle_turn"):
        group = "attack" if latest_data.get("hit", True) else "block"
    elif health < max_health * 0.35:
        group = "healing"
    elif stamina < 20 or hour < 6 or hour >= 22:
        group = "resting"
    elif target and target.get("status") == "engaged":
        group = "attack"
    elif has_monsters:
        group = ("walk", "run")[int(time.time() // UPDATE_SEC) % 2]
    else:
        idle_groups = ("idle", "thinking", "talking", "drink-coffee")
        group = idle_groups[int(time.time() // UPDATE_SEC) % len(idle_groups)]

    frames = sorted(glob.glob(f"{CHARACTER_ROOT}/{group}/*.bmp"))

    if frames:
        frame_path = frames[int(time.time() // UPDATE_SEC) % len(frames)]
        try:
            frame = Image.open(frame_path).convert("L")
            frame.thumbnail((105, 83), Image.Resampling.LANCZOS)
            return frame.convert("1")
        except Exception:
            pass
    return _asset("bjorn1.bmp", (105, 83))


def _render_battle(state):
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

    stats = [
        ("target.bmp", len(monsters)),
        ("gold.bmp", len(loot)),
        ("level.bmp", crawler.get("level", 1)),
    ]
    x_positions = (5, 44, 84)
    for x, (icon_name, value) in zip(x_positions, stats):
        icon = _asset(icon_name, (15, 15))
        if icon:
            image.paste(icon, (x, 24))
        draw.text((x + 17, 26), str(value), font=bold, fill=0)
    draw.line((1, 44, W - 2, 44), fill=0)

    # Two compact status lines above a large central character.
    if target:
        ssid = target.get("ssid") or "[Hidden]"
        hp = int(target.get("hp") or 0)
        max_hp = max(1, int(target.get("max_hp") or 1))
        boss = "BOSS " if target.get("is_boss") else ""
        line1 = f"{boss}{target.get('monster_type', 'Monster')}"
        line2 = ssid
        hp_text = f"{hp} / {max_hp}"
    elif page == "loot":
        loot = state.get("loot") or []
        inventory = state.get("inventory") or {}
        frames = glob.glob(f"{CHARACTER_ROOT}/looting/*.bmp")
        if frames:
            try:
                portrait = Image.open(frames[0]).convert("1")
                portrait.thumbnail((105, 82), Image.Resampling.LANCZOS)
                _paste_center(image, portrait, 24)
            except Exception:
                pass
        draw.line((3, 110, W - 4, 110), fill=0)
        inv_text = f"BAG {inventory.get('count', len(loot))}/{inventory.get('capacity', crawler.get('inventory_capacity', 10))}"
        gold_text = f"GOLD {crawler.get('gold', 0)}"
        draw.text((4, 115), inv_text, font=body, fill=0)
        draw.text((W - body.getlength(gold_text) - 4, 115), gold_text, font=body, fill=0)

        weapon = next((item for item in loot if item.get("equipped") and item.get("power", 0)), None)
        armor = next((item for item in loot if item.get("equipped") and item.get("defense", 0)), None)
        draw.text((4, 132), f"WEAPON +{crawler.get('weapon_power', 0)}", font=tiny, fill=0)
        draw.text((4, 142), _fit((weapon or {}).get("item_name") or "Barely armed", tiny, W - 8, True), font=tiny, fill=0)
        draw.text((4, 156), f"ARMOR +{crawler.get('armor_power', 0)}", font=tiny, fill=0)
        draw.text((4, 166), _fit((armor or {}).get("item_name") or "Optimistic clothing", tiny, W - 8, True), font=tiny, fill=0)

        draw.line((3, 180, W - 4, 180), fill=0)
        latest = loot[0] if loot else None
        if latest:
            rarity = str(latest.get("rarity") or "common").upper()
            draw.text((4, 185), f"LATEST DROP · {rarity}", font=tiny, fill=0)
            y = 197
            for line in _wrap(latest.get("item_name") or "Questionable object", body, W - 10, 3):
                draw.text((4, y), line, font=body, fill=0)
                y += 12
        else:
            draw.text((4, 190), "INVENTORY EMPTY", font=bold, fill=0)
            draw.text((4, 206), "Donut blames Carl.", font=body, fill=0)
        return image
    else:
        line1, line2 = "SCANNING THE DUNGEON", "No monster in range"
        hp_text = ""
    draw.text((3, 47), _fit(line1, body, W - 10, True), font=body, fill=0)
    hp_width = body.getlength(hp_text)
    draw.text((3, 58), _fit(line2, body, W - hp_width - 16, True), font=body, fill=0)
    if hp_text:
        draw.text((W - hp_width - 4, 58), hp_text, font=body, fill=0)

    portrait = _character_frame(target, events, bool(monsters), crawler)
    _paste_center(image, portrait, 68)

    name = crawler.get("name") or "Carl"
    xp = int(crawler.get("xp") or 0)
    xp_next = max(1, int(crawler.get("xp_next") or 100))
    mood = crawler.get("mood") or "curious"
    health = int(crawler.get("health") or 0)
    max_health = max(1, int(crawler.get("max_health") or 100))
    stamina = int(crawler.get("stamina") or 0)
    max_stamina = max(1, int(crawler.get("max_stamina") or 100))
    quest = state.get("quest") or {}
    quest_progress = int(quest.get("progress") or 0)
    quest_required = int(quest.get("required") or 0)
    draw.text((3, 151), _fit(name.upper(), bold, 60, True), font=bold, fill=0)
    draw.text((65, 152), f"QUEST {quest_progress}/{quest_required}", font=tiny, fill=0)
    draw.text((3, 163), _fit(f"MOOD: {mood.upper()}", tiny, W - 10, True), font=tiny, fill=0)
    draw.text((3, 175), "HP", font=tiny, fill=0)
    draw.rectangle((19, 176, 57, 181), outline=0)
    draw.rectangle((20, 177, 20 + int(36 * health / max_health), 180), fill=0)
    draw.text((62, 175), "ST", font=tiny, fill=0)
    draw.rectangle((78, 176, W - 4, 181), outline=0)
    draw.rectangle((79, 177, 79 + int((W - 84) * stamina / max_stamina), 180), fill=0)
    message = ""
    for event in events:
        if event.get("message"):
            message = event["message"]
            break
    if not message:
        message = QUIPS[_quip_index % len(QUIPS)]
        _quip_index += 1
    for prefix in ("THE SYSTEM:", "SYSTEM:", "ANNOUNCER:"):
        if message.upper().startswith(prefix):
            message = message[len(prefix):].strip()
            break
    y = 186
    for line in _wrap(message, tiny, W - 14, 5):
        draw.text((4, y), line, font=tiny, fill=0)
        y += 10

    return image


def _render_page(state, page):
    """Render compact non-battle pages for the automatic e-ink rotation."""
    image = Image.new("1", (W, H), 1)
    draw = ImageDraw.Draw(image)
    tiny, body, bold = _font(7), _font(8), _font(10, bold=True)
    crawler = state.get("crawler") or {}
    draw.rectangle((0, 0, W - 1, H - 1), outline=0)
    draw.text((4, 4), _fit(page.upper(), bold, W - 8, True), font=bold, fill=0)
    draw.line((2, 19, W - 3, 19), fill=0)

    if page == "character":
        portrait = _character_frame(None, [], False, crawler)
        _paste_center(image, portrait, 24)
        rows = [
            f"{crawler.get('name','Carl')}  LV {crawler.get('level',1)}",
            f"STR {crawler.get('strength',5)}  DEX {crawler.get('dexterity',5)}",
            f"VIT {crawler.get('vitality',5)}  INT {crawler.get('intelligence',5)}",
            f"WEAPON +{crawler.get('weapon_power',0)}  ARMOR +{crawler.get('armor_power',0)}",
            f"PRESTIGE {crawler.get('prestige',0)}  GOLD {crawler.get('gold',0)}",
        ]
    elif page == "quest":
        quest = state.get("quest") or {}
        rows = [
            f"ACT {crawler.get('act',1)} · FLOOR {crawler.get('floor',1)}",
            quest.get("title") or "Awaiting destiny",
            f"QUEST {quest.get('progress',0)} / {quest.get('required',0)}",
        ]
        y = 65
        for daily in state.get("dailyQuests") or []:
            rows.append(f"{'X' if daily.get('status') == 'completed' else '>'} {daily.get('title','')}")
            rows.append(f"  {daily.get('progress',0)}/{daily.get('required',0)}")
    elif page == "donut":
        donut = state.get("companion") or {}
        frames = glob.glob(f"{CHARACTER_ROOT}/talking/*.bmp")
        if frames:
            try:
                portrait = Image.open(frames[0]).convert("1")
                portrait.thumbnail((105, 82), Image.Resampling.LANCZOS)
                _paste_center(image, portrait, 24)
            except Exception:
                pass
        draw.line((3, 110, W - 4, 110), fill=0)
        name = str(donut.get("name") or "Donut").upper()
        level = int(donut.get("level") or 1)
        mood = str(donut.get("mood") or "judgmental").upper()
        friendship = int(donut.get("friendship") or 0)
        draw.text((4, 115), _fit(name, bold, 70, True), font=bold, fill=0)
        level_text = f"LV {level}"
        draw.text((W - body.getlength(level_text) - 4, 117), level_text, font=body, fill=0)
        draw.text((4, 130), _fit(f"MOOD: {mood}", tiny, W - 8, True), font=tiny, fill=0)
        draw.text((4, 143), "FRIENDSHIP", font=tiny, fill=0)
        draw.rectangle((4, 154, W - 5, 162), outline=0)
        friendship_fill = int((W - 11) * (friendship % 25) / 25)
        if friendship and friendship % 25 == 0:
            friendship_fill = W - 11
        draw.rectangle((5, 155, 5 + friendship_fill, 161), fill=0)
        draw.text((4, 169), f"HEALS {donut.get('heals',0)}", font=tiny, fill=0)
        draw.text((43, 169), f"FINDS {donut.get('finds',0)}", font=tiny, fill=0)
        draw.text((82, 169), f"THEFTS {donut.get('steals',0)}", font=tiny, fill=0)
        action = str(donut.get("last_action") or "judging Carl")
        message = f"Donut is {action}. No witnesses. No refunds."
        y = 185
        for line in _wrap(message, body, W - 10, 4):
            draw.text((4, y), line, font=body, fill=0)
            y += 12
        return image
    else:
        recap = (state.get("weeklyRecap") or {}).get("message") or "The accountants are still counting."
        regions = state.get("regions") or []
        bosses = state.get("bosses") or []
        rows = [
            f"KILLS {crawler.get('kills',0)}  FLOOR {crawler.get('floor',1)}",
            f"ROOMS {len(state.get('monsters') or [])}  REGIONS {len(regions)}",
            f"BOSSES {len(bosses)}  QUESTS {crawler.get('quests_completed',0)}",
            "", recap,
        ]

    y = 116 if page in ("character", "donut") else 28
    for text in rows:
        for line in _wrap(text, body if y < 150 else tiny, W - 10, 2):
            if y > H - 11:
                break
            draw.text((4, y), line, font=body if y < 150 else tiny, fill=0)
            y += 11
        y += 2
    return image


def _render(state):
    crawler = state.get("crawler") or {}
    requested = crawler.get("display_page") or "auto"
    engaged = any(m.get("status") == "engaged" for m in state.get("monsters") or [])
    if requested == "battle" or engaged:
        return _render_battle(state)
    if requested == "auto":
        pages = ("battle", "character", "quest", "donut", "loot", "summary")
        requested = pages[int(time.time() // 120) % len(pages)]
    return _render_battle(state) if requested == "battle" else _render_page(state, requested)


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
