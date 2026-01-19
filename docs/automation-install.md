# Executive Automation Installation Guide

Quick setup guide for enabling Ralph CLI automation in game development repos.

---

## Prerequisites

1. **Node.js 18+** installed
2. **npm** package manager
3. **Ralph CLI** installed globally: `npm install -g ralph-cli`
4. **Git** repository initialized

---

## Quick Start (5 Steps)

### 1. Install Ralph CLI

```bash
npm install -g ralph-cli
```

### 2. Initialize Ralph in Your Project

```bash
cd /path/to/your/game-repo
ralph init
```

This creates the `.ralph/` directory structure.

### 3. Create Automation Configuration

Create `.ralph/automation-config.json`:

```json
{
  "slackChannels": {
    "gameplay": "C07L2GUNV6Y",
    "art": "C02RGAP67BL",
    "leadership": "C05V8KNACTU",
    "critical_alerts": "C05V8KNACTU"
  },
  "slackUsers": {
    "ceo": "U123456",
    "director_gameplay": "U234567",
    "director_art": "U345678"
  },
  "blockerEscalation": {
    "enabled": true,
    "thresholds": {
      "level1_days": 2,
      "level2_days": 4,
      "level3_days": 7
    }
  },
  "githubArchiving": {
    "enabled": true,
    "branch": "ralph-metrics",
    "metricsPath": ".ralph-metrics"
  },
  "bugWikipedia": {
    "enabled": true,
    "patternThreshold": 3,
    "patternWindow_days": 30
  },
  "emailFallback": {
    "enabled": false,
    "sender": "ralph-automation@studio.com",
    "recipients": ["ceo@studio.com"]
  }
}
```

**Finding Slack Channel IDs:**
- Open Slack in browser
- Go to the channel
- Channel ID is in the URL: `slack.com/archives/C07L2GUNV6Y`

### 4. Set Environment Variables

Add to your shell profile (`.bashrc`, `.zshrc`) or CI secrets:

```bash
# Required for Slack integration
export SLACK_BOT_TOKEN="xoxb-your-bot-token-here"
export SLACK_TEAM_ID="T01234567"

# Required for GitHub archiving
export GITHUB_TOKEN="ghp_your-token-here"

# Optional: Email fallback (SMTP)
export SMTP_SERVER="smtp.example.com"
export SMTP_PORT="587"
export SMTP_USER="automation@example.com"
export SMTP_PASS="password"
```

### 5. Verify Installation

```bash
ralph automation verify
```

Expected output:
```
Automation Installation Verification
════════════════════════════════════════════════════════════════

  ✓ .ralph/ directory           Found
  ✓ automation-config.json      Valid JSON with Slack channels
  ✓ SLACK_BOT_TOKEN             Set (xoxb...abcd)
  ✓ GITHUB_TOKEN                Set (ghp_...1234)
  ✓ slack-reporter.js           Slack reporting

════════════════════════════════════════════════════════════════

  Passed: 5  Warnings: 0  Failed: 0

All checks passed! Automation is ready to use.
```

---

## Environment Variables Reference

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `SLACK_BOT_TOKEN` | Yes (Slack) | Slack Bot OAuth token | `xoxb-123-456-abc...` |
| `SLACK_TEAM_ID` | No | Slack workspace ID | `T01234567` |
| `GITHUB_TOKEN` | Yes (GitHub) | GitHub PAT with repo scope | `ghp_abc123...` |
| `RALPH_DRY_RUN` | No | Test without sending (set to `1`) | `1` |
| `FORCE_SLACK_SEND` | No | Bypass quiet hours (set to `1`) | `1` |
| `RALPH_UI_URL` | No | UI base URL for links | `https://ralph.studio.com` |
| `SMTP_SERVER` | No | SMTP server for email fallback | `smtp.gmail.com` |
| `SMTP_PORT` | No | SMTP port | `587` |
| `SMTP_USER` | No | SMTP username | `user@example.com` |
| `SMTP_PASS` | No | SMTP password | `app-password` |

---

## CLI Commands

### Run Slack Reports

```bash
# Send team reports to Slack channels
ralph automation slack-report

# Dry run (no actual sends)
RALPH_DRY_RUN=1 ralph automation slack-report

# Force send during quiet hours (22:00-08:00)
FORCE_SLACK_SEND=1 ralph automation slack-report

# Validate Block Kit message format
ralph automation slack-report --format-test
```

### Check for Blockers

```bash
# Detect and escalate blocked PRDs
ralph automation check-blockers
```

### Archive Metrics to GitHub

```bash
# Push metrics to ralph-metrics branch
ralph automation github-archive
```

### Scan for Bugs

```bash
# Scan git history for bug-related commits
ralph automation scan-bugs
```

### Verify Installation

```bash
# Check all prerequisites and configuration
ralph automation verify
```

---

## Cron/Scheduler Integration

### Cron Examples (Linux/macOS)

Add to crontab (`crontab -e`):

```bash
# Daily Slack reports at 8:00 AM UTC
0 8 * * * cd /path/to/game-repo && ralph automation slack-report >> /var/log/ralph-slack.log 2>&1

# Daily blocker check at 9:00 AM UTC
0 9 * * * cd /path/to/game-repo && ralph automation check-blockers >> /var/log/ralph-blockers.log 2>&1

# Weekly GitHub archive on Fridays at 5:00 PM UTC
0 17 * * 5 cd /path/to/game-repo && ralph automation github-archive >> /var/log/ralph-archive.log 2>&1

# Daily bug scan at midnight UTC
0 0 * * * cd /path/to/game-repo && ralph automation scan-bugs >> /var/log/ralph-bugs.log 2>&1
```

### GitHub Actions Workflow

Create `.github/workflows/ralph-automation.yml`:

```yaml
name: Ralph Automation

on:
  schedule:
    # Daily at 8:00 AM UTC
    - cron: '0 8 * * *'
  workflow_dispatch:
    inputs:
      command:
        description: 'Automation command to run'
        required: true
        default: 'slack-report'
        type: choice
        options:
          - slack-report
          - check-blockers
          - github-archive
          - scan-bugs

jobs:
  automation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Ralph CLI
        run: npm install -g ralph-cli

      - name: Run Slack Report (scheduled)
        if: github.event_name == 'schedule'
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          ralph automation slack-report
          ralph automation check-blockers

      - name: Run Manual Command
        if: github.event_name == 'workflow_dispatch'
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: ralph automation ${{ inputs.command }}
```

**Required GitHub Secrets:**
- `SLACK_BOT_TOKEN`: Your Slack bot token
- `GITHUB_TOKEN`: Automatically provided by GitHub Actions

---

## Troubleshooting

### "SLACK_BOT_TOKEN not set"

**Problem:** Slack commands fail with token error.

**Solution:**
1. Create a Slack App at https://api.slack.com/apps
2. Add Bot Token Scopes: `chat:write`, `files:write`, `channels:read`
3. Install app to workspace
4. Copy "Bot User OAuth Token" (starts with `xoxb-`)
5. Set environment variable: `export SLACK_BOT_TOKEN="xoxb-..."`

### "Channel not found" / "not_in_channel"

**Problem:** Bot can't post to a channel.

**Solution:**
1. Invite the bot to the channel: `/invite @your-bot-name`
2. Verify channel ID in config matches the actual channel
3. Check bot has `chat:write` scope

### "Rate limit exceeded"

**Problem:** Too many Slack API calls.

**Solution:**
- Ralph automatically respects rate limits (1 msg/sec per channel, 20 req/min global)
- Failed messages are queued in `.ralph/message-queue.json`
- Re-run command to process queued messages

### "automation-config.json not found"

**Problem:** Config file missing.

**Solution:**
1. Create `.ralph/automation-config.json` with template above
2. Ensure `.ralph/` directory exists (run `ralph init`)

### "Scripts not found"

**Problem:** Automation scripts missing.

**Solution:**
1. Update Ralph CLI: `npm update -g ralph-cli`
2. Verify installation: `ralph --version`
3. Some scripts (check-blockers, github-archiver, bug-scanner) may not be implemented yet

### Git Blame Errors

**Problem:** Blocker escalation can't identify who caused issues.

**Solution:**
- Ensure git history is available (not a shallow clone)
- Run `git fetch --unshallow` if needed
- Check file permissions in .ralph/ directory

---

## For AI Agents

When installing Ralph automation in a new repo:

1. **Check prerequisites:**
   ```bash
   node --version    # Must be 18+
   ralph --version   # Must be installed
   ```

2. **Initialize and configure:**
   ```bash
   ralph init
   # Create .ralph/automation-config.json with channel mappings
   ```

3. **Verify environment:**
   ```bash
   ralph automation verify
   ```

4. **Test with dry run:**
   ```bash
   RALPH_DRY_RUN=1 ralph automation slack-report
   ```

5. **Set up scheduler:**
   - Use cron for local/server deployment
   - Use GitHub Actions for cloud deployment

**Critical:** Always use `--headless` flag when calling `ralph prd` from automation scripts to avoid TTY conflicts.

---

## Support

- **Issues:** https://github.com/AskTinNguyen/ralph-cli/issues
- **Docs:** Run `ralph automation --help` for command details
- **Configuration:** See `.ralph/automation-config.json` schema in examples above
