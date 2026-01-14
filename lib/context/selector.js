/**
 * Context selector - selects relevant files for a story based on relevance scores
 *
 * Scans project files (respecting .gitignore) and returns top N files
 * sorted by relevance score.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
  calculateFileRelevance,
  extractFileReferences,
  getRecentlyModifiedFiles,
} = require("./scorer");

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
 * Select relevant files for a story
 * @param {string|Object} storyBlock - Story text content or story object with text/content property
 * @param {Object} options - Selection options
 * @param {string} options.projectRoot - Project root directory (default: cwd)
 * @param {number} options.limit - Maximum number of files to return (default: 10)
 * @param {number} options.minScore - Minimum relevance score to include (default: 1)
 * @returns {Object} { files: Array<{file, score, tokens}>, summary: Object }
 */
function selectRelevantFiles(storyBlock, options = {}) {
  const { projectRoot = process.cwd(), limit = 10, minScore = 1 } = options;

  // Handle story object or string
  const storyText =
    typeof storyBlock === "string"
      ? storyBlock
      : storyBlock.text || storyBlock.content || storyBlock.title || "";

  // Get all project files
  const allFiles = getProjectFiles(projectRoot);

  // Pre-extract file references and recent files for efficiency
  const fileReferences = extractFileReferences(storyText);
  const recentFiles = getRecentlyModifiedFiles(projectRoot);

  // Score each file
  const scoredFiles = [];

  for (const file of allFiles) {
    const score = calculateFileRelevance(file, storyText, {
      projectRoot,
      recentFiles,
      fileReferences,
    });

    if (score >= minScore) {
      const absolutePath = path.join(projectRoot, file);
      const tokens = countFileTokens(absolutePath);

      scoredFiles.push({
        file,
        score,
        tokens,
      });
    }
  }

  // Sort by score (descending)
  scoredFiles.sort((a, b) => b.score - a.score);

  // Apply limit
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
    },
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
  getProjectFiles,
  getFilePaths,
  countFileTokens,
  isIncludedFile,
  shouldIgnore,
  scanDirectory,
  DEFAULT_IGNORE_PATTERNS,
  INCLUDE_EXTENSIONS,
};
