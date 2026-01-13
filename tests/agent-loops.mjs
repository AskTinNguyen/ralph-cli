import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const cliPath = path.join(repoRoot, "bin", "ralph");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function commandExists(cmd) {
  const result = spawnSync(`command -v ${cmd}`, { shell: true, stdio: "ignore" });
  return result.status === 0;
}

function setupTempProject() {
  const base = mkdtempSync(path.join(tmpdir(), "ralph-smoke-"));
  mkdirSync(path.join(base, ".agents", "tasks"), { recursive: true });
  mkdirSync(path.join(base, ".ralph"), { recursive: true });
  writeFileSync(
    path.join(base, ".agents", "tasks", "prd.md"),
    `# PRD: Smoke Test\n\n## 3. User Stories\n\n### [ ] US-001: Smoke Test Story\n**Description:** As a user, I want a placeholder story so the loop can run.\n\n**Acceptance Criteria:**\n- [ ] Example: input -> output\n- [ ] Negative case: bad input -> error\n- [ ] Typecheck passes\n\n`,
  );
  writeFileSync(
    path.join(base, ".ralph", "IMPLEMENTATION_PLAN.md"),
    `# Implementation Plan\n\n## Tasks\n### US-001: Smoke Test Story\n- [ ] Placeholder task\n  - Scope: none\n  - Acceptance: none\n  - Verification: none\n`,
  );
  return base;
}

const agents = ["codex", "claude", "droid"];
const integration = process.env.RALPH_INTEGRATION === "1";

for (const agent of agents) {
  const projectRoot = setupTempProject();
  try {
    const env = { ...process.env };
    if (!integration) {
      env.RALPH_DRY_RUN = "1";
    } else if (agent === "codex" && !commandExists("codex")) {
      console.log(`Skipping codex integration test (missing codex).`);
      continue;
    } else if (agent === "claude" && !commandExists("claude")) {
      console.log(`Skipping claude integration test (missing claude).`);
      continue;
    } else if (agent === "droid" && !commandExists("droid")) {
      console.log(`Skipping droid integration test (missing droid).`);
      continue;
    }

    run(process.execPath, [cliPath, "build", "1", "--no-commit", `--agent=${agent}`], {
      cwd: projectRoot,
      env,
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

console.log("Agent loop smoke tests passed.");
