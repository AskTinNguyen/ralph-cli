#!/usr/bin/env node
/**
 * Rebuild token caches from metrics.jsonl files (authoritative source)
 */

const fs = require('fs');
const path = require('path');
const { calculateCost } = require('../lib/tokens/calculator');

function rebuildCacheFromMetrics(prdPath) {
  const metricsPath = path.join(prdPath, 'runs', 'metrics.jsonl');

  if (!fs.existsSync(metricsPath)) {
    return null;
  }

  const content = fs.readFileSync(metricsPath, 'utf8');
  const lines = content.trim().split('\n').filter(l => l.trim());

  if (lines.length === 0) {
    return null;
  }

  // Extract stream ID from path
  const streamIdMatch = path.basename(prdPath).match(/PRD-(\d+)/);
  const streamId = streamIdMatch ? parseInt(streamIdMatch[1], 10) : null;

  const runs = [];
  const byStory = {};
  const byModel = {};
  const totals = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    estimatedCount: 0,
    runCount: 0
  };

  for (const line of lines) {
    try {
      const metric = JSON.parse(line);

      // Calculate cost
      const model = metric.model || 'unknown';
      const cost = calculateCost(
        { inputTokens: metric.inputTokens, outputTokens: metric.outputTokens },
        model,
        { repoRoot: process.cwd() }
      );

      // Add to runs array
      runs.push({
        runId: metric.runId,
        storyId: metric.storyId,
        inputTokens: metric.inputTokens,
        outputTokens: metric.outputTokens,
        model: model,
        timestamp: metric.timestamp,
        estimated: false,
        cost: cost.totalCost,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost
      });

      // Aggregate by story
      if (!byStory[metric.storyId]) {
        byStory[metric.storyId] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0, runs: 0 };
      }
      byStory[metric.storyId].inputTokens += metric.inputTokens || 0;
      byStory[metric.storyId].outputTokens += metric.outputTokens || 0;
      byStory[metric.storyId].totalTokens += (metric.inputTokens || 0) + (metric.outputTokens || 0);
      byStory[metric.storyId].totalCost += cost.totalCost;
      byStory[metric.storyId].runs++;

      // Aggregate by model
      if (!byModel[model]) {
        byModel[model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, runs: 0 };
      }
      byModel[model].inputTokens += metric.inputTokens || 0;
      byModel[model].outputTokens += metric.outputTokens || 0;
      byModel[model].totalTokens += (metric.inputTokens || 0) + (metric.outputTokens || 0);
      byModel[model].totalCost += cost.totalCost;
      byModel[model].inputCost += cost.inputCost;
      byModel[model].outputCost += cost.outputCost;
      byModel[model].runs++;

      // Aggregate totals
      totals.totalInputTokens += metric.inputTokens || 0;
      totals.totalOutputTokens += metric.outputTokens || 0;
      totals.totalTokens += (metric.inputTokens || 0) + (metric.outputTokens || 0);
      totals.totalCost += cost.totalCost;
      totals.runCount++;
    } catch (err) {
      console.error(`Error parsing metric: ${err.message}`);
    }
  }

  const cache = {
    streamId,
    lastUpdated: new Date().toISOString(),
    totals,
    byStory,
    byModel,
    runs
  };

  // Save cache
  const cachePath = path.join(prdPath, 'tokens.json');
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');

  return cache;
}

function main() {
  const rootDir = process.cwd();
  const ralphDir = path.join(rootDir, '.ralph');

  if (!fs.existsSync(ralphDir)) {
    console.error('No .ralph directory found. Run this from project root.');
    process.exit(1);
  }

  console.log('🔄 Rebuilding caches from metrics.jsonl...\n');

  const allEntries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdDirs = allEntries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('PRD-'))
    .map(entry => ({ name: entry.name, path: path.join(ralphDir, entry.name) }));

  let rebuilt = 0;

  for (const { name, path: prdPath } of prdDirs) {
    try {
      const cache = rebuildCacheFromMetrics(prdPath);

      if (cache && cache.runs && cache.runs.length > 0) {
        const models = Object.keys(cache.byModel);
        console.log(`✅ ${name}: ${cache.runs.length} runs, models: ${models.join(', ')}`);
        rebuilt++;
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Rebuilt ${rebuilt} caches from metrics.jsonl`);
  console.log('═══════════════════════════════════════');
}

main();
