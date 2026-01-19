# agent-browser Quick Reference for Ralph UI Testing

> **⚠️ DEPRECATED:** This file has been consolidated into [`docs/TESTING_CHEATSHEET.md`](docs/TESTING_CHEATSHEET.md).
> Please use the new testing cheatsheet for quick reference.
> This file will be removed in a future release.

## Setup
```bash
npm install -g agent-browser
agent-browser install
```

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
agent-browser errors                   # Check console errors
```

### Interaction
```bash
agent-browser click @e1                # Click by reference
agent-browser click "button:has-text('Start')"  # CSS selector
agent-browser type @e5 "text"          # Type into input
agent-browser fill @e5 "text"          # Fill input
agent-browser press Enter              # Press key
```

### Verification
```bash
agent-browser get text @e1             # Get element text
agent-browser is visible @e1           # Check if visible
agent-browser eval "document.title"    # Run JavaScript
```

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

## Testing Checklist

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

## Quick Test Commands

```bash
# Full automated test
./test-ui-manual.sh

# Interactive testing menu
./test-ui-interactive.sh

# Quick snapshot
agent-browser open http://localhost:3000 && agent-browser snapshot -i

# Check for errors
agent-browser open http://localhost:3000 && agent-browser errors

# Get all page titles
for page in Dashboard Streams Logs Tokens; do
  agent-browser eval "document.title"
done
```

## Debugging

```bash
# Run with visible browser
BROWSER_HEADLESS=false agent-browser open http://localhost:3000

# Slow down for observation
BROWSER_SLOW_MO=500 agent-browser click @e1

# Save HTML for inspection
agent-browser eval "document.documentElement.outerHTML" > page.html

# Check localStorage
agent-browser eval "JSON.stringify(localStorage)"

# Count elements
agent-browser eval "document.querySelectorAll('.stream-card').length"
```

## Common Issues

### Element not found
```bash
# Solution: Take fresh snapshot first
agent-browser snapshot -i > /tmp/fresh.txt
grep "desired text" /tmp/fresh.txt
```

### Click doesn't work
```bash
# Solution: Wait for element, then use selector
sleep 2
agent-browser click "button:has-text('Start')"
```

### Console errors present
```bash
# Solution: Check network and JS errors
agent-browser errors
agent-browser console
agent-browser network requests
```

### Page not loading
```bash
# Solution: Check server status
curl -I http://localhost:3000
lsof -ti:3000
```

## Environment Variables

```bash
BROWSER_HEADLESS=false    # Show browser window
BROWSER_SLOW_MO=500       # Slow down actions (ms)
BROWSER_KEEP_ALIVE=true   # Keep browser open
DEBUG=*                   # Verbose logging
UI_URL=http://...         # Custom URL
```

## Best Practices

1. **Always snapshot first**: Know what's on the page before interacting
2. **Use semantic selectors**: Prefer `button:has-text('X')` over `@eN`
3. **Add delays**: Give dynamic content time to load (`sleep 2`)
4. **Check errors**: Run `agent-browser errors` after interactions
5. **Take screenshots**: Visual evidence is valuable
6. **Test unhappy paths**: Try invalid inputs, missing data, errors
7. **Verify state changes**: Check text/attributes after actions
8. **Clean up**: Close sessions when done
9. **Use scripts**: Automate repetitive tests
10. **Document findings**: Save screenshots and error logs

## Example Test Script

```bash
#!/bin/bash
agent-browser open http://localhost:3000
agent-browser snapshot -i > /tmp/s.txt

# Click through to dashboard
agent-browser click $(grep "Press Enter" /tmp/s.txt | grep -o '@e[0-9]*' | head -1)
sleep 1
agent-browser snapshot -i > /tmp/s.txt
agent-browser click $(grep "Dashboard" /tmp/s.txt | grep -o '@e[0-9]*' | head -1)
sleep 1

# Verify elements
agent-browser is visible "text=Start Build" && echo "✓ Build button found"
agent-browser is visible "text=Stream" && echo "✓ Stream selector found"

# Check errors
ERRORS=$(agent-browser errors)
[ -z "$ERRORS" ] && echo "✓ No errors" || echo "✗ Errors found"

# Screenshot
agent-browser screenshot dashboard-test.png
echo "✓ Screenshot saved"
```
