# [GD] Stun Meter & Enemy Hyper Armor/Break

## Overview

The Stun Meter system provides a secondary damage layer that allows players to temporarily incapacitate enemies by depleting their stun resistance. Combined with the Hyper Armor system, this creates strategic depth in how players approach different enemy types.

---

## Stun Meter

### Core Concept
- Every enemy has a Stun Meter (invisible or visible based on enemy tier)
- Attacks deal Stun Damage in addition to HP damage
- When Stun Meter is depleted, enemy enters Stunned state
- Stun Meter regenerates over time when not taking stun damage

### Stun Meter Properties

| Property | Description |
|----------|-------------|
| Max Stun | Total stun meter capacity |
| Current Stun | Current stun value |
| Regen Rate | Stun recovery per second |
| Regen Delay | Time before regen starts after hit |
| Stun Duration | How long enemy stays stunned |

### Stun Damage Sources

| Source | Stun Damage |
|--------|-------------|
| Light Attacks | Low |
| Heavy Attacks | Medium |
| Charged Attacks | High |
| Artifacts | Varies |
| Parry/Counter | Very High |
| Environmental | Medium |

### Stun States

1. **Normal**: Full stun resistance
2. **Weakened**: Stun meter below 50%, visual indicator
3. **Critical**: Stun meter below 25%, flashing indicator
4. **Stunned**: Stun meter depleted, fully vulnerable

---

## Hyper Armor

### Core Concept
- Certain enemies have Hyper Armor during specific actions
- Hyper Armor prevents stagger/interruption from attacks
- Does NOT prevent damage, only stagger
- Can be broken by dealing enough Hyper Armor damage

### Hyper Armor Types

#### Passive Hyper Armor
- Always active on certain enemy types (Juggernaut, Bosses)
- Requires significant damage to break
- Regenerates after being broken

#### Active Hyper Armor
- Activated during specific attacks
- Duration matches attack animation
- Cannot be broken during active frames

#### Conditional Hyper Armor
- Triggers under specific conditions
- Example: Enraged state, low HP threshold
- May have different break requirements

### Hyper Armor Properties

| Property | Description |
|----------|-------------|
| Armor Value | Damage required to break |
| Active Duration | Time armor is active |
| Regen Time | Time to restore after break |
| Break Vulnerability | Duration of break state |

---

## Break State

### When Hyper Armor Breaks
1. Enemy staggers heavily (long stagger animation)
2. Vulnerable to all attacks for break duration
3. Stun meter damage amplified during break
4. Special finisher opportunities available

### Visual/Audio Feedback

#### Hyper Armor Active
- Golden/white glow around enemy
- Distinctive sound when attacks bounce
- Damage numbers show "ARMOR" indicator

#### Hyper Armor Breaking
- Crack/shatter VFX
- Glass breaking SFX
- Screen flash
- Enemy stagger animation

#### Stunned State
- Stars/daze VFX above head
- Dizzy animation loop
- Vulnerability sound cue
- Special execution prompt

---

## Enemy Tier Scaling

### Normal Enemies
- Low stun meter (easy to stun)
- Rare hyper armor (only on attacks)
- Fast stun recovery
- Short stun duration

### Elite Enemies
- Medium stun meter
- Frequent hyper armor phases
- Moderate recovery
- Medium stun duration

### Boss Enemies
- High stun meter
- Constant passive hyper armor
- Slow recovery but multiple armor phases
- Long stun duration (reward)
- Phase transitions may reset stun meter

---

## Player Strategy Guide

### Against High Stun Resistance
- Focus on heavy/charged attacks
- Use parry counters for stun spike
- Be patient, chip away at meter

### Against Hyper Armor
- Avoid trading hits (you'll stagger, they won't)
- Look for armor gaps between attacks
- Use multi-hit attacks to break faster
- Exploit break window fully

### Optimal Stun Combos
1. Parry > Heavy Attack > Charged Attack (high stun burst)
2. Artifact ability > Follow-up combo (during stun)
3. Break armor > Full combo string > Finisher

---

## Tuning Guidelines

### Balance Considerations
- Stun should feel earned, not trivial
- Hyper armor should force strategy, not frustrate
- Break windows should be satisfying
- Recovery should allow re-engagement

### Difficulty Scaling
| Difficulty | Stun Meter | Armor Strength | Recovery |
|------------|------------|----------------|----------|
| Easy | -20% | -20% | +20% |
| Normal | Base | Base | Base |
| Hard | +30% | +30% | -20% |
| Nightmare | +50% | +50% | -30% |

---

*Source: Notion GDDs Dec 2025 > Enemies GDD > [GD] Stun Meter & Enemy Hyper Armor/Break*
