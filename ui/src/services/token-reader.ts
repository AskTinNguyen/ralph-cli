/**
 * Token Reader Service
 *
 * Reads token metrics from all PRD-N folders and provides aggregated data
 * for the token dashboard API endpoints.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getRalphRoot, getStreams } from './state-reader.js';
import type {
  TokenMetrics,
  TokenSummary,
  StreamTokenSummary,
  StoryTokenSummary,
  RunTokenData,
  TokenTrend,
  TokenTrendDataPoint,
  ModelEfficiency,
  ModelComparison,
  ModelRecommendations,
} from '../types.js';

/**
 * Token cache structure from lib/tokens/cache.js
 */
interface TokenCache {
  streamId: number;
  lastUpdated: string;
  totals?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    avgCostPerRun: number;
    estimatedCount: number;
    runCount: number;
  };
  byStory?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    runs: number;
    estimatedCount: number;
  }>;
  byModel?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    runs: number;
  }>;
  runs?: Array<{
    runId: string;
    storyId: string | null;
    inputTokens: number;
    outputTokens: number;
    model: string | null;
    timestamp: string;
    estimated: boolean;
    cost: number;
    inputCost: number;
    outputCost: number;
  }>;
}

/**
 * Load token cache from a stream directory
 */
function loadTokenCache(streamPath: string): TokenCache | null {
  const cachePath = path.join(streamPath, 'tokens.json');

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(content) as TokenCache;
  } catch {
    return null;
  }
}

/**
 * Round cost to 6 decimal places
 */
function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Get overall token/cost summary across all streams
 */
export function getTokenSummary(): TokenSummary {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      avgCostPerStory: 0,
      avgCostPerRun: 0,
      byStream: [],
      byModel: {},
    };
  }

  const streams = getStreams();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalRuns = 0;
  let totalStories = 0;
  const byStream: StreamTokenSummary[] = [];
  const byModel: Record<string, TokenMetrics> = {};

  for (const stream of streams) {
    const cache = loadTokenCache(stream.path);

    if (!cache) {
      // Add stream with zero metrics
      byStream.push({
        streamId: stream.id,
        streamName: stream.name,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        runCount: 0,
        storyCount: 0,
        avgCostPerStory: 0,
      });
      continue;
    }

    const streamInputTokens = cache.totals?.totalInputTokens || 0;
    const streamOutputTokens = cache.totals?.totalOutputTokens || 0;
    const streamCost = cache.totals?.totalCost || 0;
    const runCount = cache.runs?.length || 0;
    const storyCount = cache.byStory ? Object.keys(cache.byStory).length : 0;

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;
    totalCost += streamCost;
    totalRuns += runCount;
    totalStories += storyCount;

    byStream.push({
      streamId: stream.id,
      streamName: stream.name,
      inputTokens: streamInputTokens,
      outputTokens: streamOutputTokens,
      totalCost: roundCost(streamCost),
      runCount,
      storyCount,
      avgCostPerStory: storyCount > 0 ? roundCost(streamCost / storyCount) : 0,
    });

    // Aggregate by model
    if (cache.byModel) {
      for (const [model, metrics] of Object.entries(cache.byModel)) {
        if (!byModel[model]) {
          byModel[model] = {
            inputTokens: 0,
            outputTokens: 0,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            runCount: 0,
          };
        }
        byModel[model].inputTokens += metrics.inputTokens;
        byModel[model].outputTokens += metrics.outputTokens;
        byModel[model].totalCost = roundCost(byModel[model].totalCost + metrics.totalCost);
        byModel[model].inputCost = roundCost((byModel[model].inputCost || 0) + metrics.inputCost);
        byModel[model].outputCost = roundCost((byModel[model].outputCost || 0) + metrics.outputCost);
        byModel[model].runCount = (byModel[model].runCount || 0) + metrics.runs;
      }
    }
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCost: roundCost(totalCost),
    avgCostPerStory: totalStories > 0 ? roundCost(totalCost / totalStories) : 0,
    avgCostPerRun: totalRuns > 0 ? roundCost(totalCost / totalRuns) : 0,
    byStream,
    byModel,
  };
}

/**
 * Get detailed token metrics for a specific stream
 */
export function getStreamTokens(streamId: string): StreamTokenSummary | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  // Find the stream directory
  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);

  if (!fs.existsSync(streamPath)) {
    return null;
  }

  const cache = loadTokenCache(streamPath);

  // Get stream name from PRD
  let streamName = `PRD-${streamId}`;
  const prdPath = path.join(streamPath, 'prd.md');
  if (fs.existsSync(prdPath)) {
    try {
      const prdContent = fs.readFileSync(prdPath, 'utf-8');
      const titleMatch = prdContent.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        streamName = titleMatch[1].trim();
      }
    } catch {
      // Use default name
    }
  }

  if (!cache) {
    return {
      streamId,
      streamName,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      runCount: 0,
      storyCount: 0,
      avgCostPerStory: 0,
      byStory: {},
      byModel: {},
      runs: [],
    };
  }

  const runCount = cache.runs?.length || 0;
  const storyCount = cache.byStory ? Object.keys(cache.byStory).length : 0;
  const totalCost = cache.totals?.totalCost || 0;

  // Transform runs for response
  const runs: RunTokenData[] = (cache.runs || []).map(run => ({
    runId: run.runId,
    storyId: run.storyId || undefined,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    model: run.model || undefined,
    timestamp: run.timestamp,
    estimated: run.estimated,
    cost: run.cost,
  }));

  return {
    streamId,
    streamName,
    inputTokens: cache.totals?.totalInputTokens || 0,
    outputTokens: cache.totals?.totalOutputTokens || 0,
    totalCost: roundCost(totalCost),
    runCount,
    storyCount,
    avgCostPerStory: storyCount > 0 ? roundCost(totalCost / storyCount) : 0,
    byStory: cache.byStory || {},
    byModel: cache.byModel || {},
    runs,
  };
}

/**
 * Get token metrics for a specific story within a stream
 */
export function getStoryTokens(streamId: string, storyId: string): StoryTokenSummary | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);

  if (!fs.existsSync(streamPath)) {
    return null;
  }

  const cache = loadTokenCache(streamPath);

  if (!cache || !cache.byStory || !cache.byStory[storyId]) {
    return null;
  }

  const storyMetrics = cache.byStory[storyId];

  // Get all runs for this story
  const runs: RunTokenData[] = (cache.runs || [])
    .filter(run => run.storyId === storyId)
    .map(run => ({
      runId: run.runId,
      storyId: run.storyId || undefined,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      model: run.model || undefined,
      timestamp: run.timestamp,
      estimated: run.estimated,
      cost: run.cost,
    }));

  return {
    streamId,
    storyId,
    inputTokens: storyMetrics.inputTokens,
    outputTokens: storyMetrics.outputTokens,
    totalCost: roundCost(storyMetrics.totalCost),
    runCount: storyMetrics.runs,
    estimatedCount: storyMetrics.estimatedCount,
    runs,
  };
}

/**
 * Get token data for recent runs
 */
export function getRunTokens(options: {
  streamId?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
}): { runs: RunTokenData[]; total: number } {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return { runs: [], total: 0 };
  }

  const { streamId, limit = 50, offset = 0, from, to } = options;

  let allRuns: RunTokenData[] = [];

  // If streamId specified, only get runs from that stream
  if (streamId) {
    const streamPath = path.join(ralphRoot, `PRD-${streamId}`);
    const cache = loadTokenCache(streamPath);

    if (cache?.runs) {
      allRuns = cache.runs.map(run => ({
        runId: run.runId,
        streamId,
        storyId: run.storyId || undefined,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        model: run.model || undefined,
        timestamp: run.timestamp,
        estimated: run.estimated,
        cost: run.cost,
      }));
    }
  } else {
    // Get runs from all streams
    const streams = getStreams();

    for (const stream of streams) {
      const cache = loadTokenCache(stream.path);

      if (cache?.runs) {
        for (const run of cache.runs) {
          allRuns.push({
            runId: run.runId,
            streamId: stream.id,
            storyId: run.storyId || undefined,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            model: run.model || undefined,
            timestamp: run.timestamp,
            estimated: run.estimated,
            cost: run.cost,
          });
        }
      }
    }
  }

  // Filter by date range if specified
  if (from || to) {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    allRuns = allRuns.filter(run => {
      const runDate = new Date(run.timestamp);
      if (fromDate && runDate < fromDate) return false;
      if (toDate && runDate > toDate) return false;
      return true;
    });
  }

  // Sort by timestamp descending (newest first)
  allRuns.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = allRuns.length;
  const paginatedRuns = allRuns.slice(offset, offset + limit);

  return { runs: paginatedRuns, total };
}

/**
 * Get time-series token data for charts
 * @param period - Time period to fetch ('7d', '30d', '90d', 'all')
 * @param streamId - Optional stream ID to filter by (if not provided, returns aggregate)
 */
export function getTokenTrends(
  period: '7d' | '30d' | '90d' | 'all' = '7d',
  streamId?: string
): TokenTrend {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return { period, dataPoints: [], streamId };
  }

  // Calculate date range
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      startDate = new Date(0); // Beginning of time
      break;
  }

  // Determine which streams to process
  let streamsToProcess: Array<{ id: string; path: string }>;

  if (streamId) {
    // Only process the specified stream
    const streamPath = path.join(ralphRoot, `PRD-${streamId}`);
    if (fs.existsSync(streamPath)) {
      streamsToProcess = [{ id: streamId, path: streamPath }];
    } else {
      return { period, dataPoints: [], streamId };
    }
  } else {
    // Process all streams
    streamsToProcess = getStreams();
  }

  const runsByDate = new Map<string, TokenTrendDataPoint>();

  for (const stream of streamsToProcess) {
    const cache = loadTokenCache(stream.path);

    if (!cache?.runs) {
      continue;
    }

    for (const run of cache.runs) {
      const runDate = new Date(run.timestamp);

      // Skip runs outside the date range
      if (runDate < startDate) {
        continue;
      }

      // Group by date (YYYY-MM-DD)
      const dateKey = runDate.toISOString().split('T')[0];

      if (!runsByDate.has(dateKey)) {
        runsByDate.set(dateKey, {
          date: dateKey,
          inputTokens: 0,
          outputTokens: 0,
          totalCost: 0,
          runCount: 0,
        });
      }

      const dataPoint = runsByDate.get(dateKey)!;
      dataPoint.inputTokens += run.inputTokens;
      dataPoint.outputTokens += run.outputTokens;
      dataPoint.totalCost = roundCost(dataPoint.totalCost + run.cost);
      dataPoint.runCount += 1;
    }
  }

  // Convert map to array and sort by date
  const dataPoints = Array.from(runsByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date));

  return { period, dataPoints, streamId };
}

/**
 * Budget status structure
 */
interface BudgetPeriodStatus {
  spent: number;
  limit: number | null;
  hasLimit: boolean;
  percentage: number;
  remaining: number | null;
  exceeded: boolean;
  alerts: Array<{
    threshold: number;
    message: string;
  }>;
}

export interface BudgetStatus {
  daily: BudgetPeriodStatus;
  monthly: BudgetPeriodStatus;
  pauseOnExceeded: boolean;
  shouldPause: boolean;
  alertThresholds: number[];
}

/**
 * Load budget configuration from config.sh
 */
function loadBudgetConfig(): {
  dailyBudget: number | null;
  monthlyBudget: number | null;
  alertThresholds: number[];
  pauseOnExceeded: boolean;
} {
  const defaultConfig = {
    dailyBudget: null as number | null,
    monthlyBudget: null as number | null,
    alertThresholds: [80, 90, 100],
    pauseOnExceeded: false,
  };

  // Find config file in repo root
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return defaultConfig;
  }

  // Navigate up from .ralph to find repo root
  const repoRoot = path.dirname(ralphRoot);
  const configPath = path.join(repoRoot, '.agents', 'ralph', 'config.sh');

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = { ...defaultConfig };

    // Parse budget variables from config.sh
    const patterns = [
      { pattern: /^RALPH_BUDGET_DAILY\s*=\s*"?([0-9.]+)"?/m, key: 'dailyBudget', type: 'float' },
      { pattern: /^RALPH_BUDGET_MONTHLY\s*=\s*"?([0-9.]+)"?/m, key: 'monthlyBudget', type: 'float' },
      { pattern: /^RALPH_BUDGET_ALERT_THRESHOLDS\s*=\s*"?([0-9,]+)"?/m, key: 'alertThresholds', type: 'array' },
      { pattern: /^RALPH_BUDGET_PAUSE_ON_EXCEEDED\s*=\s*"?(\w+)"?/m, key: 'pauseOnExceeded', type: 'bool' },
    ] as const;

    for (const { pattern, key, type } of patterns) {
      const match = content.match(pattern);
      if (match) {
        if (type === 'float') {
          (config as Record<string, unknown>)[key] = parseFloat(match[1]);
        } else if (type === 'array') {
          (config as Record<string, unknown>)[key] = match[1]
            .split(',')
            .map((n: string) => parseInt(n.trim(), 10))
            .filter((n: number) => !isNaN(n));
        } else if (type === 'bool') {
          (config as Record<string, unknown>)[key] = match[1].toLowerCase() === 'true';
        }
      }
    }

    return config;
  } catch {
    return defaultConfig;
  }
}

/**
 * Get start of today (midnight) as a Date
 */
function getStartOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/**
 * Get start of current month as a Date
 */
function getStartOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Get all runs from all streams
 */
function getAllRuns(): Array<{
  runId: string;
  timestamp: string;
  cost: number;
}> {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return [];
  }

  const streams = getStreams();
  const allRuns: Array<{ runId: string; timestamp: string; cost: number }> = [];

  for (const stream of streams) {
    const cache = loadTokenCache(stream.path);
    if (cache?.runs) {
      for (const run of cache.runs) {
        allRuns.push({
          runId: run.runId,
          timestamp: run.timestamp,
          cost: run.cost,
        });
      }
    }
  }

  return allRuns;
}

/**
 * Calculate spending for a time period from runs
 */
function calculateSpendingForPeriod(
  runs: Array<{ timestamp: string; cost: number }>,
  startDate: Date,
  endDate: Date = new Date()
): number {
  if (!runs || runs.length === 0) {
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

  return roundCost(total);
}

/**
 * Get budget status - checks current spending against configured limits
 */
export function getBudgetStatus(): BudgetStatus {
  const config = loadBudgetConfig();
  const runs = getAllRuns();

  const startOfDay = getStartOfDay();
  const startOfMonth = getStartOfMonth();

  const dailySpending = calculateSpendingForPeriod(runs, startOfDay);
  const monthlySpending = calculateSpendingForPeriod(runs, startOfMonth);

  const status: BudgetStatus = {
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
  if (status.daily.hasLimit && config.dailyBudget) {
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
  if (status.monthly.hasLimit && config.monthlyBudget) {
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
 * Calculate efficiency metrics for runs grouped by model
 * This is a TypeScript implementation matching the logic in lib/tokens/calculator.js
 */
export function calculateModelEfficiency(
  runs: Array<{
    model?: string | null;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    storyId?: string | null;
  }>
): Record<string, ModelEfficiency> {
  if (!runs || runs.length === 0) {
    return {};
  }

  // Group runs by model
  const byModel: Record<string, {
    model: string;
    totalRuns: number;
    successfulRuns: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    storyIds: Set<string>;
  }> = {};

  for (const run of runs) {
    const model = run.model || 'unknown';

    if (!byModel[model]) {
      byModel[model] = {
        model,
        totalRuns: 0,
        successfulRuns: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        storyIds: new Set(),
      };
    }

    const m = byModel[model];
    m.totalRuns++;
    m.totalTokens += (run.inputTokens || 0) + (run.outputTokens || 0);
    m.totalInputTokens += run.inputTokens || 0;
    m.totalOutputTokens += run.outputTokens || 0;
    m.totalCost += run.cost || 0;

    // Consider a run successful if it has a storyId and positive cost
    if (run.storyId && run.cost > 0) {
      m.successfulRuns++;
      m.storyIds.add(run.storyId);
    }
  }

  // Calculate efficiency metrics
  const result: Record<string, ModelEfficiency> = {};

  for (const model of Object.keys(byModel)) {
    const m = byModel[model];
    const storiesCount = m.storyIds.size;

    result[model] = {
      model,
      totalRuns: m.totalRuns,
      successfulRuns: m.successfulRuns,
      totalTokens: m.totalTokens,
      totalInputTokens: m.totalInputTokens,
      totalOutputTokens: m.totalOutputTokens,
      totalCost: roundCost(m.totalCost),
      storiesCompleted: storiesCount,

      // Efficiency metrics
      tokensPerRun: m.totalRuns > 0 ? Math.round(m.totalTokens / m.totalRuns) : 0,
      tokensPerSuccessfulRun: m.successfulRuns > 0 ? Math.round(m.totalTokens / m.successfulRuns) : 0,
      costPerRun: m.totalRuns > 0 ? roundCost(m.totalCost / m.totalRuns) : 0,
      costPerSuccessfulRun: m.successfulRuns > 0 ? roundCost(m.totalCost / m.successfulRuns) : 0,
      costPerStory: storiesCount > 0 ? roundCost(m.totalCost / storiesCount) : 0,
      successRate: m.totalRuns > 0 ? Math.round((m.successfulRuns / m.totalRuns) * 100) : 0,

      // Efficiency score (lower is better)
      efficiencyScore: storiesCount > 0 && m.successfulRuns > 0
        ? Math.round(
            (m.totalTokens / storiesCount) * 0.4 +
            (m.totalCost / storiesCount) * 1000 * 0.4 +
            ((100 - (m.successfulRuns / m.totalRuns) * 100)) * 100 * 0.2
          )
        : null,
    };
  }

  return result;
}

/**
 * Compare efficiency between two models
 */
export function compareModels(
  modelAMetrics: ModelEfficiency | undefined,
  modelBMetrics: ModelEfficiency | undefined
): ModelComparison {
  if (!modelAMetrics || !modelBMetrics) {
    return {
      valid: false,
      reason: 'Both models must have efficiency data for comparison',
    };
  }

  const comparison: ModelComparison = {
    valid: true,
    modelA: modelAMetrics.model,
    modelB: modelBMetrics.model,
    metrics: {},
    recommendations: [],
  };

  // Compare key metrics
  const metrics = [
    { key: 'tokensPerRun', label: 'Tokens per Run', lowerBetter: true },
    { key: 'costPerRun', label: 'Cost per Run', lowerBetter: true },
    { key: 'costPerStory', label: 'Cost per Story', lowerBetter: true },
    { key: 'successRate', label: 'Success Rate', lowerBetter: false },
    { key: 'efficiencyScore', label: 'Efficiency Score', lowerBetter: true },
  ] as const;

  for (const { key, label, lowerBetter } of metrics) {
    const aValue = modelAMetrics[key];
    const bValue = modelBMetrics[key];

    if (aValue == null || bValue == null) continue;

    let winner: string | null = null;
    let difference = 0;
    let percentDiff = 0;

    if (aValue !== bValue) {
      if (lowerBetter) {
        winner = aValue < bValue ? modelAMetrics.model : modelBMetrics.model;
      } else {
        winner = aValue > bValue ? modelAMetrics.model : modelBMetrics.model;
      }

      const baseValue = Math.max(aValue, bValue);
      difference = Math.abs(aValue - bValue);
      percentDiff = baseValue > 0 ? Math.round((difference / baseValue) * 100) : 0;
    }

    comparison.metrics![key] = {
      label,
      modelA: aValue,
      modelB: bValue,
      winner,
      difference,
      percentDiff,
    };
  }

  // Generate recommendations
  const effA = modelAMetrics.efficiencyScore;
  const effB = modelBMetrics.efficiencyScore;
  const successA = modelAMetrics.successRate;
  const successB = modelBMetrics.successRate;
  const costA = modelAMetrics.costPerStory;
  const costB = modelBMetrics.costPerStory;

  if (effA != null && effB != null) {
    if (effA < effB * 0.8) {
      comparison.recommendations!.push({
        type: 'overall',
        message: `${modelAMetrics.model} is significantly more efficient overall (${Math.round((1 - effA / effB) * 100)}% better efficiency score)`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (effB < effA * 0.8) {
      comparison.recommendations!.push({
        type: 'overall',
        message: `${modelBMetrics.model} is significantly more efficient overall (${Math.round((1 - effB / effA) * 100)}% better efficiency score)`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  if (costA > 0 && costB > 0) {
    if (costA < costB * 0.7) {
      comparison.recommendations!.push({
        type: 'cost',
        message: `For cost-sensitive tasks, ${modelAMetrics.model} is ${Math.round((1 - costA / costB) * 100)}% cheaper per story`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (costB < costA * 0.7) {
      comparison.recommendations!.push({
        type: 'cost',
        message: `For cost-sensitive tasks, ${modelBMetrics.model} is ${Math.round((1 - costB / costA) * 100)}% cheaper per story`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  if (successA > 0 && successB > 0) {
    if (successA > successB + 15) {
      comparison.recommendations!.push({
        type: 'reliability',
        message: `For reliability-critical tasks, ${modelAMetrics.model} has ${successA - successB}% higher success rate`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (successB > successA + 15) {
      comparison.recommendations!.push({
        type: 'reliability',
        message: `For reliability-critical tasks, ${modelBMetrics.model} has ${successB - successA}% higher success rate`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  if (comparison.recommendations!.length === 0) {
    comparison.recommendations!.push({
      type: 'neutral',
      message: 'Both models show similar efficiency. Choose based on specific requirements.',
      recommendedModel: null,
    });
  }

  return comparison;
}

/**
 * Generate model recommendations for different task types
 */
export function getModelRecommendations(efficiencyByModel: Record<string, ModelEfficiency>): ModelRecommendations {
  const models = Object.keys(efficiencyByModel);

  if (models.length === 0) {
    return { hasData: false, recommendations: [] };
  }

  const recommendations: ModelRecommendations['recommendations'] = [];

  // Find best model for each criterion
  let bestCostModel: string | undefined;
  let bestCost = Infinity;
  let bestSuccessModel: string | undefined;
  let bestSuccess = -1;
  let bestEfficiencyModel: string | undefined;
  let bestEfficiency = Infinity;

  for (const model of models) {
    const metrics = efficiencyByModel[model];

    // Skip models with insufficient data
    if (metrics.totalRuns < 2) continue;

    if (metrics.costPerStory > 0 && metrics.costPerStory < bestCost) {
      bestCost = metrics.costPerStory;
      bestCostModel = model;
    }

    if (metrics.successRate > bestSuccess) {
      bestSuccess = metrics.successRate;
      bestSuccessModel = model;
    }

    if (metrics.efficiencyScore != null && metrics.efficiencyScore < bestEfficiency) {
      bestEfficiency = metrics.efficiencyScore;
      bestEfficiencyModel = model;
    }
  }

  // Generate recommendations
  if (bestEfficiencyModel) {
    recommendations.push({
      taskType: 'general',
      description: 'Best overall efficiency for typical development tasks',
      recommendedModel: bestEfficiencyModel,
      reason: `${bestEfficiencyModel} has the best balance of cost, token usage, and success rate`,
      confidence: bestEfficiency < 50000 ? 'high' : 'medium',
    });
  }

  if (bestCostModel && bestCostModel !== bestEfficiencyModel) {
    recommendations.push({
      taskType: 'cost-sensitive',
      description: 'Budget-conscious development with cost as primary concern',
      recommendedModel: bestCostModel,
      reason: `${bestCostModel} achieves the lowest cost per completed story ($${bestCost.toFixed(4)})`,
      confidence: bestCost < 1 ? 'high' : 'medium',
    });
  }

  if (bestSuccessModel && bestSuccessModel !== bestEfficiencyModel) {
    recommendations.push({
      taskType: 'reliability-critical',
      description: 'Tasks where completion success is critical',
      recommendedModel: bestSuccessModel,
      reason: `${bestSuccessModel} has the highest success rate (${bestSuccess}%)`,
      confidence: bestSuccess > 80 ? 'high' : 'medium',
    });
  }

  // Add specific task type recommendations
  const hasOpus = efficiencyByModel.opus != null;
  const hasSonnet = efficiencyByModel.sonnet != null;
  const hasHaiku = efficiencyByModel.haiku != null;

  if (hasOpus && efficiencyByModel.opus.totalRuns >= 2) {
    recommendations.push({
      taskType: 'complex-tasks',
      description: 'Complex multi-file refactoring or architecture changes',
      recommendedModel: 'opus',
      reason: 'Opus excels at complex reasoning and large codebase understanding',
      confidence: 'high',
    });
  }

  if (hasSonnet && efficiencyByModel.sonnet.totalRuns >= 2) {
    recommendations.push({
      taskType: 'standard-development',
      description: 'Standard feature implementation and bug fixes',
      recommendedModel: 'sonnet',
      reason: 'Sonnet provides a good balance of capability and cost for most tasks',
      confidence: 'high',
    });
  }

  if (hasHaiku && efficiencyByModel.haiku.totalRuns >= 2) {
    recommendations.push({
      taskType: 'simple-tasks',
      description: 'Simple fixes, documentation updates, or straightforward changes',
      recommendedModel: 'haiku',
      reason: 'Haiku offers the best cost efficiency for simpler tasks',
      confidence: 'high',
    });
  }

  return {
    hasData: recommendations.length > 0,
    recommendations,
    bestOverall: bestEfficiencyModel,
    bestCost: bestCostModel,
    bestSuccess: bestSuccessModel,
  };
}

/**
 * Get all runs from all streams for efficiency analysis
 */
export function getAllRunsForEfficiency(): Array<{
  runId: string;
  streamId: string;
  storyId?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: string;
}> {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return [];
  }

  const streams = getStreams();
  const allRuns: Array<{
    runId: string;
    streamId: string;
    storyId?: string | null;
    model?: string | null;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    timestamp: string;
  }> = [];

  for (const stream of streams) {
    const cache = loadTokenCache(stream.path);
    if (cache?.runs) {
      for (const run of cache.runs) {
        allRuns.push({
          runId: run.runId,
          streamId: stream.id,
          storyId: run.storyId,
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cost: run.cost,
          timestamp: run.timestamp,
        });
      }
    }
  }

  return allRuns;
}
