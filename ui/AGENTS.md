# Ralph UI - Agent Guide

**Quick Reference for Testing Ralph UI**

The Ralph UI is a web-based dashboard for monitoring builds, viewing logs, and triggering workflows. This guide covers testing requirements and configuration.

---

## What is Ralph UI?

Web dashboard for Ralph CLI providing:
- **PRD/stream status** - Monitor all PRDs and build progress
- **Build controls** - Start builds, configure iterations
- **Logs viewer** - Real-time and historical logs
- **Token tracking** - Cost monitoring across builds
- **Factory workflows** - Visual factory execution monitoring

**Technology:** Next.js (React) with server-side rendering

---

## Critical Rule: Always Use Browser Automation

### ❌ NEVER Test UI with Just curl/API Calls

**Incorrect:**
```bash
curl http://localhost:3000/api/streams  # Only tests API
```

### ✅ ALWAYS Use agent-browser for UI Testing

**Correct:**
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser click @e2
agent-browser errors
```

**Why:** UI features require visual verification, interactivity testing, and console error checking. API calls only test backend endpoints, not the actual rendered page.

---

## UI Server Configuration

The Ralph UI uses `RALPH_ROOT` environment variable to determine which `.ralph` directory to read from.

### Production Mode (Default)

**Uses parent directory's .ralph/ (ralph-cli/.ralph):**
```bash
cd ui && npm run dev
# or
npm start
```

### Test Mode

**Uses ui/.ralph/ for isolated testing:**
```bash
cd ui && npm run dev:test
# or
npm run start:test
```

### Custom RALPH_ROOT

**Point to any .ralph directory:**
```bash
RALPH_ROOT=/path/to/.ralph npm run dev
```

**Directory structure:**
- `ralph-cli/.ralph/` - Production PRD directories (PRD-1 through PRD-N)
- `ralph-cli/ui/.ralph/` - Test/isolated PRD directories (used with `:test` scripts)

**Default behavior:** Server automatically uses `ralph-cli/.ralph` unless `RALPH_ROOT` is explicitly set.

---

## Testing Workflow

### 1. Start UI Server

```bash
cd ui && npm run dev
# Server starts on http://localhost:3000
```

### 2. Use agent-browser for Testing

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser errors
```

### 3. Verify Functionality

Follow the **7-step testing checklist** from dev-browser skill:
1. Navigate to page
2. Take snapshot
3. Verify elements visible
4. Test interactions
5. Check console errors
6. Validate data loads
7. Take screenshots

---

## Helper Scripts

For common testing scenarios, use the provided helper script:

```bash
# Quick snapshot of homepage
.agents/ralph/test-ui.sh snapshot

# Test PRD list page (automated)
.agents/ralph/test-ui.sh test-list

# Test logs page (automated)
.agents/ralph/test-ui.sh test-logs

# Interactive mode (opens headed browser)
.agents/ralph/test-ui.sh interactive

# Clean up browser session
.agents/ralph/test-ui.sh cleanup
```

**Custom UI URL:**
```bash
UI_URL=http://localhost:8080 .agents/ralph/test-ui.sh snapshot
```

---

## Common Testing Scenarios

### Test Dashboard Load

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser is visible "text=Dashboard" && echo "✓ Dashboard loaded"
agent-browser errors
```

### Test Stream List

```bash
agent-browser open http://localhost:3000/streams
agent-browser snapshot -i
agent-browser get text ".stream-card" | grep "PRD-" && echo "✓ Streams loaded"
agent-browser errors
```

### Test Logs Viewer

```bash
agent-browser open http://localhost:3000/logs
agent-browser snapshot -i
agent-browser is visible ".log-entry" && echo "✓ Logs loaded"
agent-browser errors
```

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **dev-browser Skill:** [skills/dev-browser/AGENTS.md](../skills/dev-browser/AGENTS.md) - Browser automation commands
- **CLAUDE.md:** [UI Testing section](../CLAUDE.md#ui-testing) - Complete UI testing reference
- **CLAUDE.md:** [UI Server Configuration section](../CLAUDE.md#ui-server-configuration) - RALPH_ROOT details

---

## Summary

**Key Takeaways:**

1. **Always use browser automation** - Never test UI with just curl
2. **Start server first** - `cd ui && npm run dev`
3. **Use agent-browser** - Follow 7-step testing checklist
4. **Check console errors** - `agent-browser errors` after interactions
5. **Use helper scripts** - `.agents/ralph/test-ui.sh` for common scenarios
6. **Configure RALPH_ROOT** - Production vs test mode via environment variable
