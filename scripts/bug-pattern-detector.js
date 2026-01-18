#!/usr/bin/env node

/**
 * Bug Pattern Detector - Detects recurring bug patterns and triggers deep dive analysis
 *
 * Part of PRD-112 US-012: Pattern detection and auto-create deep dive issue
 *
 * Features:
 * - Detects patterns: 3+ bugs in same category + module within 30 days
 * - Auto-creates GitHub issue when pattern detected
 * - Title: "[Bug Pattern] {category} in {module}"
 * - Labels: "bug-pattern", "needs-analysis", "deep-dive"
 * - Body includes: pattern summary, similar bugs, recommended actions, timeline
 * - Triggers deep dive factory: .ralph/factory/bug-deep-dive-analysis.yaml
 * - Notifies team in Slack with link to issue
 * - Tracks pattern resolution: auto-close when pattern stops (no new bugs in 60 days)
 *
 * Configuration:
 * - .ralph/automation-config.json for bugWikipedia settings
 * - GITHUB_TOKEN environment variable for issue creation
 * - SLACK_BOT_TOKEN environment variable for notifications
 *
 * Usage:
 * - Manual: node scripts/bug-pattern-detector.js
 * - CLI: ralph automation detect-patterns
 * - Dry run: node scripts/bug-pattern-detector.js --dry-run
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ============================================================================
// Configuration Constants
// ============================================================================

const BUG_WIKIPEDIA_DIR = ".ralph/bug-wikipedia";
const CATEGORIZED_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "categorized");
const PATTERNS_DIR = path.join(BUG_WIKIPEDIA_DIR, "patterns");
const PATTERN_TRACKING_FILE = path.join(PATTERNS_DIR, "tracked-patterns.json");

// Pattern detection thresholds (from PRD-112 US-012)
const PATTERN_THRESHOLD = 3; // Minimum bugs to trigger pattern
const PATTERN_WINDOW_DAYS = 30; // Time window for recent bugs
const PATTERN_RESOLUTION_DAYS = 60; // Days without new bugs before auto-closing

// GitHub issue labels
const GITHUB_ISSUE_LABELS = ["bug-pattern", "needs-analysis", "deep-dive"];

// Factory definition path
const DEEP_DIVE_FACTORY_PATH = ".ralph/factory/bug-deep-dive-analysis.yaml";

// ============================================================================
// Logging Utilities
// ============================================================================

function log(level, message, data = null) {
  const prefix =
    level === "ERROR"
      ? "  ❌"
      : level === "SUCCESS"
      ? "  ✅"
      : level === "WARN"
      ? "  ⚠️"
      : "  ℹ️";

  console.log(`${prefix} ${message}`);

  if (data && process.env.RALPH_DEBUG === "1") {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load automation configuration
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    log("WARN", "Automation config not found, using defaults");
    return {
      bugWikipedia: {
        enabled: true,
        patternThreshold: PATTERN_THRESHOLD,
        patternWindow_days: PATTERN_WINDOW_DAYS,
        autoCreateIssues: true,
        deepDiveFactory: DEEP_DIVE_FACTORY_PATH,
      },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure bugWikipedia exists with defaults
    if (!config.bugWikipedia) {
      config.bugWikipedia = {
        enabled: true,
        patternThreshold: PATTERN_THRESHOLD,
        patternWindow_days: PATTERN_WINDOW_DAYS,
        autoCreateIssues: true,
        deepDiveFactory: DEEP_DIVE_FACTORY_PATH,
      };
    }

    return config;
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Data Loading Functions
// ============================================================================

/**
 * Load all categorized bugs
 */
function loadCategorizedBugs() {
  if (!fs.existsSync(CATEGORIZED_BUGS_DIR)) {
    log("WARN", `Categorized bugs directory not found: ${CATEGORIZED_BUGS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(CATEGORIZED_BUGS_DIR).filter((f) => f.endsWith(".json"));
  const bugs = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(CATEGORIZED_BUGS_DIR, file), "utf-8");
      const bug = JSON.parse(content);
      bugs.push(bug);
    } catch (error) {
      log("ERROR", `Failed to parse ${file}: ${error.message}`);
    }
  }

  return bugs;
}

/**
 * Load tracked patterns (existing patterns)
 */
function loadTrackedPatterns() {
  if (!fs.existsSync(PATTERN_TRACKING_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(PATTERN_TRACKING_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    log("ERROR", `Failed to parse tracked patterns: ${error.message}`);
    return [];
  }
}

/**
 * Save tracked patterns
 */
function saveTrackedPatterns(patterns) {
  // Ensure patterns directory exists
  if (!fs.existsSync(PATTERNS_DIR)) {
    fs.mkdirSync(PATTERNS_DIR, { recursive: true });
  }

  fs.writeFileSync(PATTERN_TRACKING_FILE, JSON.stringify(patterns, null, 2));
  log("INFO", `Saved ${patterns.length} tracked patterns`);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract module name from file path (first 2 directory levels)
 */
function extractModule(filePath) {
  if (!filePath) return "unknown";

  const parts = filePath.split("/");
  if (parts.length <= 1) return "root";

  return parts.slice(0, 2).join("/");
}

/**
 * Check if a bug is within the pattern window (last N days)
 */
function isWithinWindow(bugDate, windowDays) {
  const now = new Date();
  const bugTimestamp = new Date(bugDate);
  const diffDays = (now - bugTimestamp) / (1000 * 60 * 60 * 24);

  return diffDays <= windowDays;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toISOString().split("T")[0];
  } catch {
    return dateStr;
  }
}

// ============================================================================
// Pattern Detection Logic
// ============================================================================

/**
 * Detect recurring bug patterns
 * Groups bugs by (category, module) and finds patterns with 3+ bugs in 30 days
 */
function detectPatterns(bugs, config) {
  const threshold = config.bugWikipedia.patternThreshold || PATTERN_THRESHOLD;
  const windowDays = config.bugWikipedia.patternWindow_days || PATTERN_WINDOW_DAYS;

  log("INFO", `Detecting patterns (threshold: ${threshold}, window: ${windowDays} days)`);

  // Group bugs by (category, module)
  const grouped = bugs.reduce((acc, bug) => {
    const category = bug.primary_category || "uncategorized";
    const files = bug.files_changed || [];

    // Handle each file separately to avoid missing patterns across files
    for (const file of files) {
      const module = extractModule(file);
      const key = `${category}-${module}`;

      if (!acc[key]) {
        acc[key] = {
          category,
          module,
          bugs: [],
        };
      }

      // Avoid duplicates
      if (!acc[key].bugs.find((b) => b.id === bug.id)) {
        acc[key].bugs.push(bug);
      }
    }

    return acc;
  }, {});

  // Find patterns: groups with 3+ bugs in the window
  const patterns = [];

  for (const [key, group] of Object.entries(grouped)) {
    // Filter bugs within time window
    const recentBugs = group.bugs.filter((bug) =>
      isWithinWindow(bug.date_fixed, windowDays)
    );

    if (recentBugs.length >= threshold) {
      // Sort by date (oldest first)
      recentBugs.sort((a, b) => new Date(a.date_fixed) - new Date(b.date_fixed));

      patterns.push({
        key,
        category: group.category,
        module: group.module,
        bug_count: recentBugs.length,
        first_occurrence: recentBugs[0].date_fixed,
        latest_occurrence: recentBugs[recentBugs.length - 1].date_fixed,
        bugs: recentBugs,
      });
    }
  }

  log("SUCCESS", `Detected ${patterns.length} patterns`);
  return patterns;
}

// ============================================================================
// GitHub Issue Creation
// ============================================================================

/**
 * Build GitHub issue body for a pattern
 */
function buildGitHubIssueBody(pattern) {
  let body = `# Bug Pattern Detected\n\n`;
  body += `**Category:** ${pattern.category}\n`;
  body += `**Module:** ${pattern.module}\n`;
  body += `**Occurrences:** ${pattern.bug_count} bugs in last 30 days\n`;
  body += `**First occurrence:** ${formatDate(pattern.first_occurrence)}\n`;
  body += `**Latest occurrence:** ${formatDate(pattern.latest_occurrence)}\n\n`;

  body += `---\n\n`;
  body += `## Pattern Summary\n\n`;
  body += `This bug pattern has been detected in **${pattern.module}** with **${pattern.bug_count}** similar bugs in the **${pattern.category}** category over the last 30 days.\n\n`;

  // Trend analysis
  const trend = pattern.bug_count >= 5 ? "increasing" : "stable";
  body += `**Trend:** ${trend}\n\n`;

  body += `---\n\n`;
  body += `## Similar Bugs\n\n`;

  for (const bug of pattern.bugs) {
    body += `### ${bug.id}\n`;
    body += `- **Date:** ${formatDate(bug.date_fixed)}\n`;
    body += `- **Author:** ${bug.author?.name || "Unknown"}\n`;
    body += `- **Message:** ${bug.commit_message}\n`;
    body += `- **Severity:** ${bug.severity || "N/A"}\n`;
    if (bug.github_commit_url) {
      body += `- **Commit:** [${bug.commit_sha?.substring(0, 7)}](${bug.github_commit_url})\n`;
    }
    if (bug.prevention_tips) {
      body += `- **Prevention tip:** ${bug.prevention_tips}\n`;
    }
    body += `\n`;
  }

  body += `---\n\n`;
  body += `## Recommended Actions\n\n`;
  body += `### Immediate Actions\n`;
  body += `1. Review the similar bugs listed above\n`;
  body += `2. Identify common root causes\n`;
  body += `3. Check if recent fixes actually addressed the underlying issue\n\n`;

  body += `### Long-term Actions\n`;
  body += `1. Consider refactoring **${pattern.module}** to prevent **${pattern.category}** bugs\n`;
  body += `2. Add automated tests to catch this pattern earlier\n`;
  body += `3. Document prevention strategies in team knowledge base\n\n`;

  body += `---\n\n`;
  body += `## Timeline\n\n`;
  body += `| Date | Bug ID | Author |\n`;
  body += `|------|--------|--------|\n`;
  for (const bug of pattern.bugs) {
    body += `| ${formatDate(bug.date_fixed)} | ${bug.id} | ${bug.author?.name || "Unknown"} |\n`;
  }

  body += `\n---\n\n`;
  body += `**Auto-generated by Ralph Bug Pattern Detector**\n`;
  body += `**Deep dive analysis:** See factory run results in \`.ralph/factory/runs/\`\n`;

  return body;
}

/**
 * Create GitHub issue for a pattern via REST API
 */
async function createGitHubIssue(pattern, config) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log("ERROR", "GITHUB_TOKEN not set, cannot create issue");
    return null;
  }

  // Get repo info from git
  let repoInfo;
  try {
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (match) {
      repoInfo = { owner: match[1], repo: match[2] };
    } else {
      log("ERROR", "Could not parse GitHub repo from remote URL");
      return null;
    }
  } catch (error) {
    log("ERROR", `Failed to get GitHub repo info: ${error.message}`);
    return null;
  }

  const title = `[Bug Pattern] ${pattern.category} in ${pattern.module}`;
  const body = buildGitHubIssueBody(pattern);

  try {
    const https = require("https");

    const data = JSON.stringify({
      title,
      body,
      labels: GITHUB_ISSUE_LABELS,
    });

    const options = {
      hostname: "api.github.com",
      path: `/repos/${repoInfo.owner}/${repoInfo.repo}/issues`,
      method: "POST",
      headers: {
        "User-Agent": "Ralph-Bug-Pattern-Detector",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "Content-Length": data.length,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode === 201) {
            const issue = JSON.parse(responseData);
            log("SUCCESS", `Created GitHub issue #${issue.number}: ${title}`);
            resolve({
              number: issue.number,
              url: issue.html_url,
            });
          } else {
            log("ERROR", `Failed to create issue: HTTP ${res.statusCode}`);
            log("ERROR", responseData);
            resolve(null);
          }
        });
      });

      req.on("error", (error) => {
        log("ERROR", `Request failed: ${error.message}`);
        resolve(null);
      });

      req.write(data);
      req.end();
    });
  } catch (error) {
    log("ERROR", `Failed to create GitHub issue: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Factory Triggering
// ============================================================================

/**
 * Trigger deep dive factory for a pattern
 */
function triggerDeepDiveFactory(pattern, config) {
  const factoryPath = config.bugWikipedia.deepDiveFactory || DEEP_DIVE_FACTORY_PATH;

  if (!fs.existsSync(factoryPath)) {
    log("WARN", `Factory definition not found: ${factoryPath}`);
    log("INFO", "Creating default factory definition...");
    createDefaultFactoryDefinition(factoryPath);
  }

  // Create pattern summary file for factory input
  const patternSummaryPath = path.join(PATTERNS_DIR, `pattern-${pattern.key}.json`);
  fs.writeFileSync(patternSummaryPath, JSON.stringify(pattern, null, 2));
  log("INFO", `Saved pattern summary: ${patternSummaryPath}`);

  // Trigger factory run
  try {
    log("INFO", `Triggering factory: ${factoryPath}`);
    const factoryName = path.basename(factoryPath, ".yaml");

    // Use ralph factory run command
    const cmd = `ralph factory run ${factoryName}`;
    log("INFO", `Running: ${cmd}`);

    // Note: In dry-run mode, we don't actually execute
    if (process.argv.includes("--dry-run")) {
      log("INFO", "[DRY RUN] Would execute factory run");
      return { status: "dry-run", factory: factoryName };
    }

    // Execute factory run (async - don't wait for completion)
    execSync(cmd, { stdio: "inherit" });

    log("SUCCESS", `Factory ${factoryName} triggered`);
    return { status: "triggered", factory: factoryName };
  } catch (error) {
    log("ERROR", `Failed to trigger factory: ${error.message}`);
    return { status: "failed", error: error.message };
  }
}

/**
 * Create default factory definition if it doesn't exist
 */
function createDefaultFactoryDefinition(factoryPath) {
  const factoryDir = path.dirname(factoryPath);
  if (!fs.existsSync(factoryDir)) {
    fs.mkdirSync(factoryDir, { recursive: true });
  }

  const factoryDefinition = `name: bug-deep-dive-analysis
description: Root cause analysis for recurring bug patterns

stages:
  - name: analyze_pattern
    agent: claude-sonnet
    prompt: |
      Analyze this recurring bug pattern in the codebase:

      Category: {{pattern.category}}
      Module: {{pattern.module}}
      Occurrences: {{pattern.bug_count}} bugs in 30 days

      Similar bugs:
      {{#each pattern.bugs}}
      - {{this.commit_message}} ({{this.date_fixed}})
      {{/each}}

      Output:
      1. Root cause (why does this keep happening?)
      2. Recommended refactor (how to prevent permanently?)
      3. Prevention strategy (tests, architecture changes)

      Be specific and actionable.

  - name: generate_recommendations
    agent: claude-sonnet
    prompt: |
      Based on the pattern analysis:

      {{analyze_pattern.output}}

      Generate:
      1. Immediate action items (next 1-2 days)
      2. Long-term refactor plan (1-2 weeks)
      3. Test coverage recommendations

      Format as markdown checklist.

outputs:
  - deep_dive_report.md
  - refactor_recommendations.md
  - prevention_checklist.md
`;

  fs.writeFileSync(factoryPath, factoryDefinition);
  log("SUCCESS", `Created factory definition: ${factoryPath}`);
}

// ============================================================================
// Slack Notification
// ============================================================================

/**
 * Send Slack notification for a pattern
 */
async function sendSlackNotification(pattern, githubIssue, config) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    log("WARN", "SLACK_BOT_TOKEN not set, skipping Slack notification");
    return false;
  }

  const channel = config.slackChannels?.leadership || config.slackChannels?.critical_alerts;
  if (!channel) {
    log("WARN", "No Slack channel configured for leadership/critical_alerts");
    return false;
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 Bug Pattern Detected`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Category:* ${pattern.category}\n*Module:* ${pattern.module}\n*Occurrences:* ${pattern.bug_count} bugs in 30 days`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Timeline:* ${formatDate(pattern.first_occurrence)} → ${formatDate(pattern.latest_occurrence)}`,
      },
    },
  ];

  if (githubIssue) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*GitHub Issue:* <${githubIssue.url}|#${githubIssue.number}>`,
      },
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Deep Dive Factory:* Triggered for root cause analysis\n*Results:* Check \`.ralph/factory/runs/\` for detailed analysis`,
    },
  });

  try {
    const https = require("https");

    const data = JSON.stringify({
      channel,
      blocks,
    });

    const options = {
      hostname: "slack.com",
      path: "/api/chat.postMessage",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": data.length,
      },
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          const response = JSON.parse(responseData);
          if (response.ok) {
            log("SUCCESS", `Sent Slack notification to ${channel}`);
            resolve(true);
          } else {
            log("ERROR", `Slack API error: ${response.error}`);
            resolve(false);
          }
        });
      });

      req.on("error", (error) => {
        log("ERROR", `Slack request failed: ${error.message}`);
        resolve(false);
      });

      req.write(data);
      req.end();
    });
  } catch (error) {
    log("ERROR", `Failed to send Slack notification: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Pattern Resolution Tracking
// ============================================================================

/**
 * Check if patterns should be auto-closed (no new bugs in 60 days)
 */
async function checkPatternResolution(trackedPatterns, currentBugs, config) {
  const resolutionDays = PATTERN_RESOLUTION_DAYS;
  const now = new Date();
  const closedPatterns = [];

  for (const tracked of trackedPatterns) {
    if (tracked.status === "closed") {
      continue; // Already closed
    }

    // Find bugs matching this pattern
    const matchingBugs = currentBugs.filter((bug) => {
      const category = bug.primary_category || "uncategorized";
      const files = bug.files_changed || [];

      for (const file of files) {
        const module = extractModule(file);
        const key = `${category}-${module}`;
        if (key === tracked.key) {
          return true;
        }
      }
      return false;
    });

    // Find latest bug date
    if (matchingBugs.length === 0) {
      continue; // No bugs (shouldn't happen for tracked patterns)
    }

    matchingBugs.sort((a, b) => new Date(b.date_fixed) - new Date(a.date_fixed));
    const latestBugDate = new Date(matchingBugs[0].date_fixed);
    const daysSinceLastBug = (now - latestBugDate) / (1000 * 60 * 60 * 24);

    if (daysSinceLastBug >= resolutionDays) {
      log("INFO", `Pattern ${tracked.key} resolved (${Math.floor(daysSinceLastBug)} days since last bug)`);

      tracked.status = "closed";
      tracked.resolved_at = now.toISOString();
      tracked.resolution_note = `No new bugs in ${resolutionDays} days`;

      // Close GitHub issue if exists
      if (tracked.github_issue_number) {
        await closeGitHubIssue(tracked, config);
      }

      closedPatterns.push(tracked);
    }
  }

  return closedPatterns;
}

/**
 * Close GitHub issue for a resolved pattern
 */
async function closeGitHubIssue(pattern, config) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log("WARN", "GITHUB_TOKEN not set, cannot close issue");
    return false;
  }

  // Get repo info
  let repoInfo;
  try {
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (match) {
      repoInfo = { owner: match[1], repo: match[2] };
    } else {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const https = require("https");

    // Close issue
    const closeData = JSON.stringify({ state: "closed" });
    const closeOptions = {
      hostname: "api.github.com",
      path: `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${pattern.github_issue_number}`,
      method: "PATCH",
      headers: {
        "User-Agent": "Ralph-Bug-Pattern-Detector",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "Content-Length": closeData.length,
      },
    };

    await new Promise((resolve) => {
      const req = https.request(closeOptions, (res) => {
        res.on("end", () => {
          if (res.statusCode === 200) {
            log("SUCCESS", `Closed GitHub issue #${pattern.github_issue_number}`);
          }
          resolve();
        });
      });
      req.on("error", () => resolve());
      req.write(closeData);
      req.end();
    });

    // Add resolution comment
    const commentData = JSON.stringify({
      body: `## Pattern Resolved ✅\n\n${pattern.resolution_note}\n\nThis pattern has been automatically closed by Ralph Bug Pattern Detector.`,
    });
    const commentOptions = {
      hostname: "api.github.com",
      path: `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${pattern.github_issue_number}/comments`,
      method: "POST",
      headers: {
        "User-Agent": "Ralph-Bug-Pattern-Detector",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "Content-Length": commentData.length,
      },
    };

    await new Promise((resolve) => {
      const req = https.request(commentOptions, (res) => {
        res.on("end", resolve);
      });
      req.on("error", resolve);
      req.write(commentData);
      req.end();
    });

    return true;
  } catch (error) {
    log("ERROR", `Failed to close issue: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  console.log("============================================");
  console.log("Bug Pattern Detector");
  console.log("============================================\n");

  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) {
    log("INFO", "Running in DRY RUN mode (no GitHub/Slack actions)");
  }

  // Load configuration
  const config = loadAutomationConfig();

  if (!config.bugWikipedia.enabled) {
    log("WARN", "Bug Wikipedia disabled in config, exiting");
    process.exit(0);
  }

  // Load categorized bugs
  log("INFO", "Loading categorized bugs...");
  const bugs = loadCategorizedBugs();
  log("INFO", `Loaded ${bugs.length} categorized bugs`);

  if (bugs.length === 0) {
    log("WARN", "No categorized bugs found, run bug-categorizer.js first");
    process.exit(0);
  }

  // Detect patterns
  const patterns = detectPatterns(bugs, config);

  if (patterns.length === 0) {
    log("INFO", "No patterns detected");
  } else {
    log("SUCCESS", `Found ${patterns.length} patterns to analyze`);
  }

  // Load tracked patterns
  const trackedPatterns = loadTrackedPatterns();
  log("INFO", `Loaded ${trackedPatterns.length} tracked patterns`);

  // Check pattern resolution (auto-close old patterns)
  const closedPatterns = await checkPatternResolution(trackedPatterns, bugs, config);
  if (closedPatterns.length > 0) {
    log("SUCCESS", `Closed ${closedPatterns.length} resolved patterns`);
  }

  // Process new patterns
  for (const pattern of patterns) {
    // Check if already tracked
    const existing = trackedPatterns.find((t) => t.key === pattern.key);

    if (existing && existing.status !== "closed") {
      log("INFO", `Pattern ${pattern.key} already tracked (issue #${existing.github_issue_number || "N/A"})`);
      continue;
    }

    log("INFO", `Processing new pattern: ${pattern.key}`);

    // Create GitHub issue
    let githubIssue = null;
    if (config.bugWikipedia.autoCreateIssues && !isDryRun) {
      githubIssue = await createGitHubIssue(pattern, config);
    } else if (isDryRun) {
      log("INFO", "[DRY RUN] Would create GitHub issue");
      githubIssue = { number: 999, url: "https://github.com/example/repo/issues/999" };
    }

    // Trigger deep dive factory
    const factoryResult = triggerDeepDiveFactory(pattern, config);

    // Send Slack notification
    if (!isDryRun) {
      await sendSlackNotification(pattern, githubIssue, config);
    } else {
      log("INFO", "[DRY RUN] Would send Slack notification");
    }

    // Track this pattern
    trackedPatterns.push({
      key: pattern.key,
      category: pattern.category,
      module: pattern.module,
      bug_count: pattern.bug_count,
      first_detected: new Date().toISOString(),
      github_issue_number: githubIssue?.number || null,
      github_issue_url: githubIssue?.url || null,
      factory_run: factoryResult.factory,
      status: "open",
    });

    log("SUCCESS", `Pattern ${pattern.key} tracked`);
  }

  // Save updated tracked patterns
  saveTrackedPatterns(trackedPatterns);

  console.log("\n============================================");
  log("SUCCESS", "Bug pattern detection complete");
  console.log("============================================\n");
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    log("ERROR", `Unhandled error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = {
  detectPatterns,
  loadCategorizedBugs,
  extractModule,
  isWithinWindow,
};
