---
name: ralph-stream
description: Manage multi-stream parallel execution. Use when user says "ralph stream", "parallel ralph", "multi-stream", or wants to run multiple tasks in parallel using Git Worktrees.
---

# Ralph Stream - Multi-Stream Parallel Execution

Enable parallel execution of multiple Ralph tasks using Git Worktrees for isolation.

## Usage

```
/ralph-stream <command>
```

Commands:
- `/ralph-stream init` - Initialize worktrees for all streams
- `/ralph-stream start <name>` - Start Ralph in a specific stream
- `/ralph-stream status` - Show status of all streams
- `/ralph-stream merge <name>` - Merge completed stream to base
- `/ralph-stream cleanup` - Remove merged worktrees

## When to Use Multi-Stream

Use multi-stream when:
- You have 3+ independent tasks that don't share code
- Tasks affect different parts of the codebase (e.g., auth vs api vs frontend)
- You want to parallelize work across multiple terminal sessions

Don't use multi-stream when:
- Tasks have dependencies on each other
- Tasks modify the same files
- You're working on a single feature

## Configuration

Create `.ralph/streams.yaml`:

```yaml
version: 1

streams:
  auth:
    branch: ralph/auth
    tasks:
      - ralph-1
      - ralph-2
    paths:                    # Optional: warn if changes escape these paths
      - src/auth/**
      - tests/auth/**

  api:
    branch: ralph/api
    tasks:
      - ralph-3
      - ralph-4
    paths:
      - src/api/**

settings:
  base_branch: main           # Branch to create streams from and merge to
  worktree_dir: .ralph/worktrees  # Where to create worktrees
  merge_strategy: rebase      # rebase, merge, or squash
  auto_merge: false           # Auto-merge when stream completes
```

## Commands

### /ralph-stream init

Creates Git Worktrees for each stream defined in streams.yaml.

**What it does:**
1. Reads streams.yaml configuration
2. For each stream:
   - Creates branch from base_branch if needed
   - Creates worktree at .ralph/worktrees/<stream-name>/
   - Copies guardrails.md to stream
   - Creates task directories

**Example output:**
```
Initializing streams from main...

  + auth: created at .ralph/worktrees/auth
  + api: created at .ralph/worktrees/api

Streams initialized. Start with: ralph stream start <name>
```

### /ralph-stream start <name>

Runs Ralph on all tasks assigned to a stream, in sequence.

**What it does:**
1. Acquires stream lock (prevents concurrent runs)
2. Changes to stream's worktree directory
3. Runs `/ralph-go <task-id>` for each assigned task
4. Stops on NEEDS_HUMAN or failure
5. Releases stream lock

**Example:**
```
Starting stream: auth
  Branch: ralph/auth
  Tasks: ralph-1, ralph-2
  Worktree: .ralph/worktrees/auth

Running task: ralph-1
...
Task ralph-1 completed

Running task: ralph-2
...
Task ralph-2 completed

Stream auth finished
```

### /ralph-stream status

Shows the status of all configured streams.

**Example output:**
```
Ralph Streams Status
============================================================

  STREAM        STATUS          PROGRESS    BRANCH
------------------------------------------------------------
  ● auth        completed       2/2         ralph/auth
  ▶ api         running         1/2         ralph/api
  ○ frontend    not_initialized 0/3         ralph/frontend
------------------------------------------------------------
```

Status symbols:
- ○ not_initialized - Worktree not created yet
- ◐ ready - Worktree exists, not running
- ▶ running - Currently executing
- ● completed - All tasks done
- ✓ merged - Merged to base branch

### /ralph-stream merge <name>

Merges a completed stream's branch back to the base branch.

**Prerequisites:**
- Stream must be completed (all tasks done)
- No other merge in progress

**What it does:**
1. Acquires merge lock
2. Fetches latest base branch
3. Rebases stream branch on base (if using rebase strategy)
4. Fast-forward merges to base branch
5. Releases merge lock

**Example:**
```
Merging stream auth to main...
Fetching main...
Rebasing ralph/auth on main...
Merging to main...

Stream auth merged successfully

Next steps:
  git push origin main
  ralph stream cleanup auth
```

### /ralph-stream cleanup

Removes worktrees for completed/merged streams.

**Usage:**
```
/ralph-stream cleanup           # Remove all non-running streams
/ralph-stream cleanup auth      # Remove specific stream
```

## Parallel Execution Pattern

Run multiple streams in parallel using background processes:

```bash
# Terminal 1
ralph stream start auth

# Terminal 2
ralph stream start api

# Terminal 3
ralph stream start frontend

# Monitor progress
watch ralph stream status
```

Or using shell background:

```bash
ralph stream start auth &
ralph stream start api &
ralph stream start frontend &
wait

ralph stream status
```

## Directory Structure

After `ralph stream init`:

```
.ralph/
├── guardrails.md              # Shared safety rules
├── streams.yaml               # Stream configuration
├── locks/                     # Coordination locks
│   ├── stream-auth.lock       # PID of running auth stream
│   └── merge.lock             # Active merge lock
├── ralph-1/                   # Tasks in main worktree
├── ralph-2/
└── worktrees/                 # Stream worktrees
    ├── auth/                  # auth stream
    │   ├── .ralph/
    │   │   ├── guardrails.md  # Copied from main
    │   │   ├── ralph-1/       # Tasks for this stream
    │   │   └── ralph-2/
    │   └── src/               # Working copy
    └── api/                   # api stream
        ├── .ralph/
        │   └── ...
        └── src/
```

## Coordination & Locks

**Stream locks** prevent running the same stream twice:
- Created at `.ralph/locks/stream-<name>.lock`
- Contains PID of running process
- Auto-released when process exits

**Merge lock** prevents concurrent merges:
- Created at `.ralph/locks/merge.lock`
- Only one merge at a time
- Released after merge completes

## Troubleshooting

### Stream shows "running" but nothing is executing

Check and clear stale lock:
```bash
cat .ralph/locks/stream-<name>.lock  # Get PID
ps -p <pid>                          # Check if process exists
rm .ralph/locks/stream-<name>.lock   # Remove if stale
```

### Merge conflicts

If rebase fails:
```bash
cd .ralph/worktrees/<stream-name>
# Resolve conflicts
git rebase --continue
cd ../..
ralph stream merge <stream-name>
```

### Worktree already exists

```bash
# Remove and recreate
git worktree remove .ralph/worktrees/<stream-name> --force
ralph stream init
```
