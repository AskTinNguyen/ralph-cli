/**
 * Configuration validation checks for ralph doctor
 *
 * Validates .agents/ralph/config.sh and required templates
 */
const fs = require("fs");
const path = require("path");

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Read file contents or return null if not exists
 * @param {string} filePath - Path to file
 * @returns {string|null}
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Required template files that must exist in .agents/ralph/
 */
const REQUIRED_TEMPLATES = [
  { file: "config.sh", description: "Configuration file" },
  { file: "loop.sh", description: "Main execution loop" },
  { file: "PROMPT_build.md", description: "Build prompt template" },
  { file: "PROMPT_plan.md", description: "Plan prompt template" },
];

/**
 * Optional but recommended files
 */
const RECOMMENDED_FILES = [
  { file: "stream.sh", description: "Multi-stream commands" },
  { file: "agents.sh", description: "Agent definitions" },
  { file: "references/GUARDRAILS.md", description: "Guardrails reference" },
];

/**
 * Validate the ralph agent templates directory
 * @param {string} projectPath - Path to project root
 * @returns {object} Validation result
 */
function validateTemplates(projectPath = ".") {
  const agentsDir = path.join(projectPath, ".agents", "ralph");
  const result = {
    name: "Templates Validation",
    path: agentsDir,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    templates: {
      found: [],
      missing: [],
    },
  };

  // Check if .agents/ralph directory exists
  if (!exists(agentsDir)) {
    result.valid = false;
    result.errors.push({
      type: "directory_not_found",
      message: ".agents/ralph/ directory not found",
      suggestion: "Run 'ralph install' to set up the agent templates",
    });
    return result;
  }

  result.exists = true;

  // Check required templates
  for (const template of REQUIRED_TEMPLATES) {
    const templatePath = path.join(agentsDir, template.file);
    if (exists(templatePath)) {
      result.templates.found.push({
        file: template.file,
        path: templatePath,
        description: template.description,
      });
    } else {
      result.valid = false;
      result.templates.missing.push({
        file: template.file,
        description: template.description,
      });
      result.errors.push({
        type: "missing_template",
        message: `Missing required template: ${template.file} (${template.description})`,
        suggestion: "Run 'ralph install' to restore missing templates",
      });
    }
  }

  // Check recommended files
  for (const rec of RECOMMENDED_FILES) {
    const recPath = path.join(agentsDir, rec.file);
    if (!exists(recPath)) {
      result.warnings.push({
        type: "missing_recommended",
        message: `Missing recommended file: ${rec.file} (${rec.description})`,
        suggestion: "Run 'ralph install' to restore missing files",
      });
    }
  }

  return result;
}

/**
 * Validate config.sh syntax and settings
 * @param {string} projectPath - Path to project root
 * @returns {object} Validation result
 */
function validateConfigFile(projectPath = ".") {
  const configPath = path.join(projectPath, ".agents", "ralph", "config.sh");
  const result = {
    name: "Config File Validation",
    path: configPath,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    settings: {},
  };

  const content = readFile(configPath);
  if (!content) {
    result.valid = false;
    result.errors.push({
      type: "file_not_found",
      message: "config.sh not found",
      suggestion: "Run 'ralph install' to create the config file",
    });
    return result;
  }

  result.exists = true;
  const lines = content.split("\n");

  // Parse settings
  const settingPattern = /^([A-Z_]+)=(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Skip comments and empty lines
    if (line.startsWith("#") || line === "") {
      continue;
    }

    const match = line.match(settingPattern);
    if (match) {
      const key = match[1];
      let value = match[2];

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result.settings[key] = value;

      // Validate budget settings
      if (key === "RALPH_BUDGET_DAILY" || key === "RALPH_BUDGET_MONTHLY") {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
          result.warnings.push({
            type: "invalid_budget",
            message: `Invalid budget value for ${key}: ${value}`,
            line: lineNum,
            suggestion: "Budget should be a positive number (e.g., 25.00)",
          });
        }
      }

      // Validate paths exist if they are set
      if (key.endsWith("_PATH") && value && !value.startsWith("$")) {
        const checkPath = path.join(projectPath, value);
        if (!exists(checkPath) && !value.includes("{")) {
          result.warnings.push({
            type: "path_not_found",
            message: `Path configured in ${key} does not exist: ${value}`,
            line: lineNum,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Check for .ralph directory structure
 * @param {string} projectPath - Path to project root
 * @returns {object} Validation result
 */
function validateRalphDirectory(projectPath = ".") {
  const ralphDir = path.join(projectPath, ".ralph");
  const result = {
    name: "Ralph Directory Validation",
    path: ralphDir,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    structure: {
      hasPRDs: false,
      hasGuardrails: false,
      hasLocks: false,
      hasWorktrees: false,
      prdCount: 0,
    },
  };

  if (!exists(ralphDir)) {
    result.warnings.push({
      type: "directory_not_found",
      message: ".ralph/ directory not found (created on first 'ralph prd')",
      suggestion: "Run 'ralph prd' to create a new PRD",
    });
    return result;
  }

  result.exists = true;

  // Check for guardrails.md
  const guardrailsPath = path.join(ralphDir, "guardrails.md");
  result.structure.hasGuardrails = exists(guardrailsPath);
  if (!result.structure.hasGuardrails) {
    result.warnings.push({
      type: "missing_guardrails",
      message: "guardrails.md not found in .ralph/",
      suggestion: "Run a build iteration to create guardrails.md",
    });
  }

  // Check for locks directory
  const locksDir = path.join(ralphDir, "locks");
  result.structure.hasLocks = exists(locksDir);

  // Check for worktrees directory
  const worktreesDir = path.join(ralphDir, "worktrees");
  result.structure.hasWorktrees = exists(worktreesDir);

  // Count PRD directories
  try {
    const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
    const prdDirs = entries.filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name));
    result.structure.prdCount = prdDirs.length;
    result.structure.hasPRDs = prdDirs.length > 0;

    if (!result.structure.hasPRDs) {
      result.warnings.push({
        type: "no_prds",
        message: "No PRD directories found",
        suggestion: "Run 'ralph prd' to create a new PRD",
      });
    }
  } catch (err) {
    result.errors.push({
      type: "read_error",
      message: `Cannot read .ralph directory: ${err.message}`,
    });
    result.valid = false;
  }

  return result;
}

/**
 * Run all configuration checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Aggregated results
 */
function runAllChecks(projectPath = ".") {
  const checks = [];
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  // Validate templates
  const templatesResult = validateTemplates(projectPath);
  checks.push(templatesResult);
  if (templatesResult.valid) {
    passed++;
  } else {
    errors += templatesResult.errors.length;
  }
  warnings += templatesResult.warnings.length;

  // Validate config file
  const configResult = validateConfigFile(projectPath);
  checks.push(configResult);
  if (configResult.valid) {
    passed++;
  } else {
    errors += configResult.errors.length;
  }
  warnings += configResult.warnings.length;

  // Validate .ralph directory
  const ralphDirResult = validateRalphDirectory(projectPath);
  checks.push(ralphDirResult);
  if (ralphDirResult.valid) {
    passed++;
  } else {
    errors += ralphDirResult.errors.length;
  }
  warnings += ralphDirResult.warnings.length;

  return {
    category: "configuration",
    checks,
    passed,
    warnings,
    errors,
    summary: {
      templatesValid: templatesResult.valid,
      configValid: configResult.valid,
      ralphDirExists: ralphDirResult.exists,
      prdCount: ralphDirResult.structure.prdCount,
    },
  };
}

module.exports = {
  validateTemplates,
  validateConfigFile,
  validateRalphDirectory,
  validateConfig: runAllChecks, // Alias for backwards compatibility
  runAllChecks,
  REQUIRED_TEMPLATES,
  RECOMMENDED_FILES,
};
