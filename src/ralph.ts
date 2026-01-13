#!/usr/bin/env bun
/**
 * Ralph CLI - Autonomous Coding Loop
 *
 * A thin wrapper that calls Claude Code with Ralph skills.
 * For interactive use, just run: claude then /ralph-go <id>
 *
 * This script is for headless/scripted execution.
 *
 * Usage:
 *   ralph install             Install skills to current repo
 *   ralph update              Update skills to latest version
 *   ralph new "task"          Create task (prints ID)
 *   ralph list                List tasks
 *   ralph go <task-id>        Run task (headless)
 */

import { $ } from "bun"
import { readdir, readFile, mkdir, writeFile, access, cp, rm } from "fs/promises"
import { join, dirname } from "path"

// Directory where this script lives (for finding bundled skills and templates)
const SCRIPT_DIR = dirname(import.meta.path)
const TEMPLATES_DIR = join(SCRIPT_DIR, "templates")

const RALPH_DIR = ".ralph"

// ============================================================================
// Helpers
// ============================================================================

async function loadTemplate(name: string): Promise<string> {
  const path = join(TEMPLATES_DIR, name)
  return await readFile(path, "utf-8")
}

async function getNextTaskId(workDir: string): Promise<string> {
  try {
    const entries = await readdir(join(workDir, RALPH_DIR), { withFileTypes: true })
    const ids = entries
      .filter(e => e.isDirectory() && /^ralph-\d+$/.test(e.name))
      .map(e => parseInt(e.name.replace("ralph-", ""), 10))
    const max = ids.length > 0 ? Math.max(...ids) : 0
    return `ralph-${max + 1}`
  } catch {
    return "ralph-1"
  }
}

function normalizeId(id: string): string {
  return /^\d+$/.test(id) ? `ralph-${id}` : id
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Commands
// ============================================================================

async function cmdNew(taskName: string): Promise<void> {
  const workDir = process.cwd()
  const taskId = await getNextTaskId(workDir)
  const taskDir = join(workDir, RALPH_DIR, taskId)

  // Create directories
  await mkdir(taskDir, { recursive: true })

  // Create guardrails if first task
  const guardrailsPath = join(workDir, RALPH_DIR, "guardrails.md")
  if (!(await dirExists(guardrailsPath))) {
    const guardrailsTemplate = await loadTemplate("guardrails.md")
    await writeFile(guardrailsPath, guardrailsTemplate)
  }

  // Create plan.md from template
  const planTemplate = await loadTemplate("plan.md")
  const planContent = planTemplate.replace(/\{\{TASK_NAME\}\}/g, taskName)
  await writeFile(join(taskDir, "plan.md"), planContent)

  // Create empty state files
  await writeFile(join(taskDir, "progress.md"), "# Progress\n")
  await writeFile(join(taskDir, "errors.log"), "")

  console.log(`Created task: ${taskId}`)
  console.log(`  ${RALPH_DIR}/${taskId}/plan.md`)
  console.log("")
  console.log("To start:")
  console.log(`  claude then /ralph-go ${taskId.replace("ralph-", "")}`)
  console.log("Or headless:")
  console.log(`  bun ralph.ts go ${taskId.replace("ralph-", "")}`)
}

async function cmdList(): Promise<void> {
  const workDir = process.cwd()
  const ralphDir = join(workDir, RALPH_DIR)

  if (!(await dirExists(ralphDir))) {
    console.log("No .ralph/ directory found.")
    console.log("Run: bun ralph.ts new \"task description\"")
    return
  }

  const entries = await readdir(ralphDir, { withFileTypes: true })
  const tasks = entries
    .filter(e => e.isDirectory() && /^ralph-\d+$/.test(e.name))
    .sort((a, b) => {
      const aNum = parseInt(a.name.replace("ralph-", ""), 10)
      const bNum = parseInt(b.name.replace("ralph-", ""), 10)
      return aNum - bNum
    })

  if (tasks.length === 0) {
    console.log("No tasks found.")
    return
  }

  console.log("Ralph tasks:")
  for (const task of tasks) {
    const planPath = join(ralphDir, task.name, "plan.md")
    const progressPath = join(ralphDir, task.name, "progress.md")

    let taskName = task.name
    let iterations = 0

    try {
      const plan = await readFile(planPath, "utf-8")
      const match = plan.match(/^task:\s*(.+)$/m)
      if (match) taskName = match[1]
    } catch {
      // Plan file may not exist yet
    }

    try {
      const progress = await readFile(progressPath, "utf-8")
      iterations = (progress.match(/## Iteration \d+/g) || []).length
    } catch {
      // Progress file may not exist yet
    }

    console.log(`  ${task.name}: ${taskName} (${iterations} iterations)`)
  }
}

async function cmdGo(taskIdArg: string): Promise<void> {
  const workDir = process.cwd()
  const taskId = normalizeId(taskIdArg)
  const taskDir = join(workDir, RALPH_DIR, taskId)

  if (!(await dirExists(taskDir))) {
    console.error(`Task not found: ${taskId}`)
    await cmdList()
    process.exit(1)
  }

  // Read max_iterations from plan.md
  const planPath = join(taskDir, "plan.md")
  const plan = await readFile(planPath, "utf-8")
  const maxIterMatch = plan.match(/max_iterations:\s*(\d+)/)
  const maxIterations = maxIterMatch ? parseInt(maxIterMatch[1], 10) : 15

  console.log(`Running Ralph on ${taskId}...`)
  console.log(`Max iterations: ${maxIterations}`)
  console.log("")

  // Pure loop: fresh brain each iteration, memory is filesystem + git
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`Iteration ${iteration}/${maxIterations}`)
    console.log(`${"=".repeat(50)}\n`)

    // Fresh Claude invocation each time - no accumulated context
    const prompt = `/ralph-go ${taskId}`
    const result = await $`claude -p ${prompt} --output-format text`.quiet().nothrow()

    const output = result.stdout.toString()
    console.log(output)

    // Check completion signals
    if (output.includes("<promise>COMPLETE")) {
      console.log("\n✓ Task completed successfully")
      process.exit(0)
    }

    if (output.includes("NEEDS_HUMAN")) {
      console.log("\n⚠ Task needs human intervention")
      process.exit(2)
    }

    // If Claude crashed or errored, log it but continue the loop
    if (result.exitCode !== 0) {
      console.log(`\n⚠ Iteration ${iteration} exited with code ${result.exitCode}, continuing...`)
    }

    // Loop continues: new brain, same task, updated filesystem
  }

  console.log(`\n✗ Max iterations (${maxIterations}) reached without completion`)
  process.exit(1)
}

async function cmdInstall(): Promise<void> {
  const workDir = process.cwd()

  // Skills are bundled in ../skills/ relative to this script
  const skillsSource = join(SCRIPT_DIR, "..", "skills")
  const skillsTarget = join(workDir, ".claude", "skills")

  // Check if skills source exists
  if (!(await dirExists(skillsSource))) {
    console.error("Error: Skills not found in package.")
    console.error(`Expected at: ${skillsSource}`)
    process.exit(1)
  }

  // Create target directory
  await mkdir(skillsTarget, { recursive: true })

  // Copy each skill
  const skills = ["ralph-go", "ralph-new", "ralph-plan"]
  for (const skill of skills) {
    const src = join(skillsSource, skill)
    const dest = join(skillsTarget, skill)

    if (await dirExists(src)) {
      await cp(src, dest, { recursive: true })
      console.log(`  ✓ Installed ${skill}`)
    }
  }

  // Create .ralph directory with guardrails
  const ralphDir = join(workDir, RALPH_DIR)
  await mkdir(ralphDir, { recursive: true })

  const guardrailsPath = join(ralphDir, "guardrails.md")
  if (!(await dirExists(guardrailsPath))) {
    const guardrailsTemplate = await loadTemplate("guardrails.md")
    await writeFile(guardrailsPath, guardrailsTemplate)
    console.log(`  ✓ Created ${RALPH_DIR}/guardrails.md`)
  } else {
    console.log(`  - ${RALPH_DIR}/guardrails.md already exists`)
  }

  console.log("")
  console.log("Ralph installed successfully!")
  console.log("")
  console.log("Next steps:")
  console.log("  1. Start Claude Code: claude")
  console.log("  2. Create a task: /ralph-new Add my feature")
  console.log("  3. Run the task: /ralph-go 1")
}

async function cmdUpdate(): Promise<void> {
  const workDir = process.cwd()

  // Skills are bundled in ../skills/ relative to this script
  const skillsSource = join(SCRIPT_DIR, "..", "skills")
  const skillsTarget = join(workDir, ".claude", "skills")

  // Check if skills source exists
  if (!(await dirExists(skillsSource))) {
    console.error("Error: Skills not found in package.")
    console.error(`Expected at: ${skillsSource}`)
    process.exit(1)
  }

  // Check if skills are installed
  const skills = ["ralph-go", "ralph-new", "ralph-plan"]
  let hasExisting = false
  for (const skill of skills) {
    if (await dirExists(join(skillsTarget, skill))) {
      hasExisting = true
      break
    }
  }

  if (!hasExisting) {
    console.log("No Ralph skills found. Running install instead...")
    await cmdInstall()
    return
  }

  console.log("Updating Ralph skills...")
  console.log("")

  // Update each skill (remove old, copy new)
  for (const skill of skills) {
    const src = join(skillsSource, skill)
    const dest = join(skillsTarget, skill)

    if (await dirExists(src)) {
      // Remove existing skill
      if (await dirExists(dest)) {
        await rm(dest, { recursive: true })
      }
      // Copy fresh skill
      await cp(src, dest, { recursive: true })
      console.log(`  ✓ Updated ${skill}`)
    }
  }

  // Update guardrails template (only if user hasn't customized it)
  const guardrailsPath = join(workDir, RALPH_DIR, "guardrails.md")
  if (await dirExists(guardrailsPath)) {
    const currentGuardrails = await readFile(guardrailsPath, "utf-8")
    // Check if it still has the placeholder text (not customized)
    if (currentGuardrails.includes("(Add your project's constraints here)")) {
      const guardrailsTemplate = await loadTemplate("guardrails.md")
      await writeFile(guardrailsPath, guardrailsTemplate)
      console.log(`  ✓ Updated ${RALPH_DIR}/guardrails.md`)
    } else {
      console.log(`  - ${RALPH_DIR}/guardrails.md skipped (customized)`)
    }
  }

  console.log("")
  console.log("Ralph skills updated successfully!")
}

// ============================================================================
// Main
// ============================================================================

const [,, command, ...args] = process.argv

switch (command) {
  case "install":
    await cmdInstall()
    break

  case "update":
    await cmdUpdate()
    break

  case "new":
    if (!args[0]) {
      console.error("Usage: ralph new \"task description\"")
      process.exit(1)
    }
    await cmdNew(args.join(" "))
    break

  case "list":
    await cmdList()
    break

  case "go":
    if (!args[0]) {
      console.error("Usage: ralph go <task-id>")
      process.exit(1)
    }
    await cmdGo(args[0])
    break

  default:
    console.log(`Ralph - Autonomous Coding Loop

Usage:
  ralph install          Install skills to current repo
  ralph update           Update skills to latest version
  ralph new "task"       Create a new task
  ralph list             List all tasks
  ralph go <id>          Run task (headless)

For interactive use:
  claude
  /ralph-go <id>
`)
}
