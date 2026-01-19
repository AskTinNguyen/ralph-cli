# Testing Cheatsheet

**Quick reference for Ralph CLI testing**

---

## Quick Commands

### Run Tests

```bash
# Quick smoke tests
npm test

# All integration tests
npm run test:all

# Specific tests
npm run test:checkpoint
npm run test:ui-api
npm run test:e2e

# With coverage
npm run test:coverage
```

---

## agent-browser Essentials

### Setup

```bash
npm install -g agent-browser
agent-browser install
cd ui && npm run dev
agent-browser open http://localhost:3000
```

### Navigation

```bash
agent-browser open <url>
agent-browser back
agent-browser reload
```

### Inspection

```bash
agent-browser snapshot -i              # Interactive elements
agent-browser snapshot -c              # Compact
agent-browser screenshot page.png
agent-browser errors                   # Console errors
```

### Interaction

```bash
agent-browser click @e1                # By reference
agent-browser click "button:has-text('Start')"  # CSS
agent-browser type @e5 "text"
agent-browser fill @e5 "text"
agent-browser press Enter
```

### Verification

```bash
agent-browser get text @e1
agent-browser is visible @e1
agent-browser eval "document.title"
agent-browser wait-for "text=Ready"
```

---

## Common Patterns

### Pattern 1: Navigate and Verify

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i > elements.txt
grep "Start Build" elements.txt && echo "✓ Found"
```

### Pattern 2: Click Through Workflow

```bash
agent-browser open http://localhost:3000
agent-browser click @e1  # Enter
agent-browser click @e2  # Dashboard
agent-browser is visible "text=Start Build"
```

### Pattern 3: Fill Form

```bash
agent-browser fill @e11 "5"         # Iterations
agent-browser click @e12            # Dropdown
agent-browser click @e14            # Select
```

### Pattern 4: Check Real-time Updates

```bash
while true; do
  agent-browser snapshot -c | head -20
  agent-browser get text "@e1"
  sleep 3
done
```

### Pattern 5: Verify Page Load

```bash
agent-browser click @e3             # Navigate
sleep 2
agent-browser errors
agent-browser screenshot page.png
```

---

## Quick Test Scripts

### Snapshot Current Page

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
```

### Check for Errors

```bash
agent-browser open http://localhost:3000
agent-browser errors
```

### Test Navigation

```bash
for page in @e2 @e3 @e4 @e5; do
  agent-browser click "$page"
  sleep 1
  agent-browser errors
done
```

### Get All Titles

```bash
for page in @e2 @e3 @e4; do
  agent-browser click "$page"
  agent-browser eval "document.title"
done
```

---

## Debugging

### Visual Browser

```bash
BROWSER_HEADLESS=false agent-browser open http://localhost:3000
```

### Slow Motion

```bash
BROWSER_SLOW_MO=500 agent-browser click @e1
```

### Save HTML

```bash
agent-browser eval "document.documentElement.outerHTML" > page.html
```

### Check localStorage

```bash
agent-browser eval "JSON.stringify(localStorage)"
```

### Count Elements

```bash
agent-browser eval "document.querySelectorAll('.stream-card').length"
```

---

## Helper Scripts

### Quick Tests

```bash
.agents/ralph/test-ui.sh snapshot      # Snapshot
.agents/ralph/test-ui.sh test-list     # Test list
.agents/ralph/test-ui.sh test-logs     # Test logs
.agents/ralph/test-ui.sh interactive   # Headed
.agents/ralph/test-ui.sh cleanup       # Clean
```

### Custom URL

```bash
UI_URL=http://localhost:8080 .agents/ralph/test-ui.sh snapshot
```

---

## Environment Variables

```bash
BROWSER_HEADLESS=false    # Show browser
BROWSER_SLOW_MO=500       # Slow down (ms)
BROWSER_KEEP_ALIVE=true   # Keep open
DEBUG=*                   # Verbose
UI_URL=http://...         # Custom URL
```

---

## Testing Checklist

- [ ] Homepage loads
- [ ] Navigation works
- [ ] Dashboard controls visible
- [ ] Stream list loads
- [ ] Logs page displays
- [ ] No console errors
- [ ] Screenshots captured
- [ ] Keyboard navigation
- [ ] Error states
- [ ] Real-time updates

---

## Common Selectors

```bash
# By text
"button:has-text('Start Build')"
"text=Build completed"

# By role
"[role=button]"
"[role=listbox]"

# By attribute
"[data-testid='stream-select']"
"[data-status='running']"

# By class
".stream-card"
".log-entry"

# By element
"h1"
"button"
"input[type='text']"
```

---

## Common Issues

### Element not found

```bash
# Solution: Fresh snapshot
agent-browser snapshot -i > /tmp/fresh.txt
grep "text" /tmp/fresh.txt
```

### Click doesn't work

```bash
# Solution: Wait, then selector
sleep 2
agent-browser click "button:has-text('Start')"
```

### Console errors

```bash
# Solution: Check network and JS
agent-browser errors
agent-browser console
agent-browser network requests
```

### Page not loading

```bash
# Solution: Check server
curl -I http://localhost:3000
lsof -ti:3000
```

---

## Best Practices

1. **Snapshot first** - Know what's on page
2. **Semantic selectors** - `button:has-text('X')` not `@eN`
3. **Add delays** - `sleep 2` for dynamic content
4. **Check errors** - `agent-browser errors` after actions
5. **Screenshots** - Visual evidence
6. **Test unhappy paths** - Invalid inputs, errors
7. **Verify changes** - Check text/attributes
8. **Clean up** - Close sessions
9. **Automate** - Use scripts
10. **Document** - Save logs and screenshots

---

## Example Test Script

```bash
#!/bin/bash
set -e

agent-browser open http://localhost:3000
agent-browser snapshot -i > /tmp/s.txt

# Click through
agent-browser click $(grep "Enter" /tmp/s.txt | grep -o '@e[0-9]*' | head -1)
sleep 1
agent-browser click $(grep "Dashboard" /tmp/s.txt | grep -o '@e[0-9]*' | head -1)
sleep 1

# Verify
agent-browser is visible "text=Start Build" && echo "✓ Found"
agent-browser errors | grep -q "." && echo "✗ Errors" || echo "✓ No errors"

# Screenshot
agent-browser screenshot test.png
echo "✓ Done"
```

---

## Related

- [Full Testing Guide](TESTING.md)
- [UI Testing Guide](../UI_TESTING_GUIDE.md) - Deprecated
- [Agent Browser Cheatsheet](../AGENT_BROWSER_CHEATSHEET.md) - Deprecated

---

**Last Updated:** January 19, 2026
