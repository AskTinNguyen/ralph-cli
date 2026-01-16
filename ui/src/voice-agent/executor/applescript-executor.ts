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
  | "mute"
  // Window management
  | "snap_left"
  | "snap_right"
  | "snap_top"
  | "snap_bottom"
  | "center"
  | "move_display"
  | "tile_left"
  | "tile_right"
  // Browser
  | "open_url"
  | "new_tab"
  | "close_tab"
  | "refresh"
  | "back"
  | "forward"
  // Clipboard
  | "copy"
  | "paste"
  | "select_all"
  | "read_clipboard"
  // Finder
  | "open_folder"
  | "new_window"
  | "go_to_path"
  // VS Code
  | "open_file"
  | "go_to_line"
  | "command_palette"
  // Terminal
  | "clear_terminal"
  | "delete_line"
  | "delete_word"
  // Communication
  | "send_message"
  | "send_email"
  | "create_event"
  | "create_reminder";

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

      // Window Management
      case "snap_left":
      case "tile_left":
        return `
tell application "System Events" to tell process "${app}"
  set screenSize to size of first desktop
  set screenWidth to item 1 of screenSize
  set screenHeight to item 2 of screenSize
  set position of window 1 to {0, 25}
  set size of window 1 to {screenWidth / 2, screenHeight - 25}
end tell`;

      case "snap_right":
      case "tile_right":
        return `
tell application "System Events" to tell process "${app}"
  set screenSize to size of first desktop
  set screenWidth to item 1 of screenSize
  set screenHeight to item 2 of screenSize
  set position of window 1 to {screenWidth / 2, 25}
  set size of window 1 to {screenWidth / 2, screenHeight - 25}
end tell`;

      case "snap_top":
        return `
tell application "System Events" to tell process "${app}"
  set screenSize to size of first desktop
  set screenWidth to item 1 of screenSize
  set screenHeight to item 2 of screenSize
  set position of window 1 to {0, 25}
  set size of window 1 to {screenWidth, screenHeight / 2}
end tell`;

      case "snap_bottom":
        return `
tell application "System Events" to tell process "${app}"
  set screenSize to size of first desktop
  set screenWidth to item 1 of screenSize
  set screenHeight to item 2 of screenSize
  set position of window 1 to {0, screenHeight / 2}
  set size of window 1 to {screenWidth, screenHeight / 2}
end tell`;

      case "center":
        return `
tell application "System Events" to tell process "${app}"
  set screenSize to size of first desktop
  set screenWidth to item 1 of screenSize
  set screenHeight to item 2 of screenSize
  set windowSize to size of window 1
  set windowWidth to item 1 of windowSize
  set windowHeight to item 2 of windowSize
  set position of window 1 to {(screenWidth - windowWidth) / 2, (screenHeight - windowHeight) / 2}
end tell`;

      case "move_display":
        // Move window to next display (macOS Cmd+Opt+M equivalent)
        return `tell application "System Events" to keystroke "m" using {command down, option down}`;

      // Browser Controls
      case "open_url":
        const url = parameters?.url || parameters?.target || "";
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to open location "${url}"`;
        }
        return null;

      case "new_tab":
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to make new tab`;
        }
        return `tell application "System Events" to keystroke "t" using command down`;

      case "close_tab":
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to close current tab`;
        }
        return `tell application "System Events" to keystroke "w" using command down`;

      case "refresh":
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to tell active tab of front window to reload`;
        }
        return `tell application "System Events" to keystroke "r" using command down`;

      case "back":
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to go back`;
        }
        return `tell application "System Events" to key code 123 using command down`; // Cmd+Left

      case "forward":
        if (this.isBrowserApp(app)) {
          return `tell application "${app}" to go forward`;
        }
        return `tell application "System Events" to key code 124 using command down`; // Cmd+Right

      // Clipboard
      case "copy":
        return `tell application "System Events" to keystroke "c" using command down`;

      case "paste":
        return `tell application "System Events" to keystroke "v" using command down`;

      case "select_all":
        return `tell application "System Events" to keystroke "a" using command down`;

      case "read_clipboard":
        return `the clipboard as text`;

      // Finder
      case "open_folder":
        const folderPath = parameters?.path || parameters?.target || "Documents";
        if (folderPath.startsWith("/")) {
          return `tell application "Finder" to open POSIX file "${folderPath}"`;
        }
        return `tell application "Finder" to open folder "${folderPath}" of home`;

      case "new_window":
        if (app === "Finder") {
          return `tell application "Finder" to make new Finder window`;
        }
        return `tell application "System Events" to keystroke "n" using command down`;

      case "go_to_path":
        const targetPath = parameters?.path || parameters?.target || "";
        if (app === "Finder" && targetPath) {
          return `tell application "Finder" to open POSIX file "${targetPath}"`;
        }
        return null;

      // VS Code / Cursor
      case "open_file":
        const filePath = parameters?.path || parameters?.file || "";
        if (this.isEditorApp(app) && filePath) {
          return `do shell script "code '${filePath}'"`;
        }
        return `tell application "System Events" to keystroke "p" using command down`;

      case "go_to_line":
        const lineNumber = parameters?.line || "";
        if (this.isEditorApp(app)) {
          return `
tell application "System Events" to tell process "${app}"
  keystroke "g" using command down
  keystroke "${lineNumber}"
  keystroke return
end tell`;
        }
        return null;

      case "command_palette":
        if (this.isEditorApp(app)) {
          return `tell application "System Events" to keystroke "p" using {command down, shift down}`;
        }
        return null;

      // Terminal
      case "clear_terminal":
        if (this.isTerminalApp(app)) {
          return `tell application "System Events" to keystroke "k" using command down`;
        }
        return `tell application "System Events" to keystroke "l" using control down`;

      case "delete_line":
        return `tell application "System Events" to keystroke "u" using control down`;

      case "delete_word":
        return `tell application "System Events" to keystroke (key code 51) using option down`; // Opt+Delete

      // Communication
      case "send_message":
        const recipient = parameters?.recipient || parameters?.target || "";
        const messageText = parameters?.message || parameters?.text || "";
        if (app === "Messages" && recipient && messageText) {
          return `
tell application "Messages"
  send "${messageText}" to buddy "${recipient}"
end tell`;
        }
        return null;

      case "send_email":
        const emailTo = parameters?.to || parameters?.recipient || "";
        const subject = parameters?.subject || "";
        const body = parameters?.body || parameters?.message || "";
        if (app === "Mail" && emailTo) {
          return `
tell application "Mail"
  set newMessage to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:true}
  tell newMessage
    make new to recipient with properties {address:"${emailTo}"}
  end tell
  activate
end tell`;
        }
        return null;

      case "create_event":
        const eventTitle = parameters?.title || parameters?.event || "";
        const eventDate = parameters?.date || "";
        if (app === "Calendar" && eventTitle) {
          return `
tell application "Calendar"
  tell calendar "Work"
    make new event with properties {summary:"${eventTitle}"}
  end tell
end tell`;
        }
        return null;

      case "create_reminder":
        const reminderText = parameters?.text || parameters?.reminder || "";
        if (app === "Reminders" && reminderText) {
          return `
tell application "Reminders"
  tell list "Reminders"
    make new reminder with properties {name:"${reminderText}"}
  end tell
end tell`;
        }
        return null;

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
   * Check if app is a browser
   */
  private isBrowserApp(app: string): boolean {
    const browsers = ["Safari", "Chrome", "Google Chrome", "Firefox", "Edge", "Arc"];
    return browsers.some((b) => app.toLowerCase().includes(b.toLowerCase()));
  }

  /**
   * Check if app is a code editor
   */
  private isEditorApp(app: string): boolean {
    const editors = ["Visual Studio Code", "VS Code", "Code", "Cursor", "Xcode"];
    return editors.some((e) => app.toLowerCase().includes(e.toLowerCase()));
  }

  /**
   * Check if app is a terminal
   */
  private isTerminalApp(app: string): boolean {
    const terminals = ["Terminal", "iTerm", "iTerm2"];
    return terminals.some((t) => app.toLowerCase().includes(t.toLowerCase()));
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
