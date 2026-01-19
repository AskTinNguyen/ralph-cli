# Documentation Structure & Cross-References

## Overview

Ralph CLI has two complementary documentation files for AI agents:

1. **CLAUDE.md** - Comprehensive reference (read by all agents via project context)
2. **ui/public/docs/agent-guide.html** - Agent-optimized quick reference (web/file access)

## File Responsibilities

### CLAUDE.md (Comprehensive Reference)

**Purpose:** Complete technical documentation for installation, configuration, and troubleshooting

**Content:**
- 🤖 **Agent pointer section** (top of file) - directs agents to agent-guide.html first
- Installation instructions (all platforms)
- Complete command reference tables
- Factory Mode documentation
- Workflow explanations
- Parallel workflow procedures
- **Full file structure** with subdirectories
- PRD format specification
- Agent configuration (Claude/Codex/Droid)
- **Model routing configuration** (detailed)
- **PRD command modes** (interactive vs headless - full explanation)
- Package structure
- How it works (technical details)
- **Status validation** (comprehensive)
- **MCP servers** (setup, environment variables, examples)
- Orphaned process cleanup
- **UI testing** (complete agent-browser reference, Playwright MCP, helper scripts)
- UI server configuration
- **Error handling** (full error code reference, GitHub issue creation, configuration)
- Concise pointer to agent-guide.html

**Target audience:** Agents needing detailed setup, configuration, or troubleshooting info

---

### agent-guide.html (Agent-Optimized Quick Reference)

**Purpose:** Fast, task-oriented reference for agents executing Ralph commands

**Content:**
- 📑 **Table of Contents** - 6 categories with anchor links
- ⚡ **Quick Start Summary** - critical rules + most common commands
- 🚨 **Critical warnings** (nested agent interaction, merge policy)
- 🎯 **Decision tree** - command selection flowchart
- 📋 **Common task patterns** - end-to-end workflows
- 🔗 **PRD command modes** (condensed with pointer to CLAUDE.md)
- 📁 **File structure** (key locations with pointer to CLAUDE.md)
- ❌✅ **Critical rules** (DO/DON'T lists)
- 📊 **Status codes table**
- ✅ **Status verification commands**
- ⚠️ **Error handling** (condensed with pointer to CLAUDE.md)
- 🔧 **Quick troubleshooting**
- 🔌 **MCP tools** (examples with pointer to CLAUDE.md)
- 🖥️ **UI testing** (7-step checklist with pointer to CLAUDE.md)
- 💬 **Response templates**
- ✍️ **Writing quality specifications**
- 📖 **Quick reference card**
- 📍 **Section pointers table** - task-based navigation

**Target audience:** Agents actively working on Ralph tasks, needing quick answers

---

## Cross-Reference Strategy

### From CLAUDE.md → agent-guide.html

**Location:** Top of CLAUDE.md (after title, before Quick Reference)

```markdown
## 🤖 For AI Agents

**If you are an AI agent working on Ralph CLI tasks:**

👉 **Start here**: `ui/public/docs/agent-guide.html` or http://localhost:3000/docs/agent-guide.html

The Agent Guide provides:
- ⚡ Quick-start summary with critical rules
- 🎯 Decision trees for command selection
- 📋 Common task patterns with examples
- 🚨 Critical warnings (--headless, merge policy)
- 📍 Task-based section pointers

**This file (CLAUDE.md)** is the comprehensive reference for:
- Installation & setup details
- Complete command documentation
- Configuration options
- Technical implementation details
- Troubleshooting procedures

**Use this workflow:**
1. Check agent-guide.html for task patterns and critical rules
2. Reference CLAUDE.md sections for detailed configuration/troubleshooting
3. Use `ralph error RALPH-XXX` for error remediation
```

### From agent-guide.html → CLAUDE.md

**Locations:** At the end of condensed sections

**Pattern:**
```html
<div style="font-size: 10px; color: #6B7280; margin-top: 8px;">
  📖 <strong>Full details:</strong> See <a href="../CLAUDE.md#section-name">CLAUDE.md § Section Name</a> for [specific details].
</div>
```

**Cross-references added:**

1. **PRD Command Modes** → `CLAUDE.md#prd-command-modes`
   - Full interactive vs headless behavior
   - UI server configuration

2. **File Structure** → `CLAUDE.md#file-structure`
   - Complete directory tree
   - All subdirectories and file descriptions

3. **MCP Tools** → `CLAUDE.md#mcp-servers`
   - Setup instructions
   - Environment variables
   - Complete tool documentation

4. **UI Testing** → `CLAUDE.md#ui-testing`
   - Complete command reference
   - Playwright MCP setup
   - Testing helper scripts
   - UI server configuration

5. **Error Handling** → `CLAUDE.md#error-handling--issue-creation`
   - GitHub issue creation format
   - Required context
   - Configuration options
   - MCP examples

---

## Agent Workflow

### Recommended Usage Pattern

```
┌─────────────────────────────────────────────┐
│ Agent receives Ralph CLI task from user    │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 1. Check agent-guide.html                  │
│    - Read quick-start summary              │
│    - Use decision tree                     │
│    - Find task pattern                     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 2. Execute task using pattern              │
│    - Follow critical rules (--headless!)   │
│    - Use commands from examples            │
└──────────────┬──────────────────────────────┘
               │
               ├─ Success → Exit
               │
               ▼
┌─────────────────────────────────────────────┐
│ 3. If issue/config needed:                 │
│    - Use section pointers                  │
│    - Click link to CLAUDE.md section       │
│    - Get detailed info                     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 4. For errors:                              │
│    - ralph error RALPH-XXX                  │
│    - Follow remediation steps               │
└─────────────────────────────────────────────┘
```

---

## Content Deduplication Summary

### Eliminated Redundancies

| Section | Before | After |
|---------|--------|-------|
| **PRD Command Modes** | Full details in both | agent-guide: condensed rule + pointer |
| **File Structure** | Complete tree in both | agent-guide: key locations + pointer |
| **UI Testing** | Full reference in both | agent-guide: 7-step checklist + pointer |
| **MCP Tools** | Full setup in both | agent-guide: quick examples + pointer |
| **Error Handling** | Complete guide in both | agent-guide: error codes + responsibilities + pointer |

### Unique Content (No Duplication)

**Only in CLAUDE.md:**
- Installation procedures
- Model routing configuration
- Package structure
- Parallel workflow procedures
- Orphaned process cleanup
- UI server configuration details

**Only in agent-guide.html:**
- Table of contents with anchor links
- Quick-start summary box
- Decision tree flowchart
- Common task patterns (end-to-end)
- Critical warnings callouts
- Response templates
- Writing quality specifications
- Section pointers table

---

## Verification Checklist

### ✅ Completed Changes

- [x] Added "For AI Agents" section at top of CLAUDE.md
- [x] Condensed "Agent Operation Guide" section in CLAUDE.md
- [x] Condensed "PRD Command Modes" in agent-guide.html
- [x] Condensed "File Structure" in agent-guide.html
- [x] Condensed "MCP Tools" in agent-guide.html
- [x] Condensed "UI Testing" in agent-guide.html
- [x] Condensed "Error Handling" in agent-guide.html
- [x] Added cross-reference links from agent-guide.html to CLAUDE.md
- [x] Added section anchors to all major sections in agent-guide.html
- [x] Created table of contents in agent-guide.html
- [x] Created section pointers table in agent-guide.html

### ✅ No Redundancies Remaining

- [x] PRD Command Modes - agent-guide has rule only, CLAUDE.md has full details
- [x] File Structure - agent-guide has key locations, CLAUDE.md has complete tree
- [x] UI Testing - agent-guide has checklist, CLAUDE.md has full reference
- [x] MCP Tools - agent-guide has examples, CLAUDE.md has setup/config
- [x] Error Handling - agent-guide has codes/responsibilities, CLAUDE.md has full issue creation guide

### ✅ Cross-References Working

- [x] CLAUDE.md → agent-guide.html (top of file pointer)
- [x] agent-guide.html → CLAUDE.md (5 section-specific pointers)
- [x] All anchor links functional (#section-id)
- [x] Section pointers table has 16 task-based entries

---

## Benefits

### For Agents

1. **Faster task execution** - Quick-start summary provides critical info in 10 seconds
2. **Clear priorities** - Critical warnings prominently displayed
3. **Task-based navigation** - Find right section quickly via section pointers
4. **No information overload** - Condensed sections with links to details when needed
5. **Both files accessible** - CLAUDE.md via project context, agent-guide.html via web/file

### For Maintainers

1. **Single source of truth** - Detailed info only in CLAUDE.md
2. **Reduced duplication** - Changes made once, not twice
3. **Clear separation** - CLAUDE.md = how it works, agent-guide.html = what to do
4. **Easy updates** - Cross-references point to specific sections

---

## File Locations

- **CLAUDE.md**: `/Users/tinnguyen/ralph-cli/CLAUDE.md`
- **agent-guide.html**: `/Users/tinnguyen/ralph-cli/ui/public/docs/agent-guide.html`
- **This doc**: `/Users/tinnguyen/ralph-cli/DOCUMENTATION_STRUCTURE.md`

---

## Future Enhancements (Optional)

1. Add search functionality to agent-guide.html
2. Add "Back to top" floating button in agent-guide.html
3. Add copy-to-clipboard buttons for code blocks
4. Add keyboard shortcuts for navigation (e.g., `/` for search)
5. Consider collapsible sections for verbose content
