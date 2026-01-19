# Testing Guide

**Comprehensive guide to testing Ralph CLI components**

---

## Table of Contents

1. [Test Organization](#test-organization)
2. [Running Tests](#running-tests)
3. [UI Testing with agent-browser](#ui-testing-with-agent-browser)
4. [Common Test Scenarios](#common-test-scenarios)
5. [Writing New Tests](#writing-new-tests)
6. [Best Practices](#best-practices)

---

## Test Organization

### Test Folder Structure

**All test files MUST be in `/tests` directory.** This is a strict requirement.

```
tests/
├── *.mjs                              # Integration and E2E tests
│   ├── cli-smoke.mjs                  # CLI smoke tests
│   ├── agent-loops.mjs                # Agent loop behavior
│   ├── agent-ping.mjs                 # Agent health checks
│   ├── integration.mjs                # Main integration suite
│   ├── integration-actions.mjs        # Actions integration
│   ├── integration-checkpoint.mjs     # Checkpoint system
│   ├── integration-doctor.mjs         # Doctor command
│   ├── integration-metrics.mjs        # Metrics collection
│   ├── integration-notify.mjs         # Notification system
│   ├── integration-risk.mjs           # Risk analysis
│   ├── integration-switcher.mjs       # Agent switcher
│   ├── integration-ui-api.mjs         # UI API integration
│   ├── integration-watch.mjs          # File watching
│   ├── e2e-workflow.mjs               # End-to-end workflows
│   ├── real-agents.mjs                # Real agent execution
│   └── lib-python.mjs                 # Python library tests
│
├── test-*.js                          # Unit tests
│   ├── test-analyzer.js               # Code analyzer
│   ├── test-committer.js              # Git committer
│   ├── test-complexity.js             # Complexity analysis
│   ├── test-context-budget.js         # Context budget
│   ├── test-context-directives.js     # Context directives
│   ├── test-context-scorer.js         # Context scoring
│   ├── test-context-selector.js       # Context selection
│   ├── test-context-visualization.js  # Context visualization
│   ├── test-error-handling.js         # Error handling
│   ├── test-executor.js               # Story executor
│   ├── test-executor-us003.js         # Specific user stories
│   ├── test-git-fallback.js           # Git fallback
│   ├── test-merger.js                 # Branch merger
│   ├── test-parallel-index.js         # Parallel execution
│   ├── test-realistic-scenarios.js    # Realistic workflows
│   ├── test-risk-analyzer.js          # Risk analyzer
│   ├── test-token-usage.js            # Token usage tracking
│   └── test-with-anthropic-api.js     # Anthropic API integration
│
├── fixtures/                          # Test fixtures and sample data
├── helpers/                           # Test utility functions
└── mocks/                             # Mock implementations
```

### File Organization Rules

**✅ DO:**
- Place ALL test files in `/tests` directory
- Use `.mjs` extension for integration and E2E tests
- Use `test-*.js` naming pattern for unit tests
- Use subdirectories (`fixtures/`, `helpers/`, `mocks/`) for supporting files
- Keep test file names descriptive and consistent

**❌ DON'T:**
- Place test files in `/lib`, `/bin`, or any source directory
- Mix test files with production code
- Use inconsistent naming conventions
- Create test files in the project root

---

## Running Tests

### Quick Tests (No Agent Required)

```bash
# Smoke tests - fast validation
npm test

# Agent health check
npm run test:ping
```

### Integration Tests (Requires Agents)

```bash
# All integration tests
npm run test:all

# Specific integration tests
npm run test:checkpoint      # Checkpoint system
npm run test:switcher        # Agent switching
npm run test:risk           # Risk analysis
npm run test:actions        # Actions workflow
npm run test:notify         # Notifications
npm run test:metrics        # Metrics collection
npm run test:doctor         # Doctor diagnostics
npm run test:watch          # File watching
npm run test:ui-api         # UI API
```

### Advanced Tests

```bash
# End-to-end workflow
npm run test:e2e

# Real agent execution (requires configured agents)
npm run test:real

# With coverage reporting
npm run test:coverage

# Integration tests with environment flag
RALPH_INTEGRATION=1 npm test
```

### Test Categories

1. **Smoke Tests (`*.mjs`)** - Quick validation, no real agent needed
2. **Integration Tests (`integration-*.mjs`)** - Multiple components, may require mock/real agents
3. **Unit Tests (`test-*.js`)** - Isolated module tests
4. **E2E Tests (`e2e-*.mjs`)** - Full workflow simulations
5. **Real Agent Tests** - Execute against actual Claude/Codex/Droid agents (requires API keys)

---

## UI Testing with agent-browser

### What is agent-browser?

**Vercel's agent-browser** - Fast Rust-based CLI for browser automation, optimized for AI agents.

**Why agent-browser?**
- ✅ Fast & reliable: Rust CLI with Node.js fallback
- ✅ AI-optimized: Snapshot + ref workflow (`@e1`, `@e2`) for deterministic selection
- ✅ No buggy MCP: Standalone CLI tool
- ✅ Persistent sessions: Isolated browser instances with cookies/storage
- ✅ JSON output: Machine-readable results

### Setup

```bash
# Install agent-browser
npm install -g agent-browser
agent-browser install  # Downloads Chromium

# Start UI server
cd ui && npm run dev

# Initialize browser session
agent-browser open http://localhost:3000
```

### Essential Commands

#### Navigation & Inspection

```bash
# Open a URL
agent-browser open http://localhost:3000

# Go back/forward
agent-browser back
agent-browser forward

# Reload page
agent-browser reload

# Take snapshot (see all interactive elements)
agent-browser snapshot -i          # Interactive elements only
agent-browser snapshot -c          # Compact format
agent-browser snapshot             # Full snapshot

# Take screenshot
agent-browser screenshot page.png
agent-browser screenshot --full page.png  # Full page scroll

# Get page title
agent-browser eval "document.title"

# Get current URL
agent-browser eval "window.location.href"
```

#### Element Interaction

```bash
# Click elements
agent-browser click @e1                          # Use @eN ref from snapshot
agent-browser click "button:has-text('Start')"   # CSS selector
agent-browser click "[role=button]"              # Attribute selector

# Type text
agent-browser type @e17 "PRD-67"
agent-browser fill @e17 "PRD-67"  # Same as type

# Press keys
agent-browser press Enter
agent-browser press Escape
agent-browser press "Control+a"

# Select dropdown
agent-browser select @e12 "Codex"  # Select by value/text
```

#### Verification

```bash
# Get text content
agent-browser get text @e1
agent-browser get text "h1"

# Get attribute value
agent-browser get attribute @e1 "href"
agent-browser get attribute "button" "disabled"

# Check visibility
agent-browser is visible @e1
agent-browser is visible "button:has-text('Start Build')"

# Check if element exists
agent-browser find "button:has-text('Start Build')"

# Get all matching elements
agent-browser find-all ".stream-card"
```

#### Advanced

```bash
# Run JavaScript
agent-browser eval "document.querySelectorAll('.stream-card').length"
agent-browser eval "localStorage.getItem('theme')"

# Wait for element
agent-browser wait-for "text=Build completed"
agent-browser wait-for "[data-status='running']"

# Check console messages
agent-browser console
agent-browser errors

# Network activity
agent-browser network requests
agent-browser network responses
```

---

## Common Test Scenarios

### 1. Test Dashboard Load

```bash
# Navigate to dashboard
agent-browser open http://localhost:3000
agent-browser click @e1  # Click "Press Enter"
agent-browser click @e1  # Click "Back to Dashboard"

# Verify elements are visible
agent-browser snapshot -i
agent-browser is visible "button:has-text('Start Build')"
agent-browser is visible "[data-testid='stream-select']"

# Check for errors
agent-browser console
agent-browser errors
```

### 2. Test Stream Selection

```bash
# Get available streams
agent-browser get text @e18  # Stream listbox

# Select a specific stream
agent-browser click @e18     # Open dropdown
agent-browser type "PRD-67"  # Type to search
agent-browser press Enter    # Select

# Verify selection
agent-browser get text "[data-testid='selected-stream']"
```

### 3. Test Build Configuration

```bash
# Set iterations
agent-browser fill @e11 "5"  # Iterations spinbutton

# Select agent
agent-browser click @e12     # Open agent dropdown
agent-browser click @e14     # Select "Codex"

# Toggle dry run
agent-browser click @e20     # Dry run checkbox

# Verify form state
agent-browser get attribute @e20 "checked"
agent-browser get text @e12  # Selected agent
```

### 4. Test Navigation

```bash
# Navigate to Streams page
agent-browser click @e3      # Streams link
agent-browser snapshot -i    # See stream cards

# Navigate to Logs page
agent-browser click @e5      # Logs link
agent-browser snapshot -i    # See log viewer

# Navigate to Documentation
agent-browser click @e4      # Documentation link
agent-browser snapshot -i    # See docs
```

### 5. Test Stream Actions

```bash
# Navigate to Streams page
agent-browser click @e3

# Take snapshot to find buttons
agent-browser snapshot -i

# Click "Monitor" for first stream
agent-browser click @e13

# Verify modal/page opened
agent-browser snapshot -i

# Close modal (if applicable)
agent-browser press Escape
```

### 6. Test Search Functionality

```bash
# Go to Streams page
agent-browser click @e3

# Find search input
agent-browser snapshot -i

# Search for specific PRD
agent-browser type @e17 "PRD-67"

# Verify filtered results
agent-browser eval "document.querySelectorAll('.stream-card').length"
```

### 7. Test Real-time Updates

```bash
# Open dashboard
agent-browser open http://localhost:3000

# Start a build in another terminal:
# ralph build 1 --prd=67

# Watch for status updates
agent-browser wait-for "text=running"
agent-browser wait-for "[data-status='running']"

# Check real-time progress
agent-browser get text "[data-testid='build-status']"

# Take screenshot
agent-browser screenshot build-running.png
```

### 8. Test Error Handling

```bash
# Try to build without selecting stream
agent-browser click "button:has-text('Start Build')"

# Check for error message
agent-browser wait-for "text=Please select"
agent-browser snapshot -i

# Check console for errors
agent-browser errors
```

### 9. Test Logs Page

```bash
# Navigate to Logs
agent-browser click @e5

# Wait for logs to load
agent-browser wait-for "[data-testid='log-entries']"

# Get log count
agent-browser eval "document.querySelectorAll('[data-log-entry]').length"

# Filter logs
agent-browser fill "[data-testid='log-filter']" "ERROR"

# Verify filtered results
agent-browser snapshot -i
```

### 10. Test Token/Cost Tracking

```bash
# Navigate to Tokens page
agent-browser click @e6

# Verify cost data loads
agent-browser wait-for "text=$"  # Wait for cost to appear
agent-browser snapshot -i

# Get total cost
agent-browser get text "[data-testid='total-cost']"

# Check chart renders
agent-browser is visible "canvas"  # Chart.js renders to canvas
```

### Debugging Tips

```bash
# Open headed browser for visual debugging
BROWSER_HEADLESS=false agent-browser open http://localhost:3000

# Slow down actions for observation
BROWSER_SLOW_MO=500 agent-browser click @e1

# Keep browser open after script
BROWSER_KEEP_ALIVE=true agent-browser open http://localhost:3000

# Verbose output
DEBUG=* agent-browser open http://localhost:3000

# Save HTML for inspection
agent-browser eval "document.documentElement.outerHTML" > page.html
```

### UI Testing Helper Script

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

# Custom UI URL
UI_URL=http://localhost:8080 .agents/ralph/test-ui.sh snapshot
```

### UI Server Configuration

The Ralph UI server uses `RALPH_ROOT` environment variable:

**Production mode (default):**
```bash
# Uses parent directory's .ralph/ (ralph-cli/.ralph)
cd ui && npm run dev
```

**Test mode:**
```bash
# Uses ui/.ralph/ for isolated testing
cd ui && npm run dev:test
```

**Custom RALPH_ROOT:**
```bash
# Point to any .ralph directory
RALPH_ROOT=/path/to/.ralph npm run dev
```

---

## Writing New Tests

### Choosing the Right Location

**Always use `/tests` directory.**

### Choosing the Right Extension

- `.mjs` for integration/E2E tests
- `.js` for unit tests

### Use Descriptive Names

- Integration: `integration-feature-name.mjs`
- Unit: `test-component-name.js`
- E2E: `e2e-workflow-name.mjs`

### Update package.json

If adding new npm scripts, update `package.json`:

```json
{
  "scripts": {
    "test:my-feature": "node tests/integration-my-feature.mjs"
  }
}
```

### Document Complex Scenarios

Add comments for complex test logic:

```javascript
// Test PRD status detection with direct-to-main workflow
// This verifies git commits are used as source of truth, not checkboxes
test('detects completed PRDs via git log', async () => {
  // ... test logic
});
```

---

## Best Practices

### General Testing Principles

1. **Isolation** - Tests should not depend on each other
2. **Cleanup** - Clean up any created files/state after tests
3. **Fast** - Keep unit tests fast; use mocks when possible
4. **Descriptive** - Use clear test names and assertions
5. **Maintainable** - Keep tests simple and focused
6. **Documented** - Add comments for complex test logic

### UI Testing Best Practices

1. **Always snapshot first** - Use `agent-browser snapshot -i` to see page state
2. **Use semantic selectors** - Prefer `button:has-text('Start')` over brittle `@eN` refs
3. **Add delays** - Give dynamic content time to load (`sleep 2` or `wait-for`)
4. **Check console errors** - Run `agent-browser errors` after interactions
5. **Take screenshots** - Visual evidence: `agent-browser screenshot test.png`
6. **Test unhappy paths** - Try invalid inputs, missing data, error states
7. **Verify state changes** - Check text/attributes after actions
8. **Clean up** - Close browser sessions when done
9. **Use scripts** - Automate repetitive tests
10. **Document findings** - Save screenshots and error logs

### Common Pitfalls

**❌ DON'T:**
- Rely on element refs (`@eN`) - they change on every snapshot
- Assume instant loads - elements may not be ready
- Ignore console errors - they indicate real issues
- Test only with mouse - users also use keyboard
- Skip visual verification - some bugs are visual only

**✅ DO:**
- Use semantic selectors like `button:has-text('Start Build')`
- Use `wait-for` or add `sleep` delays for async content
- Check `agent-browser errors` after each interaction
- Test keyboard navigation with `press Tab`, `press Enter`
- Take screenshots and compare against expected states

---

## Test Script Examples

### Automated UI Test Script

Create `test-ui.sh`:

```bash
#!/bin/bash
set -e

echo "🧪 Testing Ralph UI..."

# 1. Navigate to homepage
echo "1. Loading homepage..."
agent-browser open http://localhost:3000
agent-browser click @e1  # Press Enter

# 2. Go to dashboard
echo "2. Navigating to dashboard..."
agent-browser click @e1  # Back to Dashboard

# 3. Verify elements
echo "3. Verifying dashboard elements..."
agent-browser snapshot -i > /tmp/dashboard-snapshot.txt
grep -q "Start Build" /tmp/dashboard-snapshot.txt || echo "❌ Start Build button missing"
grep -q "Stream" /tmp/dashboard-snapshot.txt || echo "❌ Stream selector missing"

# 4. Test navigation
echo "4. Testing navigation..."
agent-browser click @e3  # Streams
sleep 1
agent-browser click @e5  # Logs
sleep 1
agent-browser click @e2  # Back to Dashboard

# 5. Check for errors
echo "5. Checking console errors..."
ERRORS=$(agent-browser errors)
if [ -n "$ERRORS" ]; then
  echo "❌ Console errors found:"
  echo "$ERRORS"
else
  echo "✅ No console errors"
fi

# 6. Take final screenshot
echo "6. Taking screenshot..."
agent-browser screenshot test-result.png

echo "✅ All tests passed!"
```

Run it:
```bash
chmod +x test-ui.sh
./test-ui.sh
```

### Continuous Monitoring Script

Watch UI in real-time during builds:

```bash
#!/bin/bash
# watch-ui.sh

while true; do
  clear
  echo "=== Ralph UI Status ==="
  agent-browser snapshot -c | head -20
  agent-browser errors | tail -5
  sleep 5
done
```

Run in split terminal:
```bash
# Terminal 1
ralph build 10 --prd=67

# Terminal 2
./watch-ui.sh
```

---

## Testing Checklist

When adding new UI features, verify:

- [ ] Homepage loads without errors
- [ ] Navigation between all pages works
- [ ] Dashboard shows all controls
- [ ] Stream list loads with data
- [ ] Logs page displays entries
- [ ] Tokens page shows cost data
- [ ] Search/filter functionality works
- [ ] Build controls are interactive
- [ ] No console errors anywhere
- [ ] Screenshots captured for reference
- [ ] Keyboard navigation works
- [ ] Error states display correctly
- [ ] Real-time updates reflect correctly
- [ ] Data persists across page reloads

---

## Environment Variables

For agent-browser debugging:

```bash
BROWSER_HEADLESS=false    # Show browser window
BROWSER_SLOW_MO=500       # Slow down actions (ms)
BROWSER_KEEP_ALIVE=true   # Keep browser open
DEBUG=*                   # Verbose logging
UI_URL=http://...         # Custom URL
```

---

## Migration Notes

All test files have been migrated to `/tests` directory:

- Moved from `/lib/metrics/test-git-fallback.js` → `/tests/test-git-fallback.js`
- Moved from root `test-*.js` files → `/tests/test-*.js`
- Updated import paths to reflect new locations
- Worktree test copies remain in `.ralph/worktrees/` (not part of main codebase)

---

## Related Documentation

- [Testing Cheatsheet](TESTING_CHEATSHEET.md) - Quick reference
- [Voice Guide](VOICE.md) - Testing voice features
- [CLAUDE.md](../CLAUDE.md) - UI testing section

---

**Last Updated:** January 19, 2026
