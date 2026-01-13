# Proposal: Multi-Stream Parallel Execution with Git Worktrees

**Author:** Claude
**Date:** 2026-01-13
**Status:** Draft
**Version:** 1.0

---

## Executive Summary

This proposal introduces **Multi-Stream Execution** to Ralph, enabling parallel work on independent areas of a codebase. By leveraging Git Worktrees, each stream operates in an isolated environment with its own working directory, branch, and state files, while sharing a single Git repository.

The key insight is that many PRDs contain stories that affect different, non-overlapping parts of the codebase (e.g., authentication vs. API endpoints vs. frontend components). These can be safely developed in parallel, with coordination only required at merge time.

**Goals:**
- Enable parallel story execution for independent workstreams
- Maintain Ralph's simple, file-based memory model
- Prevent race conditions and merge conflicts during execution
- Provide clear merge orchestration for completed work

**Non-Goals:**
- Real-time collaboration between streams
- Automatic conflict resolution
- Changes to the agent execution model

---

## Problem Statement

### Current Limitations

Ralph's current architecture is strictly sequential:

```
Story 1 → Story 2 → Story 3 → Story 4 → ... → Complete
```

This creates bottlenecks when:

1. **Independent work exists**: Stories affecting `src/auth/` have no dependency on stories affecting `src/api/`
2. **Long-running stories block progress**: A complex story blocks all subsequent work
3. **Multiple developers want to use Ralph**: Each must wait for others to complete
4. **Different expertise areas**: Frontend and backend stories could parallelize

### Technical Barriers

| Component | Current State | Barrier to Parallelism |
|-----------|---------------|------------------------|
| `select_story()` | Always picks `remaining[0]` | No story assignment |
| PRD file | Single file, modified in-place | Write conflicts |
| `.ralph/` directory | Shared state | Race conditions |
| Git working tree | Single tree | Uncommitted conflicts |
| Progress tracking | Single `progress.md` | Interleaved entries |

---

## Proposed Solution: Stream-Based Worktrees

### Core Concept

A **Stream** is an isolated execution context consisting of:
- A Git Worktree (separate working directory)
- A feature branch
- An assigned subset of stories (by ID or path pattern)
- Independent `.ralph/` state
- Its own Ralph loop process

```
                    ┌─────────────────────────────────────────┐
                    │           Main Repository               │
                    │  .git/  (shared object store)           │
                    └─────────────────────────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
    ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
    │   Stream A    │         │   Stream B    │         │   Stream C    │
    │ (worktree)    │         │ (worktree)    │         │ (worktree)    │
    ├───────────────┤         ├───────────────┤         ├───────────────┤
    │ Branch:       │         │ Branch:       │         │ Branch:       │
    │ ralph/auth    │         │ ralph/api     │         │ ralph/ui      │
    ├───────────────┤         ├───────────────┤         ├───────────────┤
    │ Stories:      │         │ Stories:      │         │ Stories:      │
    │ US-001        │         │ US-004        │         │ US-007        │
    │ US-002        │         │ US-005        │         │ US-008        │
    │ US-003        │         │ US-006        │         │ US-009        │
    ├───────────────┤         ├───────────────┤         ├───────────────┤
    │ .ralph/       │         │ .ralph/       │         │ .ralph/       │
    │ (isolated)    │         │ (isolated)    │         │ (isolated)    │
    └───────────────┘         └───────────────┘         └───────────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      │
                                      ▼
                            ┌───────────────────┐
                            │  Merge to Main    │
                            │  (orchestrated)   │
                            └───────────────────┘
```

### Stream Configuration

Streams are defined in a new configuration file:

```yaml
# .ralph/streams.yaml
version: 1

streams:
  auth:
    branch: ralph/auth
    stories:
      - US-001
      - US-002
      - US-003
    paths:
      - src/auth/**
      - src/middleware/auth*

  api:
    branch: ralph/api
    stories:
      - US-004
      - US-005
      - US-006
    paths:
      - src/api/**
      - src/routes/**

  frontend:
    branch: ralph/ui
    stories:
      - US-007
      - US-008
      - US-009
    paths:
      - src/components/**
      - src/pages/**

settings:
  base_branch: main
  worktree_dir: .ralph/worktrees
  merge_strategy: rebase  # or merge, squash
  auto_merge: false
```

---

## Architecture

### State Diagram: Stream Lifecycle

```
                              ┌─────────────┐
                              │   DEFINED   │
                              │ (in config) │
                              └──────┬──────┘
                                     │
                              ralph stream init
                                     │
                                     ▼
                              ┌─────────────┐
                              │  INITIALIZED│
                              │ (worktree   │
                              │  created)   │
                              └──────┬──────┘
                                     │
                              ralph stream start <name>
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                           RUNNING                                   │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ Select   │───▶│ Execute  │───▶│ Commit   │───▶│ Update   │──┐  │
│  │ Story    │    │ Agent    │    │ Changes  │    │ State    │  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │  │
│       ▲                                                         │  │
│       └─────────────────────────────────────────────────────────┘  │
│                         (more stories)                              │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                         (all stories done)
                                │
                                ▼
                         ┌─────────────┐
                         │  COMPLETED  │
                         │ (ready to   │
                         │  merge)     │
                         └──────┬──────┘
                                │
                         ralph stream merge <name>
                                │
                                ▼
                         ┌─────────────┐
                         │   MERGED    │
                         │ (cleanup    │
                         │  optional)  │
                         └─────────────┘
```

### State Diagram: Story Assignment

```
                    ┌─────────────────────────────────────┐
                    │            PRD (Master)              │
                    │  US-001, US-002, ... US-009          │
                    └─────────────────────────────────────┘
                                      │
                              ralph stream init
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
             ┌───────────┐     ┌───────────┐     ┌───────────┐
             │ Stream A  │     │ Stream B  │     │ Stream C  │
             │ PRD copy  │     │ PRD copy  │     │ PRD copy  │
             │           │     │           │     │           │
             │ US-001 [ ]│     │ US-004 [ ]│     │ US-007 [ ]│
             │ US-002 [ ]│     │ US-005 [ ]│     │ US-008 [ ]│
             │ US-003 [ ]│     │ US-006 [ ]│     │ US-009 [ ]│
             │           │     │           │     │           │
             │ (others   │     │ (others   │     │ (others   │
             │  hidden)  │     │  hidden)  │     │  hidden)  │
             └───────────┘     └───────────┘     └───────────┘

   Note: Each stream's PRD only shows its assigned stories.
   Other stories are either removed or marked as "out of scope".
```

### State Diagram: Coordination Lock

```
                         ┌─────────────────┐
                         │  Lock Manager   │
                         │ .ralph/locks/   │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
       ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
       │ stream-a.   │     │ stream-b.   │     │ master.     │
       │ lock        │     │ lock        │     │ lock        │
       │             │     │             │     │             │
       │ owner: PID  │     │ owner: PID  │     │ (merge ops) │
       │ since: ts   │     │ since: ts   │     │             │
       │ story: ID   │     │ story: ID   │     │             │
       └─────────────┘     └─────────────┘     └─────────────┘

   Lock Acquisition Flow:
   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
   │ Request  │────▶│  Check   │────▶│ Acquire  │────▶│ Execute  │
   │ Lock     │     │ Available│     │ (flock)  │     │ Operation│
   └──────────┘     └────┬─────┘     └──────────┘     └────┬─────┘
                         │                                  │
                    (not available)                    (complete)
                         │                                  │
                         ▼                                  ▼
                   ┌──────────┐                       ┌──────────┐
                   │  Wait/   │                       │ Release  │
                   │  Retry   │                       │ Lock     │
                   └──────────┘                       └──────────┘
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Stream Configuration Parser

**File:** `lib/streams.sh` (new)

```bash
# Parse streams.yaml and export stream definitions
parse_streams_config() {
  local config_file="${1:-.ralph/streams.yaml}"
  python3 - "$config_file" <<'PY'
import sys
import yaml
from pathlib import Path

config = yaml.safe_load(Path(sys.argv[1]).read_text())

for name, stream in config.get('streams', {}).items():
    print(f"STREAM_{name.upper()}_BRANCH={stream['branch']}")
    print(f"STREAM_{name.upper()}_STORIES={','.join(stream.get('stories', []))}")
    print(f"STREAM_{name.upper()}_PATHS={','.join(stream.get('paths', []))}")
PY
}
```

#### 1.2 Worktree Manager

**File:** `lib/worktree.sh` (new)

```bash
#!/bin/bash
# Worktree management functions

WORKTREE_BASE="${RALPH_WORKTREE_DIR:-.ralph/worktrees}"

# Create a worktree for a stream
create_stream_worktree() {
  local stream_name="$1"
  local branch_name="$2"
  local base_branch="${3:-main}"
  local worktree_path="$WORKTREE_BASE/$stream_name"

  if [ -d "$worktree_path" ]; then
    echo "Worktree already exists: $worktree_path"
    return 1
  fi

  # Create branch from base if it doesn't exist
  if ! git show-ref --verify --quiet "refs/heads/$branch_name"; then
    git branch "$branch_name" "$base_branch"
  fi

  # Create worktree
  git worktree add "$worktree_path" "$branch_name"

  # Initialize stream-local .ralph directory
  mkdir -p "$worktree_path/.ralph"

  echo "Created worktree at $worktree_path on branch $branch_name"
}

# Remove a worktree
remove_stream_worktree() {
  local stream_name="$1"
  local worktree_path="$WORKTREE_BASE/$stream_name"

  if [ ! -d "$worktree_path" ]; then
    echo "Worktree does not exist: $worktree_path"
    return 1
  fi

  git worktree remove "$worktree_path" --force
  echo "Removed worktree: $worktree_path"
}

# List all stream worktrees
list_stream_worktrees() {
  git worktree list | grep "$WORKTREE_BASE" || echo "No stream worktrees found"
}

# Get worktree status
worktree_status() {
  local stream_name="$1"
  local worktree_path="$WORKTREE_BASE/$stream_name"

  if [ ! -d "$worktree_path" ]; then
    echo "NOT_FOUND"
    return
  fi

  # Check if ralph is running in this worktree
  local lock_file="$worktree_path/.ralph/stream.lock"
  if [ -f "$lock_file" ] && kill -0 "$(cat "$lock_file")" 2>/dev/null; then
    echo "RUNNING"
  elif [ -f "$worktree_path/.ralph/COMPLETE" ]; then
    echo "COMPLETED"
  else
    echo "READY"
  fi
}
```

#### 1.3 Stream-Scoped Story Selection

**Modification to:** `loop.sh`

```bash
# Enhanced select_story() with stream filtering
select_story() {
  local meta_out="$1"
  local block_out="$2"
  local stream_stories="${3:-}"  # Comma-separated list of story IDs

  python3 - "$PRD_PATH" "$meta_out" "$block_out" "$stream_stories" <<'PY'
import json
import re
import sys
from pathlib import Path

prd_path = Path(sys.argv[1])
meta_out = Path(sys.argv[2])
block_out = Path(sys.argv[3])
stream_filter = sys.argv[4].split(',') if len(sys.argv) > 4 and sys.argv[4] else []

text = prd_path.read_text().splitlines()
pattern = re.compile(r'^###\s+(\[(?P<status>[ xX])\]\s+)?(?P<id>US-\d+):\s*(?P<title>.+)$')

stories = []
current = None
for line in text:
    m = pattern.match(line)
    if m:
        if current:
            stories.append(current)
        current = {
            "id": m.group("id"),
            "title": m.group("title").strip(),
            "status": (m.group("status") or " "),
            "lines": [line],
        }
    elif current is not None:
        current["lines"].append(line)
if current:
    stories.append(current)

# Apply stream filter if provided
if stream_filter:
    stories = [s for s in stories if s["id"] in stream_filter]

if not stories:
    meta_out.write_text(json.dumps({
        "ok": False,
        "error": "No stories found for this stream"
    }, indent=2) + "\n")
    block_out.write_text("")
    sys.exit(0)

def is_done(story):
    return str(story.get("status", "")).strip().lower() == "x"

remaining = [s for s in stories if not is_done(s)]
meta = {
    "ok": True,
    "total": len(stories),
    "remaining": len(remaining),
    "stream_filter": stream_filter
}

if remaining:
    target = remaining[0]
    meta.update({
        "id": target["id"],
        "title": target["title"],
    })
    block_out.write_text("\n".join(target["lines"]))
else:
    block_out.write_text("")

meta_out.write_text(json.dumps(meta, indent=2) + "\n")
PY
}
```

### Phase 2: CLI Commands

#### 2.1 New Stream Subcommand

**Addition to:** `bin/ralph`

```javascript
// Add stream command handling
if (cmd === "stream") {
  const subCmd = args[1];

  switch (subCmd) {
    case "init":
      // Initialize all streams from config
      await initStreams();
      break;

    case "start":
      // Start ralph in a specific stream
      const streamName = args[2];
      await startStream(streamName);
      break;

    case "status":
      // Show status of all streams
      await showStreamStatus();
      break;

    case "merge":
      // Merge completed stream to base
      const mergeStream = args[2];
      await mergeStream(mergeStream);
      break;

    case "cleanup":
      // Remove merged stream worktrees
      await cleanupStreams();
      break;

    default:
      console.log("Unknown stream command:", subCmd);
      process.exit(1);
  }
  process.exit(0);
}
```

#### 2.2 CLI Interface

```
ralph stream <command> [options]

Commands:
  init                     Initialize worktrees for all streams in config
  start <name>             Start ralph loop in specified stream
  status                   Show status of all streams
  merge <name>             Merge completed stream to base branch
  merge --all              Merge all completed streams
  cleanup                  Remove merged stream worktrees
  list                     List all configured streams

Options:
  --config <path>          Path to streams.yaml (default: .ralph/streams.yaml)
  --base <branch>          Override base branch for operations
  --force                  Force operation (skip confirmations)

Examples:
  ralph stream init                    # Create worktrees for all streams
  ralph stream start auth              # Run ralph in auth stream
  ralph stream start api &             # Run api stream in background
  ralph stream status                  # Check progress
  ralph stream merge auth              # Merge completed auth work
```

### Phase 3: State Isolation

#### 3.1 Stream-Local State Directory Structure

```
project/
├── .git/                           # Shared Git objects
├── .ralph/
│   ├── streams.yaml                # Stream configuration
│   ├── locks/                      # Coordination locks
│   │   ├── master.lock
│   │   └── merge.lock
│   ├── status/                     # Stream status tracking
│   │   ├── auth.json
│   │   ├── api.json
│   │   └── ui.json
│   └── worktrees/                  # Git worktrees
│       ├── auth/                   # Stream: auth
│       │   ├── .ralph/             # Stream-local state
│       │   │   ├── progress.md
│       │   │   ├── guardrails.md
│       │   │   ├── errors.log
│       │   │   ├── activity.log
│       │   │   ├── IMPLEMENTATION_PLAN.md
│       │   │   ├── runs/
│       │   │   └── stream.lock
│       │   ├── .agents/            # Copied from main
│       │   │   └── tasks/
│       │   │       └── prd.md      # Filtered PRD
│       │   └── src/                # Working copy
│       │       └── auth/
│       ├── api/                    # Stream: api
│       │   └── ... (same structure)
│       └── ui/                     # Stream: ui
│           └── ... (same structure)
├── .agents/
│   ├── ralph/                      # Ralph templates
│   └── tasks/
│       └── prd.md                  # Master PRD
└── src/                            # Main working tree
```

#### 3.2 PRD Filtering for Streams

**File:** `lib/prd-filter.py` (new)

```python
#!/usr/bin/env python3
"""
Filter a PRD to include only stories assigned to a stream.
Other stories are marked as [STREAM: other] and excluded from selection.
"""

import re
import sys
from pathlib import Path


def filter_prd_for_stream(prd_path: Path, stream_stories: list[str], output_path: Path):
    """
    Create a filtered PRD that only includes stories for this stream.
    """
    lines = prd_path.read_text().splitlines()
    pattern = re.compile(r'^(###\s+)(\[[ xX]\]\s+)?(US-\d+):\s*(.+)$')

    output_lines = []
    current_story_id = None
    include_current = True

    for line in lines:
        m = pattern.match(line)
        if m:
            prefix, status, story_id, title = m.groups()
            current_story_id = story_id

            if story_id in stream_stories:
                include_current = True
                output_lines.append(line)
            else:
                include_current = False
                # Add a marker for excluded stories
                output_lines.append(f"<!-- [OUT OF SCOPE] {story_id}: {title} -->")
        elif include_current:
            output_lines.append(line)
        # Skip lines belonging to excluded stories

    output_path.write_text('\n'.join(output_lines) + '\n')
    return len(stream_stories)


if __name__ == "__main__":
    prd_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    stream_stories = sys.argv[3].split(',') if len(sys.argv) > 3 else []

    count = filter_prd_for_stream(prd_path, stream_stories, output_path)
    print(f"Filtered PRD: {count} stories for stream")
```

### Phase 4: Merge Orchestration

#### 4.1 Merge State Machine

```
                              ┌─────────────────┐
                              │ MERGE_REQUESTED │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │ Acquire merge   │
                              │ lock            │
                              └────────┬────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                    (lock acquired)           (lock busy)
                          │                         │
                          ▼                         ▼
                   ┌─────────────┐          ┌─────────────┐
                   │ Fetch base  │          │ Queue for   │
                   │ branch      │          │ retry       │
                   └──────┬──────┘          └─────────────┘
                          │
                   ┌──────▼──────┐
                   │ Rebase      │
                   │ stream      │
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              │                       │
        (no conflicts)          (conflicts)
              │                       │
              ▼                       ▼
       ┌─────────────┐         ┌─────────────┐
       │ Fast-forward│         │ CONFLICT    │
       │ merge       │         │ (manual     │
       └──────┬──────┘         │ resolution) │
              │                └─────────────┘
              ▼
       ┌─────────────┐
       │ Update PRD  │
       │ master      │
       └──────┬──────┘
              │
       ┌──────▼──────┐
       │ Release     │
       │ merge lock  │
       └──────┬──────┘
              │
       ┌──────▼──────┐
       │ MERGED      │
       └─────────────┘
```

#### 4.2 PRD Synchronization

When merging, the master PRD must be updated with completed stories:

**File:** `lib/prd-sync.py` (new)

```python
#!/usr/bin/env python3
"""
Synchronize story completion status from stream PRD back to master PRD.
"""

import re
import sys
from pathlib import Path


def sync_prd_completion(master_prd: Path, stream_prd: Path):
    """
    Update master PRD with completion status from stream PRD.
    """
    pattern = re.compile(r'^(###\s+)\[([xX ])\]\s+(US-\d+):\s*(.+)$')

    # Parse stream PRD for completed stories
    completed = set()
    for line in stream_prd.read_text().splitlines():
        m = pattern.match(line)
        if m and m.group(2).lower() == 'x':
            completed.add(m.group(3))

    if not completed:
        print("No completed stories to sync")
        return 0

    # Update master PRD
    master_lines = master_prd.read_text().splitlines()
    updated_lines = []
    updated_count = 0

    for line in master_lines:
        m = pattern.match(line)
        if m:
            story_id = m.group(3)
            if story_id in completed and m.group(2) != 'x':
                # Mark as complete
                line = f"{m.group(1)}[x] {story_id}: {m.group(4)}"
                updated_count += 1
        updated_lines.append(line)

    master_prd.write_text('\n'.join(updated_lines) + '\n')
    print(f"Synced {updated_count} completed stories to master PRD")
    return updated_count


if __name__ == "__main__":
    master_prd = Path(sys.argv[1])
    stream_prd = Path(sys.argv[2])
    sync_prd_completion(master_prd, stream_prd)
```

#### 4.3 Merge Script

**File:** `lib/merge-stream.sh` (new)

```bash
#!/bin/bash
# Merge a completed stream back to base branch

set -euo pipefail

STREAM_NAME="$1"
BASE_BRANCH="${2:-main}"
WORKTREE_PATH=".ralph/worktrees/$STREAM_NAME"
MERGE_LOCK=".ralph/locks/merge.lock"
MASTER_PRD=".agents/tasks/prd.md"
STREAM_PRD="$WORKTREE_PATH/.agents/tasks/prd.md"

# Verify stream is complete
if [ ! -f "$WORKTREE_PATH/.ralph/COMPLETE" ]; then
  echo "Error: Stream '$STREAM_NAME' is not complete"
  echo "Run 'ralph stream status' to check progress"
  exit 1
fi

# Acquire merge lock
exec 200>"$MERGE_LOCK"
if ! flock -n 200; then
  echo "Error: Another merge is in progress"
  echo "Wait for it to complete or check: $MERGE_LOCK"
  exit 1
fi

echo "Acquired merge lock"

# Get stream branch
STREAM_BRANCH=$(git -C "$WORKTREE_PATH" branch --show-current)

# Fetch latest base
echo "Fetching latest $BASE_BRANCH..."
git fetch origin "$BASE_BRANCH"

# Rebase stream on base
echo "Rebasing $STREAM_BRANCH on $BASE_BRANCH..."
cd "$WORKTREE_PATH"
if ! git rebase "origin/$BASE_BRANCH"; then
  echo ""
  echo "Error: Rebase conflicts detected"
  echo ""
  echo "To resolve:"
  echo "  1. cd $WORKTREE_PATH"
  echo "  2. Resolve conflicts"
  echo "  3. git rebase --continue"
  echo "  4. cd - && ralph stream merge $STREAM_NAME"
  echo ""
  echo "Or to abort:"
  echo "  cd $WORKTREE_PATH && git rebase --abort"
  exit 1
fi
cd - > /dev/null

# Merge to base branch
echo "Merging $STREAM_BRANCH to $BASE_BRANCH..."
git checkout "$BASE_BRANCH"
git merge --ff-only "$STREAM_BRANCH"

# Sync PRD completion status
echo "Syncing PRD completion status..."
python3 lib/prd-sync.py "$MASTER_PRD" "$STREAM_PRD"

# Commit PRD update
if ! git diff --quiet "$MASTER_PRD"; then
  git add "$MASTER_PRD"
  git commit -m "chore(prd): sync completion from stream $STREAM_NAME"
fi

# Update stream status
cat > ".ralph/status/$STREAM_NAME.json" <<EOF
{
  "status": "merged",
  "merged_at": "$(date -Iseconds)",
  "base_branch": "$BASE_BRANCH",
  "final_commit": "$(git rev-parse HEAD)"
}
EOF

echo ""
echo "Successfully merged stream '$STREAM_NAME' to $BASE_BRANCH"
echo ""
echo "Next steps:"
echo "  - Push changes: git push origin $BASE_BRANCH"
echo "  - Cleanup worktree: ralph stream cleanup $STREAM_NAME"

# Release merge lock (automatic on script exit via fd 200)
```

### Phase 5: Status Dashboard

#### 5.1 Stream Status Command

**File:** `lib/stream-status.sh` (new)

```bash
#!/bin/bash
# Display status of all streams

print_status_line() {
  local name="$1"
  local status="$2"
  local progress="$3"
  local branch="$4"

  local color
  case "$status" in
    RUNNING)   color="\033[0;33m" ;;  # Yellow
    COMPLETED) color="\033[0;32m" ;;  # Green
    MERGED)    color="\033[0;34m" ;;  # Blue
    ERROR)     color="\033[0;31m" ;;  # Red
    *)         color="\033[0m"    ;;  # Default
  esac

  printf "  %-12s ${color}%-10s\033[0m  %-12s  %s\n" "$name" "$status" "$progress" "$branch"
}

echo ""
echo "Ralph Multi-Stream Status"
echo "════════════════════════════════════════════════════════════"
printf "  %-12s %-10s  %-12s  %s\n" "STREAM" "STATUS" "PROGRESS" "BRANCH"
echo "────────────────────────────────────────────────────────────"

for status_file in .ralph/status/*.json; do
  [ -f "$status_file" ] || continue

  name=$(basename "$status_file" .json)
  status=$(python3 -c "import json; print(json.load(open('$status_file')).get('status', 'UNKNOWN'))")

  worktree=".ralph/worktrees/$name"
  if [ -d "$worktree" ]; then
    branch=$(git -C "$worktree" branch --show-current 2>/dev/null || echo "-")

    # Count stories
    total=$(grep -c '### \[' "$worktree/.agents/tasks/prd.md" 2>/dev/null || echo 0)
    done=$(grep -c '### \[x\]' "$worktree/.agents/tasks/prd.md" 2>/dev/null || echo 0)
    progress="$done/$total"
  else
    branch="-"
    progress="-"
  fi

  print_status_line "$name" "$status" "$progress" "$branch"
done

echo "────────────────────────────────────────────────────────────"
echo ""
```

Output example:

```
Ralph Multi-Stream Status
════════════════════════════════════════════════════════════
  STREAM       STATUS      PROGRESS      BRANCH
────────────────────────────────────────────────────────────
  auth         COMPLETED   3/3           ralph/auth
  api          RUNNING     1/3           ralph/api
  frontend     READY       0/3           ralph/ui
────────────────────────────────────────────────────────────
```

---

## Coordination Protocol

### Lock Types

| Lock | Purpose | Scope | Duration |
|------|---------|-------|----------|
| `stream-{name}.lock` | Prevent concurrent runs in same stream | Per-stream | While ralph running |
| `merge.lock` | Serialize merge operations | Global | During merge |
| `prd-master.lock` | Protect master PRD writes | Global | During PRD sync |

### Lock Implementation

Using `flock` for POSIX advisory locking:

```bash
# Acquire exclusive lock (blocking)
exec 200>.ralph/locks/stream-auth.lock
flock 200

# Acquire exclusive lock (non-blocking)
exec 200>.ralph/locks/stream-auth.lock
if ! flock -n 200; then
  echo "Stream already running"
  exit 1
fi

# Lock is automatically released when:
# - Script exits
# - File descriptor 200 is closed
```

### Conflict Prevention Rules

1. **Story Assignment is Static**: Once streams.yaml is defined, story assignments don't change
2. **No Cross-Stream Commits**: Each stream only commits to its own branch
3. **Sequential Merges**: Only one merge at a time (merge.lock)
4. **PRD Updates are Atomic**: Master PRD updates happen only during merge
5. **Path Boundaries**: Optional path restrictions warn if changes escape declared paths

---

## Migration Path

### From Single-Stream to Multi-Stream

**Step 1: Create streams.yaml**

```bash
ralph stream generate-config
```

Analyzes PRD and suggests stream groupings based on:
- Story naming patterns (US-AUTH-*, US-API-*, etc.)
- File path analysis from existing plan
- Dependency graph (if available)

**Step 2: Initialize Streams**

```bash
ralph stream init
```

- Creates worktrees for each stream
- Filters PRDs
- Initializes stream-local state

**Step 3: Migrate Existing Progress**

If work is already in progress:
- Copy relevant progress entries to stream
- Copy guardrails and learned signs
- Reset stream to appropriate commit

**Step 4: Start Streams**

```bash
# Option A: Sequential (same machine)
ralph stream start auth
# Wait for completion
ralph stream start api

# Option B: Parallel (background)
ralph stream start auth &
ralph stream start api &
ralph stream start frontend &
wait

# Option C: Distributed (multiple machines)
# Machine 1: ralph stream start auth
# Machine 2: ralph stream start api
# Machine 3: ralph stream start frontend
```

---

## Risks and Mitigations

### Risk 1: Merge Conflicts

**Probability:** Medium
**Impact:** High

**Causes:**
- Stories assigned to wrong stream
- Shared utilities modified by multiple streams
- Incorrect path boundaries

**Mitigations:**
- Conflict detection during `ralph stream init`
- Path overlap warnings in config validation
- Pre-merge conflict check before starting merge
- Clear documentation on stream boundary design

### Risk 2: Orphaned Worktrees

**Probability:** Low
**Impact:** Medium

**Causes:**
- Process killed without cleanup
- Manual intervention breaking state

**Mitigations:**
- `ralph stream cleanup --stale` command
- Worktree health checks in status command
- Git's built-in worktree pruning: `git worktree prune`

### Risk 3: PRD Sync Conflicts

**Probability:** Low
**Impact:** High

**Causes:**
- Manual PRD edits during stream execution
- Multiple streams completing simultaneously

**Mitigations:**
- Master PRD lock during merge
- Sequential merge enforcement
- PRD checksum validation before sync

### Risk 4: Complexity Overhead

**Probability:** Medium
**Impact:** Medium

**Causes:**
- Small projects don't benefit from parallelism
- Learning curve for new concepts

**Mitigations:**
- Multi-stream is opt-in (requires streams.yaml)
- Single-stream mode remains default
- `ralph stream suggest` for guidance on when to use

---

## Success Metrics

| Metric | Current (Single) | Target (Multi-Stream) |
|--------|------------------|----------------------|
| Stories/hour | 1-2 | 3-6 (3 streams) |
| Developer wait time | Full duration | Per-stream duration |
| Merge conflicts | N/A | < 5% of merges |
| Setup time | 0 | < 5 minutes |
| Recovery from failure | Full restart | Per-stream restart |

---

## Implementation Timeline

### Phase 1: Foundation (Core)
- Stream configuration parser
- Worktree manager
- Stream-scoped story selection

### Phase 2: CLI (User Interface)
- `ralph stream` subcommand
- Status dashboard
- Init and start commands

### Phase 3: Coordination (Safety)
- Lock management
- PRD filtering and sync
- Merge orchestration

### Phase 4: Polish (Quality)
- Conflict detection
- Cleanup utilities
- Documentation and examples

---

## Open Questions

1. **Should streams support dependencies?**
   - e.g., "api" stream depends on "auth" completing first
   - Adds complexity but enables more use cases

2. **Should we support stream-level agents?**
   - Different streams using different agents (codex for backend, claude for frontend)
   - Useful for specialized work

3. **How to handle shared test suites?**
   - Tests that span multiple streams
   - Run after merge? Separate test stream?

4. **Should completed streams auto-merge?**
   - Reduces manual intervention
   - Risks unreviewed code landing in main

---

## Appendix A: Example Workflow

```bash
# 1. Define streams based on PRD analysis
cat > .ralph/streams.yaml << 'EOF'
version: 1
streams:
  auth:
    branch: ralph/auth
    stories: [US-001, US-002, US-003]
  api:
    branch: ralph/api
    stories: [US-004, US-005, US-006]
  ui:
    branch: ralph/ui
    stories: [US-007, US-008, US-009]
settings:
  base_branch: main
EOF

# 2. Initialize all streams
ralph stream init

# 3. Check status
ralph stream status
#   STREAM       STATUS      PROGRESS      BRANCH
#   auth         READY       0/3           ralph/auth
#   api          READY       0/3           ralph/api
#   ui           READY       0/3           ralph/ui

# 4. Start streams in parallel
ralph stream start auth &
ralph stream start api &
ralph stream start ui &

# 5. Monitor progress
watch ralph stream status

# 6. Merge completed streams
ralph stream merge auth
ralph stream merge api
ralph stream merge ui

# 7. Push and cleanup
git push origin main
ralph stream cleanup --all

# 8. Verify
ralph stream status
#   STREAM       STATUS      PROGRESS      BRANCH
#   auth         MERGED      3/3           (cleaned)
#   api          MERGED      3/3           (cleaned)
#   ui           MERGED      3/3           (cleaned)
```

---

## Appendix B: Configuration Reference

```yaml
# .ralph/streams.yaml - Full reference

version: 1

streams:
  # Stream name (used in CLI and paths)
  auth:
    # Git branch for this stream
    branch: ralph/auth

    # Stories assigned to this stream (by ID)
    stories:
      - US-001
      - US-002
      - US-003

    # Optional: Path boundaries (warnings if exceeded)
    paths:
      - src/auth/**
      - src/middleware/auth*
      - tests/auth/**

    # Optional: Agent override for this stream
    agent: claude

    # Optional: Max iterations override
    max_iterations: 30

settings:
  # Base branch for worktrees and merges
  base_branch: main

  # Directory for worktrees
  worktree_dir: .ralph/worktrees

  # Merge strategy: rebase, merge, or squash
  merge_strategy: rebase

  # Auto-merge when stream completes (use with caution)
  auto_merge: false

  # Path overlap detection: error, warn, or ignore
  path_overlap: warn

  # Include base .ralph state in new streams
  inherit_guardrails: true
  inherit_progress: false
```

---

## References

- [Git Worktrees Documentation](https://git-scm.com/docs/git-worktree)
- [flock(2) - Linux Manual](https://man7.org/linux/man-pages/man2/flock.2.html)
- Current Ralph Architecture: `.agents/ralph/state-machines.md`
