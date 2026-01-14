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
  aggregateDailyCosts,
  compareToBudget,
  getAvailableModels,
  aggregateVelocityMetrics,
  getPrdBurndown,
  compareVelocityAcrossStreams,
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
 * Cost data point for cost time series
 */
export interface CostDataPoint {
  date: string;
  cost: number;
  runs: number;
  stories: number;
  costPerStory: number;
  cumulativeCost: number;
  byModel: Record<string, { cost: number; runs: number }>;
}

/**
 * Model breakdown data
 */
export interface ModelBreakdown {
  cost: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Story cost trend data
 */
export interface StoryCostTrend {
  storyId: string;
  date: string;
  cost: number;
  runs: number;
}

/**
 * Cost trend data
 */
export interface CostTrend {
  period: string;
  groupBy: string;
  startDate: string;
  endDate: string;
  totalCost: number;
  totalRuns: number;
  totalStories: number;
  avgCostPerRun: number;
  avgCostPerStory: number;
  dailyMetrics: CostDataPoint[];
  byModel: Record<string, ModelBreakdown>;
  storyTrends: StoryCostTrend[];
  filters: {
    prd: string;
    model: string;
  };
}

/**
 * Budget comparison data
 */
export interface BudgetComparison {
  date: string;
  cost: number;
  budget: number;
  variance: number;
  overBudget: boolean;
  percentOfBudget: number;
}

/**
 * Cost with budget analysis
 */
export interface CostWithBudget extends CostTrend {
  dailyBudget: number;
  totalBudget: number;
  budgetAnalysis: BudgetComparison[];
  overBudgetDays: number;
  underBudgetDays: number;
  totalVariance: number;
  percentOfTotalBudget: number;
}

/**
 * Filter options for cost trends
 */
export interface CostTrendFilters {
  prd?: string;
  model?: string;
  groupBy?: "day" | "week";
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

// ============================================
// Cost Trend Functions
// ============================================

/**
 * Get cost trends
 * @param period - Time period ("7d" or "30d")
 * @param filters - Optional filters { prd, model, groupBy }
 * @returns Cost trend data
 */
export function getCostTrends(
  period: "7d" | "30d" = "30d",
  filters: CostTrendFilters = {}
): CostTrend {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      period,
      groupBy: filters.groupBy || "day",
      startDate: "",
      endDate: "",
      totalCost: 0,
      totalRuns: 0,
      totalStories: 0,
      avgCostPerRun: 0,
      avgCostPerStory: 0,
      dailyMetrics: [],
      byModel: {},
      storyTrends: [],
      filters: {
        prd: filters.prd || "all",
        model: filters.model || "all",
      },
    };
  }

  const days = period === "30d" ? 30 : 7;
  const result = aggregateDailyCosts(ralphRoot, {
    days,
    prd: filters.prd,
    model: filters.model,
    groupBy: filters.groupBy || "day",
  });

  return result as CostTrend;
}

/**
 * Get cost trends with budget comparison
 * @param period - Time period ("7d" or "30d")
 * @param dailyBudget - Daily budget in dollars
 * @param filters - Optional filters
 * @returns Cost trend data with budget analysis
 */
export function getCostTrendsWithBudget(
  period: "7d" | "30d" = "30d",
  dailyBudget: number,
  filters: CostTrendFilters = {}
): CostWithBudget {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      period,
      groupBy: filters.groupBy || "day",
      startDate: "",
      endDate: "",
      totalCost: 0,
      totalRuns: 0,
      totalStories: 0,
      avgCostPerRun: 0,
      avgCostPerStory: 0,
      dailyMetrics: [],
      byModel: {},
      storyTrends: [],
      filters: {
        prd: filters.prd || "all",
        model: filters.model || "all",
      },
      dailyBudget,
      totalBudget: 0,
      budgetAnalysis: [],
      overBudgetDays: 0,
      underBudgetDays: 0,
      totalVariance: 0,
      percentOfTotalBudget: 0,
    };
  }

  const days = period === "30d" ? 30 : 7;
  const result = compareToBudget(ralphRoot, dailyBudget, {
    days,
    prd: filters.prd,
    model: filters.model,
    groupBy: filters.groupBy || "day",
  });

  return result as CostWithBudget;
}

/**
 * Get available models for filtering
 * @returns Array of available model names
 */
export function getCostFilterOptions(): {
  prds: string[];
  models: string[];
} {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      prds: [],
      models: [],
    };
  }

  const prds = getAvailablePrds(ralphRoot) as string[];
  const models = getAvailableModels(ralphRoot) as string[];

  return { prds, models };
}

/**
 * Format cost trend data for Chart.js
 * @param trend - Cost trend data
 * @param options - Chart options { showBudget, dailyBudget }
 * @returns Chart.js compatible data object
 */
export function formatCostForChart(
  trend: CostTrend,
  options: { showBudget?: boolean; dailyBudget?: number } = {}
): {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    tension: number;
    type?: string;
    borderDash?: number[];
  }>;
} {
  const labels = trend.dailyMetrics.map((dp) => {
    const date = new Date(dp.date);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const costs = trend.dailyMetrics.map((dp) => dp.cost);
  const cumulativeCosts = trend.dailyMetrics.map((dp) => dp.cumulativeCost);
  const costPerStory = trend.dailyMetrics.map((dp) => dp.costPerStory);

  const datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    tension: number;
    type?: string;
    borderDash?: number[];
  }> = [
    {
      label: "Daily Cost ($)",
      data: costs,
      borderColor: "#8b5cf6", // Purple
      backgroundColor: "rgba(139, 92, 246, 0.1)",
      fill: true,
      tension: 0.3,
    },
    {
      label: "Cumulative Cost ($)",
      data: cumulativeCosts,
      borderColor: "#f59e0b", // Amber
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
    },
    {
      label: "Cost per Story ($)",
      data: costPerStory,
      borderColor: "#06b6d4", // Cyan
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
    },
  ];

  // Add budget line if requested
  if (options.showBudget && options.dailyBudget) {
    const budgetLine = trend.dailyMetrics.map(() => options.dailyBudget as number);
    datasets.push({
      label: "Daily Budget ($)",
      data: budgetLine,
      borderColor: "#ef4444", // Red
      backgroundColor: "transparent",
      fill: false,
      tension: 0,
      borderDash: [5, 5],
    });
  }

  return {
    labels,
    datasets,
  };
}

/**
 * Format model breakdown for pie chart
 * @param byModel - Model breakdown data
 * @returns Chart.js compatible pie chart data
 */
export function formatModelBreakdownForChart(byModel: Record<string, ModelBreakdown>): {
  labels: string[];
  datasets: Array<{
    data: number[];
    backgroundColor: string[];
    borderColor: string[];
    borderWidth: number;
  }>;
} {
  const labels = Object.keys(byModel);
  const costs = labels.map((model) => byModel[model].cost);

  // Color palette for models
  const colors = [
    "#8b5cf6", // Purple (Opus)
    "#3b82f6", // Blue (Sonnet)
    "#10b981", // Green (Haiku)
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#06b6d4", // Cyan
  ];

  const backgroundColor = labels.map((_, i) => colors[i % colors.length]);
  const borderColor = backgroundColor.map((c) => c);

  return {
    labels,
    datasets: [
      {
        data: costs,
        backgroundColor,
        borderColor,
        borderWidth: 2,
      },
    ],
  };
}

// ============================================
// Velocity Trend Functions (US-003)
// ============================================

/**
 * Velocity data point for time series
 */
export interface VelocityDataPoint {
  date: string;
  storiesCompleted: number;
  runsCompleted: number;
  totalDuration: number;
  avgDurationSeconds: number;
  avgDurationMinutes: number;
  cumulativeStories?: number;
}

/**
 * Velocity trend data
 */
export interface VelocityTrend {
  period: string;
  groupBy: string;
  startDate: string;
  endDate: string;
  totalStories: number;
  totalRuns: number;
  totalDurationSeconds: number;
  avgTimePerStorySeconds: number;
  avgTimePerStoryMinutes: number;
  avgTimePerRunSeconds: number;
  avgTimePerRunMinutes: number;
  storiesPerDay: number;
  storiesPerWeek: number;
  velocityMetrics: VelocityDataPoint[];
  filters: {
    prd: string;
  };
}

/**
 * Burndown data point
 */
export interface BurndownDataPoint {
  date: string;
  completed: number;
  remaining: number;
  completedStories?: string[];
}

/**
 * Burndown data for a PRD
 */
export interface BurndownData {
  prdId: string;
  totalStories: number;
  completedStories: number;
  remainingStories: number;
  percentComplete: number;
  burndownData: BurndownDataPoint[];
  idealBurndown: Array<{ date: string; remaining: number }>;
  velocity: number;
  estimatedDaysRemaining: number | null;
  estimatedCompletion: string | null;
}

/**
 * Stream velocity data for comparison
 */
export interface StreamVelocity {
  prdId: string;
  name: string;
  totalStories: number;
  totalRuns: number;
  avgTimePerStoryMinutes: number;
  storiesPerDay: number;
  storiesPerWeek: number;
  percentComplete: number;
  remainingStories: number;
  estimatedCompletion: string | null;
  velocityMetrics: VelocityDataPoint[];
}

/**
 * Stream comparison data
 */
export interface StreamComparison {
  period: string;
  streamCount: number;
  streams: StreamVelocity[];
  overall: {
    totalStories: number;
    totalRuns: number;
    avgStoriesPerDay: number;
    avgStoriesPerWeek: number;
  };
}

/**
 * Velocity filter options
 */
export interface VelocityFilters {
  prd?: string;
  groupBy?: "day" | "week";
}

/**
 * Get velocity trends
 * @param period - Time period ("7d" or "30d")
 * @param filters - Optional filters { prd, groupBy }
 * @returns Velocity trend data
 */
export function getVelocityTrends(
  period: "7d" | "30d" = "30d",
  filters: VelocityFilters = {}
): VelocityTrend {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      period,
      groupBy: filters.groupBy || "day",
      startDate: "",
      endDate: "",
      totalStories: 0,
      totalRuns: 0,
      totalDurationSeconds: 0,
      avgTimePerStorySeconds: 0,
      avgTimePerStoryMinutes: 0,
      avgTimePerRunSeconds: 0,
      avgTimePerRunMinutes: 0,
      storiesPerDay: 0,
      storiesPerWeek: 0,
      velocityMetrics: [],
      filters: {
        prd: filters.prd || "all",
      },
    };
  }

  const days = period === "30d" ? 30 : 7;
  const result = aggregateVelocityMetrics(ralphRoot, {
    days,
    prd: filters.prd,
    groupBy: filters.groupBy || "day",
  });

  return result as VelocityTrend;
}

/**
 * Get burndown data for a PRD
 * @param prdId - PRD ID
 * @returns Burndown data
 */
export function getBurndown(prdId: string): BurndownData | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  return getPrdBurndown(ralphRoot, prdId) as BurndownData | null;
}

/**
 * Compare velocity across streams
 * @param period - Time period ("7d" or "30d")
 * @returns Stream comparison data
 */
export function getStreamVelocityComparison(period: "7d" | "30d" = "30d"): StreamComparison {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      period,
      streamCount: 0,
      streams: [],
      overall: {
        totalStories: 0,
        totalRuns: 0,
        avgStoriesPerDay: 0,
        avgStoriesPerWeek: 0,
      },
    };
  }

  const days = period === "30d" ? 30 : 7;
  return compareVelocityAcrossStreams(ralphRoot, { days }) as StreamComparison;
}

/**
 * Format velocity trend data for Chart.js bar chart
 * @param trend - Velocity trend data
 * @returns Chart.js compatible data object
 */
export function formatVelocityForChart(trend: VelocityTrend): {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    type?: string;
  }>;
} {
  const labels = trend.velocityMetrics.map((dp) => {
    const date = new Date(dp.date);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const storiesPerDay = trend.velocityMetrics.map((dp) => dp.storiesCompleted);
  const cumulativeStories = trend.velocityMetrics.map((dp) => dp.cumulativeStories || 0);
  const avgDuration = trend.velocityMetrics.map((dp) => dp.avgDurationMinutes);

  return {
    labels,
    datasets: [
      {
        label: "Stories Completed",
        data: storiesPerDay,
        backgroundColor: "#3b82f6", // Blue
        borderColor: "#2563eb",
        borderWidth: 1,
      },
      {
        label: "Cumulative Stories",
        data: cumulativeStories,
        backgroundColor: "transparent",
        borderColor: "#10b981", // Green
        borderWidth: 2,
        type: "line",
      },
      {
        label: "Avg Duration (min)",
        data: avgDuration,
        backgroundColor: "rgba(249, 115, 22, 0.6)", // Orange
        borderColor: "#f97316",
        borderWidth: 1,
      },
    ],
  };
}

/**
 * Format burndown data for Chart.js line chart
 * @param burndown - Burndown data
 * @returns Chart.js compatible data object
 */
export function formatBurndownForChart(burndown: BurndownData): {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    tension: number;
    borderDash?: number[];
  }>;
} {
  const labels = burndown.burndownData.map((dp) => {
    const date = new Date(dp.date);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const remaining = burndown.burndownData.map((dp) => dp.remaining);
  const idealRemaining = burndown.idealBurndown.map((dp) => dp.remaining);

  return {
    labels,
    datasets: [
      {
        label: "Remaining Stories",
        data: remaining,
        borderColor: "#3b82f6", // Blue
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.3,
      },
      {
        label: "Ideal Burndown",
        data: idealRemaining,
        borderColor: "#9ca3af", // Gray
        backgroundColor: "transparent",
        fill: false,
        tension: 0,
        borderDash: [5, 5],
      },
    ],
  };
}

/**
 * Format stream comparison for Chart.js horizontal bar chart
 * @param comparison - Stream comparison data
 * @returns Chart.js compatible data object
 */
export function formatStreamComparisonForChart(comparison: StreamComparison): {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
  }>;
} {
  const labels = comparison.streams.map((s) => s.name);
  const velocities = comparison.streams.map((s) => s.storiesPerDay);
  const completions = comparison.streams.map((s) => s.percentComplete);

  // Color palette for streams
  const colors = [
    "#3b82f6", // Blue
    "#10b981", // Green
    "#f59e0b", // Amber
    "#8b5cf6", // Purple
    "#ef4444", // Red
    "#06b6d4", // Cyan
  ];

  const backgroundColor = labels.map((_, i) => colors[i % colors.length]);

  return {
    labels,
    datasets: [
      {
        label: "Velocity (stories/day)",
        data: velocities,
        backgroundColor: backgroundColor[0],
        borderColor: backgroundColor[0],
        borderWidth: 1,
      },
      {
        label: "% Complete",
        data: completions,
        backgroundColor: "rgba(16, 185, 129, 0.6)",
        borderColor: "#10b981",
        borderWidth: 1,
      },
    ],
  };
}
