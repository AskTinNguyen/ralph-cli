/**
 * Trends Service
 *
 * Reads success rate metrics and provides trend data for visualization.
 * Works with lib/metrics/aggregator.js for data aggregation.
 */

import { createRequire } from "node:module";
import { getRalphRoot, getStreams } from "./state-reader.js";

// Import CommonJS aggregator module
const require = createRequire(import.meta.url);
const {
  aggregateDailyMetrics,
  getAvailablePrds,
  getAvailableAgents,
  calculateWeekOverWeek,
} = require("../../../lib/metrics/aggregator.js");

/**
 * Data point for success rate time series
 */
export interface SuccessRateDataPoint {
  date: string;
  total: number;
  passed: number;
  failed: number;
  successRate: number | null;
}

/**
 * Significant change event
 */
export interface SignificantChange {
  date: string;
  previousRate: number;
  currentRate: number;
  delta: number;
  direction: "improved" | "declined";
  magnitude: number;
}

/**
 * Success rate trend data
 */
export interface SuccessRateTrend {
  period: string;
  startDate: string;
  endDate: string;
  totalRuns: number;
  totalPassed: number;
  totalFailed: number;
  overallSuccessRate: number | null;
  dailyMetrics: SuccessRateDataPoint[];
  significantChanges: SignificantChange[];
  filters: {
    prd: string;
    agent: string;
    developer: string;
  };
}

/**
 * Week-over-week comparison data
 */
export interface WeekOverWeekComparison {
  thisWeek: {
    successRate: number | null;
    totalRuns: number;
  };
  lastWeek: {
    successRate: number | null;
    totalRuns: number;
  };
  delta: number | null;
  direction: "improved" | "declined" | "stable";
  percentChange: number | null;
}

/**
 * Filter options for trends
 */
export interface TrendFilters {
  prd?: string;
  agent?: string;
  developer?: string;
}

/**
 * Get success rate trends
 * @param period - Time period ("7d" or "30d")
 * @param filters - Optional filters { prd, agent, developer }
 * @returns Success rate trend data
 */
export function getSuccessRateTrends(
  period: "7d" | "30d" = "7d",
  filters: TrendFilters = {}
): SuccessRateTrend {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      period,
      startDate: "",
      endDate: "",
      totalRuns: 0,
      totalPassed: 0,
      totalFailed: 0,
      overallSuccessRate: null,
      dailyMetrics: [],
      significantChanges: [],
      filters: {
        prd: filters.prd || "all",
        agent: filters.agent || "all",
        developer: filters.developer || "all",
      },
    };
  }

  const days = period === "30d" ? 30 : 7;
  const result = aggregateDailyMetrics(ralphRoot, {
    days,
    prd: filters.prd,
    agent: filters.agent,
    developer: filters.developer,
  });

  return result as SuccessRateTrend;
}

/**
 * Get week-over-week comparison
 * @param filters - Optional filters
 * @returns Week-over-week comparison data
 */
export function getWeekOverWeek(filters: TrendFilters = {}): WeekOverWeekComparison {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      thisWeek: { successRate: null, totalRuns: 0 },
      lastWeek: { successRate: null, totalRuns: 0 },
      delta: null,
      direction: "stable",
      percentChange: null,
    };
  }

  return calculateWeekOverWeek(ralphRoot, filters) as WeekOverWeekComparison;
}

/**
 * Get available filter options
 * @returns Object with available PRDs, agents, and developers for filtering
 */
export function getFilterOptions(): {
  prds: string[];
  agents: string[];
  developers: string[];
} {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      prds: [],
      agents: [],
      developers: [],
    };
  }

  const prds = getAvailablePrds(ralphRoot) as string[];
  const agents = getAvailableAgents(ralphRoot) as string[];

  // For now, developers aren't tracked
  const developers = ["default"];

  return { prds, agents, developers };
}

/**
 * Format success rate trend data for Chart.js
 * @param trend - Success rate trend data
 * @returns Chart.js compatible data object
 */
export function formatForChart(trend: SuccessRateTrend): {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    tension: number;
  }>;
  significantChanges: Array<{
    x: number;
    date: string;
    delta: number;
    direction: string;
  }>;
} {
  const labels = trend.dailyMetrics.map((dp) => {
    const date = new Date(dp.date);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const successRates = trend.dailyMetrics.map((dp) =>
    dp.successRate !== null ? dp.successRate : 0
  );
  const passedCounts = trend.dailyMetrics.map((dp) => dp.passed);
  const failedCounts = trend.dailyMetrics.map((dp) => dp.failed);

  // Map significant changes to chart indices
  const significantChangeAnnotations = trend.significantChanges.map((change) => {
    const index = trend.dailyMetrics.findIndex((dp) => dp.date === change.date);
    return {
      x: index,
      date: change.date,
      delta: change.delta,
      direction: change.direction,
    };
  });

  return {
    labels,
    datasets: [
      {
        label: "Success Rate (%)",
        data: successRates,
        borderColor: "#10b981", // Green
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.3,
      },
      {
        label: "Passed",
        data: passedCounts,
        borderColor: "#3b82f6", // Blue
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: false,
        tension: 0.3,
      },
      {
        label: "Failed",
        data: failedCounts,
        borderColor: "#ef4444", // Red
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        fill: false,
        tension: 0.3,
      },
    ],
    significantChanges: significantChangeAnnotations,
  };
}
