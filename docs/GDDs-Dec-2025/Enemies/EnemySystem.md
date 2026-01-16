# [GDD] Enemy System

## Table Of Contents
1. [Overview](#overview)
2. [Enemy States](#enemy-states)
3. [Status Effects](#status-effects)
4. [Movement](#movement)
5. [Special Interactions](#special-interactions)
6. [Attacks](#attacks)
7. [Abilities](#abilities)
8. [Feedback](#feedback)
9. [Classification](#classification)
10. [List of Enemies](#list-of-enemies)

---

## OVERVIEW

- The enemy system in **S2** is built around the philosophy of **"readable – reactable – rewarding when overcome,"** emphasizing behavioral variety, clear combat rhythm, and the ability to apply tactical pressure on the player.

- Enemies are categorized into multiple tiers such as **normal**, **elite**, and **boss**, each with distinct behaviors and combat roles. Certain enemies can coordinate with one another, take advantage of environmental features, or trigger contextual interactions to enhance combat dynamism and challenge.

- The core pillars include:
  - Readable attack patterns
  - Reactable timing windows
  - Rewarding player skill expression

- Strong visual and audio feedback mechanisms reinforce attack readability and elevate the overall combat experience.

---

## ENEMY STATES

### Idle State Domain

The Idle State Domain governs enemy behavior when not actively engaged in combat. Key states include:

- **Patrol**: Enemy follows predefined patrol routes
- **Idle Animation**: Default stance when stationary
- **Alert**: Transitional state when player is detected nearby
- **Investigation**: Enemy investigates disturbances or sounds

### Combat State Domain

The Combat State Domain handles all combat-related behaviors:

- **Engage**: Initial combat engagement state
- **Attack**: Executing attack animations and hitboxes
- **Recovery**: Post-attack recovery frames
- **Reposition**: Moving to optimal combat position
- **Defend**: Blocking or defensive stance
- **Stagger**: Reaction to player attacks
- **Chase**: Pursuing fleeing player

---

## STATUS EFFECTS

### Stunned
- Enemy is temporarily incapacitated
- Cannot perform any actions
- Duration varies by enemy type and attack that caused it
- Visual indicator: Stars/daze effect above head

### Knocked Down
- Enemy falls to the ground
- Recovery animation required before resuming combat
- Vulnerable to follow-up attacks during recovery
- Some enemies have knockdown immunity

### Frozen
- Enemy movement and actions halted
- Damage vulnerability may be increased
- Duration based on freeze source
- Can be broken by fire damage

### Broken Hyper Armor
- Enemy's super armor has been depleted
- Vulnerable to stagger and interrupts
- Must regenerate before regaining armor
- Visual indicator: Armor crack effect

### Death
- Final state when HP reaches zero
- Triggers death animation sequence
- Drops loot and grants experience
- Removes enemy from combat

### On-Death Action
- Special abilities triggered upon death
- Examples: Explosion, summoning allies, buff to nearby enemies
- Must be clearly telegraphed to player

---

## MOVEMENT

### Root Motion
- Animation-driven movement
- Precise control over enemy positioning during attacks
- Used for: Combo attacks, heavy strikes, special moves

### Motion-Warped
- Dynamically adjusts animation to reach target
- Ensures attacks connect at appropriate range
- Used for: Lunges, gap closers, tracking attacks

### Rotate-to-Target
- Enemy rotates to face player
- Can be restricted during certain animations
- Rotation speed varies by enemy type

### Strafe
- Lateral movement while maintaining facing
- Used during combat positioning
- Speed and direction influenced by player position

### Formation
- Coordinated movement with other enemies
- Maintains spacing and encirclement
- Leaders may direct formation changes

### NavLink
- Uses navigation links for complex traversal
- Jumping gaps, climbing ledges
- Pathfinding integration

---

## SPECIAL INTERACTIONS

- Environmental hazards interaction
- Destructible object usage
- Team coordination behaviors
- Contextual attack triggers

---

## ATTACKS

### Đặc điểm chung (Common Characteristics)
- Clear wind-up animations for readability
- Consistent timing windows for player reaction
- Hitbox activation tied to animation frames
- Recovery frames allow punishment windows

### Structure
- **Anticipation Phase**: Wind-up, clearly visible telegraph
- **Active Phase**: Hitbox active, damage dealing
- **Recovery Phase**: Vulnerable window after attack

### On-hit Effect
- Hitstop for impact feedback
- Screen shake intensity based on damage
- VFX particles at point of impact
- SFX tied to material type

---

## ABILITIES

### Dodge/Dash
- Evasive movement to avoid player attacks
- Cooldown between uses
- Can be baited and punished

### Teleport
- Instant repositioning ability
- Telegraph before disappearing
- Reappearance location telegraphed

### Block/Parry
- Defensive ability to negate damage
- Perfect timing rewards with counter opportunity
- Stamina/posture cost for blocking

### Summon
- Ability to call reinforcements
- Summoning animation is interruptible
- Limit on number of summons

### Read Player's Input
- Advanced enemies can predict player actions
- Counters specific player behaviors
- Creates strategic depth

### Synchronised Abilities
- Coordinated attacks with other enemies
- Requires communication between AI
- Devastating but telegraphed

---

## FEEDBACK

### Visual Feedback
- Attack indicators and telegraphs
- Health bar and status effect display
- Damage numbers
- State change indicators

### Audio Feedback
- Unique audio cues per attack type
- Warning sounds before dangerous attacks
- Impact sounds for hits and blocks
- Voice lines for state changes

---

## CLASSIFICATION

### Enemy Classes
- **Melee**: Close-range combat specialists
- **Ranged**: Distance attackers
- **Support**: Buff/heal allies
- **Tank**: High HP, defensive abilities
- **Assassin**: High damage, low HP

### Body Types
- **Humanoid**: Standard human proportions
- **Beast**: Animal-like enemies
- **Large**: Oversized enemies with unique hitboxes
- **Small**: Smaller targets, faster movement
- **Flying**: Aerial enemies

---

## LIST OF ENEMIES

### BOSS
- Spear Wielder
- YÊU NHỀN NHỆN (Spider Demon)

### ELITE ENEMIES
| Enemy | Description |
|-------|-------------|
| Dream Walker | Illusion-based attacks |
| Dual Swords | Fast combo attacks |
| Great Axe | Heavy, slow attacks |
| Battle Mage | Magic/melee hybrid |
| Axe Shield | Defensive + offensive |
| Claw Sword | Aggressive melee |
| Dreadroot | Nature-based abilities |
| Grimwarden | Dark magic user |
| Beast | Animal-type elite |
| Maskmancer | Mask-based powers |

### NORMAL ENEMIES
| Enemy | Description |
|-------|-------------|
| Sword | Basic melee fighter |
| Ironbound | Armored warrior |
| Fire Monk Abbot | Fire magic leader |
| Fire Monk Novice | Basic fire attacks |
| Sword Shield | Defensive melee |
| Juggernaut | Heavy bruiser |
| Spear | Reach-based attacks |
| Sword Aggressive | Fast attacker |
| Dual Swords | Quick combo fighter |
| Feibiao | Thrown weapon user |
| Spellcaster | Magic ranged |
| Dream Walker | Illusion user |

### CREEP
- Halfbody - Basic fodder enemy

---

## Related Documents

### Biomes (CÁC PHÁCH)
- [Ố - HATRED](./Biomes/Hatred.md)
- [ÁI - LOVE](./Biomes/Love.md)
- [AI - DESPAIR](./Biomes/Despair.md)
- [HỶ - JOY](./Biomes/Joy.md)
- [CỤ - FEAR](./Biomes/Fear.md)
- [NỘ - RAGE](./Biomes/Rage.md)
- [DỤC - DESIRE](./Biomes/Desire.md)

### Other Enemy GDDs
- [Enemy Ambush/Encounter](./EnemyAmbush.md)
- [Enemy Block & Parry](./EnemyBlockParry.md)
- [Stun Meter & Hyper Armor](./StunMeter.md)

---

*Source: Notion GDDs Dec 2025 > Enemies GDD > [GDD] Enemy System*
*Miro Board: [BIOME](https://miro.com/app/board/uXjVINo8Hjo=/)*
