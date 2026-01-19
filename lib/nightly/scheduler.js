/**
 * Nightly Scheduler
 *
 * Sets up cron jobs for automated nightly recommendations.
 * Supports:
 * - System cron (Linux/macOS)
 * - Launchd (macOS)
 * - Windows Task Scheduler
 * - GitHub Actions workflow generation
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const os = require("os");

/**
 * Default schedule: midnight local time
 */
const DEFAULT_CRON_SCHEDULE = "0 0 * * *";
const DEFAULT_TIME = "00:00";

/**
 * Generate cron expression from time string
 */
function timeToCron(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error(`Invalid time format: ${timeStr}. Use HH:MM format.`);
  }
  return `${minutes} ${hours} * * *`;
}

/**
 * Get the path to the ralph binary
 */
function getRalphBinPath() {
  // Check if ralph is in PATH
  try {
    const which = spawnSync("which", ["ralph"], { encoding: "utf-8" });
    if (which.status === 0 && which.stdout.trim()) {
      return which.stdout.trim();
    }
  } catch {}

  // Check common locations
  const commonPaths = [
    "/usr/local/bin/ralph",
    path.join(os.homedir(), ".npm-global/bin/ralph"),
    path.join(os.homedir(), "node_modules/.bin/ralph"),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to npx
  return "npx ralph-cli";
}

/**
 * Generate cron job entry
 */
function generateCronEntry(options = {}) {
  const {
    schedule = DEFAULT_CRON_SCHEDULE,
    projectPath = process.cwd(),
    logFile = null,
  } = options;

  const ralphPath = getRalphBinPath();
  const logPart = logFile ? ` >> "${logFile}" 2>&1` : "";

  return `${schedule} cd "${projectPath}" && ${ralphPath} nightly run${logPart}`;
}

/**
 * Install cron job (Linux/macOS)
 */
async function installCron(options = {}) {
  const {
    time = DEFAULT_TIME,
    projectPath = process.cwd(),
    logFile = path.join(projectPath, ".ralph/nightly.log"),
  } = options;

  const schedule = timeToCron(time);
  const cronEntry = generateCronEntry({ schedule, projectPath, logFile });

  // Get existing crontab
  let existingCron = "";
  try {
    existingCron = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {}

  // Check if entry already exists
  const marker = `# ralph-nightly: ${projectPath}`;
  if (existingCron.includes(marker)) {
    // Update existing entry
    const lines = existingCron.split("\n");
    const newLines = [];
    let skipNext = false;

    for (const line of lines) {
      if (line.includes(marker)) {
        skipNext = true;
        newLines.push(marker);
        newLines.push(cronEntry);
        continue;
      }
      if (skipNext) {
        skipNext = false;
        continue;
      }
      newLines.push(line);
    }

    existingCron = newLines.join("\n");
  } else {
    // Add new entry
    existingCron = existingCron.trim() + "\n\n" + marker + "\n" + cronEntry + "\n";
  }

  // Write new crontab
  const tempFile = path.join(os.tmpdir(), `ralph-cron-${Date.now()}`);
  fs.writeFileSync(tempFile, existingCron);

  try {
    execSync(`crontab "${tempFile}"`, { encoding: "utf-8" });
    return {
      success: true,
      schedule,
      entry: cronEntry,
      method: "cron",
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to install crontab: ${err.message}`,
    };
  } finally {
    fs.unlinkSync(tempFile);
  }
}

/**
 * Uninstall cron job
 */
async function uninstallCron(options = {}) {
  const { projectPath = process.cwd() } = options;

  let existingCron = "";
  try {
    existingCron = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {
    return { success: true, message: "No crontab found" };
  }

  const marker = `# ralph-nightly: ${projectPath}`;
  if (!existingCron.includes(marker)) {
    return { success: true, message: "No ralph-nightly entry found" };
  }

  // Remove entry
  const lines = existingCron.split("\n");
  const newLines = [];
  let skipNext = false;

  for (const line of lines) {
    if (line.includes(marker)) {
      skipNext = true;
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    newLines.push(line);
  }

  const newCron = newLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  const tempFile = path.join(os.tmpdir(), `ralph-cron-${Date.now()}`);
  fs.writeFileSync(tempFile, newCron);

  try {
    execSync(`crontab "${tempFile}"`, { encoding: "utf-8" });
    return { success: true, message: "Cron job removed" };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    fs.unlinkSync(tempFile);
  }
}

/**
 * Generate macOS launchd plist
 */
function generateLaunchdPlist(options = {}) {
  const {
    time = DEFAULT_TIME,
    projectPath = process.cwd(),
    logFile = path.join(projectPath, ".ralph/nightly.log"),
  } = options;

  const [hours, minutes] = time.split(":").map(Number);
  const ralphPath = getRalphBinPath();
  const projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, "-");
  const label = `com.ralph.nightly.${projectName}`;

  return {
    label,
    plist: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${ralphPath}</string>
        <string>nightly</string>
        <string>run</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectPath}</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hours}</integer>
        <key>Minute</key>
        <integer>${minutes}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${logFile}</string>
    <key>StandardErrorPath</key>
    <string>${logFile}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`,
  };
}

/**
 * Install launchd job (macOS)
 */
async function installLaunchd(options = {}) {
  const { projectPath = process.cwd() } = options;
  const { label, plist } = generateLaunchdPlist(options);

  const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);

  // Ensure directory exists
  const launchAgentsDir = path.dirname(plistPath);
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  // Unload existing if present
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { encoding: "utf-8" });
    } catch {}
  }

  // Write plist
  fs.writeFileSync(plistPath, plist);

  // Load the job
  try {
    execSync(`launchctl load "${plistPath}"`, { encoding: "utf-8" });
    return {
      success: true,
      method: "launchd",
      label,
      plistPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load launchd job: ${err.message}`,
    };
  }
}

/**
 * Uninstall launchd job
 */
async function uninstallLaunchd(options = {}) {
  const { projectPath = process.cwd() } = options;
  const projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, "-");
  const label = `com.ralph.nightly.${projectName}`;
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);

  if (!fs.existsSync(plistPath)) {
    return { success: true, message: "No launchd job found" };
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { encoding: "utf-8" });
  } catch {}

  fs.unlinkSync(plistPath);
  return { success: true, message: "Launchd job removed" };
}

/**
 * Generate GitHub Actions workflow
 */
function generateGitHubActionsWorkflow(options = {}) {
  const {
    time = DEFAULT_TIME,
    branch = "main",
    createPR = false,
  } = options;

  const [hours, minutes] = time.split(":").map(Number);

  return `name: Nightly AI Recommendations

on:
  schedule:
    # Runs at ${time} UTC daily
    - cron: '${minutes} ${hours} * * *'
  workflow_dispatch:
    # Allows manual trigger

jobs:
  nightly-recommendations:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${branch}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Ralph CLI
        run: npm install -g ralph-cli

      - name: Run nightly recommendations
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          SMTP_HOST: \${{ secrets.SMTP_HOST }}
          SMTP_USER: \${{ secrets.SMTP_USER }}
          SMTP_PASS: \${{ secrets.SMTP_PASS }}
          RALPH_NOTIFY_EMAIL: \${{ secrets.RALPH_NOTIFY_EMAIL }}
        run: |
          ralph nightly run ${createPR ? "--create-pr" : ""}

      - name: Commit recommendation report
        if: success()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .ralph/recommendations/
          git diff --staged --quiet || git commit -m "chore: add nightly recommendation $(date +%Y-%m-%d)"
          git push

${createPR ? `
      - name: Create implementation PR
        if: success()
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          # Check if there's an implementation branch
          if git ls-remote --heads origin nightly-implementation-$(date +%Y-%m-%d) | grep -q .; then
            gh pr create \\
              --title "Nightly Recommendation Implementation - $(date +%Y-%m-%d)" \\
              --body "Automated implementation of today's AI recommendation." \\
              --head nightly-implementation-$(date +%Y-%m-%d) \\
              --base ${branch} || true
          fi
` : ""}
`;
}

/**
 * Generate Windows Task Scheduler XML
 */
function generateWindowsTaskXML(options = {}) {
  const {
    time = DEFAULT_TIME,
    projectPath = process.cwd(),
  } = options;

  const [hours, minutes] = time.split(":").map(Number);
  const ralphPath = getRalphBinPath();

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Ralph CLI Nightly AI Recommendations</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2024-01-01T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${ralphPath}</Command>
      <Arguments>nightly run</Arguments>
      <WorkingDirectory>${projectPath}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Get current schedule status
 */
function getScheduleStatus(options = {}) {
  const { projectPath = process.cwd() } = options;
  const status = {
    cron: { installed: false },
    launchd: { installed: false },
    githubActions: { installed: false },
  };

  // Check cron
  try {
    const crontab = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
    const marker = `# ralph-nightly: ${projectPath}`;
    status.cron.installed = crontab.includes(marker);
    if (status.cron.installed) {
      const lines = crontab.split("\n");
      const markerIndex = lines.findIndex(l => l.includes(marker));
      if (markerIndex >= 0 && lines[markerIndex + 1]) {
        const cronLine = lines[markerIndex + 1];
        const match = cronLine.match(/^(\d+)\s+(\d+)/);
        if (match) {
          status.cron.time = `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}`;
        }
      }
    }
  } catch {}

  // Check launchd (macOS)
  if (process.platform === "darwin") {
    const projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, "-");
    const label = `com.ralph.nightly.${projectName}`;
    const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
    status.launchd.installed = fs.existsSync(plistPath);
    if (status.launchd.installed) {
      status.launchd.plistPath = plistPath;
    }
  }

  // Check GitHub Actions
  const workflowPath = path.join(projectPath, ".github/workflows/nightly-recommendations.yml");
  status.githubActions.installed = fs.existsSync(workflowPath);
  if (status.githubActions.installed) {
    status.githubActions.path = workflowPath;
  }

  return status;
}

module.exports = {
  timeToCron,
  generateCronEntry,
  installCron,
  uninstallCron,
  generateLaunchdPlist,
  installLaunchd,
  uninstallLaunchd,
  generateGitHubActionsWorkflow,
  generateWindowsTaskXML,
  getScheduleStatus,
  DEFAULT_CRON_SCHEDULE,
  DEFAULT_TIME,
};
