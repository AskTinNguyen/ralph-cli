# Ralph UI Testing Guide with agent-browser

> **⚠️ DEPRECATED:** This file has been consolidated into [`docs/TESTING.md`](docs/TESTING.md).
> Please use the new comprehensive testing guide for all testing documentation.
> This file will be removed in a future release.

## Setup

```bash
# 1. Install agent-browser (if not installed)
npm install -g agent-browser
agent-browser install  # Downloads Chromium

# 2. Start UI server
cd ui && npm run dev

# 3. Initialize browser session
agent-browser open http://localhost:3000
```

## Basic Commands

### Navigation & Inspection

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

### Element Interaction

```bash
# Click elements (use @eN references from snapshot)
agent-browser click @e1
agent-browser click "button:has-text('Start Build')"  # CSS selector
agent-browser click "[role=button]"                   # Attribute selector

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

### Verification

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

### Advanced

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

# Click "Monitor" for first stream (PRD-1)
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
agent-browser type @e17 "PRD-67"  # Assuming @e17 is search input

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

# Take screenshot of running build
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

## Debugging Tips

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

## Test Script Example

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

## Automated Test Suite

For CI/CD, use the helper script:

```bash
# Quick tests
.agents/ralph/test-ui.sh snapshot      # Just take snapshot
.agents/ralph/test-ui.sh test-list     # Test PRD list
.agents/ralph/test-ui.sh test-logs     # Test logs page

# Full test suite
.agents/ralph/test-ui.sh all

# Custom URL
UI_URL=http://localhost:8080 .agents/ralph/test-ui.sh snapshot
```

## Best Practices

1. **Always take snapshot first**: Use `agent-browser snapshot -i` to see what's on the page
2. **Use semantic selectors**: Prefer `button:has-text('Start')` over brittle `@eN` refs
3. **Wait for elements**: Use `wait-for` for dynamic content
4. **Check console errors**: Always run `agent-browser errors` after interactions
5. **Take screenshots**: Visual evidence of test state: `agent-browser screenshot test.png`
6. **Clean up**: Close browser sessions when done
7. **Test error states**: Don't just test happy paths
8. **Verify data loading**: Check that API data actually renders
9. **Test responsiveness**: Resize browser and verify layout
10. **Use headed mode for debugging**: `BROWSER_HEADLESS=false` to see what's happening

## Common Pitfalls

❌ **Don't**: Rely on element refs (@eN) - they change on every snapshot
✅ **Do**: Use semantic selectors like `button:has-text('Start Build')`

❌ **Don't**: Assume instant loads - elements may not be ready
✅ **Do**: Use `wait-for` or add `sleep` delays for async content

❌ **Don't**: Ignore console errors - they indicate real issues
✅ **Do**: Check `agent-browser errors` after each interaction

❌ **Don't**: Test only with mouse - users also use keyboard
✅ **Do**: Test keyboard navigation with `press Tab`, `press Enter`

❌ **Don't**: Skip visual verification - some bugs are visual only
✅ **Do**: Take screenshots and compare against expected states

## Integration with Ralph Builds

Test UI during Ralph builds:

```bash
# Start UI server
cd ui && npm run dev &
UI_PID=$!

# Run build
ralph build 5 --prd=67

# Test UI reflects build status
agent-browser open http://localhost:3000
agent-browser click @e3  # Streams
agent-browser eval "document.querySelector('[data-prd=\"67\"]').textContent"

# Cleanup
kill $UI_PID
```

## Continuous Monitoring

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

Run in split terminal while building:
```bash
# Terminal 1
ralph build 10 --prd=67

# Terminal 2
./watch-ui.sh
```
