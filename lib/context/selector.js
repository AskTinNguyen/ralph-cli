/**
 * Context selector - selects relevant files for a story based on relevance scores
 *
 * Scans project files (respecting .gitignore) and returns top N files
 * sorted by relevance score. Supports budget-aware selection to fit within
 * model context limits.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { minimatch } = require("minimatch");

const {
  calculateFileRelevance,
  extractFileReferences,
  getRecentlyModifiedFiles,
} = require("./scorer");

// Lazy-load budget module to avoid circular dependencies
let budgetModule = null;
function getBudgetModule() {
  if (!budgetModule) {
    budgetModule = require("./budget");
  }
  return budgetModule;
}

// Try to load token estimator for token counting
let estimateTokensFromText;
try {
  const extractor = require("../tokens/extractor");
  estimateTokensFromText = extractor.estimateTokensFromText;
} catch {
  // Fallback: ~4 chars per token
  estimateTokensFromText = (text) => (text ? Math.ceil(text.length / 4) : 0);
}

// Default patterns to ignore (in addition to .gitignore)
const DEFAULT_IGNORE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /\.ralph\//,
  /\.agents\//,
  /dist\//,
  /build\//,
  /coverage\//,
  /\.nyc_output\//,
  /\.cache\//,
  /\.next\//,
  /\.nuxt\//,
  /\.output\//,
  /\.vercel\//,
  /\.turbo\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.DS_Store$/,
  /\.env$/,
  /\.env\..+$/,
];

// File extensions to include (code and config files)
const INCLUDE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".vue",
  ".svelte",
]);

/**
 * Get list of project files using git ls-files (respects .gitignore)
 * Falls back to recursive directory scan if git is unavailable
 * @param {string} projectRoot - Project root directory
 * @returns {string[]} Array of file paths relative to project root
 */
function getProjectFiles(projectRoot) {
  try {
    // Use git ls-files to get tracked and untracked files (respecting .gitignore)
    const cmd = "git ls-files --cached --others --exclude-standard 2>/dev/null";
    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
    });

    return output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .filter((file) => isIncludedFile(file));
  } catch {
    // Fallback: recursive directory scan
    return scanDirectory(projectRoot, projectRoot);
  }
}

/**
 * Recursively scan a directory for files
 * @param {string} dir - Directory to scan
 * @param {string} projectRoot - Project root for relative paths
 * @returns {string[]} Array of file paths relative to project root
 */
function scanDirectory(dir, projectRoot) {
  const files = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(projectRoot, fullPath);

      // Skip ignored patterns
      if (shouldIgnore(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...scanDirectory(fullPath, projectRoot));
      } else if (entry.isFile() && isIncludedFile(relativePath)) {
        files.push(relativePath);
      }
    }
  } catch {
    // Ignore read errors (permission denied, etc.)
  }

  return files;
}

/**
 * Check if a file should be ignored based on default patterns
 * @param {string} filePath - Relative file path
 * @returns {boolean} True if file should be ignored
 */
function shouldIgnore(filePath) {
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file should be included based on extension
 * @param {string} filePath - File path
 * @returns {boolean} True if file should be included
 */
function isIncludedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return INCLUDE_EXTENSIONS.has(ext);
}

/**
 * Count tokens in a file
 * @param {string} filePath - Absolute path to file
 * @returns {number} Estimated token count
 */
function countFileTokens(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return estimateTokensFromText(content);
  } catch {
    return 0;
  }
}

/**
 * Parse @include and @exclude directives from story text
 * Directives can be:
 *   @include path/to/file.js - Include specific file
 *   @include lib/[star][star]/[star].js - Include files matching glob pattern
 *   @exclude [star][star]/test/[star][star] - Exclude files matching glob pattern
 *
 * @param {string} storyText - Story text content
 * @returns {Object} { includes: string[], excludes: string[] }
 */
function parseDirectives(storyText) {
  const includes = [];
  const excludes = [];

  if (!storyText) {
    return { includes, excludes };
  }

  // Match @include and @exclude directives
  // Format: @include pattern or @exclude pattern (rest of line)
  const includeRegex = /@include\s+([^\s@]+)/gi;
  const excludeRegex = /@exclude\s+([^\s@]+)/gi;

  let match;

  // Extract all @include patterns
  while ((match = includeRegex.exec(storyText)) !== null) {
    const pattern = match[1].trim();
    if (pattern) {
      includes.push(pattern);
    }
  }

  // Extract all @exclude patterns
  while ((match = excludeRegex.exec(storyText)) !== null) {
    const pattern = match[1].trim();
    if (pattern) {
      excludes.push(pattern);
    }
  }

  return { includes, excludes };
}

/**
 * Check if a file matches any of the given patterns (glob or exact path)
 * @param {string} filePath - File path to check
 * @param {string[]} patterns - Array of patterns (glob or exact paths)
 * @returns {boolean} True if file matches any pattern
 */
function matchesAnyPattern(filePath, patterns) {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Check exact match first
    if (normalizedPath === normalizedPattern) {
      return true;
    }

    // Check if path ends with pattern (e.g., pattern "scorer.js" matches "lib/context/scorer.js")
    if (normalizedPath.endsWith(normalizedPattern) || normalizedPath.endsWith("/" + normalizedPattern)) {
      return true;
    }

    // Check glob pattern match
    try {
      if (minimatch(normalizedPath, normalizedPattern, { matchBase: true, dot: true })) {
        return true;
      }
    } catch {
      // Invalid pattern, skip
    }
  }

  return false;
}

/**
 * Expand glob patterns to actual file paths
 * @param {string[]} patterns - Array of patterns (glob or exact paths)
 * @param {string[]} allFiles - Array of all project files
 * @returns {string[]} Array of matching file paths
 */
function expandPatterns(patterns, allFiles) {
  if (!patterns || patterns.length === 0) {
    return [];
  }

  const matched = new Set();

  for (const pattern of patterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    for (const file of allFiles) {
      const normalizedFile = file.replace(/\\/g, "/");

      // Check exact match
      if (normalizedFile === normalizedPattern) {
        matched.add(file);
        continue;
      }

      // Check if file ends with pattern
      if (normalizedFile.endsWith(normalizedPattern) || normalizedFile.endsWith("/" + normalizedPattern)) {
        matched.add(file);
        continue;
      }

      // Check glob pattern
      try {
        if (minimatch(normalizedFile, normalizedPattern, { matchBase: true, dot: true })) {
          matched.add(file);
        }
      } catch {
        // Invalid pattern, skip
      }
    }
  }

  return Array.from(matched);
}

/**
 * Determine why a file was selected based on its relevance factors
 * @param {string} file - File path
 * @param {string} storyText - Story text
 * @param {Object} fileReferences - Pre-extracted file references
 * @param {string[]} recentFiles - Recently modified files
 * @param {string} projectRoot - Project root directory
 * @returns {string[]} Array of reasons why the file was selected
 */
function getSelectionReasons(file, storyText, fileReferences, recentFiles, projectRoot) {
  const reasons = [];
  const filePathLower = file.toLowerCase();
  const fileName = path.basename(file);
  const fileNameLower = fileName.toLowerCase();
  const fileNameNoExt = path.basename(file, path.extname(file)).toLowerCase();
  const fileDir = path.dirname(file);

  // Check direct mentions
  for (const mentionedPath of fileReferences.filePaths) {
    if (
      filePathLower.includes(mentionedPath.toLowerCase()) ||
      mentionedPath.toLowerCase().includes(filePathLower)
    ) {
      reasons.push("direct mention");
      break;
    }
  }

  // Check module name matches
  for (const moduleName of fileReferences.moduleNames) {
    const moduleNameLower = moduleName.toLowerCase();
    if (fileNameNoExt === moduleNameLower || fileNameLower.includes(moduleNameLower)) {
      reasons.push("module reference");
      break;
    }
  }

  // Check directory patterns
  for (const dirPattern of fileReferences.directoryPatterns) {
    if (filePathLower.startsWith(dirPattern.toLowerCase())) {
      reasons.push("directory match");
      break;
    }
  }

  // Check recent modifications
  const recentIndex = recentFiles.findIndex((f) => f.toLowerCase() === filePathLower);
  if (recentIndex !== -1) {
    reasons.push("recently modified");
  }

  // Check same directory as mentioned files
  for (const mentionedPath of fileReferences.filePaths) {
    const mentionedDir = path.dirname(mentionedPath);
    if (fileDir.toLowerCase() === mentionedDir.toLowerCase()) {
      reasons.push("same directory");
      break;
    }
  }

  // If no specific reasons found, it's keyword/semantic match
  if (reasons.length === 0) {
    reasons.push("keyword match");
  }

  return reasons;
}

/**
 * Select relevant files for a story
 * @param {string|Object} storyBlock - Story text content or story object with text/content property
 * @param {Object} options - Selection options
 * @param {string} options.projectRoot - Project root directory (default: cwd)
 * @param {number} options.limit - Maximum number of files to return (default: 10)
 * @param {number} options.minScore - Minimum relevance score to include (default: 1)
 * @param {number} options.budget - Token budget for context (optional, enables budget-aware selection)
 * @param {string} options.model - Model name for budget calculation (optional)
 * @param {boolean} options.truncateLarge - Whether to truncate large files when using budget (default: true)
 * @param {string[]} options.include - Additional files/patterns to force-include (merged with @include directives)
 * @param {string[]} options.exclude - Files/patterns to exclude (merged with @exclude directives)
 * @returns {Object} { files: Array<{file, score, tokens, reasons}>, summary: Object, directives: Object }
 */
function selectRelevantFiles(storyBlock, options = {}) {
  const {
    projectRoot = process.cwd(),
    limit = 10,
    minScore = 1,
    budget = null,
    model = null,
    truncateLarge = true,
    include = [],
    exclude = [],
  } = options;

  // Handle story object or string
  const storyText =
    typeof storyBlock === "string"
      ? storyBlock
      : storyBlock.text || storyBlock.content || storyBlock.title || "";

  // Get all project files
  const allFiles = getProjectFiles(projectRoot);

  // Parse @include and @exclude directives from story text
  const storyDirectives = parseDirectives(storyText);

  // Merge story directives with option overrides (option values take precedence for additions)
  const allIncludes = [...storyDirectives.includes, ...include];
  const allExcludes = [...storyDirectives.excludes, ...exclude];

  // Expand include patterns to get force-include files
  const forceIncludeFiles = expandPatterns(allIncludes, allFiles);
  const forceIncludeSet = new Set(forceIncludeFiles);

  // Pre-extract file references and recent files for efficiency
  const fileReferences = extractFileReferences(storyText);
  const recentFiles = getRecentlyModifiedFiles(projectRoot);

  // Score each file
  const scoredFiles = [];
  const excludedByDirective = [];

  for (const file of allFiles) {
    // Check if file should be excluded by @exclude directive
    if (matchesAnyPattern(file, allExcludes)) {
      excludedByDirective.push(file);
      continue;
    }

    const score = calculateFileRelevance(file, storyText, {
      projectRoot,
      recentFiles,
      fileReferences,
    });

    // Force-include files always get added regardless of minScore
    const isForceIncluded = forceIncludeSet.has(file);

    if (score >= minScore || isForceIncluded) {
      const absolutePath = path.join(projectRoot, file);
      const tokens = countFileTokens(absolutePath);
      const reasons = getSelectionReasons(file, storyText, fileReferences, recentFiles, projectRoot);

      // Add "@include" reason for force-included files
      if (isForceIncluded) {
        reasons.unshift("@include directive");
      }

      scoredFiles.push({
        file,
        score: isForceIncluded ? Math.max(score, 100) : score, // Force-included files get high priority
        tokens,
        reasons,
        forceIncluded: isForceIncluded,
      });
    }
  }

  // Sort by score (descending) - force-included files will be at top due to score boost
  scoredFiles.sort((a, b) => b.score - a.score);

  // If budget is specified, use budget-aware selection
  if (budget && budget > 0) {
    const budgetMod = getBudgetModule();
    const budgetResult = budgetMod.selectWithinBudget(scoredFiles, budget, {
      truncateLarge,
      projectRoot,
    });

    // Apply limit after budget selection
    const selectedFiles = budgetResult.selected.slice(0, limit);

    // Preserve reasons from original scored files
    for (const selected of selectedFiles) {
      const original = scoredFiles.find((f) => f.file === selected.file);
      if (original && original.reasons) {
        selected.reasons = original.reasons;
      }
    }

    return {
      files: selectedFiles,
      summary: {
        totalFiles: selectedFiles.length,
        totalTokens: selectedFiles.reduce((sum, f) => sum + f.tokens, 0),
        avgScore:
          selectedFiles.length > 0
            ? Math.round(selectedFiles.reduce((sum, f) => sum + f.score, 0) / selectedFiles.length)
            : 0,
        scannedFiles: allFiles.length,
        matchedFiles: scoredFiles.length,
        budget,
        budgetRemaining: budgetResult.summary.remaining,
        budgetUtilization: budgetResult.summary.utilization,
        truncatedFiles: budgetResult.summary.truncatedFiles,
        skippedFiles: budgetResult.summary.skippedFiles,
        budgetStatus: budgetResult.summary.status,
        forceIncludedFiles: forceIncludeFiles.length,
        excludedByDirective: excludedByDirective.length,
      },
      truncated: budgetResult.truncated,
      skipped: budgetResult.skipped,
      directives: {
        includes: allIncludes,
        excludes: allExcludes,
        forceIncludedFiles: forceIncludeFiles,
        excludedFiles: excludedByDirective,
      },
    };
  }

  // Standard selection (no budget constraint)
  const selectedFiles = scoredFiles.slice(0, limit);

  // Calculate summary
  const totalFiles = selectedFiles.length;
  const totalTokens = selectedFiles.reduce((sum, f) => sum + f.tokens, 0);
  const avgScore =
    totalFiles > 0
      ? Math.round(selectedFiles.reduce((sum, f) => sum + f.score, 0) / totalFiles)
      : 0;

  return {
    files: selectedFiles,
    summary: {
      totalFiles,
      totalTokens,
      avgScore,
      scannedFiles: allFiles.length,
      matchedFiles: scoredFiles.length,
      forceIncludedFiles: forceIncludeFiles.length,
      excludedByDirective: excludedByDirective.length,
    },
    directives: {
      includes: allIncludes,
      excludes: allExcludes,
      forceIncludedFiles: forceIncludeFiles,
      excludedFiles: excludedByDirective,
    },
  };
}

/**
 * Select relevant files with automatic budget calculation based on model
 * @param {string|Object} storyBlock - Story text content or story object
 * @param {Object} options - Selection options
 * @param {string} options.projectRoot - Project root directory (default: cwd)
 * @param {number} options.limit - Maximum number of files to return (default: 10)
 * @param {number} options.minScore - Minimum relevance score to include (default: 1)
 * @param {string} options.model - Model name for budget calculation (default: "sonnet")
 * @param {boolean} options.truncateLarge - Whether to truncate large files (default: true)
 * @returns {Object} { files, summary, budget }
 */
function selectWithBudget(storyBlock, options = {}) {
  const { model = "sonnet", ...rest } = options;

  const budgetMod = getBudgetModule();
  const budgetInfo = budgetMod.calculateBudget(model);

  return {
    ...selectRelevantFiles(storyBlock, {
      ...rest,
      budget: budgetInfo.context,
      model,
    }),
    budgetInfo,
  };
}

/**
 * Get file paths only from selection result
 * @param {Object} selection - Result from selectRelevantFiles
 * @returns {string[]} Array of file paths
 */
function getFilePaths(selection) {
  if (!selection || !selection.files) {
    return [];
  }
  return selection.files.map((f) => f.file);
}

module.exports = {
  selectRelevantFiles,
  selectWithBudget,
  getProjectFiles,
  getFilePaths,
  getSelectionReasons,
  countFileTokens,
  isIncludedFile,
  shouldIgnore,
  scanDirectory,
  parseDirectives,
  matchesAnyPattern,
  expandPatterns,
  DEFAULT_IGNORE_PATTERNS,
  INCLUDE_EXTENSIONS,
};
