/**
 * State Reader Service
 *
 * Reads the .ralph directory structure to provide data to the UI.
 * Handles single-PRD, multi-stream, and legacy modes.
 */

import fs from "node:fs";
import path from "node:path";
import type { RalphMode, Stream, StreamStatus, Story, Run, VerificationResult } from "../types.js";

// Cache the ralph root to avoid repeated lookups
let cachedRalphRoot: string | null = null;

/**
 * Find the .ralph directory by walking up from the current working directory.
 * Returns the absolute path to .ralph/ or null if not found.
 */
export function getRalphRoot(): string | null {
  if (cachedRalphRoot !== null) {
    // Verify cache is still valid
    if (fs.existsSync(cachedRalphRoot)) {
      return cachedRalphRoot;
    }
    cachedRalphRoot = null;
  }

  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const ralphPath = path.join(currentDir, ".ralph");
    if (fs.existsSync(ralphPath) && fs.statSync(ralphPath).isDirectory()) {
      cachedRalphRoot = ralphPath;
      return ralphPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory too
  const rootRalphPath = path.join(root, ".ralph");
  if (fs.existsSync(rootRalphPath) && fs.statSync(rootRalphPath).isDirectory()) {
    cachedRalphRoot = rootRalphPath;
    return rootRalphPath;
  }

  return null;
}

/**
 * Clear the cached ralph root (useful for testing)
 */
export function clearRalphRootCache(): void {
  cachedRalphRoot = null;
}

/**
 * Detect the operating mode based on directory structure.
 * - "multi": Has PRD-N directories (modern structure)
 * - "single": Has prd.md at root level without PRD-N directories
 * - "legacy": Has ralph-N directories (old stream format)
 * - "uninitialized": No .ralph directory found
 */
export function getMode(): RalphMode {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return "uninitialized";
  }

  try {
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });

    // Check for PRD-N directories (case-insensitive)
    const hasPrdDirs = entries.some(
      (entry) => entry.isDirectory() && /^prd-\d+$/i.test(entry.name)
    );

    if (hasPrdDirs) {
      return "multi";
    }

    // Check for legacy ralph-N directories
    const hasLegacyDirs = entries.some(
      (entry) => entry.isDirectory() && /^ralph-\d+$/i.test(entry.name)
    );

    if (hasLegacyDirs) {
      return "legacy";
    }

    // Check for single-PRD mode (prd.md at root level)
    const hasPrdFile = entries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase() === "prd.md"
    );

    if (hasPrdFile) {
      return "single";
    }

    // Default to uninitialized if no recognizable structure
    return "uninitialized";
  } catch {
    return "uninitialized";
  }
}

/**
 * Check if a lock file exists for a stream
 * Supports both naming conventions: N.lock and PRD-N.lock
 */
function isStreamLocked(ralphRoot: string, streamId: string): boolean {
  const locksDir = path.join(ralphRoot, "locks");

  // Check both naming conventions
  const lockPaths = [
    path.join(locksDir, `${streamId}.lock`), // N.lock
    path.join(locksDir, `PRD-${streamId}.lock`), // PRD-N.lock
  ];

  for (const lockPath of lockPaths) {
    if (fs.existsSync(lockPath)) {
      // Verify the lock is still valid (process is running)
      try {
        const pid = fs.readFileSync(lockPath, "utf-8").trim();
        if (pid && !isNaN(parseInt(pid, 10))) {
          // Check if process is still alive (optional validation)
          return true;
        }
      } catch {
        // If we can't read the lock, assume it's valid if it exists
        return true;
      }
    }
  }

  return false;
}

/**
 * Count completed stories from PRD content
 */
function countStories(prdContent: string): { total: number; completed: number } {
  const storyPattern = /^###\s*\[([ x])\]\s*US-\d+:/gim;
  let total = 0;
  let completed = 0;
  let match;

  while ((match = storyPattern.exec(prdContent)) !== null) {
    total++;
    if (match[1].toLowerCase() === "x") {
      completed++;
    }
  }

  return { total, completed };
}

/**
 * Get the effective PRD path, preferring worktree if it exists
 * Worktrees have structure: .ralph/worktrees/PRD-N/.ralph/PRD-N/prd.md
 */
function getEffectivePrdPath(ralphRoot: string, streamId: string, mainPrdPath: string): string {
  // Check for worktree PRD (has more up-to-date data during builds)
  const worktreePrdPath = path.join(
    ralphRoot,
    "worktrees",
    `PRD-${streamId}`,
    ".ralph",
    `PRD-${streamId}`,
    "prd.md"
  );

  if (fs.existsSync(worktreePrdPath)) {
    return worktreePrdPath;
  }

  return mainPrdPath;
}

/**
 * Get the effective runs path, preferring worktree if it exists
 */
function getEffectiveRunsPath(ralphRoot: string, streamId: string, mainRunsPath: string): string {
  const worktreeRunsPath = path.join(
    ralphRoot,
    "worktrees",
    `PRD-${streamId}`,
    ".ralph",
    `PRD-${streamId}`,
    "runs"
  );

  if (fs.existsSync(worktreeRunsPath)) {
    return worktreeRunsPath;
  }

  return mainRunsPath;
}

/**
 * Determine stream status based on files and locks
 */
function getStreamStatus(ralphRoot: string, streamId: string, prdPath: string): StreamStatus {
  // Check if stream is locked (running)
  if (isStreamLocked(ralphRoot, streamId)) {
    return "running";
  }

  // Check PRD for completion status
  if (fs.existsSync(prdPath)) {
    try {
      const content = fs.readFileSync(prdPath, "utf-8");
      const { total, completed } = countStories(content);

      if (total > 0 && completed === total) {
        return "completed";
      }
    } catch {
      // Fall through to idle
    }
  }

  return "idle";
}

/**
 * List all PRD-N directories with basic metadata.
 * Returns streams sorted by ID number.
 */
export function getStreams(): Stream[] {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return [];
  }

  const streams: Stream[] = [];

  try {
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });

    for (const entry of entries) {
      // Match PRD-N directories (case-insensitive)
      const match = entry.name.match(/^prd-(\d+)$/i);

      if (entry.isDirectory() && match) {
        const streamId = match[1];
        const streamPath = path.join(ralphRoot, entry.name);

        const mainPrdPath = path.join(streamPath, "prd.md");
        const planPath = path.join(streamPath, "plan.md");
        const progressPath = path.join(streamPath, "progress.md");

        // Use worktree PRD if available (has current progress during builds)
        const effectivePrdPath = getEffectivePrdPath(ralphRoot, streamId, mainPrdPath);

        const hasPrd = fs.existsSync(mainPrdPath) || fs.existsSync(effectivePrdPath);
        const hasPlan = fs.existsSync(planPath);
        const hasProgress = fs.existsSync(progressPath);

        // Count stories from effective PRD (worktree or main)
        let totalStories = 0;
        let completedStories = 0;

        if (fs.existsSync(effectivePrdPath)) {
          try {
            const prdContent = fs.readFileSync(effectivePrdPath, "utf-8");
            const counts = countStories(prdContent);
            totalStories = counts.total;
            completedStories = counts.completed;
          } catch {
            // Ignore read errors
          }
        }

        const status = getStreamStatus(ralphRoot, streamId, effectivePrdPath);

        // Extract name from effective PRD title if available
        let name = `PRD-${streamId}`;
        if (fs.existsSync(effectivePrdPath)) {
          try {
            const prdContent = fs.readFileSync(effectivePrdPath, "utf-8");
            const titleMatch = prdContent.match(/^#\s+(.+)$/m);
            if (titleMatch) {
              name = titleMatch[1].trim();
            }
          } catch {
            // Use default name
          }
        }

        streams.push({
          id: streamId,
          name,
          path: streamPath,
          status,
          hasPrd,
          hasPlan,
          hasProgress,
          stories: [], // Populated by getStreamDetails
          totalStories,
          completedStories,
          runs: [], // Populated by getStreamDetails
        });
      }
    }

    // Sort by ID number
    streams.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
  } catch {
    // Return empty array on error
  }

  return streams;
}

/**
 * Parse stories from PRD markdown content
 */
function parseStoriesFromPrd(content: string): Story[] {
  const stories: Story[] = [];
  const lines = content.split("\n");

  let currentStory: Story | null = null;
  let inAcceptanceCriteria = false;

  for (const line of lines) {
    // Match story heading: ### [ ] US-001: Title or ### [x] US-001: Title
    const storyMatch = line.match(/^###\s*\[([ x])\]\s*(US-\d+):\s*(.+)$/i);

    if (storyMatch) {
      // Save previous story
      if (currentStory) {
        stories.push(currentStory);
      }

      const isCompleted = storyMatch[1].toLowerCase() === "x";
      currentStory = {
        id: storyMatch[2].toUpperCase(),
        title: storyMatch[3].trim(),
        status: isCompleted ? "completed" : "pending",
        acceptanceCriteria: [],
      };
      inAcceptanceCriteria = false;
      continue;
    }

    // Check for acceptance criteria section
    if (currentStory && /^#{4,}\s*Acceptance Criteria/i.test(line)) {
      inAcceptanceCriteria = true;
      continue;
    }

    // Stop acceptance criteria parsing at next heading
    if (currentStory && /^#{3,}/.test(line) && !line.match(/^###\s*\[([ x])\]/i)) {
      inAcceptanceCriteria = false;
    }

    // Parse acceptance criteria items
    if (currentStory && inAcceptanceCriteria) {
      const criteriaMatch = line.match(/^-\s*\[([ x])\]\s*(.+)$/i);
      if (criteriaMatch) {
        currentStory.acceptanceCriteria.push({
          text: criteriaMatch[2].trim(),
          completed: criteriaMatch[1].toLowerCase() === "x",
        });
      }
    }

    // Update story status based on "As a" line indicating in-progress
    if (currentStory && currentStory.status === "pending") {
      // Check for in-progress markers (could be customized)
      if (line.includes("IN PROGRESS") || line.includes("in progress")) {
        currentStory.status = "in-progress";
      }
    }
  }

  // Don't forget the last story
  if (currentStory) {
    stories.push(currentStory);
  }

  return stories;
}

/**
 * Extract story ID and title from log content
 */
function extractStoryFromLog(logPath: string): { storyId?: string; storyTitle?: string } {
  try {
    // Read only the first 2KB of the log to find story info (it's usually at the top)
    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
    fs.closeSync(fd);

    const content = buffer.toString("utf-8", 0, bytesRead);

    // Pattern 1: "**US-XXX: Story Title**" (markdown bold with title)
    const boldPattern = /\*\*(US-\d+):\s*([^*]+)\*\*/i;
    const boldMatch = content.match(boldPattern);
    if (boldMatch) {
      return {
        storyId: boldMatch[1].toUpperCase(),
        storyTitle: boldMatch[2].trim(),
      };
    }

    // Pattern 2: "US-XXX has been successfully completed" or similar
    const completedPattern = /(US-\d+)\s+has been/i;
    const completedMatch = content.match(completedPattern);
    if (completedMatch) {
      return {
        storyId: completedMatch[1].toUpperCase(),
      };
    }

    // Pattern 3: "story=US-XXX" in metadata
    const metaPattern = /story=(US-\d+)/i;
    const metaMatch = content.match(metaPattern);
    if (metaMatch) {
      return {
        storyId: metaMatch[1].toUpperCase(),
      };
    }

    // Pattern 4: "Working on US-XXX" or "Implementing US-XXX"
    const workingPattern = /(?:Working on|Implementing|Starting)\s+(US-\d+)/i;
    const workingMatch = content.match(workingPattern);
    if (workingMatch) {
      return {
        storyId: workingMatch[1].toUpperCase(),
      };
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Extract retry statistics from a run summary file
 * Returns { retryCount, retryTime } or null if not found
 */
function extractRetryStatsFromSummary(
  summaryPath: string
): { retryCount: number; retryTime: number } | null {
  try {
    const content = fs.readFileSync(summaryPath, "utf-8");

    // Look for retry statistics section
    // Format: "- Retry count: N" and "- Total retry wait time: Ns"
    const retryCountMatch = content.match(/^- Retry count:\s*(\d+)/m);
    const retryTimeMatch = content.match(/^- Total retry wait time:\s*(\d+)s/m);

    if (retryCountMatch) {
      const retryCount = parseInt(retryCountMatch[1], 10);
      const retryTime = retryTimeMatch ? parseInt(retryTimeMatch[1], 10) : 0;
      return { retryCount, retryTime };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Retry event from activity log
 */
export interface RetryEvent {
  timestamp: Date;
  iteration: number;
  attempt: number;
  maxAttempts: number;
  delay: number;
  exitCode: number;
  cumulativeTime?: number;
  eventType: "retry" | "success" | "exhausted";
}

/**
 * Parse retry events from activity log content
 * Returns array of retry events for analysis
 */
export function parseRetryEvents(activityLogPath: string): RetryEvent[] {
  const events: RetryEvent[] = [];

  if (!fs.existsSync(activityLogPath)) {
    return events;
  }

  try {
    const content = fs.readFileSync(activityLogPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      // Match timestamp: [2026-01-14 10:30:45]
      const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      if (!timestampMatch) continue;

      const timestamp = new Date(timestampMatch[1].replace(" ", "T"));

      // Match RETRY event: RETRY iteration=N attempt=M/X delay=Ns exit_code=E
      const retryMatch = line.match(
        /RETRY\s+iteration=(\d+)\s+attempt=(\d+)\/(\d+)\s+delay=([0-9.]+)s\s+exit_code=(\d+)/
      );
      if (retryMatch) {
        events.push({
          timestamp,
          iteration: parseInt(retryMatch[1], 10),
          attempt: parseInt(retryMatch[2], 10),
          maxAttempts: parseInt(retryMatch[3], 10),
          delay: parseFloat(retryMatch[4]),
          exitCode: parseInt(retryMatch[5], 10),
          eventType: "retry",
        });
        continue;
      }

      // Match RETRY_SUCCESS event: RETRY_SUCCESS iteration=N succeeded_after=M retries
      const successMatch = line.match(
        /RETRY_SUCCESS\s+iteration=(\d+)\s+succeeded_after=(\d+)\s+retries/
      );
      if (successMatch) {
        events.push({
          timestamp,
          iteration: parseInt(successMatch[1], 10),
          attempt: parseInt(successMatch[2], 10) + 1, // succeeded on attempt after retries
          maxAttempts: 0, // not available in success log
          delay: 0,
          exitCode: 0,
          eventType: "success",
        });
        continue;
      }

      // Match RETRY_EXHAUSTED event: RETRY_EXHAUSTED iteration=N total_attempts=M final_exit_code=E
      const exhaustedMatch = line.match(
        /RETRY_EXHAUSTED\s+iteration=(\d+)\s+total_attempts=(\d+)\s+final_exit_code=(\d+)/
      );
      if (exhaustedMatch) {
        events.push({
          timestamp,
          iteration: parseInt(exhaustedMatch[1], 10),
          attempt: parseInt(exhaustedMatch[2], 10),
          maxAttempts: parseInt(exhaustedMatch[2], 10),
          delay: 0,
          exitCode: parseInt(exhaustedMatch[3], 10),
          eventType: "exhausted",
        });
      }
    }
  } catch {
    // Return empty array on error
  }

  return events;
}

/**
 * Parse runs from a stream's runs directory
 */
function parseRuns(runsPath: string, streamId: string): Run[] {
  const runs: Run[] = [];

  if (!fs.existsSync(runsPath)) {
    return runs;
  }

  try {
    const entries = fs.readdirSync(runsPath, { withFileTypes: true });

    for (const entry of entries) {
      // Match run log files: run-YYYYMMDD-HHMMSS-XXXXX-iter-N.log
      const match = entry.name.match(/^run-(\d{8})-(\d{6})-(\d+)-iter-(\d+)\.log$/);

      if (entry.isFile() && match) {
        const dateStr = match[1]; // YYYYMMDD
        const timeStr = match[2]; // HHMMSS
        const runNum = match[3];
        const iteration = parseInt(match[4], 10);

        // Parse date
        const year = parseInt(dateStr.slice(0, 4), 10);
        const month = parseInt(dateStr.slice(4, 6), 10) - 1;
        const day = parseInt(dateStr.slice(6, 8), 10);
        const hour = parseInt(timeStr.slice(0, 2), 10);
        const minute = parseInt(timeStr.slice(2, 4), 10);
        const second = parseInt(timeStr.slice(4, 6), 10);

        const startedAt = new Date(year, month, day, hour, minute, second);

        const runId = `${dateStr}-${timeStr}-${runNum}`;
        const logPath = path.join(runsPath, entry.name);
        const summaryName = entry.name.replace(".log", ".md");
        const summaryPath = path.join(runsPath, summaryName);
        const hasSummary = fs.existsSync(summaryPath);

        // Determine status based on whether summary exists
        const status: Run["status"] = hasSummary ? "completed" : "running";

        // Extract story information from log content
        const storyInfo = extractStoryFromLog(logPath);

        // Extract retry statistics from summary if available
        let retryCount: number | undefined;
        let retryTime: number | undefined;
        if (hasSummary) {
          const retryStats = extractRetryStatsFromSummary(summaryPath);
          if (retryStats) {
            retryCount = retryStats.retryCount;
            retryTime = retryStats.retryTime;
          }
        }

        runs.push({
          id: runId,
          streamId,
          iteration,
          startedAt,
          status,
          storyId: storyInfo.storyId,
          storyTitle: storyInfo.storyTitle,
          verifications: [],
          logPath,
          summaryPath: hasSummary ? summaryPath : undefined,
          retryCount,
          retryTime,
        });
      }
    }

    // Sort by date descending (newest first)
    runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  } catch {
    // Return empty array on error
  }

  return runs;
}

/**
 * Get detailed information for a specific stream.
 * Includes parsed stories, runs, and metadata.
 */
export function getStreamDetails(id: string): Stream | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  // Find the stream directory (case-insensitive)
  let streamPath: string | null = null;
  let streamDirName: string | null = null;

  try {
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^prd-(\d+)$/i);
        if (match && match[1] === id) {
          streamPath = path.join(ralphRoot, entry.name);
          streamDirName = entry.name;
          break;
        }
      }
    }
  } catch {
    return null;
  }

  if (!streamPath) {
    return null;
  }

  const mainPrdPath = path.join(streamPath, "prd.md");
  const planPath = path.join(streamPath, "plan.md");
  const progressPath = path.join(streamPath, "progress.md");
  const mainRunsPath = path.join(streamPath, "runs");

  // Use worktree paths if available (has current progress during builds)
  const effectivePrdPath = getEffectivePrdPath(ralphRoot, id, mainPrdPath);
  const effectiveRunsPath = getEffectiveRunsPath(ralphRoot, id, mainRunsPath);

  const hasPrd = fs.existsSync(mainPrdPath) || fs.existsSync(effectivePrdPath);
  const hasPlan = fs.existsSync(planPath);
  const hasProgress = fs.existsSync(progressPath);

  // Parse stories from effective PRD (worktree or main)
  let stories: Story[] = [];
  let name = `PRD-${id}`;

  if (fs.existsSync(effectivePrdPath)) {
    try {
      const prdContent = fs.readFileSync(effectivePrdPath, "utf-8");
      stories = parseStoriesFromPrd(prdContent);

      // Extract title
      const titleMatch = prdContent.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        name = titleMatch[1].trim();
      }
    } catch {
      // Use defaults
    }
  }

  // Parse runs from effective path (worktree or main)
  const runs = parseRuns(effectiveRunsPath, id);

  // Calculate story counts
  const totalStories = stories.length;
  const completedStories = stories.filter((s) => s.status === "completed").length;

  // Determine status
  const status = getStreamStatus(ralphRoot, id, effectivePrdPath);

  return {
    id,
    name,
    path: streamPath,
    status,
    hasPrd,
    hasPlan,
    hasProgress,
    stories,
    totalStories,
    completedStories,
    runs,
    lastRun: runs.length > 0 ? runs[0] : undefined,
  };
}
