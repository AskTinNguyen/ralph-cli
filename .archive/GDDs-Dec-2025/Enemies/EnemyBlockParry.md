# [GDD] Enemy Block & Parry Mechanism

## Design Philosophy

The Block & Parry system for enemies creates strategic depth in combat by giving enemies defensive options that players must read and counter. This creates a back-and-forth dynamic where players cannot simply spam attacks.

### Core Principles
1. **Readable**: Enemy defensive stances are clearly telegraphed
2. **Counterable**: Each defensive option has a player counter
3. **Varied**: Different enemy types use defense differently
4. **Rewarding**: Breaking enemy defense feels impactful

---

## Enemy Archetypes with Parry Mechanics

### Archetype 1: The Guardian
- **Behavior**: Frequent blocking, occasional parries
- **Block Stance**: Shield raised, blue glow
- **Parry Window**: 0.3 seconds
- **Counter**: Heavy attacks break guard, grabs bypass block
- **Enemies**: Sword Shield, Axe Shield, Ironbound

### Archetype 2: The Duelist
- **Behavior**: Active parrying, quick ripostes
- **Block Stance**: Weapon forward, ready position
- **Parry Window**: 0.2 seconds (tighter timing)
- **Counter**: Feint attacks, delay timing, abilities
- **Enemies**: Dual Swords, Sword, Sword Aggressive

### Archetype 3: The Juggernaut
- **Behavior**: Hyper armor, no parry, rare blocks
- **Block Stance**: Arms crossed, golden glow
- **Parry Window**: N/A (no parry)
- **Counter**: Stun meter depletion, continuous damage
- **Enemies**: Juggernaut, Great Axe, Beast

### Archetype 4: The Mystic
- **Behavior**: Magic barriers, reflect projectiles
- **Block Stance**: Energy shield projection
- **Parry Window**: 0.4 seconds (reflects attacks)
- **Counter**: Get behind barrier, use physical attacks
- **Enemies**: Battle Mage, Spellcaster, Grimwarden

### Archetype 5: The Assassin
- **Behavior**: Evasion over blocking, rare perfect parries
- **Block Stance**: Low stance, preparing dodge
- **Parry Window**: 0.15 seconds (very tight, high reward)
- **Counter**: Area attacks, tracking abilities, prediction
- **Enemies**: Dream Walker, Claw Sword, Feibiao

---

## Block Mechanics

### Block States
1. **Idle Guard**: Passive damage reduction when not attacking
2. **Active Block**: Full damage negation, stamina cost
3. **Guard Break**: Block depleted, vulnerable state
4. **Recovery**: Regenerating block stamina

### Block Properties
- **Block Stamina**: Resource depleted by blocked attacks
- **Block Strength**: Damage reduction percentage
- **Block Angle**: Direction coverage of block
- **Recovery Rate**: How fast block stamina regenerates

---

## Parry Mechanics

### Parry Window
- Frame-perfect defensive action
- Typically 0.15-0.4 seconds depending on enemy
- Successful parry staggers attacker

### Parry Responses
1. **Stagger Player**: Brief vulnerability window
2. **Riposte**: Immediate counter-attack
3. **Deflect**: Redirect attack, no follow-up
4. **Perfect Parry**: Enhanced riposte with bonus damage

---

## Visual/Audio Feedback

### Block Feedback
- Shield impact VFX
- Metal clang SFX
- Stamina bar visible on enemy
- Knockback on attacker

### Parry Feedback
- Bright flash VFX
- Distinct parry SFX (sharper sound)
- Time slow effect (brief)
- Enemy weapon glow on riposte

### Guard Break Feedback
- Shatter VFX
- Glass break SFX
- Enemy stagger animation
- Vulnerability indicator

---

## Player Counter Options

| Enemy Defense | Player Counter |
|---------------|----------------|
| Standard Block | Heavy attack, guard break combo |
| Perfect Parry | Delay attacks, use feints |
| Magic Barrier | Physical attacks, get behind |
| Hyper Armor | Sustained damage, stun meter |
| Evasion | AoE attacks, tracking moves |

---

*Source: Notion GDDs Dec 2025 > Enemies GDD > [GDD] Enemy Block & Parry mechanism*
