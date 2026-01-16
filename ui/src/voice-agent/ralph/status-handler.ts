/**
 * Status Handler
 *
 * Handles status queries for Ralph PRDs by reading from the .ralph directory.
 * Provides human-readable summaries suitable for voice/TTS responses.
 */

import { getStreams, getStreamDetails, getRalphRoot } from '../../services/state-reader.js';
import type { Stream, StreamStatus } from '../../types.js';

/**
 * Status query result types
 */
export type StatusQueryType = 'prd' | 'stream' | 'stories' | 'overall';

/**
 * Result of a status query
 */
export interface StatusQueryResult {
  /** Type of query that was executed */
  type: StatusQueryType;

  /** Human-readable summary for TTS response */
  summary: string;

  /** Detailed data for programmatic use */
  data: {
    /** Total PRDs */
    totalPrds?: number;
    /** PRDs by status */
    byStatus?: Record<StreamStatus, number>;
    /** Total stories across all PRDs */
    totalStories?: number;
    /** Completed stories across all PRDs */
    completedStories?: number;
    /** Specific PRD details if queried */
    prd?: {
      id: string;
      name: string;
      status: StreamStatus;
      totalStories: number;
      completedStories: number;
      remainingStories: number;
    };
    /** All PRDs summary */
    prds?: Array<{
      id: string;
      name: string;
      status: StreamStatus;
      progress: string;
    }>;
  };

  /** Whether the query was successful */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Status Handler class
 */
export class StatusHandler {
  /**
   * Handle a status query based on parameters
   */
  async handleQuery(params: {
    prdNumber?: string;
    streamId?: string;
    queryType?: string;
  }): Promise<StatusQueryResult> {
    const queryType = (params.queryType || 'overall') as StatusQueryType;

    try {
      // Check if Ralph is initialized
      const ralphRoot = getRalphRoot();
      if (!ralphRoot) {
        return {
          type: queryType,
          summary: "Ralph is not initialized in this project. Run 'ralph install' to set up.",
          data: {},
          success: false,
          error: 'Ralph not initialized',
        };
      }

      // Handle specific PRD query
      if (params.prdNumber || params.streamId) {
        const prdId = params.prdNumber || params.streamId;
        return this.getPrdStatus(prdId!);
      }

      // Handle query by type
      switch (queryType) {
        case 'stories':
          return this.getStoriesStatus();
        case 'overall':
        default:
          return this.getOverallStatus();
      }
    } catch (error) {
      return {
        type: queryType,
        summary: 'Failed to retrieve status information.',
        data: {},
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get status for a specific PRD
   */
  private getPrdStatus(prdId: string): StatusQueryResult {
    const details = getStreamDetails(prdId);

    if (!details) {
      return {
        type: 'prd',
        summary: `PRD ${prdId} was not found.`,
        data: {},
        success: false,
        error: `PRD-${prdId} not found`,
      };
    }

    const remaining = details.totalStories - details.completedStories;
    const statusText = this.formatStatus(details.status);

    let summary: string;
    if (details.totalStories === 0) {
      summary = `PRD ${prdId}, "${details.name}", is ${statusText}. No stories have been defined yet.`;
    } else if (remaining === 0) {
      summary = `PRD ${prdId}, "${details.name}", is ${statusText}. All ${details.totalStories} stories are completed.`;
    } else {
      const percentage = Math.round((details.completedStories / details.totalStories) * 100);
      summary = `PRD ${prdId}, "${details.name}", is ${statusText}. ${details.completedStories} of ${details.totalStories} stories completed, ${percentage}% done, ${remaining} remaining.`;
    }

    return {
      type: 'prd',
      summary,
      data: {
        prd: {
          id: details.id,
          name: details.name,
          status: details.status,
          totalStories: details.totalStories,
          completedStories: details.completedStories,
          remainingStories: remaining,
        },
      },
      success: true,
    };
  }

  /**
   * Get stories status across all PRDs
   */
  private getStoriesStatus(): StatusQueryResult {
    const streams = getStreams();

    if (streams.length === 0) {
      return {
        type: 'stories',
        summary: 'No PRDs found. Create one with "ralph prd".',
        data: { totalPrds: 0, totalStories: 0, completedStories: 0 },
        success: true,
      };
    }

    const totalStories = streams.reduce((sum, s) => sum + s.totalStories, 0);
    const completedStories = streams.reduce((sum, s) => sum + s.completedStories, 0);
    const remaining = totalStories - completedStories;

    let summary: string;
    if (totalStories === 0) {
      summary = `You have ${streams.length} PRDs but no stories defined yet.`;
    } else if (remaining === 0) {
      summary = `All ${totalStories} stories across ${streams.length} PRDs are completed. Great work!`;
    } else {
      const percentage = Math.round((completedStories / totalStories) * 100);
      summary = `${completedStories} of ${totalStories} stories completed across ${streams.length} PRDs. ${percentage}% done, ${remaining} stories remaining.`;
    }

    return {
      type: 'stories',
      summary,
      data: {
        totalPrds: streams.length,
        totalStories,
        completedStories,
      },
      success: true,
    };
  }

  /**
   * Get overall status of all PRDs
   */
  private getOverallStatus(): StatusQueryResult {
    const streams = getStreams();

    if (streams.length === 0) {
      return {
        type: 'overall',
        summary: 'No PRDs found. Create one with "ralph prd".',
        data: { totalPrds: 0, byStatus: {} as Record<StreamStatus, number> },
        success: true,
      };
    }

    // Count by status
    const byStatus: Record<StreamStatus, number> = {
      idle: 0,
      ready: 0,
      running: 0,
      in_progress: 0,
      completed: 0,
      merged: 0,
      error: 0,
    };

    streams.forEach(s => {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    });

    // Calculate totals
    const totalStories = streams.reduce((sum, s) => sum + s.totalStories, 0);
    const completedStories = streams.reduce((sum, s) => sum + s.completedStories, 0);

    // Build summary
    const parts: string[] = [`You have ${streams.length} PRDs.`];

    if (byStatus.running > 0) {
      parts.push(`${byStatus.running} ${byStatus.running === 1 ? 'is' : 'are'} currently running.`);
    }
    if (byStatus.completed > 0 || byStatus.merged > 0) {
      const done = byStatus.completed + byStatus.merged;
      parts.push(`${done} ${done === 1 ? 'is' : 'are'} completed.`);
    }
    if (byStatus.in_progress > 0) {
      parts.push(`${byStatus.in_progress} ${byStatus.in_progress === 1 ? 'is' : 'are'} in progress.`);
    }
    if (byStatus.ready > 0) {
      parts.push(`${byStatus.ready} ${byStatus.ready === 1 ? 'is' : 'are'} ready to build.`);
    }

    if (totalStories > 0) {
      const percentage = Math.round((completedStories / totalStories) * 100);
      parts.push(`Overall progress: ${completedStories} of ${totalStories} stories completed, ${percentage}%.`);
    }

    // Build PRD list for data
    const prds = streams.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      progress: s.totalStories > 0
        ? `${s.completedStories}/${s.totalStories}`
        : 'No stories',
    }));

    return {
      type: 'overall',
      summary: parts.join(' '),
      data: {
        totalPrds: streams.length,
        byStatus,
        totalStories,
        completedStories,
        prds,
      },
      success: true,
    };
  }

  /**
   * Format status for human-readable output
   */
  private formatStatus(status: StreamStatus): string {
    const statusMap: Record<StreamStatus, string> = {
      idle: 'idle',
      ready: 'ready to build',
      running: 'currently running',
      in_progress: 'in progress',
      completed: 'completed',
      merged: 'completed and merged',
      error: 'in error state',
    };
    return statusMap[status] || status;
  }
}

/**
 * Create a StatusHandler instance
 */
export function createStatusHandler(): StatusHandler {
  return new StatusHandler();
}

// Export singleton instance
export const statusHandler = new StatusHandler();
