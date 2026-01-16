# Debugging Active PRD Marker Issues

Quick guide for troubleshooting Active PRD Marker (Layer 2) problems in Ralph CLI.

## Quick Diagnosis

### Is sequential mode enabled?

```bash
# Check configuration
grep RALPH_SEQUENTIAL_MODE .agents/ralph/config.sh

# Expected output when enabled:
export RALPH_SEQUENTIAL_MODE=true
```

### Check current active PRD

```bash
# Read marker file
cat .ralph/.active-prd

# No such file? → No active PRD
# Contains number (e.g., "2")? → PRD-2 is active
```

### Verify marker functions work

```bash
# Test marker operations
cd .ralph
echo "2" > .active-prd
cat .active-prd  # Should show "2"
rm .active-prd
```

## Common Issues

### Issue 1: "Another PRD is building" but nothing is running

**Symptoms:**
- Error: "SEQUENTIAL MODE: Another PRD is already building"
- But no build process is actually running
- Marker file exists from crashed/interrupted build

**Diagnosis:**
```bash
# Check if marker file exists
ls -la .ralph/.active-prd

# Check for running ralph processes
ps aux | grep ralph | grep -v grep

# Check lock files
ls -la .ralph/locks/
```

**Cause:** Stale marker file from interrupted build

**Fix:**
```bash
# Option 1: Manual cleanup
rm -f .ralph/.active-prd

# Option 2: Verify no process is running first
ps aux | grep "ralph stream build" | grep -v grep
# If no output, safe to remove marker:
rm -f .ralph/.active-prd

# Option 3: Clear active PRD via stream.sh functions
source .agents/ralph/stream.sh
clear_active_prd
```

**Prevention:**
The `trap` in stream.sh should auto-clean on exit, but can fail if:
- Process killed with SIGKILL (-9)
- System crash
- Terminal forcefully closed

### Issue 2: Sequential mode not blocking concurrent builds

**Symptoms:**
- Two PRDs building simultaneously
- No "Another PRD is building" error
- Contamination occurs

**Diagnosis:**
```bash
# Check if sequential mode is enabled
echo $RALPH_SEQUENTIAL_MODE
grep RALPH_SEQUENTIAL_MODE .agents/ralph/config.sh

# Check if marker is being set
cat .ralph/.active-prd  # Should exist during build
```

**Possible causes:**

1. **Sequential mode disabled:**
   ```bash
   # Check config
   cat .agents/ralph/config.sh | grep RALPH_SEQUENTIAL_MODE
   # If not set or "false", sequential mode is off
   ```

2. **Using worktrees (bypasses sequential mode):**
   ```bash
   # Worktrees have separate working directories
   # Sequential mode is for non-worktree builds only
   ls -la .ralph/worktrees/
   ```

3. **Different RALPH_DIR values:**
   ```bash
   # If builds use different RALPH_DIR, markers are separate
   echo $RALPH_DIR
   ```

**Fix:**
```bash
# Enable sequential mode
echo 'export RALPH_SEQUENTIAL_MODE=true' >> .agents/ralph/config.sh

# Verify it's set in new shells
source .agents/ralph/config.sh
echo $RALPH_SEQUENTIAL_MODE  # Should print "true"
```

### Issue 3: Marker contains wrong PRD number

**Symptoms:**
- Building PRD-2 but marker shows different number
- Marker content corrupted or invalid

**Diagnosis:**
```bash
# Check marker content
cat .ralph/.active-prd
# Expected: single number (e.g., "2")
# Invalid: "PRD-2", "", multiple lines, etc.

# Check file permissions
ls -la .ralph/.active-prd

# Verify file is regular file (not symlink)
file .ralph/.active-prd
```

**Cause:** Manual editing, script errors, or filesystem issues

**Fix:**
```bash
# Clear and recreate
rm -f .ralph/.active-prd

# Start build normally (will recreate correctly)
ralph stream build 2 1
```

### Issue 4: Marker not cleared after build completes

**Symptoms:**
- Build finished but marker file still exists
- Next build blocked even though previous completed
- No running processes

**Diagnosis:**
```bash
# Check if marker exists
cat .ralph/.active-prd

# Check for running builds
ps aux | grep "ralph stream build" | grep -v grep

# Check build logs for trap execution
tail -50 .ralph/PRD-*/runs/*.log | grep -i "trap\|cleanup\|exit"
```

**Cause:** Trap didn't execute (build killed with -9, shell crash)

**Fix:**
```bash
# Manual cleanup
rm -f .ralph/.active-prd

# Verify no processes running first
ps aux | grep ralph | grep -v grep
```

**Prevention:**
Use graceful termination:
```bash
# Good: SIGTERM (allows trap to run)
kill <pid>
kill -TERM <pid>

# Bad: SIGKILL (bypasses trap)
kill -9 <pid>  # Avoid unless necessary
```

### Issue 5: Function not found errors

**Symptoms:**
```
bash: has_active_prd: command not found
bash: set_active_prd: command not found
```

**Diagnosis:**
```bash
# Check if stream.sh exists
ls -la .agents/ralph/stream.sh

# Check if functions are defined
grep -n "has_active_prd()" .agents/ralph/stream.sh
grep -n "set_active_prd()" .agents/ralph/stream.sh
```

**Cause:** Functions not sourced, or stream.sh not found

**Fix:**
```bash
# Source stream.sh manually
source .agents/ralph/stream.sh

# Or use ralph commands (which auto-source)
ralph stream status
```

## Manual Testing

### Test marker operations

```bash
# Setup
cd /path/to/project
source .agents/ralph/stream.sh

# Test 1: Set marker
set_active_prd "PRD-2"
cat .ralph/.active-prd  # Should show "2"

# Test 2: Get marker
get_active_prd  # Should output "2"

# Test 3: Check if has active
has_active_prd && echo "yes" || echo "no"  # Should show "yes"

# Test 4: Check specific PRD
is_prd_active "PRD-2" && echo "yes" || echo "no"  # Should show "yes"
is_prd_active "PRD-3" && echo "yes" || echo "no"  # Should show "no"

# Test 5: Get info
get_active_prd_info  # Should show "PRD-2"

# Test 6: Clear marker
clear_active_prd
cat .ralph/.active-prd  # Should fail (file not found)
```

### Test sequential mode blocking

```bash
# Terminal 1: Start PRD-1
export RALPH_SEQUENTIAL_MODE=true
ralph stream build 1 1

# Terminal 2: Try PRD-2 (should block)
export RALPH_SEQUENTIAL_MODE=true
ralph stream build 2 1
# Expected: ERROR: Another PRD is building (PRD-1)

# Terminal 1: Wait for PRD-1 to complete
# Marker should be auto-cleared

# Terminal 2: Retry PRD-2 (should work now)
ralph stream build 2 1
# Expected: Build starts successfully
```

### Test marker cleanup

```bash
# Start build in background
ralph stream build 1 1 &
BUILD_PID=$!

# Check marker created
cat .ralph/.active-prd  # Should show "1"

# Gracefully terminate
kill $BUILD_PID

# Wait a moment
sleep 2

# Check marker removed
cat .ralph/.active-prd  # Should fail (file should be gone)
```

## Automated Diagnostics

### Check marker health

```bash
#!/bin/bash
# check-marker-health.sh

echo "=== Active PRD Marker Health Check ==="
echo ""

# Check 1: Sequential mode config
echo "1. Sequential mode configuration:"
if grep -q "RALPH_SEQUENTIAL_MODE=true" .agents/ralph/config.sh 2>/dev/null; then
  echo "   ✅ Sequential mode ENABLED"
else
  echo "   ⚠️  Sequential mode DISABLED or not configured"
fi
echo ""

# Check 2: Marker file status
echo "2. Marker file status:"
if [[ -f .ralph/.active-prd ]]; then
  ACTIVE=$(cat .ralph/.active-prd)
  echo "   ⚠️  Marker exists: PRD-$ACTIVE"

  # Check if process is running
  if ps aux | grep "ralph stream build $ACTIVE" | grep -v grep > /dev/null; then
    echo "   ✅ Build process found for PRD-$ACTIVE"
  else
    echo "   ❌ No build process for PRD-$ACTIVE (STALE MARKER)"
    echo "   Fix: rm -f .ralph/.active-prd"
  fi
else
  echo "   ✅ No marker file (no active PRD)"
fi
echo ""

# Check 3: Running builds
echo "3. Running build processes:"
BUILDS=$(ps aux | grep "ralph stream build" | grep -v grep | wc -l)
if [[ $BUILDS -eq 0 ]]; then
  echo "   ✅ No builds running"
elif [[ $BUILDS -eq 1 ]]; then
  echo "   ✅ One build running (sequential mode OK)"
  ps aux | grep "ralph stream build" | grep -v grep | awk '{print "   Process:", $2, $11, $12, $13}'
else
  echo "   ⚠️  Multiple builds running: $BUILDS"
  ps aux | grep "ralph stream build" | grep -v grep | awk '{print "   Process:", $2, $11, $12, $13}'
  echo "   This may indicate sequential mode is disabled or not working"
fi
echo ""

# Check 4: Lock files
echo "4. Lock files:"
LOCKS=$(find .ralph/locks -name "*.lock" 2>/dev/null | wc -l)
if [[ $LOCKS -eq 0 ]]; then
  echo "   ✅ No lock files"
else
  echo "   Found $LOCKS lock file(s):"
  for lock in .ralph/locks/*.lock; do
    if [[ -f "$lock" ]]; then
      PID=$(cat "$lock")
      STREAM=$(basename "$lock" .lock)
      if kill -0 "$PID" 2>/dev/null; then
        echo "   ✅ $STREAM (PID $PID) - running"
      else
        echo "   ❌ $STREAM (PID $PID) - STALE (process not running)"
      fi
    fi
  done
fi
echo ""

echo "=== End Health Check ==="
```

**Usage:**
```bash
chmod +x check-marker-health.sh
./check-marker-health.sh
```

## Environment Variables

### Relevant variables

```bash
# Sequential mode toggle
RALPH_SEQUENTIAL_MODE=true|false

# Ralph directory (contains marker file)
RALPH_DIR=/path/to/project/.ralph

# Active PRD (set during build, not in config)
ACTIVE_PRD_NUMBER=PRD-2
```

### Check during build

```bash
# Add debug output to loop.sh or stream.sh
echo "DEBUG: RALPH_SEQUENTIAL_MODE=$RALPH_SEQUENTIAL_MODE"
echo "DEBUG: ACTIVE_PRD_NUMBER=$ACTIVE_PRD_NUMBER"
echo "DEBUG: Marker content=$(cat $RALPH_DIR/.active-prd 2>/dev/null || echo 'none')"
```

## Log Analysis

### Find marker-related log entries

```bash
# Search build logs for marker operations
grep -r "active.prd\|SEQUENTIAL\|Another PRD" .ralph/*/runs/

# Check for cleanup messages
grep -r "cleanup\|trap\|exit" .ralph/*/runs/*.log | tail -20

# Find concurrent build attempts
grep -i "BLOCKED\|already building" .ralph/*/runs/*.log
```

### Expected log patterns

**Normal sequential flow:**
```
[stream.sh] Sequential mode enabled
[stream.sh] No active PRD detected
[stream.sh] Setting active PRD: PRD-2
[loop.sh] Starting build iterations...
[loop.sh] Iteration 1 complete
[loop.sh] All iterations complete
[stream.sh] Clearing active PRD marker
```

**Blocked concurrent attempt:**
```
[stream.sh] Sequential mode enabled
[stream.sh] Active PRD detected: PRD-1
[stream.sh] Requested: PRD-2
[stream.sh] BLOCKED: Another PRD is already building
```

## Testing

### Run marker tests

```bash
# Run test suite
npm run test:marker

# Expected: All 18 tests pass
# If failures, check test output for specifics
```

### Manual verification

```bash
# Verify functions exist
type get_active_prd
type set_active_prd
type has_active_prd
type is_prd_active
type clear_active_prd
type get_active_prd_info

# All should output function definitions
# If "not found", source stream.sh first
```

## Recovery Procedures

### Clean stale state

```bash
# 1. Check for running processes
ps aux | grep ralph | grep -v grep

# 2. If no processes, safe to clean
rm -f .ralph/.active-prd
rm -f .ralph/locks/*.lock

# 3. Verify clean state
ls -la .ralph/ | grep -E "(active|lock)"
# Should show nothing or only directories
```

### Force clear (use with caution)

```bash
# Only if you're certain no builds are running
rm -f .ralph/.active-prd
rm -f .ralph/locks/*.lock
echo "Markers cleared. Verify no builds are running first!"
```

## Prevention Best Practices

1. **Graceful termination:**
   - Use `Ctrl+C` instead of `kill -9`
   - Let trap cleanup run

2. **Check before building:**
   ```bash
   ralph stream status  # Shows active builds
   cat .ralph/.active-prd  # Check marker directly
   ```

3. **Enable sequential mode explicitly:**
   ```bash
   # In .agents/ralph/config.sh
   export RALPH_SEQUENTIAL_MODE=true
   ```

4. **Monitor builds:**
   ```bash
   # Watch build progress
   ralph stream status

   # Check for stale markers periodically
   ls -la .ralph/.active-prd
   ```

## Getting Help

If Active PRD Marker isn't working:

1. **Run tests:** `npm run test:marker` (should all pass)
2. **Check health:** Run diagnostic script above
3. **Verify config:** `cat .agents/ralph/config.sh`
4. **Check logs:** `.ralph/PRD-*/runs/*.log`
5. **Clean state:** Remove marker and retry
6. **Report issue:** Include test output + logs

## See Also

- [README-active-prd-marker.md](./README-active-prd-marker.md) - Test documentation
- [CLAUDE.md](../CLAUDE.md#stream-commands-parallel-execution) - Sequential mode guide
- [stream.sh:449-501](../.agents/ralph/stream.sh) - Marker implementation
- [DEBUG-scope-validation.md](./DEBUG-scope-validation.md) - Layer 3 debugging
