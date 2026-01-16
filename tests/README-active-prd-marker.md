# Active PRD Marker Tests (Layer 2)

Tests for the Active PRD Marker system that enforces sequential execution in Ralph CLI.

## What is Tested

The Active PRD Marker functions in `.agents/ralph/stream.sh` (lines 449-501) are responsible for:

1. **Sequential execution enforcement** - Only one PRD builds at a time (when enabled)
2. **Marker file management** - Creating, reading, and clearing `.ralph/.active-prd`
3. **PRD number extraction** - Handling both `PRD-2` and `2` formats
4. **Conflict detection** - Blocking concurrent builds of different PRDs

## Test Coverage

### ✅ Marker File Operations (8 tests)
- **Set marker** - Creates `.ralph/.active-prd` with PRD number
- **Set numeric format** - Handles both "PRD-2" and "2" formats
- **Get marker** - Returns current active PRD number
- **Get when empty** - Returns empty string when no marker
- **Clear marker** - Removes marker file
- **Has active PRD** - Boolean check for marker existence
- **Is PRD active** - Checks if specific PRD is active
- **Get PRD info** - Returns formatted "PRD-N" or "none"

### ✅ Sequential Mode Enforcement (6 tests)
- **Sequential disabled** - Allows concurrent builds when mode is off
- **Sequential enabled** - Blocks concurrent PRDs when mode is on
- **Same PRD continues** - Allows same PRD to keep building
- **First PRD allowed** - Starts build when no active PRD
- **Sequential workflow** - PRD-1 finishes, then PRD-2 starts
- **Concurrent messages** - Shows helpful error messages

### ✅ Marker Lifecycle (4 tests)
- **Marker cleanup** - Simulates trap cleanup on exit
- **Marker persistence** - Survives multiple reads
- **Overwrite marker** - Updates to new PRD correctly
- **Invalid formats** - Handles edge cases gracefully

## How It Works

Each test:

1. **Sets up Ralph directory** with:
   - `.ralph/` directory
   - Multiple PRD directories (PRD-1, PRD-2, PRD-3)
   - Lock directory structure

2. **Extracts marker functions** from `stream.sh`:
   - `get_active_prd()`
   - `set_active_prd()`
   - `clear_active_prd()`
   - `has_active_prd()`
   - `is_prd_active()`
   - `get_active_prd_info()`

3. **Runs test scenarios** with controlled inputs

4. **Verifies behavior**:
   - Marker file content
   - Function return values
   - Sequential mode blocking

## Running Tests

```bash
# Run active PRD marker tests only
npm run test:marker

# Run all integration tests (includes marker tests)
npm run test:integration

# Run tests directly
node tests/test-active-prd-marker.mjs
./tests/test-active-prd-marker.mjs
```

## Test Output

```
🧪 Active PRD Marker Tests (Layer 2)

═══════════════════════════════════════════════════════

📁 Test directory: /tmp/ralph-marker-test-xyz123
✅ Set active PRD marker - creates file
✅ Set marker with numeric format (2 vs PRD-2)
✅ Get active PRD - returns marker content
✅ Get active PRD when none exists - returns empty
✅ Clear active PRD marker - removes file
✅ Has active PRD - detects marker presence
✅ Is PRD active - checks specific PRD number
✅ Get active PRD info - formatted display
✅ Sequential mode disabled - allows concurrent builds
✅ Sequential mode enabled - blocks concurrent PRDs
✅ Sequential mode - allows same PRD to continue
✅ Sequential mode - allows first PRD when none active
✅ Marker cleanup - simulates trap on exit
✅ Marker persistence - survives multiple reads
✅ Overwrite marker - updates to new PRD
✅ Sequential workflow - PRD-1 completes, then PRD-2 starts
✅ Invalid PRD format - handles edge cases
✅ Concurrent PRD messages - shows helpful info

═══════════════════════════════════════════════════════

✅ Passed: 18
❌ Failed: 0
📊 Total:  18
```

## Implementation Details

### Active PRD Marker File

```
Location: .ralph/.active-prd
Content:  <PRD number without prefix>

Examples:
- PRD-1 active → file contains "1"
- PRD-2 active → file contains "2"
- No active PRD → file doesn't exist
```

### Function Behavior

#### `set_active_prd(stream_id)`
```bash
# Input formats accepted:
set_active_prd "PRD-2"  # Extracts "2"
set_active_prd "2"      # Uses "2" directly

# Creates file: .ralph/.active-prd
# Content: "2"
```

#### `get_active_prd()`
```bash
# Returns: PRD number or empty string
get_active_prd  # → "2" (if PRD-2 active)
get_active_prd  # → "" (if no active PRD)
```

#### `has_active_prd()`
```bash
# Returns: exit code (0=true, 1=false)
has_active_prd && echo "yes" || echo "no"
# → "yes" if marker exists
# → "no" if marker doesn't exist
```

#### `is_prd_active(stream_id)`
```bash
# Checks if specific PRD is active
is_prd_active "PRD-2" && echo "yes" || echo "no"
is_prd_active "2" && echo "yes" || echo "no"
# → "yes" if PRD-2 is active
# → "no" if different PRD or none active
```

#### `clear_active_prd()`
```bash
# Removes marker file
clear_active_prd
# .ralph/.active-prd deleted
```

#### `get_active_prd_info()`
```bash
# Returns: formatted display string
get_active_prd_info  # → "PRD-2" (if active)
get_active_prd_info  # → "none" (if no active PRD)
```

## Test Scenarios

### Scenario 1: Sequential Mode Blocks Concurrent PRDs

```bash
# Terminal 1
RALPH_SEQUENTIAL_MODE=true
set_active_prd "PRD-1"  # Mark PRD-1 as active

# Terminal 2 (tries to start PRD-2)
if has_active_prd && ! is_prd_active "PRD-2"; then
  echo "BLOCKED: Another PRD is building"
  exit 1
fi
# → BLOCKED (PRD-1 is active, PRD-2 is different)

# Terminal 3 (tries to continue PRD-1)
if has_active_prd && ! is_prd_active "PRD-1"; then
  echo "BLOCKED"
  exit 1
fi
# → ALLOWED (PRD-1 is active, requesting PRD-1)
```

### Scenario 2: Sequential Mode Disabled (Parallel Allowed)

```bash
# Terminal 1
RALPH_SEQUENTIAL_MODE=false
set_active_prd "PRD-1"

# Terminal 2
if [[ "${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
  # Check would go here
fi
# → ALLOWED (sequential mode is off, no check)
```

### Scenario 3: Sequential Workflow

```bash
# Step 1: PRD-1 starts
set_active_prd "PRD-1"
# .ralph/.active-prd contains "1"

# Step 2: PRD-2 tries to start (BLOCKED)
has_active_prd  # → true
is_prd_active "PRD-2"  # → false
# Result: BLOCKED

# Step 3: PRD-1 completes
clear_active_prd
# .ralph/.active-prd removed

# Step 4: PRD-2 starts (ALLOWED)
has_active_prd  # → false
# Result: ALLOWED
set_active_prd "PRD-2"
# .ralph/.active-prd contains "2"
```

## Why This Matters

**Problem without Active PRD Marker:**
```bash
# Terminal 1: Building PRD-1
cd /large-repo
ralph stream build 1 10  # Starts iteration 1/10

# Terminal 2: User forgets PRD-1 is running
cd /large-repo
ralph stream build 2 5   # Starts PRD-2 concurrently

# Result:
# - Both PRDs read same codebase
# - Agent context contamination
# - PRD-2 might see PRD-1's changes
# - Merge conflicts likely
```

**Solution with Active PRD Marker:**
```bash
# Terminal 1: Building PRD-1
ralph stream build 1 10
# Sets .ralph/.active-prd to "1"

# Terminal 2: Tries PRD-2
ralph stream build 2 5
# ERROR: SEQUENTIAL MODE: Another PRD is already building
#        Active PRD: PRD-1
#        Requested:  PRD-2
# Build blocked immediately
```

## Integration with Other Layers

The Active PRD Marker works with other protection layers:

**Layer 1 (Config):**
```bash
# .agents/ralph/config.sh
RALPH_SEQUENTIAL_MODE=true  # Enables Layer 2 checks
```

**Layer 2 (Active PRD Marker):**
```bash
# stream.sh:1127-1149
if [[ "${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
  if has_active_prd && ! is_prd_active "$stream_id"; then
    # BLOCK BUILD
  fi
fi

# Set marker on build start
set_active_prd "$stream_id"

# Clear marker on exit (via trap)
trap "clear_active_prd" EXIT
```

**Layer 3 (Scope Validation):**
```bash
# Validates after each iteration that agent didn't modify other PRDs
# Uses ACTIVE_PRD_NUMBER (set by Layer 2) to know which PRD is allowed
```

**Layer 4 (Lock):**
```bash
# Prevents same PRD from running twice
# Works alongside Layer 2 (different PRDs) and Layer 4 (same PRD)
```

## Enforcement Points

### Build Start (`stream.sh:1127-1149`)

```bash
# Before build begins
if [[ "${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
  # Check: Is another PRD building?
  if has_active_prd && ! is_prd_active "$stream_id"; then
    active_prd=$(get_active_prd_info)
    msg_error "SEQUENTIAL MODE: Another PRD is already building"
    echo "Active PRD: $active_prd"
    echo "Requested:  $stream_id"
    return 1  # Block build
  fi
fi

# Mark this PRD as active
set_active_prd "$stream_id"

# Set up cleanup
trap "release_lock '$stream_id'; clear_active_prd" EXIT
```

### Build Completion/Exit

```bash
# Automatic cleanup via trap
trap "clear_active_prd" EXIT

# On normal exit, error, or SIGTERM:
# - clear_active_prd() runs
# - Removes .ralph/.active-prd
# - Next PRD can start
```

## Common Patterns

### Check if Sequential Mode is Safe

```bash
# Before starting build
if [[ "${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
  if has_active_prd; then
    echo "Active PRD: $(get_active_prd_info)"
    echo "Wait for completion or disable sequential mode"
    exit 1
  fi
fi
```

### Manual Cleanup (if trap fails)

```bash
# Check for stale marker
if [[ -f .ralph/.active-prd ]]; then
  echo "Stale marker found: $(cat .ralph/.active-prd)"

  # Verify process isn't running
  # (check lock file, ps aux, etc.)

  # Clear if confirmed stale
  rm -f .ralph/.active-prd
fi
```

### Display Current Status

```bash
# Show which PRD is active
if has_active_prd; then
  echo "Active PRD: $(get_active_prd_info)"
else
  echo "No active PRD (sequential mode available)"
fi
```

## Performance Impact

Active PRD Marker has minimal overhead:

- **File operations:** ~1ms per set/get/clear
- **Marker check:** ~2ms (read file, compare string)
- **Total per build:** ~5ms (set at start, clear at end)
- **No impact when disabled:** Sequential mode check is conditional

## Future Enhancements

Potential improvements:

1. **Timestamp tracking** - When did PRD become active?
2. **PID tracking** - Which process owns the marker?
3. **Stale marker detection** - Auto-cleanup if process died
4. **Queue system** - Wait for active PRD instead of blocking
5. **Priority levels** - Allow urgent PRDs to interrupt lower priority

## Related Documentation

- [CLAUDE.md](../CLAUDE.md#stream-commands-parallel-execution) - Sequential mode overview
- [4-Layer Protection](../CLAUDE.md#merge-safety) - How layers work together
- [stream.sh:449-501](../.agents/ralph/stream.sh) - Implementation
- [README-scope-validation.md](./README-scope-validation.md) - Layer 3 tests

## See Also

- **Layer 1:** Configuration (policy definition)
- **Layer 3:** Scope Validation (cross-PRD detection)
- **Layer 4:** Lock Mechanism (same-PRD protection)
