# GDDs (Dec 2025)

Game Design Documents from Notion - Ather Labs

**Source:** [Notion GDDs (Dec 2025)](https://www.notion.so/atherlabs/GDDs-Dec-2025-2992701f826d80de9fe0dbd43e3f15be)

## Structure

```
GDDs-Dec-2025/
├── Character/
│   ├── WEAPON-GreatSword.md    # Combo details, properties
│   ├── WEAPON-Spear.md         # Combo details, Beta skills
│   ├── WEAPON-Sword.md         # Combo details, properties
│   └── Artifacts.md            # Dragon Summon, Kim Châm, Dù Sấm
├── Control/
│   └── GameplayInput.md        # Input system, button mapping
├── Enemies/
│   ├── EnemySystem.md          # Core enemy system GDD
│   ├── EnemyAmbush.md          # Encounter/Ambush design
│   ├── EnemyBlockParry.md      # Block & Parry mechanics
│   ├── StunMeter.md            # Stun Meter & Hyper Armor
│   └── Biomes/
│       ├── Fear.md             # CỤ - Fear biome enemies
│       ├── Despair.md          # AI - Despair biome enemies
│       ├── Hatred.md           # Ố - Hatred biome
│       ├── Love.md             # ÁI - Love biome
│       ├── Joy.md              # HỶ - Joy biome
│       ├── Rage.md             # NỘ - Rage biome
│       └── Desire.md           # DỤC - Desire biome
├── Camera.md                   # (empty in Notion)
└── Audio.md                    # (embedded content)
```

## Documents

### Character
- **[WEAPON - Great Sword](Character/WEAPON-GreatSword.md)** - Heavy weapon with Light/Heavy combos, Jump Attack, Sprint Attack
- **[WEAPON - Spear](Character/WEAPON-Spear.md)** - Polearm with combos and Beta skills (Y, X, B, A)
- **[WEAPON - Sword](Character/WEAPON-Sword.md)** - Balanced weapon with Light/Heavy combos
- **[Artifacts](Character/Artifacts.md)** - Dragon Summon, Kim Châm (Needles), Dù Sấm (Thunder Umbrella)

### Control
- **[Gameplay Input](Control/GameplayInput.md)** - Unreal Enhanced Input System, contexts, button mapping

### Enemies

#### Core Systems
- **[Enemy System](Enemies/EnemySystem.md)** - States, Status Effects, Movement, Attacks, Abilities, Classification
- **[Enemy Ambush/Encounter](Enemies/EnemyAmbush.md)** - Encounter phases, triggers, scenarios
- **[Enemy Block & Parry](Enemies/EnemyBlockParry.md)** - Defensive mechanics, enemy archetypes
- **[Stun Meter & Hyper Armor](Enemies/StunMeter.md)** - Stun system, armor break mechanics

#### Biomes (CÁC PHÁCH)
- **[CỤ - FEAR](Enemies/Biomes/Fear.md)** - Fear enemies (Fear1, Fear3, Fear6)
- **[AI - DESPAIR](Enemies/Biomes/Despair.md)** - Insect enemies (Beetle, Dragonfly, Myrmi, Mantis, Moth, Burrow, Bootie)
- **[Ố - HATRED](Enemies/Biomes/Hatred.md)** - Aggressive enemies
- **[ÁI - LOVE](Enemies/Biomes/Love.md)** - Protective/obsessive enemies
- **[HỶ - JOY](Enemies/Biomes/Joy.md)** - Chaotic/unpredictable enemies
- **[NỘ - RAGE](Enemies/Biomes/Rage.md)** - Berserker enemies
- **[DỤC - DESIRE](Enemies/Biomes/Desire.md)** - Temptation-based enemies

#### Enemy Roster
**Boss**: Spear Wielder, YÊU NHỀN NHỆN (Spider Demon)

**Elite**: Dream Walker, Dual Swords, Great Axe, Battle Mage, Axe Shield, Claw Sword, Dreadroot, Grimwarden, Beast, Maskmancer

**Normal**: Sword, Ironbound, Fire Monk Abbot, Fire Monk Novice, Sword Shield, Juggernaut, Spear, Sword Aggressive, Dual Swords, Feibiao, Spellcaster, Dream Walker

**Creep**: Halfbody

### Other
- **Camera** - Empty (no content in Notion)
- **Audio** - Embedded content (not retrievable via API)

---

*Retrieved from Notion via MCP on 2026-01-16*
