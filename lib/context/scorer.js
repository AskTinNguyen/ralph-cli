/**
 * Context scorer - calculates relevance scores for files based on story content
 *
 * Scoring rules (from PRD):
 * - Direct mentions in story: +10 points
 * - Import/require connections: +5 points
 * - Same directory as modified files: +3 points
 * - Recent modifications (git-based): +2 points
 * - Semantic similarity (keyword matching): +1-5 points
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Cache for import connections and recently modified files
let importConnectionsCache = new Map();
let recentlyModifiedCache = null;
let recentlyModifiedCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Extract file and module references from story text
 * @param {string} storyBlock - The story text content
 * @returns {Object} { filePaths: string[], moduleNames: string[], directoryPatterns: string[] }
 */
function extractFileReferences(storyBlock) {
  if (!storyBlock || typeof storyBlock !== "string") {
    return { filePaths: [], moduleNames: [], directoryPatterns: [] };
  }

  const filePaths = [];
  const moduleNames = [];
  const directoryPatterns = [];

  // Pattern 1: Explicit file paths (e.g., lib/context/selector.js, src/foo.ts)
  const filePathPattern = /(?:^|\s|`|'|")([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,5})(?:\s|$|`|'|"|,|:|\))/gm;
  let match;
  while ((match = filePathPattern.exec(storyBlock)) !== null) {
    const filepath = match[1];
    // Filter out URLs and common non-file patterns
    if (!filepath.includes("://") && !filepath.startsWith(".")) {
      filePaths.push(filepath);
    }
  }

  // Pattern 2: Backticked module/file references (e.g., `selector`, `scorer.js`)
  const backtickPattern = /`([a-zA-Z0-9_\-./]+)`/g;
  while ((match = backtickPattern.exec(storyBlock)) !== null) {
    const ref = match[1];
    if (ref.includes(".")) {
      filePaths.push(ref);
    } else if (ref.length > 2) {
      moduleNames.push(ref);
    }
  }

  // Pattern 3: Directory patterns (e.g., lib/context/, src/components/)
  const dirPattern = /(?:^|\s|`|'|")([a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]+)+)\/?(?:\s|$|`|'|"|,|:|\))/gm;
  while ((match = dirPattern.exec(storyBlock)) !== null) {
    const dir = match[1];
    if (!dir.includes(".") && !dir.includes("://")) {
      directoryPatterns.push(dir);
    }
  }

  // Deduplicate
  return {
    filePaths: [...new Set(filePaths)],
    moduleNames: [...new Set(moduleNames)],
    directoryPatterns: [...new Set(directoryPatterns)],
  };
}

/**
 * Find import/require connections for a file
 * @param {string} filePath - Absolute path to the file
 * @param {string} projectRoot - Project root directory
 * @returns {string[]} Array of connected file paths (relative to project root)
 */
function findImportConnections(filePath, projectRoot) {
  // Check cache
  const cacheKey = filePath;
  if (importConnectionsCache.has(cacheKey)) {
    return importConnectionsCache.get(cacheKey);
  }

  const connections = [];

  try {
    if (!fs.existsSync(filePath)) {
      return connections;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();

    // Only parse JS/TS files
    if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      return connections;
    }

    // Pattern 1: require("./path") or require("path")
    const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = resolveImportPath(importPath, filePath, projectRoot);
      if (resolved) {
        connections.push(resolved);
      }
    }

    // Pattern 2: import ... from "path"
    const importPattern = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
    while ((match = importPattern.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = resolveImportPath(importPath, filePath, projectRoot);
      if (resolved) {
        connections.push(resolved);
      }
    }

    // Pattern 3: dynamic import("path")
    const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportPattern.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = resolveImportPath(importPath, filePath, projectRoot);
      if (resolved) {
        connections.push(resolved);
      }
    }
  } catch {
    // Ignore read errors
  }

  const result = [...new Set(connections)];
  importConnectionsCache.set(cacheKey, result);
  return result;
}

/**
 * Resolve an import path to a file path relative to project root
 * @param {string} importPath - The import path (e.g., "./foo", "../bar", "lodash")
 * @param {string} fromFile - The file containing the import
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} Resolved path relative to project root, or null if external
 */
function resolveImportPath(importPath, fromFile, projectRoot) {
  // Skip node_modules / external packages
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  let resolvedPath = path.resolve(fromDir, importPath);

  // Try common extensions if no extension provided
  const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", "/index.js", "/index.ts"];

  for (const ext of extensions) {
    const candidate = resolvedPath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      // Return path relative to project root
      return path.relative(projectRoot, candidate);
    }
  }

  return null;
}

/**
 * Get recently modified files from git history
 * @param {string} projectRoot - Project root directory
 * @param {number} sinceCommits - Number of recent commits to check (default: 10)
 * @returns {string[]} Array of file paths sorted by recency (most recent first)
 */
function getRecentlyModifiedFiles(projectRoot, sinceCommits = 10) {
  const now = Date.now();

  // Return cached result if still valid
  if (recentlyModifiedCache !== null && now - recentlyModifiedCacheTime < CACHE_TTL_MS) {
    return recentlyModifiedCache;
  }

  const files = [];

  try {
    // Get files from recent commits
    const cmd = `git log --name-only --pretty=format: -n ${sinceCommits} 2>/dev/null`;
    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });

    // Parse output - files appear in order of recency
    const lines = output.split("\n").filter((line) => line.trim() !== "");

    // Track seen files to preserve order but deduplicate
    const seen = new Set();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        files.push(trimmed);
      }
    }
  } catch {
    // Git not available or not a git repo
  }

  recentlyModifiedCache = files;
  recentlyModifiedCacheTime = now;
  return files;
}

/**
 * Extract keywords from story text for semantic matching
 * @param {string} storyBlock - Story text content
 * @returns {string[]} Array of meaningful keywords
 */
function extractKeywords(storyBlock) {
  if (!storyBlock || typeof storyBlock !== "string") {
    return [];
  }

  // Common stop words to filter out
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "and",
    "but",
    "or",
    "nor",
    "so",
    "yet",
    "both",
    "either",
    "neither",
    "not",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "just",
    "that",
    "this",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "any",
    "some",
    "no",
    "it",
    "its",
    "they",
    "them",
    "their",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "i",
    "me",
    "my",
    "want",
    "using",
    "use",
    "also",
    "developer",
    "user",
    "story",
  ]);

  // Extract words, keeping meaningful ones
  const words = storyBlock
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  return [...new Set(words)];
}

/**
 * Calculate relevance score for a file based on story content
 * @param {string} filePath - Relative file path from project root
 * @param {string} storyBlock - Story text content
 * @param {Object} options - Scoring options
 * @param {string} options.projectRoot - Project root directory
 * @param {string[]} options.recentFiles - Recently modified files (optional, will be fetched if not provided)
 * @param {Object} options.fileReferences - Pre-extracted file references (optional)
 * @returns {number} Relevance score (0-100)
 */
function calculateFileRelevance(filePath, storyBlock, options = {}) {
  const { projectRoot = process.cwd(), recentFiles = null, fileReferences = null } = options;

  let score = 0;
  const filePathLower = filePath.toLowerCase();
  const fileName = path.basename(filePath);
  const fileNameLower = fileName.toLowerCase();
  const fileNameNoExt = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const fileDir = path.dirname(filePath);

  // Extract references from story if not provided
  const refs = fileReferences || extractFileReferences(storyBlock);

  // Rule 1: Direct mentions in story (+10 points)
  // Check if file path is directly mentioned
  for (const mentionedPath of refs.filePaths) {
    if (
      filePathLower.includes(mentionedPath.toLowerCase()) ||
      mentionedPath.toLowerCase().includes(filePathLower)
    ) {
      score += 10;
      break;
    }
  }

  // Check if module name matches file name
  for (const moduleName of refs.moduleNames) {
    const moduleNameLower = moduleName.toLowerCase();
    if (fileNameNoExt === moduleNameLower || fileNameLower.includes(moduleNameLower)) {
      score += 10;
      break;
    }
  }

  // Check directory patterns
  for (const dirPattern of refs.directoryPatterns) {
    if (filePathLower.startsWith(dirPattern.toLowerCase())) {
      score += 5; // Directory match is slightly less specific
      break;
    }
  }

  // Rule 2: Import/require connections (+5 points)
  // Check if this file imports/is imported by mentioned files
  const absolutePath = path.join(projectRoot, filePath);
  const connections = findImportConnections(absolutePath, projectRoot);
  for (const conn of connections) {
    for (const mentionedPath of refs.filePaths) {
      if (conn.toLowerCase().includes(mentionedPath.toLowerCase())) {
        score += 5;
        break;
      }
    }
  }

  // Rule 3: Same directory as mentioned files (+3 points)
  for (const mentionedPath of refs.filePaths) {
    const mentionedDir = path.dirname(mentionedPath);
    if (fileDir.toLowerCase() === mentionedDir.toLowerCase()) {
      score += 3;
      break;
    }
  }

  for (const dirPattern of refs.directoryPatterns) {
    if (fileDir.toLowerCase().startsWith(dirPattern.toLowerCase())) {
      score += 3;
      break;
    }
  }

  // Rule 4: Recent modifications (+2 points)
  const recent = recentFiles || getRecentlyModifiedFiles(projectRoot);
  const recentIndex = recent.findIndex((f) => f.toLowerCase() === filePathLower);
  if (recentIndex !== -1) {
    // More recent = higher score (up to 2 points)
    const recencyBonus = Math.max(0, 2 - Math.floor(recentIndex / 5) * 0.5);
    score += recencyBonus;
  }

  // Rule 5: Semantic similarity - keyword matching (+1-5 points)
  const keywords = extractKeywords(storyBlock);
  if (keywords.length > 0) {
    // Check file path and name for keyword matches
    let keywordMatches = 0;
    for (const keyword of keywords) {
      if (filePathLower.includes(keyword) || fileNameNoExt.includes(keyword)) {
        keywordMatches++;
      }
    }
    // Award 1-5 points based on number of keyword matches
    score += Math.min(keywordMatches, 5);
  }

  // Normalize score to 0-100 range
  return Math.min(Math.round(score), 100);
}

/**
 * Clear all caches (for testing)
 */
function clearCaches() {
  importConnectionsCache = new Map();
  recentlyModifiedCache = null;
  recentlyModifiedCacheTime = 0;
}

module.exports = {
  extractFileReferences,
  findImportConnections,
  resolveImportPath,
  getRecentlyModifiedFiles,
  extractKeywords,
  calculateFileRelevance,
  clearCaches,
};
