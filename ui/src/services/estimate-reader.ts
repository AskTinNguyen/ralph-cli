/**
 * Estimate Reader Service
 *
 * Reads and caches PRD estimates from the lib/estimate module.
 * Provides data to the dashboard API endpoints for estimation features.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRalphRoot } from './state-reader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Estimate result structure from lib/estimate
 */
export interface StoryEstimate {
  storyId: string;
  title: string;
  completed: boolean;
  taskCount: number;
  keywords: string[];
  complexity: number;
  complexityLevel: 'low' | 'medium' | 'high';
  duration: number;
  durationOptimistic: number;
  durationPessimistic: number;
  tokens: number;
  tokensOptimistic: number;
  tokensPessimistic: number;
  cost: number;
  costOptimistic: number;
  costPessimistic: number;
  confidence: 'low' | 'medium' | 'high';
  historicalSamples: number;
  usedHistory: boolean;
}

export interface EstimateTotals {
  stories: number;
  completed: number;
  pending: number;
  duration: number;
  durationOptimistic: number;
  durationPessimistic: number;
  tokens: number;
  tokensOptimistic: number;
  tokensPessimistic: number;
  cost: number;
  costOptimistic: number;
  costPessimistic: number;
  confidence: 'low' | 'medium' | 'high';
  historicalSamples: number;
  avgHistoricalSamples: number;
  model: string;
}

export interface EstimateResult {
  success: boolean;
  error?: string;
  estimates?: StoryEstimate[];
  totals?: EstimateTotals;
  prdFolder?: string;
}

export interface CachedEstimate extends EstimateResult {
  cached: boolean;
  cachedAt: string | null;
  planModifiedAt?: string;
}

/**
 * Cache structure stored in PRD-N/estimate-cache.json
 */
interface EstimateCache {
  timestamp: string;
  planModifiedAt: string;
  model: string;
  result: EstimateResult;
}

/**
 * Cache validity period in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Load the estimate module dynamically
 * This module is CommonJS, so we use require
 */
function loadEstimateModule(): {
  estimate: (options: {
    prdFolder: string;
    repoRoot?: string;
    model?: string;
  }) => EstimateResult;
} | null {
  try {
    // Navigate from ui/src/services to lib/estimate
    const estimatePath = path.resolve(__dirname, '..', '..', '..', 'lib', 'estimate', 'index.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(estimatePath);
  } catch {
    return null;
  }
}

/**
 * Get the PRD folder path for a given stream ID
 */
function getPrdFolderPath(streamId: string): string | null {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return null;
  }

  const prdFolder = path.join(ralphRoot, `PRD-${streamId}`);
  if (!fs.existsSync(prdFolder)) {
    return null;
  }

  return prdFolder;
}

/**
 * Get the repository root path (parent of .ralph directory)
 */
function getRepoRoot(): string | null {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return null;
  }
  return path.dirname(ralphRoot);
}

/**
 * Get the plan.md modification time
 */
function getPlanModifiedAt(prdFolder: string): string | null {
  const planPath = path.join(prdFolder, 'plan.md');
  if (!fs.existsSync(planPath)) {
    return null;
  }

  try {
    const stats = fs.statSync(planPath);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Load cached estimate from disk
 */
function loadCache(prdFolder: string, model: string): EstimateCache | null {
  const cachePath = path.join(prdFolder, 'estimate-cache.json');

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(content) as EstimateCache;

    // Verify model matches
    if (cache.model !== model) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

/**
 * Save estimate to cache
 */
function saveCache(prdFolder: string, model: string, result: EstimateResult): void {
  const cachePath = path.join(prdFolder, 'estimate-cache.json');
  const planModifiedAt = getPlanModifiedAt(prdFolder);

  const cache: EstimateCache = {
    timestamp: new Date().toISOString(),
    planModifiedAt: planModifiedAt || '',
    model,
    result,
  };

  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Ignore write errors
  }
}

/**
 * Check if cache is still valid
 * Cache is invalid if:
 * - Older than CACHE_TTL_MS (5 minutes)
 * - plan.md has been modified since cache was created
 */
function isCacheValid(cache: EstimateCache, prdFolder: string): boolean {
  // Check age
  const cacheTime = new Date(cache.timestamp).getTime();
  const now = Date.now();

  if (now - cacheTime > CACHE_TTL_MS) {
    return false;
  }

  // Check if plan.md was modified
  const currentPlanModifiedAt = getPlanModifiedAt(prdFolder);
  if (currentPlanModifiedAt && cache.planModifiedAt !== currentPlanModifiedAt) {
    return false;
  }

  return true;
}

/**
 * Get estimate for a stream, using cache when available
 *
 * @param streamId - The PRD stream ID (e.g., "1" for PRD-1)
 * @param options - Options for estimation
 * @param options.model - Model for cost calculation (default: 'sonnet')
 * @param options.force - Force fresh calculation, bypass cache
 * @returns Cached estimate with metadata
 */
export function getStreamEstimate(
  streamId: string,
  options: { model?: string; force?: boolean } = {}
): CachedEstimate {
  const { model = 'sonnet', force = false } = options;

  const prdFolder = getPrdFolderPath(streamId);
  if (!prdFolder) {
    return {
      success: false,
      error: `PRD-${streamId} not found or missing plan.md`,
      cached: false,
      cachedAt: null,
    };
  }

  // Check for plan.md
  const planPath = path.join(prdFolder, 'plan.md');
  if (!fs.existsSync(planPath)) {
    return {
      success: false,
      error: `PRD-${streamId} is missing plan.md. Run \`ralph plan\` first.`,
      cached: false,
      cachedAt: null,
    };
  }

  // Try to use cache unless force refresh
  if (!force) {
    const cache = loadCache(prdFolder, model);
    if (cache && isCacheValid(cache, prdFolder)) {
      return {
        ...cache.result,
        cached: true,
        cachedAt: cache.timestamp,
        planModifiedAt: cache.planModifiedAt,
      };
    }
  }

  // Load the estimate module
  const estimateModule = loadEstimateModule();
  if (!estimateModule) {
    return {
      success: false,
      error: 'Failed to load estimate module',
      cached: false,
      cachedAt: null,
    };
  }

  // Run fresh estimation
  const repoRoot = getRepoRoot();
  const result = estimateModule.estimate({
    prdFolder,
    repoRoot: repoRoot || undefined,
    model,
  });

  // Save to cache if successful
  if (result.success) {
    saveCache(prdFolder, model, result);
  }

  return {
    ...result,
    cached: false,
    cachedAt: new Date().toISOString(),
    planModifiedAt: getPlanModifiedAt(prdFolder) || undefined,
  };
}

/**
 * Get cached estimate only (does not run fresh calculation)
 *
 * @param streamId - The PRD stream ID
 * @param model - Model for cost calculation (default: 'sonnet')
 * @returns Cached estimate or null if not cached/expired
 */
export function getCachedEstimate(
  streamId: string,
  model: string = 'sonnet'
): CachedEstimate | null {
  const prdFolder = getPrdFolderPath(streamId);
  if (!prdFolder) {
    return null;
  }

  const cache = loadCache(prdFolder, model);
  if (!cache || !isCacheValid(cache, prdFolder)) {
    return null;
  }

  return {
    ...cache.result,
    cached: true,
    cachedAt: cache.timestamp,
    planModifiedAt: cache.planModifiedAt,
  };
}

/**
 * Invalidate the estimate cache for a stream
 *
 * @param streamId - The PRD stream ID
 */
export function invalidateEstimateCache(streamId: string): boolean {
  const prdFolder = getPrdFolderPath(streamId);
  if (!prdFolder) {
    return false;
  }

  const cachePath = path.join(prdFolder, 'estimate-cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      fs.unlinkSync(cachePath);
      return true;
    } catch {
      return false;
    }
  }

  return true;
}
