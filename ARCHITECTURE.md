# Ralph Architecture: Pure Loop vs Context-Based

This document explains the architectural evolution of Ralph from a context-based loop to the pure loop design.

## The Core Philosophy

```bash
while :; do cat prompt.md | agent ; done
```

**Same task. New brain each iteration. Memory is filesystem + git, not chat.**

---

## The Problem: Context Window Exhaustion

The original design relied on Claude's conversation context to manage the loop:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONTEXT-BASED ARCHITECTURE                        │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              SINGLE CLAUDE CONVERSATION                      │   │
│   │                                                              │   │
│   │   Iteration 1 → Iteration 2 → Iteration 3 → ... → Iter N   │   │
│   │                                                              │   │
│   │   ████████████████████████████████████████████████████████  │   │
│   │   ▲                                                      ▲  │   │
│   │   │          CONTEXT WINDOW FILLS UP                     │  │   │
│   │   │                                                      │  │   │
│   │   └──────────────────────────────────────────────────────┘  │   │
│   │                                                              │   │
│   │   Problems:                                                  │   │
│   │   - Context exhaustion after many iterations                 │   │
│   │   - Hallucinated history (Claude "remembers" incorrectly)    │   │
│   │   - Crash = lost all state                                   │   │
│   │   - Hard to debug (state is in chat, not files)              │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Solution: Pure Loop Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PURE LOOP ARCHITECTURE                            │
│                                                                      │
│   EXTERNAL LOOP (ralph.ts)           FILESYSTEM = MEMORY            │
│   ┌──────────────────────┐           ┌───────────────────────┐      │
│   │                      │           │  .ralph/ralph-1/      │      │
│   │  for iteration in    │           │  ├── plan.md          │      │
│   │     1..max_iterations│           │  ├── progress.md  ←───────┐  │
│   │  do                  │           │  └── errors.log   ←───────┤  │
│   │    claude -p ...     │───────────│                       │   │  │
│   │    check output      │           │  + git history        │   │  │
│   │  done                │           └───────────────────────┘   │  │
│   └──────────────────────┘                                       │  │
│            │                                                     │  │
│            ▼                                                     │  │
│   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                │  │
│   │Claude 1│  │Claude 2│  │Claude 3│  │Claude N│                │  │
│   │ FRESH  │  │ FRESH  │  │ FRESH  │  │ FRESH  │                │  │
│   │CONTEXT │  │CONTEXT │  │CONTEXT │  │CONTEXT │                │  │
│   └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘                │  │
│       │           │           │           │                      │  │
│       └───────────┴───────────┴───────────┴──────────────────────┘  │
│                    WRITES TO FILESYSTEM                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Side-by-Side Comparison

```
        CONTEXT-BASED                          PURE LOOP
   ─────────────────────────              ─────────────────────────

   ralph go 1                             ralph go 1
       │                                      │
       ▼                                      ▼
   ┌────────────────────┐                ┌────────────────────┐
   │   claude -p ...    │                │   for i in 1..15   │
   │   (SINGLE CALL)    │                │   do               │
   └────────────────────┘                │     claude -p ...  │ ◄── FRESH
       │                                 │     check signals  │      EACH
       ▼                                 │   done             │      TIME
   ┌────────────────────┐                └────────────────────┘
   │                    │                     │
   │   Claude manages   │                     ▼
   │   its own loop     │                ┌─────────┐ ┌─────────┐
   │   internally       │                │Iteration│ │Iteration│ ...
   │                    │                │    1    │ │    2    │
   │   ┌───┐ ┌───┐     │                └─────────┘ └─────────┘
   │   │ 1 │→│ 2 │→... │                     │           │
   │   └───┘ └───┘     │                     ▼           ▼
   │                    │                ┌─────────────────────┐
   │   Memory = Chat    │                │ Memory = Filesystem │
   └────────────────────┘                │   progress.md       │
                                         │   errors.log        │
                                         │   git commits       │
                                         └─────────────────────┘
```

---

## Code Comparison

### Context-Based (`cmdGo` - original):

```typescript
async function cmdGo(taskIdArg: string): Promise<void> {
  // ...setup...

  // ONE call - Claude handles the loop internally
  const prompt = `/ralph-go ${taskId}`
  const result = await $`claude -p ${prompt}`.quiet().nothrow()

  // Check output once
  if (output.includes("<promise>COMPLETE")) {
    process.exit(0)
  }
}
```

### Pure Loop (`cmdGo` - new):

```typescript
async function cmdGo(taskIdArg: string): Promise<void> {
  // ...setup...

  // EXTERNAL loop - fresh Claude each time
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`Iteration ${iteration}/${maxIterations}`)

    // Fresh Claude invocation - no accumulated context
    const prompt = `/ralph-go ${taskId}`
    const result = await $`claude -p ${prompt} --output-format text`.quiet().nothrow()

    // Check completion signals
    if (output.includes("<promise>COMPLETE")) {
      console.log("\n✓ Task completed successfully")
      process.exit(0)
    }

    if (output.includes("NEEDS_HUMAN")) {
      console.log("\n⚠ Task needs human intervention")
      process.exit(2)
    }

    // Loop continues: new brain, same task, updated filesystem
  }

  console.log(`\n✗ Max iterations reached`)
  process.exit(1)
}
```

---

## Memory Model Comparison

### Context-Based Memory

```
┌────────────────────────────────────────────────────────────────┐
│                    Claude's Context Window                      │
│                                                                 │
│  Iter 1: "I read plan.md, did X, tests passed"                 │
│  Iter 2: "Based on what I did, now I'll do Y"                  │
│  Iter 3: "I remember doing X and Y, now Z"     ← May hallucinate│
│  ...                                                            │
│  Iter N: Context full, summarization, detail loss              │
│                                                                 │
│  Memory lives here ─────────────────────────────────────────── │
└────────────────────────────────────────────────────────────────┘
```

### Pure Loop Memory

```
Iteration 1               Iteration 2               Iteration N
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│Fresh Claude │          │Fresh Claude │          │Fresh Claude │
│             │          │             │          │             │
│ Reads files │          │ Reads files │          │ Reads files │
│ Does 1 step │          │ Does 1 step │          │ Does 1 step │
│ Writes files│          │ Writes files│          │ Writes files│
│ Exits       │          │ Exits       │          │ Exits       │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       ▼                        ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    FILESYSTEM (MEMORY)                        │
│                                                               │
│   progress.md:                                                │
│   ## Iteration 1 - Added route handler                       │
│   ## Iteration 2 - Added tests                               │
│   ## Iteration N - Final validation                          │
│                                                               │
│   Memory lives here ──────────────────────────────────────── │
└──────────────────────────────────────────────────────────────┘
```

---

## Benefits of Pure Loop

| Problem (Context-Based) | Solution (Pure Loop) |
|------------------------|---------------------|
| Context exhaustion after ~15 iterations | Fresh 200K context every iteration |
| Hallucinated history | Must read actual files |
| Crash = lost all state | State persists in filesystem |
| Hard to debug | All state visible in files |
| Can't resume after restart | Resume by re-running loop |

---

## Iteration Lifecycle

```
                    ┌─────────────────────────────────┐
                    │       External Loop (ralph.ts)  │
                    └─────────────────┬───────────────┘
                                      │
                                      ▼
              ┌───────────────────────────────────────────────┐
              │            SINGLE ITERATION                   │
              │                                               │
              │  ┌─────────────────────────────────────────┐  │
              │  │ 1. READ MEMORY (files, not chat)        │  │
              │  │    - plan.md → the goal                 │  │
              │  │    - progress.md → what's done          │  │
              │  │    - errors.log → what failed           │  │
              │  │    - git log → recent commits           │  │
              │  └─────────────────────────────────────────┘  │
              │                      │                        │
              │                      ▼                        │
              │  ┌─────────────────────────────────────────┐  │
              │  │ 2. DECIDE NEXT STEP                     │  │
              │  │    - What criteria are unchecked?       │  │
              │  │    - What was done last?                │  │
              │  │    - What failed?                       │  │
              │  └─────────────────────────────────────────┘  │
              │                      │                        │
              │                      ▼                        │
              │  ┌─────────────────────────────────────────┐  │
              │  │ 3. DO ONE THING                         │  │
              │  │    - Make focused change                │  │
              │  │    - Run test_command                   │  │
              │  └─────────────────────────────────────────┘  │
              │                      │                        │
              │                      ▼                        │
              │  ┌─────────────────────────────────────────┐  │
              │  │ 4. WRITE TO MEMORY                      │  │
              │  │    - Append to progress.md              │  │
              │  │    - git commit                         │  │
              │  │    - (or log errors)                    │  │
              │  └─────────────────────────────────────────┘  │
              │                      │                        │
              │                      ▼                        │
              │  ┌─────────────────────────────────────────┐  │
              │  │ 5. SIGNAL & EXIT                        │  │
              │  │    - COMPLETE → task done               │  │
              │  │    - NEEDS_HUMAN → blocked              │  │
              │  │    - (just exit) → loop continues       │  │
              │  └─────────────────────────────────────────┘  │
              │                                               │
              └───────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │   Loop checks signals, repeats  │
                    │   with FRESH Claude instance    │
                    └─────────────────────────────────┘
```

---

## Completion Signals

| Signal | Meaning | Exit Code |
|--------|---------|-----------|
| `<promise>COMPLETE: {message}</promise>` | Task finished successfully | 0 |
| `<promise>NEEDS_HUMAN: {reason}</promise>` | Blocked, needs intervention | 2 |
| (no signal) | Continue to next iteration | - |
| Max iterations reached | Failed to complete | 1 |

---

## Summary

The pure loop architecture fundamentally changes **where the loop lives**:

| Aspect | Context-Based | Pure Loop |
|--------|---------------|-----------|
| Loop location | Inside Claude's conversation | External script (ralph.ts) |
| Memory | Chat context | Filesystem + git |
| Context per iteration | Accumulated (shrinking) | Fresh 200K each time |
| State visibility | Hidden in conversation | Visible in files |
| Crash recovery | Lost | Resume from files |
| Max iterations | Limited by context | Unlimited |

This simple architectural change enables indefinite task execution without context exhaustion, while making all state visible and debuggable in the filesystem.
