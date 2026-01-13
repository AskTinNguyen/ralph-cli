import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "ralph");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function setupTempProject() {
  const base = mkdtempSync(path.join(tmpdir(), "ralph-real-"));
  mkdirSync(path.join(base, ".agents", "tasks"), { recursive: true });
  mkdirSync(path.join(base, ".ralph"), { recursive: true });

  const prd = `# PRD: Real Agent Smoke Test\n\n## 3. User Stories\n\n### [ ] US-001: Create baseline file\n**Description:** As a user, I want a baseline file so the repo has an artifact.\n\n**Acceptance Criteria:**\n- [ ] File \"docs/US-001.txt\" exists with the exact text \"US-001 complete\"\n- [ ] Example: open docs/US-001.txt -> \"US-001 complete\"\n- [ ] Negative case: missing file -> failure\n- [ ] Typecheck/lint passes\n\n### [ ] US-002: Add second artifact\n**Description:** As a user, I want a second artifact to verify multi-story iteration.\n\n**Acceptance Criteria:**\n- [ ] File \"docs/US-002.txt\" exists with the exact text \"US-002 complete\"\n- [ ] Example: open docs/US-002.txt -> \"US-002 complete\"\n- [ ] Negative case: missing file -> failure\n- [ ] Typecheck/lint passes\n\n`;

  writeFileSync(path.join(base, ".agents", "tasks", "prd.md"), prd);

  const agents = `# AGENTS\n\n## Validation\n- For this repo, verify changes with shell checks only.\n- Use commands like: test -f <file>, grep -q \"text\" <file>\n- Do NOT run package manager tests.\n`;

  writeFileSync(path.join(base, "AGENTS.md"), agents);

  run("git", ["init"], { cwd: base });
  run("git", ["config", "user.email", "ralph@example.com"], { cwd: base });
  run("git", ["config", "user.name", "ralph"], { cwd: base });

  return base;
}

function assertAllStoriesComplete(prdPath) {
  const text = readFileSync(prdPath, "utf-8");
  const remaining = text.match(/### \[ \] US-\d+/g);
  if (remaining && remaining.length > 0) {
    throw new Error(`Some stories remain unchecked:\n${remaining.join("\n")}`);
  }
}

function assertPlanHasStories(planPath) {
  const text = readFileSync(planPath, "utf-8");
  if (!text.includes("### US-001") || !text.includes("### US-002")) {
    throw new Error("Plan missing one or more story sections.");
  }
}

function assertCommitted(cwd) {
  const result = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error("Failed to read git history.");
  }
  const count = Number(result.stdout.trim() || "0");
  if (count < 1) {
    throw new Error("Expected at least one commit, found none.");
  }
}

function runForAgent(agent) {
  console.log(`\n=== Real agent test: ${agent} ===`);
  const projectRoot = setupTempProject();
  const env = { ...process.env };

  try {
    run(process.execPath, [cliPath, "plan", "1", `--agent=${agent}`], {
      cwd: projectRoot,
      env,
    });

    const planPath = path.join(projectRoot, ".ralph", "IMPLEMENTATION_PLAN.md");
    if (!existsSync(planPath)) {
      throw new Error("Plan not created.");
    }
    assertPlanHasStories(planPath);

    run(process.execPath, [cliPath, "build", "2", `--agent=${agent}`], {
      cwd: projectRoot,
      env,
    });

    const prdPath = path.join(projectRoot, ".agents", "tasks", "prd.md");
    assertAllStoriesComplete(prdPath);
    assertCommitted(projectRoot);

    const progressPath = path.join(projectRoot, ".ralph", "progress.md");
    if (!existsSync(progressPath)) {
      throw new Error("Progress log not created.");
    }

    console.log(`Agent ${agent} passed.`);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

const agents = ["codex", "claude", "droid"];
for (const agent of agents) {
  runForAgent(agent);
}

console.log("Real agent integration tests passed.");
