/**
 * Status Handler for Ralph Voice
 *
 * Handles Ralph CLI status queries from voice commands.
 * Uses the ralph CLI to get status information.
 */

import { spawn } from 'child_process';

/**
 * Stream/PRD status types
 */
export type StreamStatus = 'idle' | 'ready' | 'running' | 'in_progress' | 'completed' | 'merged' | 'error';

/**
 * Status query result types
 */
export type StatusQueryType = 'prd' | 'stream' | 'stories' | 'overall';

/**
 * Result of a status query
 */
export interface StatusQueryResult {
  type: StatusQueryType;
  summary: string;
  data: {
    totalPrds?: number;
    byStatus?: Record<StreamStatus, number>;
    totalStories?: number;
    completedStories?: number;
    prd?: {
      id: string;
      name: string;
      status: StreamStatus;
      totalStories: number;
      completedStories: number;
      remainingStories: number;
    };
    prds?: Array<{
      id: string;
      name: string;
      status: StreamStatus;
      progress: string;
    }>;
  };
  success: boolean;
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
  } = {}): Promise<StatusQueryResult> {
    const queryType = (params.queryType || 'overall') as StatusQueryType;

    try {
      // Execute ralph stream status command
      const prdId = params.prdNumber || params.streamId;
      const output = await this.executeRalphStatus(prdId);

      // Format the response
      const summary = this.formatOutput(output, queryType, prdId);

      return {
        type: queryType,
        summary,
        data: {},
        success: true,
      };
    } catch (error) {
      return {
        type: queryType,
        summary: error instanceof Error ? error.message : 'Failed to retrieve status',
        data: {},
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute ralph stream status command
   */
  private executeRalphStatus(prdNumber?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['stream', 'status'];
      if (prdNumber) {
        args.push(prdNumber);
      }

      const proc = spawn('ralph', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          // If ralph is not installed or not initialized
          if (stderr.includes('command not found') || stderr.includes('not found')) {
            reject(new Error('Ralph CLI is not installed or not in PATH.'));
          } else if (stderr.includes('not initialized')) {
            reject(new Error('Ralph is not initialized in this project. Run ralph install first.'));
          } else {
            reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
          }
        }
      });

      proc.on('error', (error: Error) => {
        reject(new Error(`Failed to execute ralph: ${error.message}`));
      });

      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Status command timed out'));
      }, 10000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Format the ralph output into a voice-friendly summary
   */
  private formatOutput(output: string, queryType: StatusQueryType, prdId?: string): string {
    if (!output) {
      return 'No PRDs found. Run ralph prd to create one.';
    }

    // If querying specific PRD
    if (prdId) {
      return `Status for PRD ${prdId}: ${output}`;
    }

    // For stories query, try to extract story counts
    if (queryType === 'stories') {
      const storyMatch = output.match(/(\d+)\s*\/\s*(\d+)\s*stories?/i);
      if (storyMatch) {
        const completed = parseInt(storyMatch[1], 10);
        const total = parseInt(storyMatch[2], 10);
        const remaining = total - completed;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        return `${completed} of ${total} stories completed. ${percentage}% done with ${remaining} remaining.`;
      }
    }

    // Clean up the output for voice
    const lines = output.split('\n').filter(Boolean);
    if (lines.length > 5) {
      // Summarize if too many lines
      const prdCount = (output.match(/PRD-\d+/g) || []).length;
      return `You have ${prdCount} PRDs. ${lines[0]}`;
    }

    return output;
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
