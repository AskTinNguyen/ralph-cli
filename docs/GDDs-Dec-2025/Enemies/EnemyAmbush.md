# [GDD] Enemy Ambush/Encounter

## Overview

The Enemy Ambush/Encounter system defines how enemies spawn, engage, and challenge players in various combat scenarios throughout the game.

---

## Encounter Phases

### Phase 1: Detection
- Player enters trigger zone
- Enemies become aware of player presence
- Alert state transition begins

### Phase 2: Engagement
- Enemies move to combat positions
- Initial attacks begin
- Formation established

### Phase 3: Combat
- Full combat engagement
- Reinforcement waves if applicable
- Dynamic repositioning

### Phase 4: Resolution
- All enemies defeated or player retreats
- Loot drops
- Area cleared state

---

## Trigger Types

### Proximity Trigger
- Player enters defined radius
- Most common trigger type
- Configurable detection range

### Line of Sight Trigger
- Enemy visually spots player
- Blocked by obstacles and cover
- Can be avoided with stealth

### Sound Trigger
- Loud player actions alert enemies
- Running, combat sounds, abilities
- Radius-based detection

### Scripted Trigger
- Story or event-driven encounters
- Cutscene transitions
- Boss introductions

---

## Encounter Scenarios

### Scenario 1: Standard Patrol Encounter
- Small group of 2-4 enemies
- Patrol routes intersect with player path
- Can be avoided or engaged

### Scenario 2: Ambush
- Enemies hidden until triggered
- Surround player from multiple directions
- Higher initial threat level

### Scenario 3: Wave Defense
- Multiple waves of enemies
- Escalating difficulty
- Rest periods between waves

### Scenario 4: Boss Encounter
- Single powerful enemy or boss + adds
- Arena-based combat
- Phase transitions

### Scenario 5: Elite Hunt
- Single elite enemy patrol
- Optional challenge encounter
- High risk, high reward

### Scenario 6: Horde
- Large number of weak enemies
- Overwhelming numbers
- Tests crowd control abilities

---

## VFX/SFX

### Visual Effects
- Enemy spawn effects
- Alert state indicators
- Area boundary markers
- Wave transition effects

### Sound Effects
- Enemy detection sounds
- Combat start stingers
- Wave complete audio
- Victory/defeat sounds

---

## Design Guidelines

1. **Readable Setup**: Players should understand encounter scope quickly
2. **Fair Engagement**: No unavoidable damage at encounter start
3. **Escalation**: Difficulty builds appropriately through encounter
4. **Reward Clarity**: Clear indication of rewards upon completion

---

*Source: Notion GDDs Dec 2025 > Enemies GDD > [GDD] Enemy Ambush/Encounter*
