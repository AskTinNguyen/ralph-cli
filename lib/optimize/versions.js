/**
 * Prompt template version tracking
 *
 * Tracks prompt template versions and their effectiveness metrics.
 * Versions are stored in both the prompt files and metrics.
 */
const fs = require("fs");
const path = require("path");

/**
 * Parse version from a prompt template file
 * @param {string} templatePath - Path to the prompt template file
 * @returns {object|null} Version info or null if not found
 */
function parseVersion(templatePath) {
  if (!fs.existsSync(templatePath)) {
    return null;
  }

  const content = fs.readFileSync(templatePath, "utf-8");
  const lines = content.split("\n");

  // Look for version comment in first 10 lines
  // Format: <!-- Version: 1.0.0 --> or # Version: 1.0.0
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();

    // HTML comment format
    const htmlMatch = line.match(/<!--\s*Version:\s*(\d+\.\d+\.\d+)\s*-->/i);
    if (htmlMatch) {
      return {
        version: htmlMatch[1],
        format: "html",
        line: i,
      };
    }

    // Markdown comment format (after heading)
    const mdMatch = line.match(/^<!--\s*version:\s*(\d+\.\d+\.\d+)\s*-->$/i);
    if (mdMatch) {
      return {
        version: mdMatch[1],
        format: "md-comment",
        line: i,
      };
    }

    // Inline version in first comment line
    const inlineMatch = line.match(/Version:\s*(\d+\.\d+\.\d+)/i);
    if (inlineMatch) {
      return {
        version: inlineMatch[1],
        format: "inline",
        line: i,
      };
    }
  }

  return null;
}

/**
 * Set version in a prompt template file
 * @param {string} templatePath - Path to the prompt template file
 * @param {string} version - Version string (e.g., "1.0.0")
 * @returns {boolean} Success status
 */
function setVersion(templatePath, version) {
  if (!fs.existsSync(templatePath)) {
    return false;
  }

  const content = fs.readFileSync(templatePath, "utf-8");
  const lines = content.split("\n");
  const existingVersion = parseVersion(templatePath);

  if (existingVersion) {
    // Replace existing version
    const versionLine = `<!-- Version: ${version} -->`;
    lines[existingVersion.line] = versionLine;
    fs.writeFileSync(templatePath, lines.join("\n"));
    return true;
  }

  // Add version after the first heading
  const versionLine = `<!-- Version: ${version} -->`;
  let insertAt = 1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ")) {
      insertAt = i + 1;
      break;
    }
  }

  // Insert blank line if needed
  if (lines[insertAt] && lines[insertAt].trim() !== "") {
    lines.splice(insertAt, 0, "", versionLine);
  } else {
    lines.splice(insertAt, 0, versionLine);
  }

  fs.writeFileSync(templatePath, lines.join("\n"));
  return true;
}

/**
 * Increment version number
 * @param {string} version - Current version (e.g., "1.0.0")
 * @param {string} type - Increment type: "major", "minor", or "patch"
 * @returns {string} New version
 */
function incrementVersion(version, type = "patch") {
  const parts = version.split(".").map(Number);

  if (type === "major") {
    return `${parts[0] + 1}.0.0`;
  } else if (type === "minor") {
    return `${parts[0]}.${parts[1] + 1}.0`;
  } else {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

/**
 * Get version metrics path
 * @param {string} projectPath - Path to project
 * @returns {string} Path to version metrics file
 */
function getVersionMetricsPath(projectPath) {
  return path.join(projectPath, ".ralph", "metrics", "prompt-versions.json");
}

/**
 * Load version metrics
 * @param {string} projectPath - Path to project
 * @returns {object} Version metrics object
 */
function loadVersionMetrics(projectPath) {
  const metricsPath = getVersionMetricsPath(projectPath);

  if (!fs.existsSync(metricsPath)) {
    return {
      versions: [],
      currentVersion: null,
      lastUpdated: null,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
  } catch {
    return {
      versions: [],
      currentVersion: null,
      lastUpdated: null,
    };
  }
}

/**
 * Save version metrics
 * @param {object} metrics - Version metrics object
 * @param {string} projectPath - Path to project
 */
function saveVersionMetrics(metrics, projectPath) {
  const metricsPath = getVersionMetricsPath(projectPath);
  const dir = path.dirname(metricsPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
}

/**
 * Record run result for a version
 * @param {string} projectPath - Path to project
 * @param {string} version - Version string
 * @param {object} runResult - Run result { success, duration, mode }
 */
function recordRunResult(projectPath, version, runResult) {
  const metrics = loadVersionMetrics(projectPath);

  // Find or create version entry
  let versionEntry = metrics.versions.find((v) => v.version === version);
  if (!versionEntry) {
    versionEntry = {
      version,
      firstUsed: new Date().toISOString(),
      lastUsed: null,
      runs: 0,
      successCount: 0,
      avgDuration: null,
      modes: {},
    };
    metrics.versions.push(versionEntry);
  }

  // Update metrics
  versionEntry.runs++;
  versionEntry.lastUsed = new Date().toISOString();

  if (runResult.success) {
    versionEntry.successCount++;
  }

  // Update average duration
  if (runResult.duration != null) {
    if (versionEntry.avgDuration == null) {
      versionEntry.avgDuration = runResult.duration;
    } else {
      // Rolling average
      versionEntry.avgDuration = Math.round(
        (versionEntry.avgDuration * (versionEntry.runs - 1) + runResult.duration) /
          versionEntry.runs
      );
    }
  }

  // Track by mode
  const mode = runResult.mode || "unknown";
  if (!versionEntry.modes[mode]) {
    versionEntry.modes[mode] = { runs: 0, success: 0 };
  }
  versionEntry.modes[mode].runs++;
  if (runResult.success) {
    versionEntry.modes[mode].success++;
  }

  metrics.currentVersion = version;
  metrics.lastUpdated = new Date().toISOString();

  saveVersionMetrics(metrics, projectPath);
}

/**
 * Get version effectiveness comparison
 * @param {string} projectPath - Path to project
 * @returns {object[]} Array of version stats sorted by success rate
 */
function getVersionComparison(projectPath) {
  const metrics = loadVersionMetrics(projectPath);

  return metrics.versions
    .map((v) => ({
      version: v.version,
      runs: v.runs,
      successRate: v.runs > 0 ? Math.round((v.successCount / v.runs) * 100) : null,
      avgDuration: v.avgDuration,
      firstUsed: v.firstUsed,
      lastUsed: v.lastUsed,
      isCurrent: v.version === metrics.currentVersion,
    }))
    .sort((a, b) => (b.successRate || 0) - (a.successRate || 0));
}

/**
 * Get all prompt templates in the project
 * @param {string} projectPath - Path to project
 * @returns {object[]} Array of template info
 */
function getPromptTemplates(projectPath) {
  const templates = [];

  // Check local .agents/ralph directory
  const localDir = path.join(projectPath, ".agents", "ralph");
  if (fs.existsSync(localDir)) {
    const files = fs.readdirSync(localDir);
    for (const file of files) {
      if (file.startsWith("PROMPT_") && file.endsWith(".md")) {
        const filePath = path.join(localDir, file);
        const version = parseVersion(filePath);
        templates.push({
          name: file,
          path: filePath,
          version: version?.version || null,
          type: file.replace("PROMPT_", "").replace(".md", ""),
        });
      }
    }
  }

  return templates;
}

/**
 * Initialize versioning for all templates
 * @param {string} projectPath - Path to project
 * @returns {object[]} Array of updated template info
 */
function initializeVersions(projectPath) {
  const templates = getPromptTemplates(projectPath);
  const updated = [];

  for (const template of templates) {
    if (!template.version) {
      setVersion(template.path, "1.0.0");
      updated.push({
        ...template,
        version: "1.0.0",
        action: "initialized",
      });
    } else {
      updated.push({
        ...template,
        action: "exists",
      });
    }
  }

  return updated;
}

module.exports = {
  parseVersion,
  setVersion,
  incrementVersion,
  loadVersionMetrics,
  saveVersionMetrics,
  recordRunResult,
  getVersionComparison,
  getPromptTemplates,
  initializeVersions,
  getVersionMetricsPath,
};
