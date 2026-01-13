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
