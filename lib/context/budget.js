/**
 * Context budget management - token budgeting for context selection
 *
 * Calculates context budgets based on model limits and manages
 * file selection within token constraints.
 *
 * Budget allocation (from PRD):
 * - contextBudget = modelLimit * 0.4 (40% for context files)
 * - reservedForOutput = modelLimit * 0.3 (30% for response)
 * - reservedForPrompt = modelLimit * 0.3 (30% for prompt template)
 */
const fs = require("fs");
const path = require("path");

// Try to load token estimator from existing module
let estimateTokensFromText;
try {
  const extractor = require("../tokens/extractor");
  estimateTokensFromText = extractor.estimateTokensFromText;
} catch {
  // Fallback: ~4 chars per token
  estimateTokensFromText = (text) => (text ? Math.ceil(text.length / 4) : 0);
}

// Model context limits (in tokens)
const MODEL_LIMITS = {
  // Claude models (all 200K)
  opus: 200000,
  sonnet: 200000,
  haiku: 200000,
  // Claude-specific IDs
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-haiku-20240307": 200000,
  // OpenAI/Codex models
  codex: 128000,
  "gpt-4": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4o": 128000,
  // Droid/Factory
  droid: 128000,
  factory: 128000,
  // Default for unknown models
  default: 128000,
};

// Budget allocation ratios (from PRD)
const BUDGET_RATIOS = {
  context: 0.4, // 40% for context files
  output: 0.3, // 30% for response
  prompt: 0.3, // 30% for prompt template
};

// Warning thresholds for budget utilization
const BUDGET_THRESHOLDS = {
  info: 0.8, // 80% - info level
  warning: 0.9, // 90% - warning level
  critical: 0.95, // 95% - critical warning
};

// File token cache to avoid re-reading
const fileTokenCache = new Map();
const CACHE_TTL_MS = 60000; // 1 minute
let cacheCleanupTime = 0;

/**
 * Get the context limit for a model
 * @param {string} model - Model name or ID
 * @returns {number} Context limit in tokens
 */
function getModelLimit(model) {
  if (!model) {
    return MODEL_LIMITS.default;
  }

  const modelLower = model.toLowerCase();

  // Direct lookup
  if (MODEL_LIMITS[modelLower]) {
    return MODEL_LIMITS[modelLower];
  }

  // Fuzzy matching for model names
  if (modelLower.includes("opus")) return MODEL_LIMITS.opus;
  if (modelLower.includes("sonnet")) return MODEL_LIMITS.sonnet;
  if (modelLower.includes("haiku")) return MODEL_LIMITS.haiku;
  if (modelLower.includes("gpt") || modelLower.includes("codex")) return MODEL_LIMITS.codex;
  if (modelLower.includes("droid") || modelLower.includes("factory")) return MODEL_LIMITS.droid;

  return MODEL_LIMITS.default;
}

/**
 * Calculate budget allocation for a model
 * @param {string} model - Model name or ID
 * @param {Object} options - Override options
 * @param {number} options.contextRatio - Override context ratio (default: 0.4)
 * @param {number} options.outputRatio - Override output ratio (default: 0.3)
 * @param {number} options.promptRatio - Override prompt ratio (default: 0.3)
 * @returns {Object} Budget breakdown
 */
function calculateBudget(model, options = {}) {
  const modelLimit = getModelLimit(model);

  const contextRatio = options.contextRatio ?? BUDGET_RATIOS.context;
  const outputRatio = options.outputRatio ?? BUDGET_RATIOS.output;
  const promptRatio = options.promptRatio ?? BUDGET_RATIOS.prompt;

  return {
    total: modelLimit,
    context: Math.floor(modelLimit * contextRatio),
    output: Math.floor(modelLimit * outputRatio),
    prompt: Math.floor(modelLimit * promptRatio),
    model: model || "default",
    ratios: {
      context: contextRatio,
      output: outputRatio,
      prompt: promptRatio,
    },
  };
}

/**
 * Count tokens in a file
 * @param {string} filePath - Absolute path to file
 * @returns {number} Estimated token count
 */
function countFileTokens(filePath) {
  // Cleanup old cache entries periodically
  const now = Date.now();
  if (now - cacheCleanupTime > CACHE_TTL_MS) {
    for (const [key, entry] of fileTokenCache.entries()) {
      if (now - entry.time > CACHE_TTL_MS) {
        fileTokenCache.delete(key);
      }
    }
    cacheCleanupTime = now;
  }

  // Check cache
  const cached = fileTokenCache.get(filePath);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.tokens;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const tokens = estimateTokensFromText(content);

    fileTokenCache.set(filePath, { tokens, time: now });
    return tokens;
  } catch {
    return 0;
  }
}

/**
 * Read file content (used for truncation)
 * @param {string} filePath - Absolute path to file
 * @returns {string|null} File content or null if error
 */
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Truncate file content to fit within token budget
 * Strategy: Keep first 100 lines + "..." + last 50 lines (per PRD)
 * @param {string} content - Full file content
 * @param {number} maxTokens - Maximum tokens allowed
 * @returns {Object} { content, truncated, originalTokens, resultTokens }
 */
function truncateFile(content, maxTokens) {
  if (!content) {
    return { content: "", truncated: false, originalTokens: 0, resultTokens: 0 };
  }

  const originalTokens = estimateTokensFromText(content);

  // If content fits, return as-is
  if (originalTokens <= maxTokens) {
    return {
      content,
      truncated: false,
      originalTokens,
      resultTokens: originalTokens,
    };
  }

  const lines = content.split("\n");
  const totalLines = lines.length;

  // Default: first 100 lines + last 50 lines
  const headLines = 100;
  const tailLines = 50;

  // If file is small enough that head+tail covers everything, try a different approach
  if (totalLines <= headLines + tailLines) {
    // For smaller files, take proportional amounts
    const ratio = maxTokens / originalTokens;
    const keepLines = Math.floor(totalLines * ratio);
    const truncatedContent = lines.slice(0, keepLines).join("\n") + "\n\n... [truncated] ...";
    const resultTokens = estimateTokensFromText(truncatedContent);

    return {
      content: truncatedContent,
      truncated: true,
      originalTokens,
      resultTokens,
    };
  }

  // Apply head+tail truncation
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const separator = `\n... [${totalLines - headLines - tailLines} lines omitted] ...\n`;

  let truncatedContent = head.join("\n") + separator + tail.join("\n");
  let resultTokens = estimateTokensFromText(truncatedContent);

  // If still too large, reduce proportionally
  if (resultTokens > maxTokens) {
    const ratio = maxTokens / resultTokens;
    const newHeadLines = Math.floor(headLines * ratio);
    const newTailLines = Math.floor(tailLines * ratio);

    const newHead = lines.slice(0, newHeadLines);
    const newTail = lines.slice(-newTailLines);
    const newSeparator = `\n... [${totalLines - newHeadLines - newTailLines} lines omitted] ...\n`;

    truncatedContent = newHead.join("\n") + newSeparator + newTail.join("\n");
    resultTokens = estimateTokensFromText(truncatedContent);
  }

  return {
    content: truncatedContent,
    truncated: true,
    originalTokens,
    resultTokens,
  };
}

/**
 * Get budget utilization status and warnings
 * @param {number} usedTokens - Tokens used
 * @param {number} budgetTokens - Total budget
 * @returns {Object} { percentage, level, message, color }
 */
function getBudgetStatus(usedTokens, budgetTokens) {
  if (!budgetTokens || budgetTokens <= 0) {
    return { percentage: 0, level: "ok", message: null, color: "green" };
  }

  const percentage = usedTokens / budgetTokens;
  const percentDisplay = Math.round(percentage * 100);

  if (percentage >= BUDGET_THRESHOLDS.critical) {
    return {
      percentage: percentDisplay,
      level: "critical",
      message: `Critical: ${percentDisplay}% of context budget used (${usedTokens}/${budgetTokens} tokens)`,
      color: "red",
    };
  }

  if (percentage >= BUDGET_THRESHOLDS.warning) {
    return {
      percentage: percentDisplay,
      level: "warning",
      message: `Warning: ${percentDisplay}% of context budget used (${usedTokens}/${budgetTokens} tokens)`,
      color: "orange",
    };
  }

  if (percentage >= BUDGET_THRESHOLDS.info) {
    return {
      percentage: percentDisplay,
      level: "info",
      message: `Info: ${percentDisplay}% of context budget used (${usedTokens}/${budgetTokens} tokens)`,
      color: "yellow",
    };
  }

  return {
    percentage: percentDisplay,
    level: "ok",
    message: null,
    color: "green",
  };
}

/**
 * Select files within budget, prioritizing by relevance score
 * @param {Array<{file: string, score: number, tokens: number}>} scoredFiles - Files with scores and tokens
 * @param {number} budget - Token budget
 * @param {Object} options - Options
 * @param {boolean} options.truncateLarge - Whether to truncate large files (default: true)
 * @param {number} options.maxFileTokens - Max tokens per file before truncation (default: budget * 0.25)
 * @param {string} options.projectRoot - Project root for reading files (required if truncateLarge=true)
 * @returns {Object} { selected, summary }
 */
function selectWithinBudget(scoredFiles, budget, options = {}) {
  const { truncateLarge = true, maxFileTokens = null, projectRoot = null } = options;

  // Sort by score descending (should already be sorted, but ensure)
  const sorted = [...scoredFiles].sort((a, b) => b.score - a.score);

  const selected = [];
  let usedTokens = 0;
  const truncatedFiles = [];
  const skippedFiles = [];

  // Default max per file: 25% of budget
  const perFileMax = maxFileTokens ?? Math.floor(budget * 0.25);

  for (const item of sorted) {
    const { file, score, tokens } = item;
    let fileTokens = tokens;
    let truncated = false;
    let truncatedContent = null;

    // Check if file needs truncation
    if (fileTokens > perFileMax && truncateLarge && projectRoot) {
      const absolutePath = path.join(projectRoot, file);
      const content = readFileContent(absolutePath);

      if (content) {
        const result = truncateFile(content, perFileMax);
        fileTokens = result.resultTokens;
        truncated = result.truncated;
        truncatedContent = result.content;

        if (truncated) {
          truncatedFiles.push({
            file,
            originalTokens: tokens,
            truncatedTokens: fileTokens,
          });
        }
      }
    }

    // Check if file fits in remaining budget
    if (usedTokens + fileTokens <= budget) {
      selected.push({
        file,
        score,
        tokens: fileTokens,
        originalTokens: truncated ? tokens : fileTokens,
        truncated,
        truncatedContent,
      });
      usedTokens += fileTokens;
    } else {
      // Skip file - doesn't fit
      skippedFiles.push({
        file,
        score,
        tokens: fileTokens,
        reason: "budget_exceeded",
      });
    }
  }

  const budgetStatus = getBudgetStatus(usedTokens, budget);

  return {
    selected,
    summary: {
      totalFiles: selected.length,
      totalTokens: usedTokens,
      budget,
      remaining: budget - usedTokens,
      utilization: Math.round((usedTokens / budget) * 100),
      truncatedFiles: truncatedFiles.length,
      skippedFiles: skippedFiles.length,
      status: budgetStatus,
    },
    truncated: truncatedFiles,
    skipped: skippedFiles,
  };
}

/**
 * Clear token cache (for testing)
 */
function clearTokenCache() {
  fileTokenCache.clear();
  cacheCleanupTime = 0;
}

module.exports = {
  // Model limits
  getModelLimit,
  MODEL_LIMITS,

  // Budget calculation
  calculateBudget,
  BUDGET_RATIOS,

  // Token counting
  countFileTokens,
  estimateTokensFromText,
  clearTokenCache,

  // File truncation
  truncateFile,
  readFileContent,

  // Budget status
  getBudgetStatus,
  BUDGET_THRESHOLDS,

  // Budget-aware selection
  selectWithinBudget,
};
