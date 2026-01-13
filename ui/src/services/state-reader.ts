/**
 * State Reader Service
 *
 * Reads the .ralph directory structure to provide data to the UI.
 * Handles single-PRD, multi-stream, and legacy modes.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RalphMode, Stream, StreamStatus, Story, Run, VerificationResult } from '../types.js';

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
    const ralphPath = path.join(currentDir, '.ralph');
    if (fs.existsSync(ralphPath) && fs.statSync(ralphPath).isDirectory()) {
      cachedRalphRoot = ralphPath;
      return ralphPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory too
  const rootRalphPath = path.join(root, '.ralph');
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
    return 'uninitialized';
  }

  try {
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });

    // Check for PRD-N directories (case-insensitive)
    const hasPrdDirs = entries.some(
      (entry) => entry.isDirectory() && /^prd-\d+$/i.test(entry.name)
    );

    if (hasPrdDirs) {
      return 'multi';
    }

    // Check for legacy ralph-N directories
    const hasLegacyDirs = entries.some(
      (entry) => entry.isDirectory() && /^ralph-\d+$/i.test(entry.name)
    );

    if (hasLegacyDirs) {
      return 'legacy';
    }

    // Check for single-PRD mode (prd.md at root level)
    const hasPrdFile = entries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase() === 'prd.md'
    );

    if (hasPrdFile) {
      return 'single';
    }

    // Default to uninitialized if no recognizable structure
    return 'uninitialized';
  } catch {
    return 'uninitialized';
  }
}

/**
 * Check if a lock file exists for a stream
 */
function isStreamLocked(ralphRoot: string, streamId: string): boolean {
  const lockPath = path.join(ralphRoot, 'locks', `${streamId}.lock`);
  return fs.existsSync(lockPath);
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
    if (match[1].toLowerCase() === 'x') {
      completed++;
    }
  }

  return { total, completed };
}

/**
 * Determine stream status based on files and locks
 */
function getStreamStatus(ralphRoot: string, streamId: string, prdPath: string): StreamStatus {
  // Check if stream is locked (running)
  if (isStreamLocked(ralphRoot, streamId)) {
    return 'running';
  }

  // Check PRD for completion status
  if (fs.existsSync(prdPath)) {
    try {
      const content = fs.readFileSync(prdPath, 'utf-8');
      const { total, completed } = countStories(content);

      if (total > 0 && completed === total) {
        return 'completed';
      }
    } catch {
      // Fall through to idle
    }
  }

  return 'idle';
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

        const prdPath = path.join(streamPath, 'prd.md');
        const planPath = path.join(streamPath, 'plan.md');
        const progressPath = path.join(streamPath, 'progress.md');

        const hasPrd = fs.existsSync(prdPath);
        const hasPlan = fs.existsSync(planPath);
        const hasProgress = fs.existsSync(progressPath);

        // Count stories from PRD if it exists
        let totalStories = 0;
        let completedStories = 0;

        if (hasPrd) {
          try {
            const prdContent = fs.readFileSync(prdPath, 'utf-8');
            const counts = countStories(prdContent);
            totalStories = counts.total;
            completedStories = counts.completed;
          } catch {
            // Ignore read errors
          }
        }

        const status = getStreamStatus(ralphRoot, streamId, prdPath);

        // Extract name from PRD title if available
        let name = `PRD-${streamId}`;
        if (hasPrd) {
          try {
            const prdContent = fs.readFileSync(prdPath, 'utf-8');
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
  const lines = content.split('\n');

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

      const isCompleted = storyMatch[1].toLowerCase() === 'x';
      currentStory = {
        id: storyMatch[2].toUpperCase(),
        title: storyMatch[3].trim(),
        status: isCompleted ? 'completed' : 'pending',
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
          completed: criteriaMatch[1].toLowerCase() === 'x',
        });
      }
    }

    // Update story status based on "As a" line indicating in-progress
    if (currentStory && currentStory.status === 'pending') {
      // Check for in-progress markers (could be customized)
      if (line.includes('IN PROGRESS') || line.includes('in progress')) {
        currentStory.status = 'in-progress';
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
        const summaryName = entry.name.replace('.log', '.md');
        const summaryPath = path.join(runsPath, summaryName);
        const hasSummary = fs.existsSync(summaryPath);

        // Determine status based on whether summary exists
        const status: Run['status'] = hasSummary ? 'completed' : 'running';

        runs.push({
          id: runId,
          streamId,
          iteration,
          startedAt,
          status,
          verifications: [],
          logPath,
          summaryPath: hasSummary ? summaryPath : undefined,
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

  const prdPath = path.join(streamPath, 'prd.md');
  const planPath = path.join(streamPath, 'plan.md');
  const progressPath = path.join(streamPath, 'progress.md');
  const runsPath = path.join(streamPath, 'runs');

  const hasPrd = fs.existsSync(prdPath);
  const hasPlan = fs.existsSync(planPath);
  const hasProgress = fs.existsSync(progressPath);

  // Parse stories from PRD
  let stories: Story[] = [];
  let name = `PRD-${id}`;

  if (hasPrd) {
    try {
      const prdContent = fs.readFileSync(prdPath, 'utf-8');
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

  // Parse runs
  const runs = parseRuns(runsPath, id);

  // Calculate story counts
  const totalStories = stories.length;
  const completedStories = stories.filter((s) => s.status === 'completed').length;

  // Determine status
  const status = getStreamStatus(ralphRoot, id, prdPath);

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
