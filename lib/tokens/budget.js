/**
 * Budget tracking module - checks spending against configured limits
 *
 * Supports:
 * - Daily and monthly budget limits
 * - Alert thresholds (80%, 90%, 100%)
 * - Budget pause feature
 *
 * Config variables read from .agents/ralph/config.sh:
 * - RALPH_BUDGET_DAILY=10.00
 * - RALPH_BUDGET_MONTHLY=100.00
 * - RALPH_BUDGET_ALERT_THRESHOLDS=80,90,100
 * - RALPH_BUDGET_PAUSE_ON_EXCEEDED=false
 */
const fs = require("fs");
const path = require("path");

// Default alert thresholds (percentages)
const DEFAULT_ALERT_THRESHOLDS = [80, 90, 100];

// Cache for budget config
let budgetConfigCache = null;
let budgetConfigLastLoaded = 0;
const BUDGET_CONFIG_CACHE_TTL_MS = 5000;

/**
 * Load budget configuration from config.sh
 * @param {string} repoRoot - Root directory of the repository
 * @returns {Object} Budget configuration
 */
function loadBudgetConfig(repoRoot) {
  const now = Date.now();

  // Return cached config if still valid
  if (budgetConfigCache !== null && now - budgetConfigLastLoaded < BUDGET_CONFIG_CACHE_TTL_MS) {
    return budgetConfigCache;
  }

  const configPath = path.join(repoRoot, ".agents", "ralph", "config.sh");

  const defaultConfig = {
    dailyBudget: null,
    monthlyBudget: null,
    alertThresholds: [...DEFAULT_ALERT_THRESHOLDS],
    pauseOnExceeded: false,
  };

  if (!fs.existsSync(configPath)) {
    budgetConfigCache = defaultConfig;
    budgetConfigLastLoaded = now;
    return budgetConfigCache;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = { ...defaultConfig };

    // Parse budget variables from config.sh
    const patterns = [
      { pattern: /^RALPH_BUDGET_DAILY\s*=\s*"?([0-9.]+)"?/m, key: "dailyBudget", type: "float" },
      {
        pattern: /^RALPH_BUDGET_MONTHLY\s*=\s*"?([0-9.]+)"?/m,
        key: "monthlyBudget",
        type: "float",
      },
      {
        pattern: /^RALPH_BUDGET_ALERT_THRESHOLDS\s*=\s*"?([0-9,]+)"?/m,
        key: "alertThresholds",
        type: "array",
      },
      {
        pattern: /^RALPH_BUDGET_PAUSE_ON_EXCEEDED\s*=\s*"?(\w+)"?/m,
        key: "pauseOnExceeded",
        type: "bool",
      },
    ];

    for (const { pattern, key, type } of patterns) {
      const match = content.match(pattern);
      if (match) {
        if (type === "float") {
          config[key] = parseFloat(match[1]);
        } else if (type === "array") {
          config[key] = match[1]
            .split(",")
            .map((n) => parseInt(n.trim(), 10))
            .filter((n) => !isNaN(n));
        } else if (type === "bool") {
          config[key] = match[1].toLowerCase() === "true";
        } else {
          config[key] = match[1];
        }
      }
    }

    budgetConfigCache = config;
    budgetConfigLastLoaded = now;
    return budgetConfigCache;
  } catch {
    budgetConfigCache = defaultConfig;
    budgetConfigLastLoaded = now;
    return budgetConfigCache;
  }
}

/**
 * Clear the budget config cache (for testing)
 */
function clearBudgetConfigCache() {
  budgetConfigCache = null;
  budgetConfigLastLoaded = 0;
}

/**
 * Get start of today (midnight) as a Date
 * @returns {Date}
 */
function getStartOfDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/**
 * Get start of current month as a Date
 * @returns {Date}
 */
function getStartOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Calculate spending for a time period from runs
 * @param {Array} runs - Array of run objects with cost and timestamp
 * @param {Date} startDate - Start of the period
 * @param {Date} endDate - End of the period (optional, defaults to now)
 * @returns {number} Total spending in the period
 */
function calculateSpendingForPeriod(runs, startDate, endDate = new Date()) {
  if (!runs || !Array.isArray(runs)) {
    return 0;
  }

  let total = 0;
  for (const run of runs) {
    if (!run.timestamp) continue;

    const runDate = new Date(run.timestamp);
    if (runDate >= startDate && runDate <= endDate) {
      total += run.cost || 0;
    }
  }

  return Math.round(total * 1_000_000) / 1_000_000; // Round to 6 decimal places
}

/**
 * Check budget status against configured limits
 * @param {Array} runs - Array of run objects with cost and timestamp
 * @param {string} repoRoot - Root directory for loading config
 * @returns {Object} Budget status
 */
function checkBudget(runs, repoRoot) {
  const config = loadBudgetConfig(repoRoot);

  const startOfDay = getStartOfDay();
  const startOfMonth = getStartOfMonth();

  const dailySpending = calculateSpendingForPeriod(runs, startOfDay);
  const monthlySpending = calculateSpendingForPeriod(runs, startOfMonth);

  const status = {
    daily: {
      spent: dailySpending,
      limit: config.dailyBudget,
      hasLimit: config.dailyBudget !== null && config.dailyBudget > 0,
      percentage: 0,
      remaining: null,
      exceeded: false,
      alerts: [],
    },
    monthly: {
      spent: monthlySpending,
      limit: config.monthlyBudget,
      hasLimit: config.monthlyBudget !== null && config.monthlyBudget > 0,
      percentage: 0,
      remaining: null,
      exceeded: false,
      alerts: [],
    },
    pauseOnExceeded: config.pauseOnExceeded,
    shouldPause: false,
    alertThresholds: config.alertThresholds,
  };

  // Calculate daily budget status
  if (status.daily.hasLimit) {
    status.daily.percentage = Math.round((dailySpending / config.dailyBudget) * 100);
    status.daily.remaining = Math.max(0, config.dailyBudget - dailySpending);
    status.daily.exceeded = dailySpending >= config.dailyBudget;

    // Check which alert thresholds have been crossed
    for (const threshold of config.alertThresholds) {
      if (status.daily.percentage >= threshold) {
        status.daily.alerts.push({
          threshold,
          message: `${threshold}% of daily budget consumed ($${dailySpending.toFixed(2)}/$${config.dailyBudget.toFixed(2)})`,
        });
      }
    }
  }

  // Calculate monthly budget status
  if (status.monthly.hasLimit) {
    status.monthly.percentage = Math.round((monthlySpending / config.monthlyBudget) * 100);
    status.monthly.remaining = Math.max(0, config.monthlyBudget - monthlySpending);
    status.monthly.exceeded = monthlySpending >= config.monthlyBudget;

    // Check which alert thresholds have been crossed
    for (const threshold of config.alertThresholds) {
      if (status.monthly.percentage >= threshold) {
        status.monthly.alerts.push({
          threshold,
          message: `${threshold}% of monthly budget consumed ($${monthlySpending.toFixed(2)}/$${config.monthlyBudget.toFixed(2)})`,
        });
      }
    }
  }

  // Determine if builds should pause
  if (config.pauseOnExceeded) {
    status.shouldPause = status.daily.exceeded || status.monthly.exceeded;
  }

  return status;
}

/**
 * Get the highest triggered alert for a period
 * @param {Object} periodStatus - Daily or monthly status object
 * @returns {Object|null} Highest alert or null
 */
function getHighestAlert(periodStatus) {
  if (!periodStatus.alerts || periodStatus.alerts.length === 0) {
    return null;
  }
  return periodStatus.alerts[periodStatus.alerts.length - 1];
}

/**
 * Format budget alert message for logging
 * @param {string} period - "daily" or "monthly"
 * @param {Object} alert - Alert object with threshold and message
 * @returns {string} Formatted alert message
 */
function formatBudgetAlert(period, alert) {
  return `[WARN] Budget alert: ${alert.message}`;
}

/**
 * Get budget progress for display (percentage and status)
 * @param {Object} status - Budget status from checkBudget
 * @param {string} period - "daily" or "monthly"
 * @returns {Object} Progress info for UI display
 */
function getBudgetProgress(status, period) {
  const periodStatus = status[period];

  if (!periodStatus.hasLimit) {
    return {
      hasLimit: false,
      percentage: 0,
      spent: 0,
      limit: 0,
      remaining: null,
      status: "unlimited",
      color: "neutral",
    };
  }

  // Determine color based on percentage
  let color = "green";
  if (periodStatus.percentage >= 100) {
    color = "red";
  } else if (periodStatus.percentage >= 90) {
    color = "orange";
  } else if (periodStatus.percentage >= 80) {
    color = "yellow";
  }

  return {
    hasLimit: true,
    percentage: Math.min(periodStatus.percentage, 100), // Cap at 100 for display
    actualPercentage: periodStatus.percentage, // May be > 100 if exceeded
    spent: periodStatus.spent,
    limit: periodStatus.limit,
    remaining: periodStatus.remaining,
    exceeded: periodStatus.exceeded,
    status: periodStatus.exceeded ? "exceeded" : "ok",
    color,
  };
}

/**
 * Check if budget allows a new build
 * @param {Array} runs - Array of run objects with cost and timestamp
 * @param {string} repoRoot - Root directory for loading config
 * @returns {Object} { allowed: boolean, reason: string }
 */
function canStartBuild(runs, repoRoot) {
  const status = checkBudget(runs, repoRoot);

  if (!status.pauseOnExceeded) {
    return { allowed: true, reason: null };
  }

  if (status.daily.exceeded) {
    return {
      allowed: false,
      reason: `Daily budget exceeded ($${status.daily.spent.toFixed(2)}/$${status.daily.limit.toFixed(2)}). Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
    };
  }

  if (status.monthly.exceeded) {
    return {
      allowed: false,
      reason: `Monthly budget exceeded ($${status.monthly.spent.toFixed(2)}/$${status.monthly.limit.toFixed(2)}). Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
    };
  }

  return { allowed: true, reason: null };
}

module.exports = {
  loadBudgetConfig,
  clearBudgetConfigCache,
  getStartOfDay,
  getStartOfMonth,
  calculateSpendingForPeriod,
  checkBudget,
  getHighestAlert,
  formatBudgetAlert,
  getBudgetProgress,
  canStartBuild,
  DEFAULT_ALERT_THRESHOLDS,
};
