/**
 * AppleScript Executor
 *
 * Executes AppleScript commands via osascript for macOS app control.
 * Provides safe execution with app-specific controls and validation.
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { VoiceIntent, ExecutionResult } from "../types.js";

/**
 * Supported app control actions
 */
export type AppControlAction =
  | "open"
  | "close"
  | "quit"
  | "activate"
  | "hide"
  | "show"
  | "minimize"
  | "maximize"
  | "fullscreen"
  | "play"
  | "pause"
  | "stop"
  | "next"
  | "previous"
  | "volume_up"
  | "volume_down"
  | "mute";

/**
 * App control event
 */
export interface AppControlEvent {
  type: "start" | "complete" | "error";
  app?: string;
  action?: AppControlAction;
  error?: string;
  timestamp: Date;
}

/**
 * Common macOS apps with their bundle identifiers
 */
const APP_BUNDLES: Record<string, string> = {
  // Browsers
  chrome: "com.google.Chrome",
  safari: "com.apple.Safari",
  firefox: "org.mozilla.firefox",
  edge: "com.microsoft.edgemac",
  arc: "company.thebrowser.Browser",

  // Productivity
  finder: "com.apple.finder",
  notes: "com.apple.Notes",
  reminders: "com.apple.reminders",
  calendar: "com.apple.iCal",
  mail: "com.apple.mail",
  messages: "com.apple.MobileSMS",
  facetime: "com.apple.FaceTime",

  // Media
  music: "com.apple.Music",
  spotify: "com.spotify.client",
  "apple music": "com.apple.Music",
  photos: "com.apple.Photos",
  "quick time": "com.apple.QuickTimePlayerX",
  quicktime: "com.apple.QuickTimePlayerX",
  vlc: "org.videolan.vlc",

  // Development
  terminal: "com.apple.Terminal",
  iterm: "com.googlecode.iterm2",
  iterm2: "com.googlecode.iterm2",
  "visual studio code": "com.microsoft.VSCode",
  vscode: "com.microsoft.VSCode",
  code: "com.microsoft.VSCode",
  xcode: "com.apple.dt.Xcode",
  cursor: "com.todesktop.230313mzl4w4u92",

  // Communication
  slack: "com.tinyspeck.slackmacgap",
  discord: "com.hnc.Discord",
  zoom: "us.zoom.xos",
  teams: "com.microsoft.teams",

  // Utilities
  "system preferences": "com.apple.systempreferences",
  "system settings": "com.apple.systempreferences",
  settings: "com.apple.systempreferences",
  preview: "com.apple.Preview",
  "app store": "com.apple.AppStore",
  calculator: "com.apple.calculator",
};

/**
 * Apps that should never be controlled (system critical)
 */
const BLOCKED_APPS = [
  "kernel_task",
  "launchd",
  "WindowServer",
  "loginwindow",
];

/**
 * AppleScript Executor class
 */
export class AppleScriptExecutor {
  private defaultTimeout: number;

  constructor(options: { timeout?: number } = {}) {
    this.defaultTimeout = options.timeout || 10000; // 10 second default
  }

  /**
   * Execute an app control command
   */
  async execute(
    intent: VoiceIntent,
    options: { timeout?: number } = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const target = intent.target;
    const action = (intent.parameters?.action || intent.command || "open") as AppControlAction;

    if (!target) {
      return {
        success: false,
        error: "No target application specified",
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    // Normalize app name
    const normalizedApp = this.normalizeAppName(target);

    // Check if app is blocked
    if (this.isBlocked(normalizedApp)) {
      return {
        success: false,
        error: `Cannot control system-critical process: ${target}`,
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    // Build and execute AppleScript
    const script = this.buildScript(normalizedApp, action, intent.parameters);

    if (!script) {
      return {
        success: false,
        error: `Unknown app control action: ${action}`,
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    const timeout = options.timeout || this.defaultTimeout;
    return this.executeScript(script, intent, timeout, startTime);
  }

  /**
   * Build AppleScript for the given action
   */
  private buildScript(
    app: string,
    action: AppControlAction,
    parameters?: Record<string, string>
  ): string | null {
    switch (action) {
      case "open":
      case "activate":
        return `tell application "${app}" to activate`;

      case "close":
      case "quit":
        return `tell application "${app}" to quit`;

      case "hide":
        return `tell application "System Events" to set visible of process "${app}" to false`;

      case "show":
        return `tell application "System Events" to set visible of process "${app}" to true`;

      case "minimize":
        return `tell application "System Events" to tell process "${app}" to set value of attribute "AXMinimized" of window 1 to true`;

      case "maximize":
        // macOS doesn't have true maximize, but we can zoom
        return `tell application "System Events" to tell process "${app}" to click menu item "Zoom" of menu "Window" of menu bar 1`;

      case "fullscreen":
        return `tell application "System Events" to tell process "${app}" to set value of attribute "AXFullScreen" of window 1 to true`;

      // Media controls (for Music/Spotify)
      case "play":
        if (this.isMusicApp(app)) {
          return `tell application "${app}" to play`;
        }
        return `tell application "System Events" to keystroke space`;

      case "pause":
        if (this.isMusicApp(app)) {
          return `tell application "${app}" to pause`;
        }
        return `tell application "System Events" to keystroke space`;

      case "stop":
        if (this.isMusicApp(app)) {
          return `tell application "${app}" to stop`;
        }
        return null;

      case "next":
        if (this.isMusicApp(app)) {
          return `tell application "${app}" to next track`;
        }
        return `tell application "System Events" to key code 124 using command down`; // Cmd+Right

      case "previous":
        if (this.isMusicApp(app)) {
          return `tell application "${app}" to previous track`;
        }
        return `tell application "System Events" to key code 123 using command down`; // Cmd+Left

      case "volume_up":
        return `set volume output volume ((output volume of (get volume settings)) + 10)`;

      case "volume_down":
        return `set volume output volume ((output volume of (get volume settings)) - 10)`;

      case "mute":
        return `set volume with output muted`;

      default:
        return null;
    }
  }

  /**
   * Execute an AppleScript string
   */
  private async executeScript(
    script: string,
    intent: VoiceIntent,
    timeout: number,
    startTime: number
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let timedOut = false;
      let stdout = "";
      let stderr = "";

      const child = spawn("osascript", ["-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout);

      // Collect output
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle exit
      child.on("exit", (code) => {
        clearTimeout(timeoutId);
        const duration_ms = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            error: `AppleScript timed out after ${timeout}ms`,
            output: stdout,
            duration_ms,
            action: intent.action,
            intent,
          });
          return;
        }

        const success = code === 0;
        resolve({
          success,
          output: stdout || `App control action completed`,
          error: success ? undefined : stderr || `Exit code: ${code}`,
          exitCode: code ?? -1,
          duration_ms,
          action: intent.action,
          intent,
        });
      });

      // Handle error
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `AppleScript error: ${error.message}`,
          duration_ms: Date.now() - startTime,
          action: intent.action,
          intent,
        });
      });
    });
  }

  /**
   * Execute with streaming events
   */
  executeStreaming(
    intent: VoiceIntent,
    options: { timeout?: number } = {}
  ): { eventEmitter: EventEmitter; cancel: () => void } {
    const eventEmitter = new EventEmitter();
    const target = intent.target;
    const action = (intent.parameters?.action || intent.command || "open") as AppControlAction;

    if (!target) {
      setTimeout(() => {
        eventEmitter.emit("error", {
          type: "error",
          error: "No target application specified",
          timestamp: new Date(),
        } as AppControlEvent);
      }, 0);
      return { eventEmitter, cancel: () => {} };
    }

    const normalizedApp = this.normalizeAppName(target);
    const script = this.buildScript(normalizedApp, action, intent.parameters);

    if (!script) {
      setTimeout(() => {
        eventEmitter.emit("error", {
          type: "error",
          app: normalizedApp,
          action,
          error: `Unknown action: ${action}`,
          timestamp: new Date(),
        } as AppControlEvent);
      }, 0);
      return { eventEmitter, cancel: () => {} };
    }

    const timeout = options.timeout || this.defaultTimeout;

    // Emit start
    eventEmitter.emit("start", {
      type: "start",
      app: normalizedApp,
      action,
      timestamp: new Date(),
    } as AppControlEvent);

    const child = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      eventEmitter.emit("error", {
        type: "error",
        app: normalizedApp,
        action,
        error: `Timed out after ${timeout}ms`,
        timestamp: new Date(),
      } as AppControlEvent);
    }, timeout);

    child.on("exit", (code) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("complete", {
        type: "complete",
        app: normalizedApp,
        action,
        error: code !== 0 ? `Exit code: ${code}` : undefined,
        timestamp: new Date(),
      } as AppControlEvent);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("error", {
        type: "error",
        app: normalizedApp,
        action,
        error: error.message,
        timestamp: new Date(),
      } as AppControlEvent);
    });

    const cancel = () => {
      clearTimeout(timeoutId);
      child.kill("SIGTERM");
    };

    return { eventEmitter, cancel };
  }

  /**
   * Normalize app name to proper application name
   */
  normalizeAppName(input: string): string {
    const lower = input.toLowerCase().trim();

    // Check if we have a known bundle mapping
    if (APP_BUNDLES[lower]) {
      // Return the proper app name (capitalized)
      return input.charAt(0).toUpperCase() + input.slice(1);
    }

    // Special cases for common variations
    const aliases: Record<string, string> = {
      chrome: "Google Chrome",
      "google chrome": "Google Chrome",
      safari: "Safari",
      firefox: "Firefox",
      spotify: "Spotify",
      music: "Music",
      "apple music": "Music",
      terminal: "Terminal",
      iterm: "iTerm",
      iterm2: "iTerm",
      vscode: "Visual Studio Code",
      code: "Visual Studio Code",
      "vs code": "Visual Studio Code",
      slack: "Slack",
      discord: "Discord",
      zoom: "zoom.us",
      finder: "Finder",
      mail: "Mail",
      notes: "Notes",
      calendar: "Calendar",
      reminders: "Reminders",
      messages: "Messages",
      facetime: "FaceTime",
      photos: "Photos",
      preview: "Preview",
      xcode: "Xcode",
      cursor: "Cursor",
      arc: "Arc",
    };

    return aliases[lower] || input;
  }

  /**
   * Check if an app is blocked from control
   */
  isBlocked(app: string): boolean {
    return BLOCKED_APPS.some(
      (blocked) => app.toLowerCase() === blocked.toLowerCase()
    );
  }

  /**
   * Check if app is a music player
   */
  private isMusicApp(app: string): boolean {
    const musicApps = ["Music", "Spotify", "iTunes", "Apple Music"];
    return musicApps.some((m) => app.toLowerCase().includes(m.toLowerCase()));
  }

  /**
   * Get list of running applications
   */
  async getRunningApps(): Promise<string[]> {
    return new Promise((resolve) => {
      const script = `
        tell application "System Events"
          set appList to name of every process whose background only is false
          return appList
        end tell
      `;

      const child = spawn("osascript", ["-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0 && stdout) {
          // AppleScript returns comma-separated list
          const apps = stdout
            .trim()
            .split(", ")
            .map((app) => app.trim())
            .filter(Boolean);
          resolve(apps);
        } else {
          resolve([]);
        }
      });

      child.on("error", () => {
        resolve([]);
      });

      // Timeout
      setTimeout(() => {
        child.kill();
        resolve([]);
      }, 5000);
    });
  }

  /**
   * Check if an app is running
   */
  async isAppRunning(app: string): Promise<boolean> {
    const normalizedApp = this.normalizeAppName(app);
    const runningApps = await this.getRunningApps();
    return runningApps.some(
      (running) => running.toLowerCase() === normalizedApp.toLowerCase()
    );
  }

  /**
   * Check if osascript is available (macOS check)
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", 'return "ok"'], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0 && output.includes("ok")) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: "osascript not available (macOS only feature)",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "osascript not found (requires macOS)",
        });
      });

      setTimeout(() => {
        child.kill();
        resolve({ available: false, error: "Check timed out" });
      }, 3000);
    });
  }

  /**
   * Set default timeout
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }
}

/**
 * Create an AppleScriptExecutor instance
 */
export function createAppleScriptExecutor(
  options: { timeout?: number } = {}
): AppleScriptExecutor {
  return new AppleScriptExecutor(options);
}

// Export singleton instance
export const appleScriptExecutor = new AppleScriptExecutor();
