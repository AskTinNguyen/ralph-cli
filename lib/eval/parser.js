/**
 * Run log parser - extracts structured data from run logs and summaries
 */
const fs = require("fs");
const path = require("path");

/**
 * Parse a run summary file (.md) for metadata
 * @param {string} summaryPath - Path to run summary file
 * @returns {object} Parsed metadata
 */
function parseRunSummary(summaryPath) {
  if (!fs.existsSync(summaryPath)) {
    return null;
  }

  const content = fs.readFileSync(summaryPath, "utf-8");
  const lines = content.split("\n");

  const result = {
    runId: null,
    iteration: null,
    mode: null,
    story: null,
    startedAt: null,
    endedAt: null,
    duration: null,
    status: null,
    logPath: null,
    headBefore: null,
    headAfter: null,
    commits: [],
    changedFiles: [],
    uncommittedChanges: [],
  };

  let section = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse header metadata
    if (trimmed.startsWith("- Run ID:")) {
      result.runId = trimmed.replace("- Run ID:", "").trim();
    } else if (trimmed.startsWith("- Iteration:")) {
      result.iteration = parseInt(trimmed.replace("- Iteration:", "").trim(), 10);
    } else if (trimmed.startsWith("- Mode:")) {
      result.mode = trimmed.replace("- Mode:", "").trim();
    } else if (trimmed.startsWith("- Story:")) {
      result.story = trimmed.replace("- Story:", "").trim();
    } else if (trimmed.startsWith("- Started:")) {
      result.startedAt = trimmed.replace("- Started:", "").trim();
    } else if (trimmed.startsWith("- Ended:")) {
      result.endedAt = trimmed.replace("- Ended:", "").trim();
    } else if (trimmed.startsWith("- Duration:")) {
      const durationStr = trimmed.replace("- Duration:", "").trim();
      result.duration = parseInt(durationStr.replace("s", ""), 10);
    } else if (trimmed.startsWith("- Status:")) {
      result.status = trimmed.replace("- Status:", "").trim();
    } else if (trimmed.startsWith("- Log:")) {
      result.logPath = trimmed.replace("- Log:", "").trim();
    } else if (trimmed.startsWith("- Head (before):")) {
      result.headBefore = trimmed.replace("- Head (before):", "").trim();
    } else if (trimmed.startsWith("- Head (after):")) {
      result.headAfter = trimmed.replace("- Head (after):", "").trim();
    }

    // Track sections
    if (trimmed === "### Commits") {
      section = "commits";
    } else if (trimmed === "### Changed Files (commits)") {
      section = "changedFiles";
    } else if (trimmed === "### Uncommitted Changes") {
      section = "uncommittedChanges";
    } else if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      section = null;
    }

    // Parse section items
    if (section && trimmed.startsWith("- ") && trimmed !== "- (none)") {
      const item = trimmed.replace("- ", "");
      if (section === "commits") {
        result.commits.push(item);
      } else if (section === "changedFiles") {
        result.changedFiles.push(item);
      } else if (section === "uncommittedChanges") {
        result.uncommittedChanges.push(item);
      }
    }
  }

  return result;
}

/**
 * Parse a run log file for verification outcomes and patterns
 * @param {string} logPath - Path to run log file
 * @returns {object} Parsed log data
 */
function parseRunLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return null;
  }

  const content = fs.readFileSync(logPath, "utf-8");

  const result = {
    hasComplete: false,
    verificationCommands: [],
    errors: [],
    warnings: [],
    passCount: 0,
    failCount: 0,
  };

  // Check for COMPLETE signal
  result.hasComplete = content.includes("<promise>COMPLETE</promise>");

  // Look for verification patterns like "Command: X -> PASS/FAIL"
  const verifyRegex = /(?:Command|Verification|Test):\s*([^\n]+?)\s*->\s*(PASS|FAIL)/gi;
  let match;
  while ((match = verifyRegex.exec(content)) !== null) {
    const command = match[1].trim();
    const status = match[2].toUpperCase();
    result.verificationCommands.push({ command, status });
    if (status === "PASS") {
      result.passCount++;
    } else {
      result.failCount++;
    }
  }

  // Also check for checkmark patterns (✓ or ✗)
  const checkmarkPassRegex = /[✓✔]\s+(.+)/g;
  const checkmarkFailRegex = /[✗✘×]\s+(.+)/g;

  while ((match = checkmarkPassRegex.exec(content)) !== null) {
    result.passCount++;
  }
  while ((match = checkmarkFailRegex.exec(content)) !== null) {
    result.failCount++;
  }

  // Look for error patterns
  const errorPatterns = [
    /Error:\s*(.+)/gi,
    /error\[\w+\]:\s*(.+)/gi,
    /FAIL:\s*(.+)/gi,
    /failed:\s*(.+)/gi,
    /TypeError:\s*(.+)/gi,
    /ReferenceError:\s*(.+)/gi,
    /SyntaxError:\s*(.+)/gi,
  ];

  for (const pattern of errorPatterns) {
    while ((match = pattern.exec(content)) !== null) {
      result.errors.push(match[1].trim());
    }
  }

  // Look for warning patterns
  const warningPatterns = [
    /Warning:\s*(.+)/gi,
    /warn:\s*(.+)/gi,
  ];

  for (const pattern of warningPatterns) {
    while ((match = pattern.exec(content)) !== null) {
      result.warnings.push(match[1].trim());
    }
  }

  return result;
}

/**
 * List all run summaries in the runs directory
 * @param {string} runsDir - Path to runs directory
 * @returns {string[]} Array of run summary file paths
 */
function listRunSummaries(runsDir) {
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  return fs.readdirSync(runsDir)
    .filter((f) => f.endsWith(".md") && f.startsWith("run-"))
    .map((f) => path.join(runsDir, f))
    .sort();
}

/**
 * Extract run ID from a run file path
 * @param {string} filePath - Path to run file
 * @returns {string|null} Run ID
 */
function extractRunId(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/run-(\d{8}-\d{6}-\d+)/);
  return match ? match[1] : null;
}

module.exports = {
  parseRunSummary,
  parseRunLog,
  listRunSummaries,
  extractRunId,
};
