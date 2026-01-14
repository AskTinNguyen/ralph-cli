/**
 * Helper for seeding historical run data for testing
 *
 * Populates .ralph/PRD-N/runs/ with realistic run summaries, metrics.jsonl,
 * and activity logs for testing dashboards, trends, and aggregations.
 *
 * Usage:
 *   import { seedRunData } from './tests/helpers/seed-run-data.js';
 *
 *   await seedRunData(prdDir, {
 *     days: 7,
 *     runsPerDay: 2,
 *     successRate: 0.8
 *   });
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Generate a timestamp for N days ago
 */
function daysAgo(days, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/**
 * Format date as YYYYMMDD-HHMMSS
 */
function formatRunId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

/**
 * Generate random value within range
 */
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Seed run data for a PRD
 * @param {string} prdDir - Path to PRD directory (.ralph/PRD-N)
 * @param {Object} [options] - Seeding options
 * @param {number} [options.days=7] - Number of days of history
 * @param {number} [options.runsPerDay=2] - Runs per day
 * @param {number} [options.successRate=0.8] - Success rate (0-1)
 * @param {number} [options.prdNumber=1] - PRD number
 */
export function seedRunData(prdDir, options = {}) {
  const {
    days = 7,
    runsPerDay = 2,
    successRate = 0.8,
    prdNumber = 1
  } = options;

  // Ensure runs directory exists
  const runsDir = path.join(prdDir, 'runs');
  mkdirSync(runsDir, { recursive: true });

  // Paths
  const metricsPath = path.join(prdDir, 'metrics.jsonl');
  const activityPath = path.join(prdDir, 'activity.log');

  const stories = [
    'US-001: Setup Infrastructure',
    'US-002: Implement Core Feature',
    'US-003: Add Error Handling',
    'US-004: Write Tests',
    'US-005: Add Documentation',
    'US-006: Performance Optimization'
  ];

  let runCount = 0;
  let storyIndex = 0;

  // Generate runs for each day
  for (let day = days - 1; day >= 0; day--) {
    for (let run = 0; run < runsPerDay; run++) {
      runCount++;
      const hour = 9 + run * 4; // Spread runs throughout the day
      const date = daysAgo(day, hour, randomInRange(0, 59));
      const runId = formatRunId(date);
      const story = stories[storyIndex % stories.length];
      const isSuccess = Math.random() < successRate;
      const iterations = randomInRange(1, 3);
      const tokensUsed = randomInRange(10000, 30000);
      const cost = (tokensUsed / 1000000) * (isSuccess ? 1.5 : 2.0); // Higher cost for failures
      const durationMinutes = randomInRange(5, 20);

      // Create run summary
      const summary = createRunSummary({
        runId,
        story,
        isSuccess,
        iterations,
        tokensUsed,
        cost,
        durationMinutes,
        date
      });

      writeFileSync(
        path.join(runsDir, `run-${runId}.md`),
        summary,
        'utf-8'
      );

      // Add metrics.jsonl entry
      const metricsEntry = {
        timestamp: date.toISOString(),
        runId,
        story,
        success: isSuccess,
        iterations,
        tokensUsed,
        cost: Number(cost.toFixed(4)),
        durationSeconds: durationMinutes * 60,
        model: 'claude-sonnet-4-5'
      };

      appendFileSync(
        metricsPath,
        JSON.stringify(metricsEntry) + '\n',
        'utf-8'
      );

      // Add activity.log entry
      const activityEntry = `[${date.toISOString()}] BUILD_START run=${runId} story=${story}\n` +
        `[${date.toISOString()}] ${isSuccess ? 'BUILD_SUCCESS' : 'BUILD_FAILED'} iterations=${iterations} tokens=${tokensUsed}\n`;

      appendFileSync(activityPath, activityEntry, 'utf-8');

      // Move to next story on success
      if (isSuccess) {
        storyIndex++;
      }
    }
  }

  return {
    runsCreated: runCount,
    metricsEntries: runCount,
    storiesCompleted: storyIndex
  };
}

/**
 * Create a run summary markdown
 */
function createRunSummary(options) {
  const {
    runId,
    story,
    isSuccess,
    iterations,
    tokensUsed,
    cost,
    durationMinutes,
    date
  } = options;

  const status = isSuccess ? '✅ SUCCESS' : '❌ FAILED';
  const files = [
    'src/main.js',
    'tests/test.js',
    'README.md'
  ].slice(0, randomInRange(1, 3));

  return `# Run Summary

**Status**: ${status}
**Story**: ${story}
**Run ID**: ${runId}
**Started**: ${date.toISOString()}
**Duration**: ${durationMinutes}m 0s
**Iterations**: ${iterations}

## Metrics

- Tokens used: ${tokensUsed.toLocaleString()}
- Cost: $${cost.toFixed(4)}
- Model: claude-sonnet-4-5

## Files Modified

${files.map(f => `- ${f}`).join('\n')}

${isSuccess ? `## Tests

\`\`\`
✓ All tests passed
\`\`\`

## Commit

Hash: ${Math.random().toString(36).substring(7)}
Message: "Complete ${story}"
` : `## Error

\`\`\`
Build failed after ${iterations} iteration(s)
\`\`\`
`}
`;
}

/**
 * Seed run data with specific patterns (e.g., increasing success over time)
 */
export function seedTrendingRunData(prdDir, options = {}) {
  const { days = 7 } = options;

  // Gradually improve success rate
  for (let day = days - 1; day >= 0; day--) {
    const successRate = 0.5 + (days - day - 1) / days * 0.4; // 50% -> 90%
    seedRunData(prdDir, {
      days: 1,
      runsPerDay: 3,
      successRate,
      ...options
    });
  }
}

/**
 * CLI mode for manual testing
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const testDir = mkdtempSync(path.join(tmpdir(), 'ralph-seed-test-'));
  const prdDir = path.join(testDir, '.ralph', 'PRD-1');
  mkdirSync(prdDir, { recursive: true });

  console.log('Seeding run data...');
  const result = seedRunData(prdDir, {
    days: 7,
    runsPerDay: 2,
    successRate: 0.75
  });

  console.log(`✓ Created ${result.runsCreated} runs`);
  console.log(`✓ ${result.storiesCompleted} stories completed`);
  console.log(`✓ Data written to ${prdDir}`);
  console.log('\nFiles created:');
  console.log(`  - ${result.runsCreated} run summaries in runs/`);
  console.log(`  - metrics.jsonl with ${result.metricsEntries} entries`);
  console.log(`  - activity.log with build events`);
}
