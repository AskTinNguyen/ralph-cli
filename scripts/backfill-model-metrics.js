#!/usr/bin/env node
/**
 * Backfill model metrics from activity.log MODEL_SELECTION events
 *
 * The metrics.jsonl files have incorrect model values ("codex", "None", "unknown")
 * because TOKEN_MODEL was extracted from log content instead of routing decisions.
 *
 * This script:
 * 1. Reads activity.log files to extract MODEL_SELECTION events (correct model data)
 * 2. Updates metrics.jsonl files to use the correct routed models
 * 3. Rebuilds tokens.json cache files
 */

const fs = require('fs');
const path = require('path');

// Parse MODEL_SELECTION events from activity.log
function parseModelSelections(activityLogPath) {
  if (!fs.existsSync(activityLogPath)) {
    return {};
  }

  const content = fs.readFileSync(activityLogPath, 'utf8');
  const modelByStory = {};

  // Pattern: [timestamp] MODEL_SELECTION story=US-001 complexity=5 model=sonnet reason="..."
  const pattern = /MODEL_SELECTION story=([^\s]+) complexity=[\d.]+(?:\s+|\/10\s+)model=(\w+)/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const [, storyId, model] = match;
    modelByStory[storyId] = model;
  }

  return modelByStory;
}

// Update metrics.jsonl with correct models
function updateMetricsJsonl(metricsPath, modelByStory) {
  if (!fs.existsSync(metricsPath)) {
    return { updated: 0, total: 0 };
  }

  const content = fs.readFileSync(metricsPath, 'utf8');
  const lines = content.trim().split('\n').filter(l => l.trim());

  let updated = 0;
  const updatedLines = lines.map(line => {
    try {
      const metric = JSON.parse(line);
      const correctModel = modelByStory[metric.storyId];

      if (correctModel && metric.model !== correctModel) {
        const oldModel = metric.model;
        metric.model = correctModel;
        updated++;
        console.log(`  ${metric.storyId}: ${oldModel} → ${correctModel}`);
      }

      return JSON.stringify(metric);
    } catch (err) {
      console.error(`Error parsing metric line: ${err.message}`);
      return line;
    }
  });

  if (updated > 0) {
    fs.writeFileSync(metricsPath, updatedLines.join('\n') + '\n', 'utf8');
  }

  return { updated, total: lines.length };
}

// Main execution
function main() {
  const rootDir = process.cwd();
  const ralphDir = path.join(rootDir, '.ralph');

  if (!fs.existsSync(ralphDir)) {
    console.error('No .ralph directory found. Run this from project root.');
    process.exit(1);
  }

  console.log('🔍 Scanning for PRD directories...\n');

  const allEntries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdDirs = allEntries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('PRD-'))
    .map(entry => path.join(ralphDir, entry.name));

  let totalPRDs = 0;
  let totalUpdated = 0;
  let totalMetrics = 0;

  for (const prdDir of prdDirs) {
    const prdName = path.basename(prdDir);
    const activityLogPath = path.join(prdDir, 'activity.log');
    const metricsPath = path.join(prdDir, 'runs', 'metrics.jsonl');

    if (!fs.existsSync(metricsPath)) {
      continue; // Skip PRDs without metrics
    }

    console.log(`📊 ${prdName}`);

    // Parse model selections from activity log
    const modelByStory = parseModelSelections(activityLogPath);
    const modelCount = Object.keys(modelByStory).length;

    if (modelCount === 0) {
      console.log('  No MODEL_SELECTION events found\n');
      continue;
    }

    console.log(`  Found ${modelCount} model selections`);

    // Update metrics.jsonl
    const { updated, total } = updateMetricsJsonl(metricsPath, modelByStory);

    totalPRDs++;
    totalUpdated += updated;
    totalMetrics += total;

    console.log(`  Updated ${updated}/${total} metrics\n`);
  }

  console.log('═══════════════════════════════════════');
  console.log(`✅ Backfill complete`);
  console.log(`   PRDs processed: ${totalPRDs}`);
  console.log(`   Metrics updated: ${totalUpdated}/${totalMetrics}`);
  console.log('═══════════════════════════════════════\n');

  if (totalUpdated > 0) {
    console.log('💡 Next steps:');
    console.log('   1. Rebuild token caches: node lib/tokens/cache-cli.js rebuild');
    console.log('   2. Restart dashboard to see updated data');
  }
}

main();
