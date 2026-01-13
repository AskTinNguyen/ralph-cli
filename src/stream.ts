/**
 * Ralph Stream Commands - Multi-stream parallel execution
 *
 * Enables running multiple Ralph tasks in parallel using Git Worktrees.
 * Each stream has its own isolated working directory, branch, and .ralph/ state.
 */

import { $ } from "bun"
import { readdir, readFile, mkdir, writeFile, access, rm } from "fs/promises"
import { join } from "path"
import { parse as parseYaml } from "yaml"

// ============================================================================
// Types
// ============================================================================

interface StreamConfig {
  branch: string
  tasks: string[]
  paths?: string[]
}

interface StreamsConfig {
  version: number
  streams: Record<string, StreamConfig>
  settings?: {
    base_branch?: string
    worktree_dir?: string
    merge_strategy?: "rebase" | "merge" | "squash"
    auto_merge?: boolean
  }
}

interface StreamStatus {
  name: string
  status: "not_initialized" | "ready" | "running" | "completed" | "merged"
  branch: string
  worktreePath: string | null
  tasks: string[]
  progress: {
    completed: number
    total: number
  }
}

// ============================================================================
// Constants
// ============================================================================

const RALPH_DIR = ".ralph"
const DEFAULT_STREAMS_PATH = ".ralph/streams.yaml"
const DEFAULT_WORKTREE_DIR = ".ralph/worktrees"
const LOCKS_DIR = ".ralph/locks"

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadStreamsConfig(configPath: string = DEFAULT_STREAMS_PATH): Promise<StreamsConfig | null> {
  try {
    const content = await readFile(configPath, "utf-8")
    return parseYaml(content) as StreamsConfig
  } catch {
    return null
  }
}

async function getWorktreePath(streamName: string, config: StreamsConfig): Promise<string> {
  const worktreeDir = config.settings?.worktree_dir || DEFAULT_WORKTREE_DIR
  return join(process.cwd(), worktreeDir, streamName)
}

async function isStreamRunning(streamName: string): Promise<boolean> {
  const lockPath = join(process.cwd(), LOCKS_DIR, `stream-${streamName}.lock`)
  if (!(await fileExists(lockPath))) {
    return false
  }
  try {
    const pid = await readFile(lockPath, "utf-8")
    // Check if process is still running
    const result = await $`kill -0 ${pid.trim()} 2>/dev/null`.nothrow()
    return result.exitCode === 0
  } catch {
    return false
  }
}

async function acquireStreamLock(streamName: string): Promise<boolean> {
  const locksDir = join(process.cwd(), LOCKS_DIR)
  await mkdir(locksDir, { recursive: true })

  const lockPath = join(locksDir, `stream-${streamName}.lock`)

  // Check if already locked
  if (await isStreamRunning(streamName)) {
    return false
  }

  // Write our PID
  await writeFile(lockPath, process.pid.toString())
  return true
}

async function releaseStreamLock(streamName: string): Promise<void> {
  const lockPath = join(process.cwd(), LOCKS_DIR, `stream-${streamName}.lock`)
  try {
    await rm(lockPath)
  } catch {
    // Ignore if file doesn't exist
  }
}

async function getStreamStatus(streamName: string, config: StreamsConfig): Promise<StreamStatus> {
  const stream = config.streams[streamName]
  if (!stream) {
    return {
      name: streamName,
      status: "not_initialized",
      branch: "",
      worktreePath: null,
      tasks: [],
      progress: { completed: 0, total: 0 }
    }
  }

  const worktreePath = await getWorktreePath(streamName, config)
  const exists = await fileExists(worktreePath)

  if (!exists) {
    return {
      name: streamName,
      status: "not_initialized",
      branch: stream.branch,
      worktreePath: null,
      tasks: stream.tasks,
      progress: { completed: 0, total: stream.tasks.length }
    }
  }

  // Check if running
  const running = await isStreamRunning(streamName)
  if (running) {
    return {
      name: streamName,
      status: "running",
      branch: stream.branch,
      worktreePath,
      tasks: stream.tasks,
      progress: await countStreamProgress(worktreePath, stream.tasks)
    }
  }

  // Check completion
  const progress = await countStreamProgress(worktreePath, stream.tasks)
  const status = progress.completed === progress.total ? "completed" : "ready"

  return {
    name: streamName,
    status,
    branch: stream.branch,
    worktreePath,
    tasks: stream.tasks,
    progress
  }
}

async function countStreamProgress(worktreePath: string, tasks: string[]): Promise<{ completed: number; total: number }> {
  let completed = 0
  for (const taskId of tasks) {
    const statusPath = join(worktreePath, RALPH_DIR, taskId, "status.json")
    try {
      const content = await readFile(statusPath, "utf-8")
      const status = JSON.parse(content)
      if (status.status === "completed") {
        completed++
      }
    } catch {
      // Task may not exist yet
    }
  }
  return { completed, total: tasks.length }
}

// ============================================================================
// Commands
// ============================================================================

export async function cmdStreamInit(): Promise<void> {
  const config = await loadStreamsConfig()
  if (!config) {
    console.error("No streams.yaml found at .ralph/streams.yaml")
    console.log("Create one with the following format:")
    console.log(`
version: 1
streams:
  auth:
    branch: ralph/auth
    tasks: [ralph-1, ralph-2]
  api:
    branch: ralph/api
    tasks: [ralph-3, ralph-4]
settings:
  base_branch: main
`)
    process.exit(1)
  }

  const baseBranch = config.settings?.base_branch || "main"
  console.log(`Initializing streams from ${baseBranch}...`)
  console.log("")

  for (const [streamName, stream] of Object.entries(config.streams)) {
    const worktreePath = await getWorktreePath(streamName, config)

    if (await fileExists(worktreePath)) {
      console.log(`  - ${streamName}: already exists`)
      continue
    }

    // Create branch if it doesn't exist
    const branchExists = await $`git show-ref --verify --quiet refs/heads/${stream.branch}`.nothrow()
    if (branchExists.exitCode !== 0) {
      await $`git branch ${stream.branch} ${baseBranch}`
    }

    // Create worktree
    await $`git worktree add ${worktreePath} ${stream.branch}`

    // Copy guardrails to stream
    const guardrailsPath = join(process.cwd(), RALPH_DIR, "guardrails.md")
    const streamGuardrailsPath = join(worktreePath, RALPH_DIR, "guardrails.md")
    if (await fileExists(guardrailsPath)) {
      await mkdir(join(worktreePath, RALPH_DIR), { recursive: true })
      const guardrails = await readFile(guardrailsPath, "utf-8")
      await writeFile(streamGuardrailsPath, guardrails)
    }

    // Create task directories in stream
    for (const taskId of stream.tasks) {
      const taskDir = join(worktreePath, RALPH_DIR, taskId)
      await mkdir(taskDir, { recursive: true })
    }

    console.log(`  + ${streamName}: created at ${worktreePath}`)
  }

  console.log("")
  console.log("Streams initialized. Start with: ralph stream start <name>")
}

export async function cmdStreamStart(streamName: string): Promise<void> {
  const config = await loadStreamsConfig()
  if (!config) {
    console.error("No streams.yaml found")
    process.exit(1)
  }

  const stream = config.streams[streamName]
  if (!stream) {
    console.error(`Stream not found: ${streamName}`)
    console.log("Available streams:", Object.keys(config.streams).join(", "))
    process.exit(1)
  }

  const worktreePath = await getWorktreePath(streamName, config)
  if (!(await fileExists(worktreePath))) {
    console.error(`Stream not initialized: ${streamName}`)
    console.log("Run: ralph stream init")
    process.exit(1)
  }

  // Acquire lock
  if (!(await acquireStreamLock(streamName))) {
    console.error(`Stream ${streamName} is already running`)
    process.exit(1)
  }

  console.log(`Starting stream: ${streamName}`)
  console.log(`  Branch: ${stream.branch}`)
  console.log(`  Tasks: ${stream.tasks.join(", ")}`)
  console.log(`  Worktree: ${worktreePath}`)
  console.log("")

  try {
    // Run ralph go for each task in sequence
    for (const taskId of stream.tasks) {
      console.log(`Running task: ${taskId}`)

      // Change to worktree directory and run ralph
      const prompt = `/ralph-go ${taskId}`
      const result = await $`cd ${worktreePath} && claude -p ${prompt} --output-format text`.quiet().nothrow()

      const output = result.stdout.toString()
      console.log(output)

      if (output.includes("<promise>COMPLETE")) {
        console.log(`Task ${taskId} completed`)
      } else if (output.includes("NEEDS_HUMAN")) {
        console.log(`Task ${taskId} needs human intervention`)
        break
      } else if (result.exitCode !== 0) {
        console.log(`Task ${taskId} failed`)
        break
      }
    }
  } finally {
    // Release lock
    await releaseStreamLock(streamName)
  }

  console.log("")
  console.log(`Stream ${streamName} finished`)
}

export async function cmdStreamStatus(): Promise<void> {
  const config = await loadStreamsConfig()
  if (!config) {
    console.error("No streams.yaml found")
    process.exit(1)
  }

  console.log("")
  console.log("Ralph Streams Status")
  console.log("=" .repeat(60))
  console.log("")
  console.log("  STREAM        STATUS          PROGRESS    BRANCH")
  console.log("-".repeat(60))

  for (const streamName of Object.keys(config.streams)) {
    const status = await getStreamStatus(streamName, config)

    const statusSymbol: Record<string, string> = {
      not_initialized: "○",
      ready: "◐",
      running: "▶",
      completed: "●",
      merged: "✓"
    }

    const symbol = statusSymbol[status.status] || "?"
    const progressStr = `${status.progress.completed}/${status.progress.total}`

    console.log(
      `  ${symbol} ${streamName.padEnd(12)} ${status.status.padEnd(15)} ${progressStr.padEnd(11)} ${status.branch}`
    )
  }

  console.log("-".repeat(60))
  console.log("")
}

export async function cmdStreamMerge(streamName: string): Promise<void> {
  const config = await loadStreamsConfig()
  if (!config) {
    console.error("No streams.yaml found")
    process.exit(1)
  }

  const stream = config.streams[streamName]
  if (!stream) {
    console.error(`Stream not found: ${streamName}`)
    process.exit(1)
  }

  const status = await getStreamStatus(streamName, config)
  if (status.status !== "completed") {
    console.error(`Stream ${streamName} is not completed (status: ${status.status})`)
    console.log("Complete all tasks before merging")
    process.exit(1)
  }

  const baseBranch = config.settings?.base_branch || "main"
  const mergeStrategy = config.settings?.merge_strategy || "rebase"

  console.log(`Merging stream ${streamName} to ${baseBranch}...`)

  // Acquire merge lock
  const mergeLockPath = join(process.cwd(), LOCKS_DIR, "merge.lock")
  await mkdir(join(process.cwd(), LOCKS_DIR), { recursive: true })

  if (await fileExists(mergeLockPath)) {
    console.error("Another merge is in progress")
    process.exit(1)
  }
  await writeFile(mergeLockPath, process.pid.toString())

  try {
    // Fetch latest base
    console.log(`Fetching ${baseBranch}...`)
    await $`git fetch origin ${baseBranch}`

    // Rebase or merge based on strategy
    if (mergeStrategy === "rebase") {
      console.log(`Rebasing ${stream.branch} on ${baseBranch}...`)
      const worktreePath = status.worktreePath!
      const rebaseResult = await $`cd ${worktreePath} && git rebase origin/${baseBranch}`.nothrow()

      if (rebaseResult.exitCode !== 0) {
        console.error("Rebase failed. Resolve conflicts manually:")
        console.log(`  cd ${worktreePath}`)
        console.log("  # resolve conflicts")
        console.log("  git rebase --continue")
        console.log(`  ralph stream merge ${streamName}`)
        process.exit(1)
      }
    }

    // Switch to base branch and merge
    console.log(`Merging to ${baseBranch}...`)
    await $`git checkout ${baseBranch}`
    await $`git merge --ff-only ${stream.branch}`

    console.log("")
    console.log(`Stream ${streamName} merged successfully`)
    console.log("")
    console.log("Next steps:")
    console.log(`  git push origin ${baseBranch}`)
    console.log(`  ralph stream cleanup ${streamName}`)
  } finally {
    // Release merge lock
    try {
      await rm(mergeLockPath)
    } catch {
      // Ignore
    }
  }
}

export async function cmdStreamCleanup(streamName?: string): Promise<void> {
  const config = await loadStreamsConfig()
  if (!config) {
    console.error("No streams.yaml found")
    process.exit(1)
  }

  const streamsToClean = streamName
    ? [streamName]
    : Object.keys(config.streams)

  for (const name of streamsToClean) {
    const status = await getStreamStatus(name, config)

    if (status.status === "not_initialized") {
      console.log(`  - ${name}: not initialized`)
      continue
    }

    if (status.status === "running") {
      console.log(`  - ${name}: skipped (still running)`)
      continue
    }

    const worktreePath = status.worktreePath!
    console.log(`Removing worktree: ${name}`)

    await $`git worktree remove ${worktreePath} --force`
    console.log(`  + ${name}: removed`)
  }
}

// ============================================================================
// Main export for CLI routing
// ============================================================================

export async function handleStreamCommand(subCmd: string, args: string[]): Promise<void> {
  switch (subCmd) {
    case "init":
      await cmdStreamInit()
      break

    case "start":
      if (!args[0]) {
        console.error("Usage: ralph stream start <stream-name>")
        process.exit(1)
      }
      await cmdStreamStart(args[0])
      break

    case "status":
      await cmdStreamStatus()
      break

    case "merge":
      if (!args[0]) {
        console.error("Usage: ralph stream merge <stream-name>")
        process.exit(1)
      }
      await cmdStreamMerge(args[0])
      break

    case "cleanup":
      await cmdStreamCleanup(args[0])
      break

    default:
      console.log(`Ralph Stream - Multi-stream parallel execution

Usage:
  ralph stream init              Create worktrees from streams.yaml
  ralph stream start <name>      Start Ralph in a stream
  ralph stream status            Show all streams status
  ralph stream merge <name>      Merge completed stream to base
  ralph stream cleanup [name]    Remove worktrees (all if no name)

Configuration:
  Create .ralph/streams.yaml with stream definitions.
`)
  }
}
