# Gameplay Input

## 1. Overview

The Gameplay Input System defines how player inputs are captured, processed, and translated into in-game actions. This system serves as the foundation for player interaction with the game world and is designed to provide responsive, intuitive controls across multiple input devices while accommodating various gameplay contexts.

### Key Features:
- Context-sensitive input mapping for different gameplay modes
- Input buffering system for responsive combat
- Support for multiple input devices (keyboard/mouse, controllers)
- Customizable control schemes and accessibility options
- Priority-based input handling for conflict resolution

## 2. Input Architecture

The input system is built on Unreal Engine's **Enhanced Input System**, which provides a flexible framework for mapping player inputs to in-game actions across different contexts.

### Input Mapping

Input mapping is defined through a combination of Input Actions (what can be done) and Input Mapping Contexts (when those actions are valid). This separation allows for dynamic adjustment of available inputs based on the current game state.

### Input Contexts

The game uses distinct input contexts to handle different gameplay scenarios:

- **Combat Context**: Active during combat encounters, prioritizes attack, block, and dodge inputs
- **Exploration Context**: Active during world traversal, prioritizes movement and interaction
- **UI Context**: Active when navigating menus, inventory, or other interfaces
- **Vehicle Context**: Active when operating vehicles or mounts
- **Dialogue Context**: Active during dialogue or cutscene interactions

### Main Input Mapping Context:
- Scheme 1: `IMC_MainCharacter`
- Scheme 2: `IMC_MainCharacter_NewScheme`

### Input Priorities

When multiple contexts are active simultaneously, input priorities determine which actions take precedence:

1. Critical Actions (emergency dodge, healing) - Highest Priority
2. Context-Specific Primary Actions (attack in combat, jump in exploration)
3. Universal Actions (camera controls, pause menu)
4. Secondary/Optional Actions (emotes, non-critical interactions) - Lowest Priority

---

## Button Mapping

### Movement, Look & Interact

| Action | Keyboard | Controller | Notes |
|--------|----------|------------|-------|
| Move | WASD | Left Stick | 8-directional movement |
| Look | Mouse | Right Stick | Camera control |
| Interact | E / F | A / X | Context-sensitive |
| Sprint | Shift | L3 (Click) | Hold to sprint |
| Jump | Space | A / X | Tap for jump |

### Attacks

| Action | Keyboard | Controller | Notes |
|--------|----------|------------|-------|
| Light Attack | LMB | X / Square | Primary attack |
| Heavy Attack | RMB | Y / Triangle | Charged attack |
| Dodge | Space / Ctrl | B / Circle | Invincibility frames |
| Block | Q | LB / L1 | Hold to block |
| Parry | Q (timed) | LB (timed) | Perfect timing required |

### Fulu Specific Inputs

*(Table with Fulu-specific control mappings)*

### Beta Specific Inputs

*(Table with Beta skill control mappings)*

---

*Source: Notion GDDs Dec 2025 > Control > Gameplay Input*
