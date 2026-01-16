/**
 * Alerts Reader Service
 *
 * Detects critical alerts that require user attention:
 * - Budget exceeded (daily or monthly limits)
 * - Stalled streams (locked > 1 hour with no progress)
 * - Consecutive build failures (> 3 failures in a row)
 * - Checkpoint files (manual intervention required)
 */

import fs from "node:fs";
import path from "node:path";
import { getRalphRoot, getStreams } from "./state-reader.js";
import { getBudgetStatus } from "./token-reader.js";

export interface CriticalAlert {
  type: "budget" | "stalled" | "failures" | "checkpoint";
  severity: "error" | "warning";
  message: string;
  streamId?: string;
  streamName?: string;
  action?: string;
  details?: Record<string, unknown>;
}

/**
 * Check for budget alerts (daily or monthly limits exceeded)
 */
function checkBudgetAlerts(): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];

  try {
    const budget = getBudgetStatus();

    // Daily budget alerts
    if (budget.daily.hasLimit && budget.daily.exceeded) {
      alerts.push({
        type: "budget",
        severity: "error",
        message: `Daily budget exceeded: $${budget.daily.spent.toFixed(2)} / $${budget.daily.limit!.toFixed(2)}`,
        action: budget.pauseOnExceeded
          ? "Builds are paused. Adjust budget in config.sh or wait until tomorrow."
          : "Consider pausing builds or increasing daily budget limit.",
        details: {
          period: "daily",
          spent: budget.daily.spent,
          limit: budget.daily.limit,
          percentage: budget.daily.percentage,
        },
      });
    } else if (budget.daily.hasLimit && budget.daily.percentage >= 90) {
      alerts.push({
        type: "budget",
        severity: "warning",
        message: `Daily budget at ${budget.daily.percentage}%: $${budget.daily.spent.toFixed(2)} / $${budget.daily.limit!.toFixed(2)}`,
        action: "Monitor spending. Consider reducing build iterations.",
        details: {
          period: "daily",
          spent: budget.daily.spent,
          limit: budget.daily.limit,
          percentage: budget.daily.percentage,
        },
      });
    }

    // Monthly budget alerts
    if (budget.monthly.hasLimit && budget.monthly.exceeded) {
      alerts.push({
        type: "budget",
        severity: "error",
        message: `Monthly budget exceeded: $${budget.monthly.spent.toFixed(2)} / $${budget.monthly.limit!.toFixed(2)}`,
        action: budget.pauseOnExceeded
          ? "Builds are paused. Adjust budget in config.sh or wait until next month."
          : "Consider pausing builds or increasing monthly budget limit.",
        details: {
          period: "monthly",
          spent: budget.monthly.spent,
          limit: budget.monthly.limit,
          percentage: budget.monthly.percentage,
        },
      });
    } else if (budget.monthly.hasLimit && budget.monthly.percentage >= 90) {
      alerts.push({
        type: "budget",
        severity: "warning",
        message: `Monthly budget at ${budget.monthly.percentage}%: $${budget.monthly.spent.toFixed(2)} / $${budget.monthly.limit!.toFixed(2)}`,
        action: "Monitor spending. Consider reducing build activity.",
        details: {
          period: "monthly",
          spent: budget.monthly.spent,
          limit: budget.monthly.limit,
          percentage: budget.monthly.percentage,
        },
      });
    }
  } catch {
    // Ignore budget check errors
  }

  return alerts;
}

/**
 * Check for stalled streams (locked > 1 hour with no recent progress)
 */
function checkStalledStreams(): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return alerts;
  }

  const streams = getStreams();
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;

  for (const stream of streams) {
    if (stream.status !== "running") {
      continue;
    }

    // Check lock file age
    const locksDir = path.join(ralphRoot, "locks");
    const lockPaths = [
      path.join(locksDir, `${stream.id}.lock`),
      path.join(locksDir, `PRD-${stream.id}.lock`),
    ];

    for (const lockPath of lockPaths) {
      if (!fs.existsSync(lockPath)) {
        continue;
      }

      try {
        const lockStat = fs.statSync(lockPath);
        const lockAge = now - lockStat.mtimeMs;

        // Check if locked > 1 hour
        if (lockAge > ONE_HOUR_MS) {
          // Verify no recent progress in runs directory
          const runsPath = path.join(stream.path, "runs");
          let hasRecentActivity = false;

          if (fs.existsSync(runsPath)) {
            const runFiles = fs.readdirSync(runsPath);
            for (const file of runFiles) {
              const filePath = path.join(runsPath, file);
              const fileStat = fs.statSync(filePath);
              const fileAge = now - fileStat.mtimeMs;

              if (fileAge < ONE_HOUR_MS) {
                hasRecentActivity = true;
                break;
              }
            }
          }

          if (!hasRecentActivity) {
            const lockHours = Math.floor(lockAge / ONE_HOUR_MS);
            alerts.push({
              type: "stalled",
              severity: "warning",
              message: `Stream ${stream.name} has been locked for ${lockHours}h with no recent activity`,
              streamId: stream.id,
              streamName: stream.name,
              action: "Check running process or manually release lock: rm .ralph/locks/PRD-" + stream.id + ".lock",
              details: {
                lockAge: lockAge,
                lockHours: lockHours,
              },
            });
          }
        }
      } catch {
        // Ignore errors reading lock file
      }
    }
  }

  return alerts;
}

/**
 * Check for consecutive build failures (> 3 in a row)
 */
function checkConsecutiveFailures(): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return alerts;
  }

  const streams = getStreams();

  for (const stream of streams) {
    const progressPath = path.join(stream.path, "progress.md");

    if (!fs.existsSync(progressPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(progressPath, "utf-8");
      const lines = content.split("\n");

      // Look for recent failed iterations
      // Format: "## Iteration N - Failed" or "## Iteration N - Error"
      let consecutiveFailures = 0;
      let lastStoryId: string | undefined;

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];

        // Check for failure markers
        if (line.match(/^##\s+Iteration\s+\d+\s+-\s+(Failed|Error)/i)) {
          consecutiveFailures++;

          // Extract story ID if present
          const storyMatch = lines
            .slice(Math.max(0, i - 10), i + 10)
            .join("\n")
            .match(/Story:\s+(US-\d+)/i);
          if (storyMatch && !lastStoryId) {
            lastStoryId = storyMatch[1];
          }
        } else if (line.match(/^##\s+Iteration\s+\d+\s+-\s+Completed/i)) {
          // Stop counting if we hit a success
          break;
        }
      }

      if (consecutiveFailures > 3) {
        alerts.push({
          type: "failures",
          severity: "error",
          message: `Stream ${stream.name} has ${consecutiveFailures} consecutive build failures`,
          streamId: stream.id,
          streamName: stream.name,
          action: lastStoryId
            ? `Review story ${lastStoryId} or consider agent fallback`
            : "Review recent build logs and consider manual intervention",
          details: {
            consecutiveFailures,
            lastStoryId,
          },
        });
      }
    } catch {
      // Ignore errors reading progress file
    }
  }

  return alerts;
}

/**
 * Check for checkpoint files (manual intervention required)
 */
function checkCheckpoints(): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return alerts;
  }

  const streams = getStreams();

  for (const stream of streams) {
    const checkpointPath = path.join(stream.path, ".checkpoint.json");

    if (fs.existsSync(checkpointPath)) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf-8"));

        alerts.push({
          type: "checkpoint",
          severity: "warning",
          message: `Stream ${stream.name} has a checkpoint requiring manual review`,
          streamId: stream.id,
          streamName: stream.name,
          action: "Review checkpoint file and decide to continue or rollback",
          details: {
            checkpoint: checkpoint,
          },
        });
      } catch {
        // Checkpoint file exists but couldn't parse
        alerts.push({
          type: "checkpoint",
          severity: "warning",
          message: `Stream ${stream.name} has a malformed checkpoint file`,
          streamId: stream.id,
          streamName: stream.name,
          action: "Review .checkpoint.json file manually",
        });
      }
    }
  }

  return alerts;
}

/**
 * Get all critical alerts across the system
 * Returns alerts sorted by severity (errors first, then warnings)
 */
export function getCriticalAlerts(): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];

  // Collect all alert types
  alerts.push(...checkBudgetAlerts());
  alerts.push(...checkStalledStreams());
  alerts.push(...checkConsecutiveFailures());
  alerts.push(...checkCheckpoints());

  // Sort by severity (errors first)
  alerts.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });

  return alerts;
}
