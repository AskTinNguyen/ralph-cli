import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "ralph");

run(process.execPath, [cliPath, "--help"]);

const projectRoot = mkdtempSync(path.join(tmpdir(), "ralph-cli-"));
try {
  const outPath = path.join(projectRoot, "prd.md");
  run(process.execPath, [cliPath, "prd", "Smoke test PRD", "--out", outPath], {
    cwd: projectRoot,
    env: { ...process.env, RALPH_DRY_RUN: "1" },
  });

  if (!existsSync(outPath)) {
    console.error("PRD smoke test failed: output not created.");
    process.exit(1);
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("CLI smoke test passed.");
