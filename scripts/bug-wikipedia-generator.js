#!/usr/bin/env node

/**
 * Bug Wikipedia Generator - Builds markdown documentation from categorized bugs
 *
 * Part of PRD-112 US-011: Build Bug Wikipedia structure
 *
 * Features:
 * - Generates index.md with table of contents
 * - Creates category markdown files (logic-errors.md, race-conditions.md, etc.)
 * - Creates by-developer markdown files
 * - Creates by-module markdown files
 * - Calculates metrics (summary.json)
 * - Updates daily as new bugs are scanned
 *
 * Directory Structure:
 * .ralph/bug-wikipedia/
 * ├── index.md                          # Table of contents
 * ├── categories/
 * │   ├── logic-errors.md
 * │   ├── race-conditions.md
 * │   └── ...
 * ├── by-developer/
 * │   ├── developer-alice.md
 * │   └── developer-bob.md
 * ├── by-module/
 * │   ├── authentication.md
 * │   └── payment-processing.md
 * ├── patterns/
 * │   └── recurring-issues.md
 * └── metrics/
 *     └── summary.json
 *
 * Usage:
 * - Manual: node scripts/bug-wikipedia-generator.js
 * - CLI: ralph automation generate-wiki
 * - Dry run: node scripts/bug-wikipedia-generator.js --dry-run
 */

const fs = require("fs");
const path = require("path");

// ============================================================================
// Configuration Constants
// ============================================================================

const BUG_WIKIPEDIA_DIR = ".ralph/bug-wikipedia";
const RAW_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "raw");
const CATEGORIZED_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "categorized");
const CATEGORIES_DIR = path.join(BUG_WIKIPEDIA_DIR, "categories");
const BY_DEVELOPER_DIR = path.join(BUG_WIKIPEDIA_DIR, "by-developer");
const BY_MODULE_DIR = path.join(BUG_WIKIPEDIA_DIR, "by-module");
const PATTERNS_DIR = path.join(BUG_WIKIPEDIA_DIR, "patterns");
const METRICS_DIR = path.join(BUG_WIKIPEDIA_DIR, "metrics");

// Bug categories (consistent with bug-categorizer.js)
const BUG_CATEGORIES = [
  "logic-error",
  "race-condition",
  "requirements-misunderstanding",
  "integration-issue",
  "environment-specific",
  "dependency-issue",
  "performance-degradation",
  "security-vulnerability",
  "data-corruption",
  "user-input-validation",
];

// ============================================================================
// Logging Utilities
// ============================================================================

function log(level, message) {
  const prefix =
    level === "ERROR" ? "  ❌" :
    level === "SUCCESS" ? "  ✅" :
    level === "WARN" ? "  ⚠️" :
    "  ℹ️";
  console.log(`${prefix} ${message}`);
}

// ============================================================================
// Data Loading Functions
// ============================================================================

/**
 * Load all raw bugs from .ralph/bug-wikipedia/raw/
 */
function loadRawBugs() {
  if (!fs.existsSync(RAW_BUGS_DIR)) {
    log("WARN", `Raw bugs directory not found: ${RAW_BUGS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(RAW_BUGS_DIR).filter(f => f.endsWith(".json"));
  const bugs = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(RAW_BUGS_DIR, file), "utf-8");
      const bug = JSON.parse(content);
      bugs.push(bug);
    } catch (error) {
      log("ERROR", `Failed to parse ${file}: ${error.message}`);
    }
  }

  return bugs;
}

/**
 * Load all categorized bugs from .ralph/bug-wikipedia/categorized/
 */
function loadCategorizedBugs() {
  if (!fs.existsSync(CATEGORIZED_BUGS_DIR)) {
    log("WARN", `Categorized bugs directory not found: ${CATEGORIZED_BUGS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(CATEGORIZED_BUGS_DIR).filter(f => f.endsWith(".json"));
  const bugs = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(CATEGORIZED_BUGS_DIR, file), "utf-8");
      const bug = JSON.parse(content);
      bugs.push(bug);
    } catch (error) {
      log("ERROR", `Failed to parse categorized ${file}: ${error.message}`);
    }
  }

  return bugs;
}

// ============================================================================
// Helper Functions
// ============================================================================

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

/**
 * Calculate days between two dates
 */
function daysBetween(date1, date2) {
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diff = Math.abs(d2 - d1);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Format category ID to display name
 */
function formatCategoryName(categoryId) {
  return categoryId
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract module name from file path
 */
function extractModule(filePath) {
  if (!filePath) return "unknown";

  // Extract directory path (e.g., src/auth/session.ts -> src/auth)
  const parts = filePath.split("/");
  if (parts.length <= 1) return "root";

  // Return first two directory levels
  return parts.slice(0, 2).join("/");
}

/**
 * Sanitize developer name for filename
 */
function sanitizeDeveloperName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Sanitize module name for filename
 */
function sanitizeModuleName(module) {
  return module
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// ============================================================================
// Markdown Generation Functions
// ============================================================================

/**
 * Generate index.md (table of contents)
 */
function generateIndexMd(rawBugs, categorizedBugs) {
  const categoryCounts = {};
  const developerCounts = {};
  const moduleCounts = {};

  // Count bugs by category
  for (const bug of categorizedBugs) {
    const category = bug.primary_category || "uncategorized";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  // Count bugs by developer
  for (const bug of rawBugs) {
    const dev = bug.author?.name || "Unknown";
    developerCounts[dev] = (developerCounts[dev] || 0) + 1;
  }

  // Count bugs by module
  for (const bug of rawBugs) {
    const files = bug.files_changed || [];
    for (const file of files) {
      const module = extractModule(file);
      moduleCounts[module] = (moduleCounts[module] || 0) + 1;
    }
  }

  let md = `# Bug Wikipedia - Table of Contents\n\n`;
  md += `**Last Updated:** ${new Date().toISOString().split("T")[0]}\n\n`;
  md += `**Total Bugs:** ${rawBugs.length} (${categorizedBugs.length} categorized)\n\n`;
  md += `---\n\n`;

  // Categories section
  md += `## By Category\n\n`;
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sortedCategories) {
    const filename = category + ".md";
    md += `- [${formatCategoryName(category)}](categories/${filename}) - ${count} bugs\n`;
  }
  md += `\n`;

  // Developers section
  md += `## By Developer\n\n`;
  const sortedDevelopers = Object.entries(developerCounts).sort((a, b) => b[1] - a[1]);
  for (const [dev, count] of sortedDevelopers) {
    const filename = `developer-${sanitizeDeveloperName(dev)}.md`;
    md += `- [${dev}](by-developer/${filename}) - ${count} bugs\n`;
  }
  md += `\n`;

  // Modules section
  md += `## By Module\n\n`;
  const sortedModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);
  for (const [module, count] of sortedModules.slice(0, 20)) {
    const filename = `${sanitizeModuleName(module)}.md`;
    md += `- [${module}](by-module/${filename}) - ${count} bugs\n`;
  }
  md += `\n`;

  // Metrics section
  md += `## Metrics\n\n`;
  md += `- [Summary Metrics](metrics/summary.json)\n`;
  md += `- [Recurring Patterns](patterns/recurring-issues.md)\n`;

  return md;
}

/**
 * Generate category markdown file (e.g., categories/race-conditions.md)
 */
function generateCategoryMd(category, bugs) {
  const categoryBugs = bugs.filter(b => b.primary_category === category);

  if (categoryBugs.length === 0) {
    return null; // Skip empty categories
  }

  let md = `# ${formatCategoryName(category)} Bugs\n\n`;

  // Summary section
  const severityCounts = { high: 0, medium: 0, low: 0 };
  const moduleCounts = {};
  let totalTimeToFix = 0;
  let timeToFixCount = 0;

  for (const bug of categoryBugs) {
    const severity = bug.severity || "medium";
    severityCounts[severity] = (severityCounts[severity] || 0) + 1;

    // Count modules
    const files = bug.files_changed || [];
    for (const file of files) {
      const module = extractModule(file);
      moduleCounts[module] = (moduleCounts[module] || 0) + 1;
    }

    // Calculate time to fix (if available)
    if (bug.date_introduced && bug.date_fixed) {
      const days = daysBetween(bug.date_introduced, bug.date_fixed);
      if (days !== null) {
        totalTimeToFix += days;
        timeToFixCount++;
      }
    }
  }

  const avgTimeToFix = timeToFixCount > 0 ? (totalTimeToFix / timeToFixCount).toFixed(1) : "N/A";
  const mostAffectedModule = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  md += `## Summary\n`;
  md += `- **Total:** ${categoryBugs.length} bugs\n`;
  md += `- **Severity:** ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low\n`;
  md += `- **Avg time to fix:** ${avgTimeToFix} days\n`;
  md += `- **Most affected module:** ${mostAffectedModule}\n`;
  md += `\n`;

  // Bugs section
  md += `## Bugs\n\n`;

  for (const bug of categoryBugs) {
    const shortSha = bug.commit_sha?.substring(0, 7) || bug.id;
    md += `### Bug-${shortSha}: ${bug.commit_message}\n`;
    md += `- **Fixed:** ${formatDate(bug.date_fixed)} by @${bug.author?.name || "Unknown"}\n`;

    if (bug.date_introduced) {
      md += `- **Introduced:** ${formatDate(bug.date_introduced)} (commit ${bug.introduced_commit?.substring(0, 7) || "unknown"})\n`;

      const days = daysBetween(bug.date_introduced, bug.date_fixed);
      if (days !== null) {
        md += `- **Time to fix:** ${days} days\n`;
      }
    }

    const files = bug.files_changed || [];
    if (files.length > 0) {
      md += `- **Files:** ${files.join(", ")}\n`;
    }

    if (bug.prevention_tips) {
      md += `- **Prevention tip:** ${bug.prevention_tips}\n`;
    }

    if (bug.github_url) {
      md += `- [Commit](${bug.github_url})\n`;
    }

    md += `\n`;
  }

  return md;
}

/**
 * Generate by-developer markdown file
 */
function generateDeveloperMd(developer, rawBugs, categorizedBugs) {
  const devBugs = rawBugs.filter(b => b.author?.name === developer);

  if (devBugs.length === 0) {
    return null;
  }

  let md = `# Bugs - ${developer}\n\n`;

  // Get categorized bugs for this developer
  const devCategorizedBugs = categorizedBugs.filter(b => b.author?.name === developer);

  // Summary
  md += `## Summary\n`;
  md += `- **Total bugs:** ${devBugs.length}\n`;
  md += `- **Categorized:** ${devCategorizedBugs.length}\n`;

  // Count by category
  const categoryCounts = {};
  for (const bug of devCategorizedBugs) {
    const category = bug.primary_category || "uncategorized";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  md += `\n### By Category\n`;
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sortedCategories) {
    md += `- ${formatCategoryName(category)}: ${count}\n`;
  }
  md += `\n`;

  // Recent bugs
  md += `## Recent Bugs\n\n`;
  const sortedBugs = devBugs.sort((a, b) => new Date(b.date_fixed) - new Date(a.date_fixed)).slice(0, 10);

  for (const bug of sortedBugs) {
    const shortSha = bug.commit_sha?.substring(0, 7) || bug.id;
    md += `### Bug-${shortSha}: ${bug.commit_message}\n`;
    md += `- **Fixed:** ${formatDate(bug.date_fixed)}\n`;

    const files = bug.files_changed || [];
    if (files.length > 0) {
      md += `- **Files:** ${files.join(", ")}\n`;
    }

    if (bug.github_url) {
      md += `- [Commit](${bug.github_url})\n`;
    }

    md += `\n`;
  }

  return md;
}

/**
 * Generate by-module markdown file
 */
function generateModuleMd(module, rawBugs, categorizedBugs) {
  const moduleBugs = rawBugs.filter(b => {
    const files = b.files_changed || [];
    return files.some(f => extractModule(f) === module);
  });

  if (moduleBugs.length === 0) {
    return null;
  }

  let md = `# Bugs - ${module}\n\n`;

  // Get categorized bugs for this module
  const moduleCategorizedBugs = categorizedBugs.filter(b => {
    const files = b.files_changed || [];
    return files.some(f => extractModule(f) === module);
  });

  // Summary
  md += `## Summary\n`;
  md += `- **Total bugs:** ${moduleBugs.length}\n`;
  md += `- **Categorized:** ${moduleCategorizedBugs.length}\n`;

  // Count by category
  const categoryCounts = {};
  for (const bug of moduleCategorizedBugs) {
    const category = bug.primary_category || "uncategorized";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  md += `\n### By Category\n`;
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sortedCategories) {
    md += `- ${formatCategoryName(category)}: ${count}\n`;
  }
  md += `\n`;

  // Recent bugs
  md += `## Recent Bugs\n\n`;
  const sortedBugs = moduleBugs.sort((a, b) => new Date(b.date_fixed) - new Date(a.date_fixed)).slice(0, 10);

  for (const bug of sortedBugs) {
    const shortSha = bug.commit_sha?.substring(0, 7) || bug.id;
    md += `### Bug-${shortSha}: ${bug.commit_message}\n`;
    md += `- **Fixed:** ${formatDate(bug.date_fixed)} by @${bug.author?.name || "Unknown"}\n`;

    const files = bug.files_changed || [];
    if (files.length > 0) {
      md += `- **Files:** ${files.join(", ")}\n`;
    }

    if (bug.github_url) {
      md += `- [Commit](${bug.github_url})\n`;
    }

    md += `\n`;
  }

  return md;
}

/**
 * Generate metrics summary.json
 */
function generateMetrics(rawBugs, categorizedBugs) {
  const metrics = {
    generated_at: new Date().toISOString(),
    total_bugs: rawBugs.length,
    categorized_bugs: categorizedBugs.length,
    by_category: {},
    by_severity: { high: 0, medium: 0, low: 0 },
    by_developer: {},
    by_module: {},
    avg_time_to_detect_days: null,
    avg_time_to_fix_days: null,
  };

  // Count by category
  for (const bug of categorizedBugs) {
    const category = bug.primary_category || "uncategorized";
    metrics.by_category[category] = (metrics.by_category[category] || 0) + 1;

    const severity = bug.severity || "medium";
    metrics.by_severity[severity] = (metrics.by_severity[severity] || 0) + 1;
  }

  // Count by developer
  for (const bug of rawBugs) {
    const dev = bug.author?.name || "Unknown";
    metrics.by_developer[dev] = (metrics.by_developer[dev] || 0) + 1;
  }

  // Count by module
  for (const bug of rawBugs) {
    const files = bug.files_changed || [];
    for (const file of files) {
      const module = extractModule(file);
      metrics.by_module[module] = (metrics.by_module[module] || 0) + 1;
    }
  }

  // Calculate average time to fix
  let totalTimeToFix = 0;
  let timeToFixCount = 0;

  for (const bug of categorizedBugs) {
    if (bug.date_introduced && bug.date_fixed) {
      const days = daysBetween(bug.date_introduced, bug.date_fixed);
      if (days !== null) {
        totalTimeToFix += days;
        timeToFixCount++;
      }
    }
  }

  if (timeToFixCount > 0) {
    metrics.avg_time_to_fix_days = parseFloat((totalTimeToFix / timeToFixCount).toFixed(1));
  }

  return metrics;
}

// ============================================================================
// Main Generation Function
// ============================================================================

/**
 * Main function - generates all Bug Wikipedia files
 */
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("[1/6] Loading bug data...");
  const rawBugs = loadRawBugs();
  const categorizedBugs = loadCategorizedBugs();

  log("INFO", `Loaded ${rawBugs.length} raw bugs, ${categorizedBugs.length} categorized`);

  if (rawBugs.length === 0) {
    log("WARN", "No bugs found. Run 'ralph automation scan-bugs' first.");
    return;
  }

  console.log("[2/6] Generating index.md...");
  const indexMd = generateIndexMd(rawBugs, categorizedBugs);
  if (!dryRun) {
    fs.writeFileSync(path.join(BUG_WIKIPEDIA_DIR, "index.md"), indexMd, "utf-8");
  }
  log("SUCCESS", "Generated index.md");

  console.log("[3/6] Generating category markdown files...");
  let categoryCount = 0;
  for (const category of BUG_CATEGORIES) {
    const md = generateCategoryMd(category, categorizedBugs);
    if (md) {
      const filename = `${category}.md`;
      if (!dryRun) {
        fs.writeFileSync(path.join(CATEGORIES_DIR, filename), md, "utf-8");
      }
      categoryCount++;
    }
  }
  log("SUCCESS", `Generated ${categoryCount} category files`);

  console.log("[4/6] Generating by-developer markdown files...");
  const developers = [...new Set(rawBugs.map(b => b.author?.name).filter(Boolean))];
  let developerCount = 0;
  for (const dev of developers) {
    const md = generateDeveloperMd(dev, rawBugs, categorizedBugs);
    if (md) {
      const filename = `developer-${sanitizeDeveloperName(dev)}.md`;
      if (!dryRun) {
        fs.writeFileSync(path.join(BY_DEVELOPER_DIR, filename), md, "utf-8");
      }
      developerCount++;
    }
  }
  log("SUCCESS", `Generated ${developerCount} developer files`);

  console.log("[5/6] Generating by-module markdown files...");
  const modules = new Set();
  for (const bug of rawBugs) {
    const files = bug.files_changed || [];
    for (const file of files) {
      modules.add(extractModule(file));
    }
  }
  let moduleCount = 0;
  for (const module of modules) {
    const md = generateModuleMd(module, rawBugs, categorizedBugs);
    if (md) {
      const filename = `${sanitizeModuleName(module)}.md`;
      if (!dryRun) {
        fs.writeFileSync(path.join(BY_MODULE_DIR, filename), md, "utf-8");
      }
      moduleCount++;
    }
  }
  log("SUCCESS", `Generated ${moduleCount} module files`);

  console.log("[6/6] Generating metrics/summary.json...");
  const metrics = generateMetrics(rawBugs, categorizedBugs);
  if (!dryRun) {
    fs.writeFileSync(
      path.join(METRICS_DIR, "summary.json"),
      JSON.stringify(metrics, null, 2),
      "utf-8"
    );
  }
  log("SUCCESS", "Generated summary.json");

  console.log("");
  log("SUCCESS", "Bug Wikipedia generation complete!");
  console.log("");
  console.log("Summary:");
  console.log(`  - Total bugs: ${rawBugs.length}`);
  console.log(`  - Categorized: ${categorizedBugs.length}`);
  console.log(`  - Category files: ${categoryCount}`);
  console.log(`  - Developer files: ${developerCount}`);
  console.log(`  - Module files: ${moduleCount}`);

  if (dryRun) {
    console.log("");
    log("INFO", "Dry run mode - no files written");
  }
}

// ============================================================================
// Entry Point
// ============================================================================

if (require.main === module) {
  main();
}

module.exports = {
  loadRawBugs,
  loadCategorizedBugs,
  generateIndexMd,
  generateCategoryMd,
  generateDeveloperMd,
  generateModuleMd,
  generateMetrics,
};
