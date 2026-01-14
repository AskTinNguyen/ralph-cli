/**
 * Interactive setup wizard for ralph init
 *
 * Guides users through project configuration with @clack/prompts
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { detectEnvironment } = require("./detect");

/**
 * Map detected project type to wizard option value
 * @param {string} detectedType - Type from detectEnvironment
 * @returns {string} - Wizard option value
 */
function mapProjectTypeToOption(detectedType) {
  const typeMap = {
    typescript: "nodejs",
    javascript: "nodejs",
    python: "python",
    go: "go",
    rust: "rust",
    ruby: "other",
    java: "other",
    php: "other",
    kotlin: "other",
    swift: "other",
    c: "other",
    cpp: "other",
    elixir: "other",
    dart: "other",
    unknown: "other",
  };
  return typeMap[detectedType] || "other";
}

/**
 * Detect project type from environment detection
 * @param {string} cwd - Current working directory
 * @returns {string} - Detected project type (nodejs, python, go, rust, other)
 */
function detectProjectType(cwd) {
  const env = detectEnvironment(cwd);
  return mapProjectTypeToOption(env.projectType);
}

/**
 * Check if an agent command is available
 * @param {string} agentName - Agent name (claude, codex, droid)
 * @returns {{ installed: boolean, path: string | null, installCmd: string }}
 */
function checkAgentInstalled(agentName) {
  const binName = agentName === "droid" ? "factory" : agentName;

  // Check if command exists
  const result = spawnSync("command", ["-v", binName], {
    shell: true,
    encoding: "utf-8",
  });

  const installed = result.status === 0;
  const agentPath = installed ? (result.stdout || "").trim() : null;

  // Install commands
  const installCommands = {
    claude: "npm install -g @anthropic-ai/claude-code",
    codex: "npm install -g @openai/codex",
    droid: "npm install -g @anthropic-ai/droid",
  };

  return {
    installed,
    path: agentPath,
    installCmd: installCommands[agentName] || `npm install -g ${agentName}`,
  };
}

/**
 * Check git working tree status
 * @param {string} cwd - Current working directory
 * @returns {{ hasGit: boolean, isClean: boolean, changedFiles: string[] }}
 */
function checkGitStatus(cwd) {
  // Check if .git exists
  const gitDir = path.join(cwd, ".git");
  if (!fs.existsSync(gitDir)) {
    // Check for worktree format
    if (fs.existsSync(gitDir)) {
      const content = fs.readFileSync(gitDir, "utf-8").trim();
      if (!content.startsWith("gitdir:")) {
        return { hasGit: false, isClean: true, changedFiles: [] };
      }
    } else {
      return { hasGit: false, isClean: true, changedFiles: [] };
    }
  }

  // Run git status --porcelain
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return { hasGit: false, isClean: true, changedFiles: [] };
  }

  const output = result.stdout || "";
  const changedFiles = output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3)); // Remove status prefix

  return {
    hasGit: true,
    isClean: changedFiles.length === 0,
    changedFiles,
  };
}

/**
 * Test agent connectivity by sending a ping prompt
 * @param {string} agentName - Agent name (claude, codex, droid)
 * @returns {{ success: boolean, error: string | null }}
 */
function testAgentConnectivity(agentName) {
  // Agent command templates (matching bin/ralph agentMap)
  const agentMap = {
    claude: "claude --print-code -p {prompt}",
    codex: "codex -q -a full-auto --context-file {prompt}",
    droid: "factory run --quiet --prompt-file {prompt}",
  };

  const agentCmd = agentMap[agentName];
  if (!agentCmd) {
    return { success: false, error: `Unknown agent: ${agentName}` };
  }

  const agentBin = agentCmd.split(" ")[0];

  // Check if binary exists first
  const existsResult = spawnSync(`command -v ${agentBin}`, {
    shell: true,
    stdio: "ignore",
  });

  if (existsResult.status !== 0) {
    return { success: false, error: `Agent command not found: ${agentBin}` };
  }

  // Create temporary prompt file
  const promptFile = path.join(os.tmpdir(), `ralph-ping-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, "Reply with <end>pong</end> only.");

  try {
    const escapePath = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
    const rendered = agentCmd.includes("{prompt}")
      ? agentCmd.replace(/\{prompt\}/g, escapePath(promptFile))
      : `cat ${escapePath(promptFile)} | ${agentCmd}`;

    const result = spawnSync(rendered, {
      shell: true,
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout
    });

    const output = `${result.stdout || ""}${result.stderr || ""}`;

    if (!output.includes("<end>pong</end>")) {
      return {
        success: false,
        error: `Ping failed: missing <end>pong</end> in response`,
      };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(promptFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Validate API keys for the selected agent
 * @param {string} agentName - Agent name (claude, codex, droid)
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateApiKeys(agentName) {
  const result = { valid: true, missing: [], warnings: [] };

  // API key environment variable requirements per agent
  const apiKeyRequirements = {
    claude: {
      envVars: ["ANTHROPIC_API_KEY"],
      name: "Anthropic API Key",
      setupUrl: "https://console.anthropic.com/settings/keys",
    },
    codex: {
      envVars: ["OPENAI_API_KEY"],
      name: "OpenAI API Key",
      setupUrl: "https://platform.openai.com/api-keys",
    },
    droid: {
      envVars: ["ANTHROPIC_API_KEY"],
      name: "Anthropic API Key",
      setupUrl: "https://console.anthropic.com/settings/keys",
    },
  };

  const requirements = apiKeyRequirements[agentName];
  if (!requirements) {
    return result;
  }

  for (const envVar of requirements.envVars) {
    const value = process.env[envVar];
    if (!value || value.trim().length === 0) {
      result.valid = false;
      result.missing.push(envVar);
      result.warnings.push(`Missing ${requirements.name}: Set ${envVar} environment variable`);
      result.warnings.push(`  Get your key at: ${requirements.setupUrl}`);
    }
  }

  return result;
}

/**
 * Find the next available PRD number
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {number} - Next PRD number (1 if no PRDs exist)
 */
function getNextPrdNumber(ralphDir) {
  if (!fs.existsSync(ralphDir)) {
    return 1;
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdNumbers = entries
    .filter((e) => e.isDirectory() && /^PRD-\d+$/.test(e.name))
    .map((e) => parseInt(e.name.replace("PRD-", ""), 10))
    .filter((n) => !isNaN(n));

  if (prdNumbers.length === 0) {
    return 1;
  }

  return Math.max(...prdNumbers) + 1;
}

/**
 * Generate a sample PRD from user description
 * @param {string} description - User's project description
 * @param {string} projectType - Selected project type
 * @returns {string} - Generated PRD content
 */
function generateSamplePRD(description, projectType) {
  // Map project type to readable name
  const typeNames = {
    nodejs: "Node.js/TypeScript",
    python: "Python",
    go: "Go",
    rust: "Rust",
    other: "General",
  };
  const typeName = typeNames[projectType] || "General";

  return `# PRD: ${description}

## Overview

${description}

## Problem Statement

<!-- Describe the problem this project solves -->
This project addresses the need for...

## Technical Approach

- **Stack**: ${typeName}
- **Architecture**: <!-- Describe high-level architecture -->

## User Stories

### [ ] US-001: Core Feature
**As a** user
**I want** the main functionality
**So that** I can achieve my goal

#### Acceptance Criteria
- [ ] Basic functionality works as expected
- [ ] Error handling is in place
- [ ] Tests pass

### [ ] US-002: Secondary Feature
**As a** user
**I want** additional functionality
**So that** I have a better experience

#### Acceptance Criteria
- [ ] Feature is implemented
- [ ] Documentation is updated

## Success Metrics

- Project compiles/runs without errors
- Core features work as described
- Tests pass with good coverage

---
<!--
PRD Structure Guide:
- Overview: Brief description of what you're building
- Problem Statement: Why this project exists
- User Stories: Features broken into user-focused stories
  - Format: As a [role], I want [feature], So that [benefit]
  - Include acceptance criteria for each story
- Success Metrics: How to measure if the project is successful

Tips:
- Keep stories small and focused
- Mark stories [x] when complete
- Run 'ralph plan' to generate implementation tasks
-->
`;
}

/**
 * Create initial configuration file
 * @param {string} cwd - Project root directory
 * @param {Object} config - Configuration options
 * @param {string} config.agent - Selected agent (claude, codex, droid)
 * @param {string} config.projectType - Project type
 * @returns {{ created: boolean, path: string }}
 */
function createConfig(cwd, config) {
  const configDir = path.join(cwd, ".agents", "ralph");
  const configPath = path.join(configDir, "config.sh");

  // Ensure directory exists
  fs.mkdirSync(configDir, { recursive: true });

  // Generate config content
  const content = `# Ralph configuration
# Generated by ralph init

# ─────────────────────────────────────────────────────────────────────────────
# Agent Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Default AI agent for build iterations
DEFAULT_AGENT="${config.agent}"

# ─────────────────────────────────────────────────────────────────────────────
# Project Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Project type detected during init
PROJECT_TYPE="${config.projectType}"

# ─────────────────────────────────────────────────────────────────────────────
# Budget Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Set spending limits to control costs. Budget alerts are shown at 80%, 90%, 100%.
#
# Daily budget limit in USD (resets at midnight):
RALPH_BUDGET_DAILY=25.00

# Monthly budget limit in USD (resets on 1st of month):
RALPH_BUDGET_MONTHLY=500.00
`;

  fs.writeFileSync(configPath, content);

  return { created: true, path: configPath };
}

/**
 * Run the interactive setup wizard
 * @param {string} cwd - Current working directory
 * @returns {Promise<Object>} - Configuration result
 */
async function runWizard(cwd) {
  const { intro, outro, select, confirm, text, isCancel, spinner, note } =
    await import("@clack/prompts");
  const pc = (await import("picocolors")).default;

  intro(pc.cyan("Welcome to Ralph CLI!"));

  // Run environment detection first
  const s = spinner();
  s.start("Detecting environment...");

  const envDetection = detectEnvironment(cwd);
  const detectedType = mapProjectTypeToOption(envDetection.projectType);

  // Build environment summary
  const envSummary = [];
  if (envDetection.manifests.length > 0) {
    envSummary.push(`Manifests: ${envDetection.manifests.join(", ")}`);
  }
  if (envDetection.hasGit) {
    const branch = envDetection.gitBranch ? ` (${envDetection.gitBranch})` : "";
    envSummary.push(`Git: detected${branch}`);
  }
  if (envDetection.hasCICD) {
    envSummary.push(`CI/CD: ${envDetection.ciType}`);
  }

  s.stop(pc.green("Environment detected"));

  // Show detected environment info
  if (envSummary.length > 0) {
    note(envSummary.join("\n"), "Detected Environment");
  }

  // Step 1: Project type selection
  const projectTypeOptions = [
    { value: "nodejs", label: "Node.js / TypeScript" },
    { value: "python", label: "Python" },
    { value: "go", label: "Go" },
    { value: "rust", label: "Rust" },
    { value: "other", label: "Other" },
  ];

  // Move detected type to first position with indicator
  const reorderedOptions = projectTypeOptions.map((opt) => ({
    ...opt,
    label: opt.value === detectedType ? `${opt.label} ${pc.dim("(detected)")}` : opt.label,
  }));

  const projectType = await select({
    message: "What type of project is this?",
    options: reorderedOptions,
    initialValue: detectedType,
  });

  if (isCancel(projectType)) {
    outro("Setup cancelled.");
    return { cancelled: true };
  }

  // Step 2: Agent selection
  const agentType = await select({
    message: "Which AI agent would you like to use?",
    options: [
      {
        value: "claude",
        label: "Claude Code",
        hint: "recommended",
      },
      { value: "codex", label: "Codex" },
      { value: "droid", label: "Droid" },
    ],
    initialValue: "claude",
  });

  if (isCancel(agentType)) {
    outro("Setup cancelled.");
    return { cancelled: true };
  }

  // Step 3: Verify agent installation
  s.start(`Checking ${agentType} installation...`);

  const agentCheck = checkAgentInstalled(agentType);

  if (agentCheck.installed) {
    s.stop(pc.green(`${agentType} detected at ${pc.cyan(agentCheck.path)}`));
  } else {
    s.stop(pc.yellow(`${agentType} not found`));
    note(`To install ${agentType}, run:\n\n  ${pc.cyan(agentCheck.installCmd)}`, "Install Command");
  }

  // Step 4: Create initial configuration
  s.start("Creating configuration...");

  const configResult = createConfig(cwd, {
    agent: agentType,
    projectType: projectType,
  });

  // Ensure .ralph directory exists
  const ralphDir = path.join(cwd, ".ralph");
  fs.mkdirSync(ralphDir, { recursive: true });

  s.stop(pc.green(`Created ${pc.cyan(configResult.path)}`));

  // Show suggested guardrails if any
  if (envDetection.suggestedGuardrails.length > 0) {
    const guardrailsList = envDetection.suggestedGuardrails
      .slice(0, 3) // Show top 3
      .map((g) => `• ${g.name}`)
      .join("\n");
    note(guardrailsList, "Suggested Guardrails");
  }

  // Step 5: First PRD Generation (US-003)
  let prdPath = null;
  let prdCreated = false;

  const wantsPRD = await confirm({
    message: "Would you like to create your first PRD now?",
    initialValue: true,
  });

  if (isCancel(wantsPRD)) {
    outro("Setup cancelled.");
    return { cancelled: true };
  }

  if (wantsPRD) {
    // Prompt: "What would you like to build?"
    const prdDescription = await text({
      message: "What would you like to build?",
      placeholder: "Example: A REST API for managing todo items with SQLite storage",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Please describe what you want to build";
        }
        if (value.trim().length < 10) {
          return "Please provide a more detailed description (at least 10 characters)";
        }
      },
    });

    if (isCancel(prdDescription)) {
      outro("Setup cancelled.");
      return { cancelled: true };
    }

    // Generate sample PRD from description
    const prdNumber = getNextPrdNumber(ralphDir);
    const prdFolder = path.join(ralphDir, `PRD-${prdNumber}`);
    prdPath = path.join(prdFolder, "prd.md");

    fs.mkdirSync(prdFolder, { recursive: true });
    const prdContent = generateSamplePRD(prdDescription.trim(), projectType);
    fs.writeFileSync(prdPath, prdContent);
    prdCreated = true;

    s.start("Creating PRD...");
    s.stop(pc.green(`Created ${pc.cyan(prdPath)}`));

    // Explain PRD structure
    const structureExplanation = [
      `${pc.bold("PRD Structure:")}`,
      `• ${pc.cyan("Overview")} - Brief description of what you're building`,
      `• ${pc.cyan("Problem Statement")} - Why this project exists`,
      `• ${pc.cyan("User Stories")} - Features as user-focused stories`,
      `  Format: As a [role], I want [feature], So that [benefit]`,
      `• ${pc.cyan("Acceptance Criteria")} - Checkboxes for each story`,
      "",
      `${pc.dim("Edit the PRD to add more user stories and details.")}`,
    ].join("\n");
    note(structureExplanation, "PRD Structure");

    // Offer to open PRD in editor
    const wantsEditor = await confirm({
      message: "Would you like to open the PRD in your editor?",
      initialValue: true,
    });

    if (!isCancel(wantsEditor) && wantsEditor) {
      // Try to open in editor
      const editor = process.env.EDITOR || process.env.VISUAL || "code";
      const openResult = spawnSync(editor, [prdPath], {
        stdio: "inherit",
        detached: true,
      });

      if (openResult.error) {
        // Fallback editors
        const fallbackEditors = ["code", "vim", "nano", "vi"];
        let opened = false;
        for (const fallback of fallbackEditors) {
          if (fallback === editor) continue;
          const fallbackResult = spawnSync("command", ["-v", fallback], {
            shell: true,
            encoding: "utf-8",
          });
          if (fallbackResult.status === 0) {
            spawnSync(fallback, [prdPath], {
              stdio: "inherit",
              detached: true,
            });
            opened = true;
            break;
          }
        }
        if (!opened) {
          note(`Could not open editor. Edit the PRD manually at:\n${pc.cyan(prdPath)}`, "Editor");
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // US-004: Configuration Validation
  // ─────────────────────────────────────────────────────────────────────────────

  // Track validation results for final summary
  const validationResults = {
    gitClean: true,
    gitWarning: null,
    agentConnected: agentCheck.installed, // Already checked above
    apiKeysValid: true,
    apiKeyWarnings: [],
  };

  // Step 6a: Check git working tree status
  s.start("Checking git status...");
  const gitStatus = checkGitStatus(cwd);

  if (gitStatus.hasGit) {
    if (gitStatus.isClean) {
      s.stop(pc.green("Git working tree is clean"));
    } else {
      s.stop(pc.yellow("Git has uncommitted changes"));
      validationResults.gitClean = false;
      validationResults.gitWarning = `You have ${gitStatus.changedFiles.length} uncommitted change(s). Consider committing before building.`;

      // Show first few changed files as context
      const filesToShow = gitStatus.changedFiles.slice(0, 5);
      const moreFiles =
        gitStatus.changedFiles.length > 5
          ? `\n  ${pc.dim(`... and ${gitStatus.changedFiles.length - 5} more`)}`
          : "";
      note(
        `${pc.yellow("Warning:")} Uncommitted changes detected:\n` +
          filesToShow.map((f) => `  • ${f}`).join("\n") +
          moreFiles,
        "Git Status"
      );
    }
  } else {
    s.stop(pc.dim("No git repository detected"));
  }

  // Step 6b: Validate API keys
  s.start("Validating API keys...");
  const apiKeyValidation = validateApiKeys(agentType);

  if (apiKeyValidation.valid) {
    s.stop(pc.green("API keys configured"));
  } else {
    s.stop(pc.yellow("API key validation warning"));
    validationResults.apiKeysValid = false;
    validationResults.apiKeyWarnings = apiKeyValidation.warnings;
    note(apiKeyValidation.warnings.join("\n"), "API Keys");
  }

  // Step 6c: Test agent connectivity (if installed)
  let connectivityResult = { success: false, error: null };
  if (agentCheck.installed) {
    const runConnectivityTest = await confirm({
      message: `Would you like to test ${agentType} connectivity? (this may take a moment)`,
      initialValue: false,
    });

    if (!isCancel(runConnectivityTest) && runConnectivityTest) {
      s.start(`Testing ${agentType} connectivity...`);
      connectivityResult = testAgentConnectivity(agentType);

      if (connectivityResult.success) {
        s.stop(pc.green(`${agentType} connectivity OK - ping successful`));
        validationResults.agentConnected = true;
      } else {
        s.stop(pc.yellow(`${agentType} connectivity test failed`));
        validationResults.agentConnected = false;
        note(
          `${pc.yellow("Warning:")} ${connectivityResult.error}\n\nThis may indicate an API key or configuration issue.`,
          "Connectivity Test"
        );
      }
    }
  }

  // Summary
  const summaryLines = [
    `Project type: ${projectType}`,
    `Agent: ${agentType}`,
    `Config: ${configResult.path}`,
  ];
  if (prdCreated && prdPath) {
    summaryLines.push(`PRD: ${prdPath}`);
  }
  if (gitStatus.hasGit) {
    const gitStatusText = gitStatus.isClean ? pc.green("clean") : pc.yellow("uncommitted changes");
    summaryLines.push(`Git: ${gitStatusText}`);
  }
  if (envDetection.hasCICD) {
    summaryLines.push(`CI/CD: ${envDetection.ciType}`);
  }

  // Show validation summary
  const validationSummary = [];
  if (agentCheck.installed) {
    validationSummary.push(`${pc.green("✓")} Agent installed: ${agentCheck.path}`);
  } else {
    validationSummary.push(`${pc.yellow("!")} Agent not installed`);
  }
  if (apiKeyValidation.valid) {
    validationSummary.push(`${pc.green("✓")} API keys configured`);
  } else {
    validationSummary.push(
      `${pc.yellow("!")} API keys: ${apiKeyValidation.missing.join(", ")} missing`
    );
  }
  if (gitStatus.hasGit) {
    if (gitStatus.isClean) {
      validationSummary.push(`${pc.green("✓")} Git working tree clean`);
    } else {
      validationSummary.push(`${pc.yellow("!")} Git has uncommitted changes`);
    }
  }

  summaryLines.push("");
  summaryLines.push(pc.bold("Validation:"));
  summaryLines.push(...validationSummary);

  note(summaryLines.join("\n"), "Configuration");

  // Determine readiness and show appropriate message
  const isFullyReady = agentCheck.installed && apiKeyValidation.valid && gitStatus.isClean;

  const nextCommand = prdCreated
    ? "ralph plan && ralph build 5"
    : "ralph prd && ralph plan && ralph build 5";

  if (isFullyReady) {
    outro(pc.green("Ready to build!") + pc.dim(` Run: ${pc.cyan(nextCommand)}`));
  } else {
    // Show conditional warnings with "Ready to build!" confirmation
    const warnings = [];
    if (!agentCheck.installed) {
      warnings.push(`• Install ${agentType}: ${agentCheck.installCmd}`);
    }
    if (!apiKeyValidation.valid) {
      warnings.push(`• Set missing API keys: ${apiKeyValidation.missing.join(", ")}`);
    }
    if (!gitStatus.isClean && gitStatus.hasGit) {
      warnings.push(`• Consider committing your changes first`);
    }

    if (warnings.length > 0) {
      note(
        `${pc.yellow("Before building, consider addressing:")}\n${warnings.join("\n")}`,
        "Recommendations"
      );
    }

    outro(
      pc.green("Ready to build!") +
        pc.dim(` Run: ${pc.cyan(nextCommand)}`) +
        (warnings.length > 0 ? pc.dim(" (see recommendations above)") : "")
    );
  }

  return {
    cancelled: false,
    projectType,
    agent: agentType,
    agentInstalled: agentCheck.installed,
    configPath: configResult.path,
    prdPath: prdCreated ? prdPath : null,
    prdCreated,
    environment: envDetection,
    validation: {
      gitClean: gitStatus.isClean,
      gitHasRepo: gitStatus.hasGit,
      apiKeysValid: apiKeyValidation.valid,
      agentConnected: validationResults.agentConnected,
    },
  };
}

module.exports = {
  runWizard,
  detectProjectType,
  checkAgentInstalled,
  checkGitStatus,
  testAgentConnectivity,
  validateApiKeys,
  createConfig,
  getNextPrdNumber,
  generateSamplePRD,
};
