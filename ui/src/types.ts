/**
 * TypeScript interfaces for Ralph CLI Web UI
 */

/**
 * Status of a user story
 */
export type StoryStatus = 'pending' | 'in-progress' | 'completed';

/**
 * An acceptance criterion within a user story
 */
export interface AcceptanceCriterion {
  text: string;
  completed: boolean;
}

/**
 * A user story from the PRD
 */
export interface Story {
  id: string;
  title: string;
  status: StoryStatus;
  description?: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

/**
 * Status of a stream (PRD folder)
 */
export type StreamStatus = 'idle' | 'running' | 'completed' | 'error';

/**
 * A stream represents a PRD-N folder with its associated data
 */
export interface Stream {
  id: string;
  name: string;
  path: string;
  status: StreamStatus;
  hasPrd: boolean;
  hasPlan: boolean;
  hasProgress: boolean;
  stories: Story[];
  totalStories: number;
  completedStories: number;
  runs: Run[];
  lastRun?: Run;
}

/**
 * Verification result from a run
 */
export interface VerificationResult {
  command: string;
  passed: boolean;
  output?: string;
}

/**
 * A run represents a single iteration of the Ralph loop
 */
export interface Run {
  id: string;
  streamId?: string;
  iteration: number;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  status: 'running' | 'completed' | 'failed';
  storyId?: string;
  storyTitle?: string;
  commit?: string;
  verifications: VerificationResult[];
  logPath: string;
  summaryPath?: string;
}

/**
 * Log level for activity log entries
 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * An entry from the activity log or run log
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: string;
  runId?: string;
}

/**
 * Ralph operating mode
 */
export type RalphMode = 'single' | 'multi' | 'legacy' | 'uninitialized';

/**
 * Progress statistics
 */
export interface ProgressStats {
  totalStories: number;
  completedStories: number;
  inProgressStories: number;
  pendingStories: number;
  completionPercentage: number;
}

/**
 * Overall Ralph status
 */
export interface RalphStatus {
  mode: RalphMode;
  rootPath: string | null;
  currentStream?: string;
  progress: ProgressStats;
  currentRun?: Run;
  isRunning: boolean;
}

/**
 * Build configuration options
 */
export interface BuildOptions {
  iterations: number;
  stream?: string;
  agent?: 'claude' | 'codex' | 'droid';
  noCommit?: boolean;
}

/**
 * Build status response
 */
export interface BuildStatus {
  state: 'idle' | 'running' | 'completed' | 'error';
  pid?: number;
  startedAt?: Date;
  command?: string;
  options?: BuildOptions;
  error?: string;
}

/**
 * Server-sent event types
 */
export type SSEEventType =
  | 'file_changed'
  | 'run_started'
  | 'run_progress'
  | 'run_completed'
  | 'log_line';

/**
 * Server-sent event payload
 */
export interface SSEEvent {
  type: SSEEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

/**
 * File change event data
 */
export interface FileChangedEvent {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
}

/**
 * API error response
 */
export interface APIError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Token metrics for a model or aggregate
 */
export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  inputCost?: number;
  outputCost?: number;
  runCount?: number;
}

/**
 * Token data for a single run
 */
export interface RunTokenData {
  runId: string;
  streamId?: string;
  storyId?: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  timestamp: string;
  estimated: boolean;
  cost: number;
}

/**
 * Token summary for a stream
 */
export interface StreamTokenSummary {
  streamId: string;
  streamName: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  runCount: number;
  storyCount: number;
  avgCostPerStory: number;
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
  runs?: RunTokenData[];
}

/**
 * Token summary for a story
 */
export interface StoryTokenSummary {
  streamId: string;
  storyId: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  runCount: number;
  estimatedCount: number;
  runs: RunTokenData[];
}

/**
 * Overall token summary across all streams
 */
export interface TokenSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgCostPerStory: number;
  avgCostPerRun: number;
  byStream: StreamTokenSummary[];
  byModel: Record<string, TokenMetrics>;
}

/**
 * Single data point for token trends
 */
export interface TokenTrendDataPoint {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  runCount: number;
}

/**
 * Token trends over time for charts
 */
export interface TokenTrend {
  period: '7d' | '30d' | '90d' | 'all';
  dataPoints: TokenTrendDataPoint[];
  streamId?: string;
}
