# dev-browser Skill - Agent Guide

**Quick Reference for UI Testing with agent-browser**

The dev-browser skill provides browser automation for testing Ralph UI features. This guide covers essential commands, testing patterns, and troubleshooting.

---

## What is the dev-browser Skill?

Provides browser automation using **agent-browser** CLI (Vercel's Rust-based tool optimized for AI agents).

**Key Features:**
- **Snapshot + ref workflow:** `@e1`, `@e2` for deterministic element selection
- **Fast & reliable:** Rust CLI with Node.js fallback
- **Persistent sessions:** Isolated browser instances with cookies/storage
- **JSON output:** Machine-readable results for agents
- **No buggy MCP:** Standalone CLI tool, no MCP server issues

---

## Critical Rule: Use agent-browser CLI

### ✅ ALWAYS Use agent-browser

**Correct:**
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser click @e2
```

### ❌ NEVER Test UI with Just curl/API Calls

**Incorrect:**
```bash
curl http://localhost:3000  # Doesn't verify rendered UI
```

**Why:** Always use browser automation to verify rendered UI, interactivity, and functionality. API calls only test backend, not the actual user experience.

---

## Installation

```bash
npm install -g agent-browser
agent-browser install  # Downloads Chromium
```

---

## Essential Commands

### Navigation
```bash
agent-browser open http://localhost:3000
agent-browser back
agent-browser reload
```

### Inspection
```bash
agent-browser snapshot -i              # Interactive elements only
agent-browser snapshot -c              # Compact format
agent-browser screenshot page.png      # Take screenshot
agent-browser console                  # View console output
agent-browser errors                   # Check console errors
```

### Interaction
```bash
agent-browser click @e1                # Click by reference
agent-browser click "button:has-text('Start')"  # CSS selector
agent-browser type @e5 "text"          # Type into input
agent-browser fill @e5 "text"          # Fill input (clears first)
agent-browser press Enter              # Press key
```

### Verification
```bash
agent-browser get text @e1             # Get element text
agent-browser is visible @e1           # Check if visible
agent-browser eval "document.title"    # Run JavaScript
```

---

## 7-Step Testing Checklist

When testing UI features with agent-browser:

1. ✅ **Navigate:** `agent-browser open http://localhost:3000`
2. ✅ **Take snapshot:** `agent-browser snapshot -i` to see interactive elements
3. ✅ **Verify visible:** `agent-browser is visible @e1`
4. ✅ **Test interactions:** `agent-browser click @e2`, `agent-browser fill @e3 "text"`
5. ✅ **Check console errors:** `agent-browser console` and `agent-browser errors`
6. ✅ **Validate data loads:** `agent-browser get text @e1` or `agent-browser eval "..."`
7. ✅ **Take screenshots:** `agent-browser screenshot --full`

**A frontend story is NOT complete until browser verification passes.**

---

## Common Patterns

### Pattern 1: Navigate and Verify

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i > elements.txt
grep "Start Build" elements.txt && echo "✓ Button found"
```

### Pattern 2: Click Through Workflow

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i > /tmp/s.txt
REF=$(grep "Press Enter" /tmp/s.txt | grep -o '@e[0-9]*' | head -1)
agent-browser click "$REF"
```

### Pattern 3: Fill Form

```bash
agent-browser fill @e11 "5"            # Iterations
agent-browser click @e12               # Open dropdown
agent-browser click @e14               # Select option
agent-browser click @e20               # Toggle checkbox
```

### Pattern 4: Verify Page Load

```bash
agent-browser click @e3                # Navigate
sleep 2                                # Wait for load
agent-browser errors                   # Check errors
agent-browser screenshot page.png      # Capture state
```

### Pattern 5: Check Real-time Updates

```bash
while true; do
  agent-browser snapshot -c | head -20
  agent-browser get text "@e1"         # Status element
  sleep 3
done
```

---

## Troubleshooting

### Element Not Found

**Problem:** Reference `@eN` not found.

**Solution:**
```bash
# Take fresh snapshot first
agent-browser snapshot -i > /tmp/fresh.txt
grep "desired text" /tmp/fresh.txt
```

### Click Doesn't Work

**Problem:** Click command fails or has no effect.

**Solution:**
```bash
# Wait for element, then use selector
sleep 2
agent-browser click "button:has-text('Start')"
```

### Console Errors Present

**Problem:** JavaScript errors in console.

**Solution:**
```bash
# Check network and JS errors
agent-browser errors
agent-browser console
agent-browser network requests
```

### Page Not Loading

**Problem:** Page fails to load.

**Solution:**
```bash
# Check server status
curl -I http://localhost:3000
lsof -ti:3000
```

---

## Environment Variables

```bash
BROWSER_HEADLESS=false    # Show browser window
BROWSER_SLOW_MO=500       # Slow down actions (ms)
BROWSER_KEEP_ALIVE=true   # Keep browser open
DEBUG=*                   # Verbose logging
UI_URL=http://...         # Custom URL
```

---

## Best Practices

1. **Always snapshot first** - Know what's on the page before interacting
2. **Use semantic selectors** - Prefer `button:has-text('X')` over `@eN`
3. **Add delays** - Give dynamic content time to load (`sleep 2`)
4. **Check errors** - Run `agent-browser errors` after interactions
5. **Take screenshots** - Visual evidence is valuable
6. **Test unhappy paths** - Try invalid inputs, missing data, errors
7. **Verify state changes** - Check text/attributes after actions
8. **Clean up** - Close sessions when done

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Cheatsheet:** [AGENT_BROWSER_CHEATSHEET.md](../../AGENT_BROWSER_CHEATSHEET.md) - Quick reference
- **CLAUDE.md:** [UI Testing section](../../CLAUDE.md#ui-testing) - Complete agent-browser reference

---

## Summary

**Key Takeaways:**

1. **Use agent-browser CLI** - Not curl, not MCP
2. **Follow 7-step checklist** - Navigate → snapshot → verify → interact → errors → validate → screenshot
3. **Always snapshot first** - Know what's on the page
4. **Add delays for dynamic content** - `sleep 2` before verification
5. **Check for errors** - Run `agent-browser errors` after interactions
6. **Frontend stories incomplete without browser verification** - Must actually test in browser
