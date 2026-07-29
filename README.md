# WiFi Dungeon Crawler

> An autonomous retro RPG where nearby Wi-Fi networks become monsters, captured data becomes loot, and real RF activity drives character progression.

WiFi Dungeon Crawler turns wireless network observations into a persistent dungeon-crawling game inspired by the automatic progression of **Progress Quest** and the absurd system-driven humour of **Dungeon Crawler Carl**.

Instead of displaying a conventional list of access points, the application transforms the surrounding wireless environment into a living dungeon:

- Wi-Fi networks become monsters
- Hidden networks become invisible stalkers
- Signal strength influences threat level
- Encryption becomes armour
- Clients become minions
- Captures become battle victories
- Recovered credentials become loot
- New networks expand the dungeon
- Long-term activity drives levels, achievements and progression

The result is part wireless dashboard, part idle RPG, and part unnecessarily dramatic dungeon simulator.

---

## Screenshot

To come soon

---

## The Concept

WiFi Dungeon Crawler sits on top of real wireless telemetry and interprets it as an autonomous role-playing game.

The crawler does not wait for the player to select every action. It explores, encounters monsters, completes quests, collects equipment and develops over time.

The surrounding RF environment becomes the procedural game world.

| Wireless activity | Dungeon interpretation |
|---|---|
| Access point discovered | Monster encountered |
| Hidden SSID | Invisible Stalker |
| Open network | Naked Slime |
| Strong signal | Higher threat |
| Encryption type | Armour class |
| Connected clients | Minions |
| Channel | Dungeon territory |
| New location | New dungeon floor |
| Handshake captured | Monster wounded |
| Successful recovery | Monster defeated |
| Captured artefact | Loot drop |
| Repeated discoveries | Quest progress |
| Historical activity | Character progression |

The same underlying network should remain recognisable across encounters, creating the sense of a persistent dungeon rather than a collection of random events.

---

## Features

### Autonomous Dungeon Progression

The game continues to progress as new wireless activity is observed.

The crawler can:

- Discover monsters
- Engage in automatic battles
- Gain experience
- Level up
- Complete quests
- Earn gold
- Collect equipment
- Unlock achievements
- Increase prestige
- Build a persistent history

### Procedural Wi-Fi Monsters

Access points are converted into monster encounters using their observed properties.

Possible monster classes include:

- The Lich
- Invisible Stalker
- Common Peasant
- Naked Slime
- Dungeon Drake
- Unknown Horror

Monster information can include:

- SSID
- BSSID
- Signal strength
- Channel
- Encryption
- Vendor
- Client count
- Last-seen time
- Challenge rating
- Encounter status

Networks sharing an SSID may be grouped into a single encounter while retaining their individual BSSIDs.

### Live Dungeon Map

The dashboard presents nearby networks as monster cards rather than rows in a technical table.

Monster states can include:

- Alive
- Wounded
- Defeated
- Hidden
- Out of range

The map updates as the wireless environment changes.

### Character Progression

The crawler has a persistent character sheet containing values such as:

- Level
- Experience
- Kills
- Current floor
- Strength
- Dexterity
- Vitality
- Intelligence
- Weapon
- Armour
- Gold
- Prestige
- Quests completed

Progress is based on actual observed activity rather than a fixed scripted campaign.

### Quests

The game supports several types of objectives:

- Main quests
- Daily quests
- Exploration goals
- Monster-defeat goals
- Network-discovery goals
- Capture goals
- Long-term progression challenges

Examples:

- Defeat roaming goblins
- Discover new dungeon rooms
- Survive unstable signal zones
- Locate hidden creatures
- Complete a number of encounters
- Find networks from unfamiliar vendors

### Loot and Equipment

Successful encounters can produce RPG-style rewards.

Loot can include:

- Weapons
- Armour
- Antennas
- Grimoires
- Trinkets
- Relics
- Consumables
- Quest items

Items may have:

- Rarity
- Value
- Flavour text
- Equipment bonuses
- Source monster
- Discovery date

Example:

> **The Princess Donut Telecommunications Grimoire**  
> A tome bound in the secrets of Princess Donut Telecommunications. It radiates mild menace.

### Achievements

Achievements record milestones and unusual events.

Examples:

- First network discovered
- First hidden network
- First successful recovery
- Fifty unique networks observed
- A network found in an unexpected location
- A rare monster defeated
- A repeated achievement with an increasing count

Achievements may be either one-time unlocks or repeatable accomplishments.

### System Commentary

The System provides live announcements and deliberately overdramatic commentary.

Examples:

> **SYSTEM:** A hidden creature has entered the dungeon. It is probably harmless. This statement is not legally binding.

> **SYSTEM:** You defeated another consumer-grade router. History will remember this moment.

> **SYSTEM:** New achievement unlocked: Questionable Life Choices.

Commentary can be generated from real game events while preserving the satirical dungeon tone.

### Live Updates

The web interface supports live event updates for activity such as:

- Monster discoveries
- Captures
- Defeats
- Loot drops
- Achievements
- Level-ups
- System events
- Processing results

The dashboard can update without requiring a full page refresh.

### Audience and Sponsorship

The project also includes a deliberately unnecessary audience system that can track fictional:

- Views
- Followers
- Favourites
- Ratings
- Peak audience
- Sponsor interest

Because apparently wireless reconnaissance is now a spectator sport.

### Companion Display

The project can be paired with a Raspberry Pi Zero 2 W and a small e-paper display.

The e-paper device can show simplified scenes such as:

- Current encounter
- Crawler status
- Battle result
- Loot acquired
- Level-up
- Resting
- Shopping
- Character sheet
- System announcement

The web dashboard acts as the full management view, while the e-paper display acts as the crawler’s handheld game screen.

---

## Dashboard Areas

The dashboard may include:

- Character Sheet
- Party Member
- Current Quest
- Daily Quests
- Trophy Case
- Audience and Sponsors
- Dungeon Map
- Live Commentary
- System Broadcast
- Inventory
- Progression History
- Game Controls
- Equipment
- Rest and Resume controls

The interface is designed to resemble a retro RPG management screen rather than a traditional security dashboard.

---

## Project Architecture

A typical deployment may contain the following components:

```text
┌───────────────────────────┐
│ Wireless observation      │
│ Bettercap / compatible    │
│ telemetry source          │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ Dungeon game engine       │
│                           │
│ Monster generation        │
│ Threat calculation        │
│ Quest progression         │
│ Loot generation           │
│ Achievements              │
│ Character progression     │
└─────────────┬─────────────┘
              │
       ┌──────┴──────┐
       ▼             ▼
┌─────────────┐  ┌─────────────┐
│ Web UI      │  │ E-paper UI  │
│ Dashboard   │  │ Companion   │
└─────────────┘  └─────────────┘


MIT License

Copyright (c) 2026 Vernon Juelich

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, subject to the conditions included in the full MIT Licence.
