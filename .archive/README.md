# Archive Directory

This directory contains outdated, orphaned, and demo documentation that is no longer actively maintained or integrated into the Ralph CLI project.

**Archived on:** 2026-01-19

## Contents

### Outdated Documentation Files

#### AGENT_QUICKSTART.md
- **Reason**: References outdated file paths and structures (e.g., `.agents/tasks/prd.md`, `.ralph/IMPLEMENTATION_PLAN.md`)
- **Status**: Superseded by current documentation in CLAUDE.md and agent-guide.html
- **Original location**: Root directory

#### .github/PAGES_SETUP.md
- **Reason**: GitHub Pages configuration no longer needed for this project
- **Status**: Deprecated
- **Original location**: `.github/PAGES_SETUP.md`

#### .github/QUICK_START.md
- **Reason**: Redundant with primary README.md and CLAUDE.md
- **Status**: Superseded by comprehensive documentation
- **Original location**: `.github/QUICK_START.md`

### Demo/Example Applications

#### wedding-planner-app/
- **Type**: Standalone demo application
- **Purpose**: Example REST API + web interface project (used for testing/examples)
- **Status**: Not integrated into main Ralph CLI functionality
- **Original location**: `wedding-planner-app/`
- **Contents**: Express.js server, guest management system, Jest tests

#### ralph-voice-app/
- **Type**: Standalone Electron application
- **Purpose**: Voice-controlled desktop automation example (separate from main CLI)
- **Status**: Not actively maintained; stands alone
- **Original location**: `ralph-voice-app/`
- **Contents**: Voice commands, menu bar app, offline STT/LLM integration

### Game Design Documentation

#### S2-Game/
- **Type**: Game design reference documents
- **Purpose**: Link collection and index for external S2 game design documents
- **Status**: Reference only; actual docs maintained externally in GitHub/Notion/Miro
- **Original location**: `S2-Game/`
- **Contents**: Links to game design documents, enemy systems, character progression

#### docs/GDDs-Dec-2025/
- **Type**: Game design documents collection (Dec 2025)
- **Purpose**: Snapshot of game design documents from external sources
- **Status**: Historical reference; maintained externally
- **Original location**: `docs/GDDs-Dec-2025/`

## Why Files Were Archived

1. **Outdated Paths**: References to deprecated file structures that no longer exist
2. **Redundancy**: Content duplicated in primary documentation (CLAUDE.md, README.md)
3. **External References**: Documents that serve as indexes to external sources
4. **Demo Content**: Example applications not part of core Ralph CLI
5. **Standalone Projects**: Separate applications (voice app, game docs) not integrated into main project

## Recovery

To restore any archived content:

```bash
# Restore a specific file
git checkout HEAD -- .archive/<filename>

# Or manually copy from archive back to original location
cp .archive/AGENT_QUICKSTART.md AGENT_QUICKSTART.md
```

## Documentation Reference

For current Ralph CLI documentation, see:

- **[CLAUDE.md](../CLAUDE.md)** - Comprehensive reference guide
- **[README.md](../README.md)** - Project overview and quick start
- **[ui/public/docs/agent-guide.html](../ui/public/docs/agent-guide.html)** - AI agent quick reference
- **[CLAUDE.md - Agent Configuration](../CLAUDE.md#agent-configuration)** - Model routing and agent setup
- **[TESTING.md](../TESTING.md)** - Test organization and best practices

## Notes

- Archive directory is tracked in git for historical reference
- Archived content is no longer actively maintained
- Consider removing this archive in future versions if no recovery needed
- Any substantive content should be migrated to main documentation before archival

---

**Last Updated:** 2026-01-19
**Archived By:** Claude Code Archive Management
