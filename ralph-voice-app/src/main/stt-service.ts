import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * STT Service Manager
 *
 * Manages the local Whisper STT server lifecycle.
 * Supports both bundled whisper.cpp binary and Python fallback.
 */
export class STTService {
  private process: ChildProcess | null = null;
  private port: number = 5001;
  private isRunning: boolean = false;
  private startupPromise: Promise<void> | null = null;

  constructor(port: number = 5001) {
    this.port = port;
  }

  /**
   * Start the STT service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('STT service already running');
      return;
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this.doStart();
    return this.startupPromise;
  }

  private async doStart(): Promise<void> {
    try {
      // Check for bundled whisper.cpp binary first
      const whisperPath = this.getWhisperPath();
      const modelPath = this.getModelPath();

      if (whisperPath && existsSync(whisperPath) && modelPath && existsSync(modelPath)) {
        await this.startWhisperCpp(whisperPath, modelPath);
      } else {
        // Fall back to Python server
        await this.startPythonServer();
      }

      // Wait for server to be ready
      await this.waitForHealth();
      this.isRunning = true;
      console.log(`STT service started on port ${this.port}`);
    } catch (error) {
      console.error('Failed to start STT service:', error);
      this.isRunning = false;
      throw error;
    } finally {
      this.startupPromise = null;
    }
  }

  /**
   * Start whisper.cpp server
   */
  private async startWhisperCpp(whisperPath: string, modelPath: string): Promise<void> {
    console.log('Starting whisper.cpp server...');

    this.process = spawn(whisperPath, [
      '--model', modelPath,
      '--port', this.port.toString(),
      '--host', '127.0.0.1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.process.stdout?.on('data', (data) => {
      console.log('[whisper]', data.toString().trim());
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[whisper]', data.toString().trim());
    });

    this.process.on('error', (error) => {
      console.error('Whisper process error:', error);
      this.isRunning = false;
    });

    this.process.on('exit', (code) => {
      console.log(`Whisper process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;
    });
  }

  /**
   * Start Python STT server (fallback)
   */
  private async startPythonServer(): Promise<void> {
    console.log('Starting Python STT server...');

    // Look for the Python server script
    const serverPath = this.getPythonServerPath();

    if (!serverPath || !existsSync(serverPath)) {
      console.warn('Python STT server not found, STT may not work');
      return;
    }

    this.process = spawn('python3', [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        STT_PORT: this.port.toString(),
      },
    });

    this.process.stdout?.on('data', (data) => {
      console.log('[stt-py]', data.toString().trim());
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[stt-py]', data.toString().trim());
    });

    this.process.on('error', (error) => {
      console.error('Python STT process error:', error);
      this.isRunning = false;
    });

    this.process.on('exit', (code) => {
      console.log(`Python STT process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;
    });
  }

  /**
   * Wait for the STT server to be healthy
   */
  private async waitForHealth(maxAttempts: number = 30): Promise<void> {
    // Use explicit IPv4 to avoid IPv6 resolution issues
    const healthUrl = `http://127.0.0.1:${this.port}/health`;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(healthUrl, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`STT server healthy after ${i + 1} attempts`);
          return;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
        if (i === 0 || i % 5 === 0) {
          console.log(`Waiting for STT server... (attempt ${i + 1}/${maxAttempts})`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`STT server failed to start after ${maxAttempts} seconds`);
  }

  /**
   * Stop the STT service
   */
  stop(): void {
    if (this.process) {
      console.log('Stopping STT service...');
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process = null;
    }
    this.isRunning = false;
  }

  /**
   * Check if the service is running
   */
  getStatus(): { running: boolean; port: number } {
    return {
      running: this.isRunning,
      port: this.port,
    };
  }

  /**
   * Get health status from the server
   */
  async checkHealth(): Promise<{ healthy: boolean; model?: string; error?: string }> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/health`);
      if (!response.ok) {
        return { healthy: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json() as { status?: string; model?: string };
      return {
        healthy: data.status === 'healthy',
        model: data.model,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the path to the bundled whisper.cpp binary
   */
  private getWhisperPath(): string | null {
    const paths = [
      // Bundled in resources
      join(process.resourcesPath || '', 'whisper', 'whisper-server'),
      // Development path
      join(__dirname, '../../resources/whisper/whisper-server'),
      // Alternative names
      join(process.resourcesPath || '', 'whisper', 'server'),
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return null;
  }

  /**
   * Get the path to the Whisper model
   */
  private getModelPath(): string | null {
    const paths = [
      // Bundled in resources
      join(process.resourcesPath || '', 'whisper', 'ggml-base.bin'),
      // Development path
      join(__dirname, '../../resources/whisper/ggml-base.bin'),
      // Alternative model names
      join(process.resourcesPath || '', 'whisper', 'ggml-base.en.bin'),
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return null;
  }

  /**
   * Get the path to the Python STT server
   */
  private getPythonServerPath(): string | null {
    const paths = [
      // In the ralph-cli skills directory (user home)
      join(app.getPath('home'), 'ralph-cli', 'skills', 'voice', 'stt_server.py'),
      // Development path (relative to ralph-voice-app)
      join(__dirname, '../../..', 'skills', 'voice', 'stt_server.py'),
      // Sibling directory (ralph-voice-app is inside ralph-cli)
      join(__dirname, '../../../..', 'skills', 'voice', 'stt_server.py'),
      // Alternative location
      join(process.resourcesPath || '', 'stt_server.py'),
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return null;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port;
  }
}

/**
 * Create an STT service instance
 */
export function createSTTService(port?: number): STTService {
  return new STTService(port);
}
