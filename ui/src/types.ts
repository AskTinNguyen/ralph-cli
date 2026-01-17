/**
 * TypeScript interfaces for Ralph CLI Web UI
 */

/**
 * Status of a user story
 */
export type StoryStatus = "pending" | "in-progress" | "completed";

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
 * - idle: PRD doesn't exist or not enough data
 * - running: Lock file exists with active PID
 * - merged: Worktree workflow - branch merged to main
 * - completed: Direct-to-main workflow - commits found on main
 * - in_progress: Progress started but not committed yet
 * - ready: PRD exists but work hasn't started
 * - error: Error reading/processing PRD
 */
export type StreamStatus =
  | "idle"
  | "running"
  | "merged"
  | "completed"
  | "in_progress"
  | "ready"
  | "error";

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
  merged: boolean;
  closed: boolean;
  stories: Story[];
  totalStories: number;
  completedStories: number;
  runs: Run[];
  lastRun?: Run;
  startedAt?: Date; // For running builds - lock file creation time
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
  status: "running" | "completed" | "failed";
  storyId?: string;
  storyTitle?: string;
  commit?: string;
  verifications: VerificationResult[];
  logPath: string;
  summaryPath?: string;
  /** Number of retry attempts made during this run (0 means succeeded on first attempt) */
  retryCount?: number;
  /** Total time spent waiting for retries in seconds */
  retryTime?: number;
}

/**
 * Log level for activity log entries
 */
export type LogLevel = "debug" | "info" | "warning" | "error";

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
export type RalphMode = "single" | "multi" | "legacy" | "uninitialized";

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
  /** Fix statistics for auto-remediation tracking (US-003) */
  fixStats?: FixStats;
}

/**
 * Build configuration options
 */
export interface BuildOptions {
  iterations: number;
  stream?: string;
  agent?: "claude" | "codex" | "droid";
  noCommit?: boolean;
}

/**
 * Build status response
 */
export interface BuildStatus {
  state: "idle" | "running" | "completed" | "error";
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
  | "file_changed"
  | "run_started"
  | "run_progress"
  | "run_completed"
  | "log_line";

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
  changeType: "create" | "modify" | "delete";
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
  byStory?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      totalCost: number;
      inputCost: number;
      outputCost: number;
      runs: number;
      estimatedCount: number;
    }
  >;
  byModel?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      totalCost: number;
      inputCost: number;
      outputCost: number;
      runs: number;
    }
  >;
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
 * Cache token metrics (Phase 4.1)
 */
export interface CacheTokenMetrics {
  totalCacheCreation: number;
  totalCacheRead: number;
  estimatedSavings: number;
}

/**
 * Data quality metrics (Phase 4.1)
 */
export interface DataQualityMetrics {
  qualityScore: number;
  highConfidenceRuns: number;
  mediumConfidenceRuns: number;
  lowConfidenceRuns: number;
  totalRuns: number;
  highConfidencePercentage: number;
  mediumConfidencePercentage: number;
  lowConfidencePercentage: number;
}

/**
 * Model attribution percentages (Phase 4.1)
 */
export interface ModelAttributionMetrics {
  opus: { runs: number; percentage: number; cost: number };
  sonnet: { runs: number; percentage: number; cost: number };
  haiku: { runs: number; percentage: number; cost: number };
  unknown: { runs: number; percentage: number; cost: number };
}

/**
 * Subscription billing breakdown (Phase 4.3)
 */
export interface SubscriptionBilling {
  period: string;
  subscriptionCost: number;
  apiOverageCost: number;
  totalCost: number;
  trackedApiCost: number;
  trackingAccuracy: number | null;
  trackingMessage: string | null;
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
  // Phase 4.1 enhancements
  cacheTokens?: CacheTokenMetrics;
  dataQuality?: DataQualityMetrics;
  modelAttribution?: ModelAttributionMetrics;
  subscription?: SubscriptionBilling;
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
  period: "7d" | "30d" | "90d" | "all";
  dataPoints: TokenTrendDataPoint[];
  streamId?: string;
}

/**
 * Model efficiency metrics
 */
export interface ModelEfficiency {
  model: string;
  totalRuns: number;
  successfulRuns: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  storiesCompleted: number;
  tokensPerRun: number;
  tokensPerSuccessfulRun: number;
  costPerRun: number;
  costPerSuccessfulRun: number;
  costPerStory: number;
  successRate: number;
  efficiencyScore: number | null;
}

/**
 * Model comparison result
 */
export interface ModelComparison {
  valid: boolean;
  reason?: string;
  modelA?: string;
  modelB?: string;
  metrics?: Record<
    string,
    {
      label: string;
      modelA: number;
      modelB: number;
      winner: string | null;
      difference: number;
      percentDiff: number;
    }
  >;
  recommendations?: Array<{
    type: string;
    message: string;
    recommendedModel: string | null;
  }>;
}

/**
 * Model recommendation for task type
 */
export interface ModelRecommendation {
  taskType: string;
  description: string;
  recommendedModel: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Model recommendations result
 */
export interface ModelRecommendations {
  hasData: boolean;
  recommendations: ModelRecommendation[];
  bestOverall?: string;
  bestCost?: string;
  bestSuccess?: string;
}

/**
 * Fix execution record for tracking auto-remediation (US-003)
 */
export interface FixRecord {
  id: string;
  type: string;
  command: string | null;
  status: 'success' | 'failure' | 'skipped';
  duration: number | null;
  error: string | null;
  startTime: number;
  endTime: number | null;
  stateChanges?: {
    changedFiles: string[];
    newFiles: string[];
    deletedFiles: string[];
    summary: string;
  } | null;
}

/**
 * Fix statistics by type
 */
export interface FixTypeStats {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Overall fix statistics for UI dashboard (US-003)
 */
export interface FixStats {
  attempted: number;
  succeeded: number;
  failed: number;
  byType: Record<string, FixTypeStats>;
  totalDuration: number;
  records: FixRecord[];
}

/**
 * Failure type that can trigger an agent switch
 */
export type FailureType = 'timeout' | 'error' | 'quality';

/**
 * Agent switch event from activity log
 * Records when the system switches from one agent to another due to failures
 */
export interface SwitchEvent {
  /** Timestamp when the switch occurred */
  timestamp: Date;
  /** Iteration number when switch occurred */
  iteration?: number;
  /** Agent that was switched from */
  fromAgent: string;
  /** Agent that was switched to */
  toAgent: string;
  /** Reason for the switch (failure type that triggered it) */
  reason: FailureType | string;
  /** Story ID being worked on when switch occurred */
  storyId?: string;
  /** Number of consecutive failures that triggered the switch */
  consecutiveFailures?: number;
  /** Type of switch event */
  eventType: 'switch' | 'failed' | 'skip';
}

/**
 * Author types for authorship tracking
 */
export type AuthorType =
  | 'human'              // Local user via UI
  | 'ai:claude'          // Claude agent (generic)
  | 'ai:claude:opus'     // Specific models
  | 'ai:claude:sonnet'
  | 'ai:claude:haiku'
  | 'ai:codex'           // OpenAI Codex
  | 'ai:droid'           // Factory.ai
  | 'unknown';           // Imported/legacy content

/**
 * A block of content with authorship information
 */
export interface AuthorshipBlock {
  id: string;                    // UUID
  lineStart: number;             // 1-indexed
  lineEnd: number;               // inclusive
  contentHash: string;           // SHA-256 for change detection
  author: AuthorType;
  timestamp: string;             // ISO 8601
  modifiedBy?: AuthorType;       // If edited by different author
  modifiedAt?: string;
  originalAuthor?: AuthorType;   // Before modification
  context?: {
    storyId?: string;            // US-XXX
    runId?: string;              // Ralph run ID
    model?: string;              // Full model name
  };
}

/**
 * Authorship metadata for a file
 */
export interface AuthorshipMetadata {
  version: 1;
  filePath: string;
  lastUpdated: string;
  defaultAuthor: AuthorType;
  blocks: AuthorshipBlock[];
  stats: {
    humanLines: number;
    aiLines: number;
    unknownLines: number;
    totalLines: number;
    humanPercentage: number;
    aiPercentage: number;
  };
}

/**
 * Data point for success rate time series
 */
export interface SuccessRateDataPoint {
  date: string;
  total: number;
  passed: number;
  failed: number;
  successRate: number | null;
}

/**
 * Significant change event in success rate
 */
export interface SignificantChange {
  date: string;
  previousRate: number;
  currentRate: number;
  delta: number;
  direction: "improved" | "declined";
  magnitude: number;
}

/**
 * Success rate trend data
 */
export interface SuccessRateTrend {
  period: string;
  startDate: string;
  endDate: string;
  totalRuns: number;
  totalPassed: number;
  totalFailed: number;
  overallSuccessRate: number | null;
  dailyMetrics: SuccessRateDataPoint[];
  significantChanges: SignificantChange[];
  filters: {
    prd: string;
    agent: string;
    developer: string;
  };
}

/**
 * Week-over-week comparison data
 */
export interface WeekOverWeekComparison {
  thisWeek: {
    successRate: number | null;
    totalRuns: number;
  };
  lastWeek: {
    successRate: number | null;
    totalRuns: number;
  };
  delta: number | null;
  direction: "improved" | "declined" | "stable";
  percentChange: number | null;
}
