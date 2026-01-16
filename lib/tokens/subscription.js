/**
 * Subscription and billing tracking (Phase 4.3)
 *
 * Tracks subscription costs separately from API overage costs
 * to provide clear visibility into billing breakdown.
 */

const fs = require("fs");
const path = require("path");

/**
 * Get subscription configuration path
 */
function getSubscriptionConfigPath(ralphDir) {
  return path.join(ralphDir, ".subscription.json");
}

/**
 * Load subscription configuration
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {Object|null} Subscription config or null if not found
 */
function loadSubscriptionConfig(ralphDir) {
  const configPath = getSubscriptionConfigPath(ralphDir);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Save subscription configuration
 * @param {string} ralphDir - Path to .ralph directory
 * @param {Object} config - Subscription configuration
 */
function saveSubscriptionConfig(ralphDir, config) {
  const configPath = getSubscriptionConfigPath(ralphDir);

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...config,
        lastUpdated: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

/**
 * Initialize default subscription configuration
 * @param {string} ralphDir - Path to .ralph directory
 * @param {Object} options - Configuration options
 * @returns {Object} Created configuration
 */
function initSubscriptionConfig(ralphDir, options = {}) {
  const {
    subscriptionType = "max", // 'max', 'api', or 'none'
    monthlyCost = 200, // $200 for Claude Max
    billingPeriodStart = new Date().toISOString().slice(0, 7), // YYYY-MM format
  } = options;

  const config = {
    subscriptionType,
    monthlyCost,
    billingPeriodStart,
    billingPeriods: [
      {
        period: billingPeriodStart,
        subscriptionCost: monthlyCost,
        apiOverageCost: 0,
        totalCost: monthlyCost,
      },
    ],
    created: new Date().toISOString(),
  };

  saveSubscriptionConfig(ralphDir, config);
  return config;
}

/**
 * Record API overage for current billing period
 * @param {string} ralphDir - Path to .ralph directory
 * @param {number} overageCost - API overage cost to add
 */
function recordApiOverage(ralphDir, overageCost) {
  let config = loadSubscriptionConfig(ralphDir);

  if (!config) {
    // Initialize with defaults if not exists
    config = initSubscriptionConfig(ralphDir);
  }

  const currentPeriod = new Date().toISOString().slice(0, 7);
  let periodEntry = config.billingPeriods.find((p) => p.period === currentPeriod);

  if (!periodEntry) {
    // Create new period entry
    periodEntry = {
      period: currentPeriod,
      subscriptionCost: config.monthlyCost || 0,
      apiOverageCost: 0,
      totalCost: config.monthlyCost || 0,
    };
    config.billingPeriods.push(periodEntry);
  }

  // Update overage cost
  periodEntry.apiOverageCost = overageCost;
  periodEntry.totalCost = periodEntry.subscriptionCost + periodEntry.apiOverageCost;

  saveSubscriptionConfig(ralphDir, config);
  return periodEntry;
}

/**
 * Get billing breakdown for current period
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {Object|null} Billing breakdown or null
 */
function getCurrentBillingBreakdown(ralphDir) {
  const config = loadSubscriptionConfig(ralphDir);

  if (!config) {
    return null;
  }

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const periodEntry = config.billingPeriods.find((p) => p.period === currentPeriod);

  if (!periodEntry) {
    return {
      period: currentPeriod,
      subscriptionCost: config.monthlyCost || 0,
      apiOverageCost: 0,
      totalCost: config.monthlyCost || 0,
      trackedApiCost: 0,
      trackingAccuracy: 0,
    };
  }

  return periodEntry;
}

/**
 * Calculate tracking accuracy for API overage
 * @param {string} ralphDir - Path to .ralph directory
 * @param {number} trackedCost - Cost tracked by Ralph CLI
 * @returns {Object} Accuracy breakdown
 */
function calculateTrackingAccuracy(ralphDir, trackedCost) {
  const breakdown = getCurrentBillingBreakdown(ralphDir);

  if (!breakdown || breakdown.apiOverageCost === 0) {
    return {
      trackedCost,
      expectedOverage: 0,
      accuracy: null,
      message: "No API overage cost configured",
    };
  }

  const accuracy = (trackedCost / breakdown.apiOverageCost) * 100;

  return {
    trackedCost,
    expectedOverage: breakdown.apiOverageCost,
    accuracy,
    missing: breakdown.apiOverageCost - trackedCost,
    message:
      accuracy >= 80
        ? "Good tracking accuracy"
        : accuracy >= 50
          ? "Moderate tracking accuracy - consider improvements"
          : "Low tracking accuracy - missing significant costs",
  };
}

/**
 * Format billing breakdown for display
 * @param {Object} breakdown - Billing breakdown object
 * @returns {string} Formatted string
 */
function formatBillingBreakdown(breakdown) {
  if (!breakdown) {
    return "No billing data configured";
  }

  const lines = [
    `Period: ${breakdown.period}`,
    `Subscription: $${breakdown.subscriptionCost.toFixed(2)}`,
    `API Overage: $${breakdown.apiOverageCost.toFixed(2)}`,
    `Total: $${breakdown.totalCost.toFixed(2)}`,
  ];

  if (breakdown.trackedApiCost !== undefined) {
    lines.push(`Tracked: $${breakdown.trackedApiCost.toFixed(2)}`);
    lines.push(`Accuracy: ${breakdown.trackingAccuracy.toFixed(1)}%`);
  }

  return lines.join("\n");
}

module.exports = {
  loadSubscriptionConfig,
  saveSubscriptionConfig,
  initSubscriptionConfig,
  recordApiOverage,
  getCurrentBillingBreakdown,
  calculateTrackingAccuracy,
  formatBillingBreakdown,
};
