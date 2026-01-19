/**
 * Nightly Executor
 *
 * Autonomous implementation of AI recommendations:
 * - Creates feature branch
 * - Invokes Claude to implement the recommendation
 * - Runs tests and validation
 * - Creates pull request
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

/**
 * Execution modes
 */
const EXECUTION_MODES = {
  DRY_RUN: "dry-run",        // Generate implementation plan only
  BRANCH_ONLY: "branch",     // Create branch with changes, no PR
  FULL_PR: "pr",             // Full implementation with PR
  AUTO_MERGE: "auto-merge",  // Create and auto-merge PR (dangerous!)
};

/**
 * Generate implementation prompt from recommendation
 */
function generateImplementationPrompt(recommendation, context = {}) {
  const {
    codebaseContext = "",
    constraints = [],
    testRequirements = [],
  } = context;

  return `You are implementing an AI-generated recommendation for a software project.

## Recommendation to Implement

**Title:** ${recommendation.title}

**Summary:** ${recommendation.summary}

**Details:**
${recommendation.details}

**Expected Impact:** ${recommendation.expectedImpact}

## Implementation Steps
${(recommendation.nextSteps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Key Data Points That Led to This Recommendation
${(recommendation.dataPoints || []).map(d => `- ${d}`).join("\n")}

## Codebase Context
${codebaseContext || "No specific context provided. Explore the codebase as needed."}

## Constraints
${constraints.length > 0 ? constraints.map(c => `- ${c}`).join("\n") : "- Follow existing code patterns and conventions\n- Minimize changes to existing functionality\n- Add appropriate tests for new code"}

## Test Requirements
${testRequirements.length > 0 ? testRequirements.map(t => `- ${t}`).join("\n") : "- Ensure all existing tests pass\n- Add unit tests for new functionality if applicable"}

## Instructions

1. Analyze the recommendation and plan the implementation
2. Make minimal, focused changes that address the recommendation
3. Follow the project's coding conventions
4. Ensure the changes don't break existing functionality
5. Add comments where logic isn't self-evident

Implement this recommendation now. Focus on delivering value while minimizing risk.`;
}

/**
 * Create implementation branch
 */
async function createBranch(recommendation, options = {}) {
  const {
    baseBranch = "main",
    branchPrefix = "nightly-impl",
    cwd = process.cwd(),
  } = options;

  // Generate branch name from recommendation title
  const date = new Date().toISOString().split("T")[0];
  const slugTitle = (recommendation.title || "recommendation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");

  const branchName = `${branchPrefix}/${date}-${slugTitle}`;

  try {
    // Ensure we're on the base branch and up to date
    execSync(`git checkout ${baseBranch}`, { cwd, encoding: "utf-8" });
    execSync("git pull", { cwd, encoding: "utf-8" });

    // Create and checkout new branch
    execSync(`git checkout -b "${branchName}"`, { cwd, encoding: "utf-8" });

    return {
      success: true,
      branchName,
      baseBranch,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create branch: ${err.message}`,
    };
  }
}

/**
 * Run Claude to implement the recommendation
 */
async function runImplementation(recommendation, options = {}) {
  const {
    cwd = process.cwd(),
    agent = "claude",
    timeout = 30 * 60 * 1000, // 30 minutes
    verbose = false,
    context = {},
  } = options;

  const prompt = generateImplementationPrompt(recommendation, context);

  // Write prompt to temp file
  const promptFile = path.join(cwd, ".ralph", "nightly-impl-prompt.md");
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  fs.writeFileSync(promptFile, prompt);

  return new Promise((resolve) => {
    // Invoke Claude in headless mode
    const agentCmd = agent === "claude"
      ? ["claude", "-p", "--dangerously-skip-permissions", prompt]
      : agent === "codex"
      ? ["codex", "exec", "--yolo", "--skip-git-repo-check", "-"]
      : ["claude", "-p", "--dangerously-skip-permissions", prompt];

    const child = spawn(agentCmd[0], agentCmd.slice(1), {
      cwd,
      stdio: verbose ? "inherit" : "pipe",
      env: { ...process.env },
    });

    let output = "";
    let errorOutput = "";

    if (!verbose) {
      child.stdout?.on("data", (data) => {
        output += data.toString();
      });
      child.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });
    }

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        success: false,
        error: "Implementation timed out",
        output,
      });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0,
        exitCode: code,
        output,
        errorOutput,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Failed to run agent: ${err.message}`,
      });
    });
  });
}

/**
 * Run validation checks after implementation
 */
async function runValidation(options = {}) {
  const {
    cwd = process.cwd(),
    testCommand = null,
    lintCommand = null,
    buildCommand = null,
  } = options;

  const results = {
    tests: { ran: false, passed: false },
    lint: { ran: false, passed: false },
    build: { ran: false, passed: false },
  };

  // Detect test command
  const effectiveTestCommand = testCommand || detectTestCommand(cwd);
  if (effectiveTestCommand) {
    try {
      execSync(effectiveTestCommand, { cwd, encoding: "utf-8", stdio: "pipe" });
      results.tests = { ran: true, passed: true };
    } catch (err) {
      results.tests = { ran: true, passed: false, error: err.message };
    }
  }

  // Detect lint command
  const effectiveLintCommand = lintCommand || detectLintCommand(cwd);
  if (effectiveLintCommand) {
    try {
      execSync(effectiveLintCommand, { cwd, encoding: "utf-8", stdio: "pipe" });
      results.lint = { ran: true, passed: true };
    } catch (err) {
      results.lint = { ran: true, passed: false, error: err.message };
    }
  }

  // Detect build command
  const effectiveBuildCommand = buildCommand || detectBuildCommand(cwd);
  if (effectiveBuildCommand) {
    try {
      execSync(effectiveBuildCommand, { cwd, encoding: "utf-8", stdio: "pipe" });
      results.build = { ran: true, passed: true };
    } catch (err) {
      results.build = { ran: true, passed: false, error: err.message };
    }
  }

  // Overall pass if all ran checks passed
  const allPassed = Object.values(results).every(r => !r.ran || r.passed);

  return {
    success: allPassed,
    results,
  };
}

/**
 * Detect test command from package.json or common patterns
 */
function detectTestCommand(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
        return "npm test";
      }
    } catch {}
  }

  // Check for common test files/configs
  const testConfigs = [
    "jest.config.js",
    "jest.config.ts",
    "vitest.config.js",
    "vitest.config.ts",
    ".mocharc.js",
    ".mocharc.json",
    "pytest.ini",
    "setup.py",
  ];

  for (const config of testConfigs) {
    if (fs.existsSync(path.join(cwd, config))) {
      if (config.includes("jest")) return "npx jest";
      if (config.includes("vitest")) return "npx vitest run";
      if (config.includes("mocha")) return "npx mocha";
      if (config.includes("pytest") || config === "setup.py") return "pytest";
    }
  }

  return null;
}

/**
 * Detect lint command
 */
function detectLintCommand(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts?.lint) return "npm run lint";
    } catch {}
  }

  if (fs.existsSync(path.join(cwd, ".eslintrc.js")) ||
      fs.existsSync(path.join(cwd, ".eslintrc.json")) ||
      fs.existsSync(path.join(cwd, "eslint.config.js"))) {
    return "npx eslint .";
  }

  return null;
}

/**
 * Detect build command
 */
function detectBuildCommand(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts?.build) return "npm run build";
    } catch {}
  }

  return null;
}

/**
 * Commit changes with recommendation context
 */
async function commitChanges(recommendation, options = {}) {
  const { cwd = process.cwd() } = options;

  try {
    // Stage all changes
    execSync("git add -A", { cwd, encoding: "utf-8" });

    // Check if there are changes to commit
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
    if (!status.trim()) {
      return {
        success: true,
        noChanges: true,
        message: "No changes to commit",
      };
    }

    // Generate commit message
    const title = recommendation.title || "Implement nightly recommendation";
    const commitMessage = `feat: ${title}

Automatically implemented based on AI recommendation.

Priority: ${recommendation.priority || "medium"}
Expected Impact: ${recommendation.expectedImpact || "N/A"}

Generated by Ralph CLI nightly recommendations.`;

    // Commit
    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      cwd,
      encoding: "utf-8",
    });

    return {
      success: true,
      message: "Changes committed",
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to commit: ${err.message}`,
    };
  }
}

/**
 * Create pull request
 */
async function createPullRequest(recommendation, branchInfo, options = {}) {
  const {
    cwd = process.cwd(),
    draft = true,
    reviewers = [],
    labels = ["nightly-recommendation", "automated"],
  } = options;

  try {
    // Push branch
    execSync(`git push -u origin "${branchInfo.branchName}"`, {
      cwd,
      encoding: "utf-8",
    });

    // Generate PR body
    const prBody = `## AI Recommendation Implementation

**Recommendation:** ${recommendation.title}

**Priority:** ${recommendation.priority || "medium"}

### Summary
${recommendation.summary}

### Details
${recommendation.details}

### Expected Impact
${recommendation.expectedImpact || "See recommendation details"}

### Data Points
${(recommendation.dataPoints || []).map(d => `- ${d}`).join("\n")}

---

This PR was automatically created by Ralph CLI's nightly recommendations system.

**Please review carefully before merging.**`;

    // Create PR using gh CLI
    const prTitle = `[Nightly] ${recommendation.title}`;
    const draftFlag = draft ? "--draft" : "";
    const labelFlag = labels.length > 0 ? `--label "${labels.join(",")}"` : "";
    const reviewerFlag = reviewers.length > 0 ? `--reviewer "${reviewers.join(",")}"` : "";

    const ghCommand = `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --base "${branchInfo.baseBranch}" ${draftFlag} ${labelFlag} ${reviewerFlag}`;

    const prUrl = execSync(ghCommand, { cwd, encoding: "utf-8" }).trim();

    return {
      success: true,
      prUrl,
      branchName: branchInfo.branchName,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create PR: ${err.message}`,
    };
  }
}

/**
 * Full execution pipeline
 */
async function execute(recommendation, analysisResult, options = {}) {
  const {
    mode = EXECUTION_MODES.DRY_RUN,
    cwd = process.cwd(),
    baseBranch = "main",
    verbose = false,
    context = {},
    validation = {},
    pr = {},
  } = options;

  const result = {
    mode,
    recommendation: recommendation.title,
    steps: [],
    success: false,
  };

  // Step 1: Create branch (unless dry-run)
  if (mode !== EXECUTION_MODES.DRY_RUN) {
    const branchResult = await createBranch(recommendation, { baseBranch, cwd });
    result.steps.push({ name: "create_branch", ...branchResult });

    if (!branchResult.success) {
      result.error = branchResult.error;
      return result;
    }
    result.branchName = branchResult.branchName;
  }

  // Step 2: Run implementation
  if (mode !== EXECUTION_MODES.DRY_RUN) {
    const implResult = await runImplementation(recommendation, { cwd, verbose, context });
    result.steps.push({ name: "implementation", success: implResult.success });

    if (!implResult.success) {
      result.error = implResult.error || "Implementation failed";
      return result;
    }
  } else {
    // Dry run - just generate the prompt
    const prompt = generateImplementationPrompt(recommendation, context);
    result.implementationPrompt = prompt;
    result.steps.push({ name: "generate_prompt", success: true });
  }

  // Step 3: Run validation
  if (mode !== EXECUTION_MODES.DRY_RUN) {
    const validationResult = await runValidation({ cwd, ...validation });
    result.steps.push({ name: "validation", ...validationResult });

    if (!validationResult.success) {
      result.validationFailed = true;
      // Don't fail entirely - let user decide via PR
    }
    result.validation = validationResult.results;
  }

  // Step 4: Commit changes
  if (mode !== EXECUTION_MODES.DRY_RUN) {
    const commitResult = await commitChanges(recommendation, { cwd });
    result.steps.push({ name: "commit", ...commitResult });

    if (!commitResult.success && !commitResult.noChanges) {
      result.error = commitResult.error;
      return result;
    }

    if (commitResult.noChanges) {
      result.noChanges = true;
    }
  }

  // Step 5: Create PR (if requested)
  if (mode === EXECUTION_MODES.FULL_PR || mode === EXECUTION_MODES.AUTO_MERGE) {
    if (!result.noChanges) {
      const prResult = await createPullRequest(
        recommendation,
        { branchName: result.branchName, baseBranch },
        { cwd, ...pr }
      );
      result.steps.push({ name: "create_pr", ...prResult });

      if (prResult.success) {
        result.prUrl = prResult.prUrl;
      } else {
        result.error = prResult.error;
        return result;
      }
    }
  }

  // Step 6: Auto-merge (if requested and validation passed)
  if (mode === EXECUTION_MODES.AUTO_MERGE && result.prUrl && !result.validationFailed) {
    try {
      execSync(`gh pr merge "${result.prUrl}" --auto --squash`, {
        cwd,
        encoding: "utf-8",
      });
      result.steps.push({ name: "auto_merge", success: true, enabled: true });
    } catch (err) {
      result.steps.push({ name: "auto_merge", success: false, error: err.message });
    }
  }

  result.success = true;
  return result;
}

module.exports = {
  EXECUTION_MODES,
  generateImplementationPrompt,
  createBranch,
  runImplementation,
  runValidation,
  commitChanges,
  createPullRequest,
  execute,
};
