# Nightly AI Recommendations

AI-powered nightly analysis that surfaces actionable insights from your data every day.

## Overview

The nightly recommendations system:

1. **Collects data** from configured sources (databases, APIs, Ralph metrics)
2. **Analyzes with Opus 4.5** to identify patterns and opportunities
3. **Generates one actionable recommendation** per day
4. **Sends notifications** via email, Slack, or Discord
5. **Stores reports** as markdown in your git repo
6. **Optionally creates PRs** with automatic implementations

## Quick Start

```bash
# Configure your data sources and notifications
ralph nightly config

# Test the configuration
ralph nightly test

# Run manually to see your first recommendation
ralph nightly run --email

# Set up automated nightly runs
ralph nightly schedule --time=06:00
```

## Configuration

Configuration is stored in `.ralph/nightly-config.json`.

### Interactive Setup

```bash
ralph nightly config
```

This wizard helps you configure:
- Data sources (databases, APIs, Ralph metrics)
- Email notifications
- Slack webhooks
- Business context for better recommendations

### Manual Configuration

```json
{
  "sources": [
    {
      "name": "ralph",
      "type": "ralph_metrics"
    },
    {
      "name": "database",
      "type": "postgresql",
      "connectionString": "postgresql://user:pass@host:5432/db",
      "queries": [
        {
          "name": "daily_signups",
          "sql": "SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '1 day'",
          "description": "New user signups in the last 24 hours"
        },
        {
          "name": "active_users",
          "sql": "SELECT COUNT(DISTINCT user_id) as count FROM events WHERE timestamp > NOW() - INTERVAL '1 day'",
          "description": "Daily active users"
        }
      ]
    }
  ],
  "email": {
    "enabled": true,
    "to": "you@example.com"
  },
  "slack": {
    "enabled": false,
    "webhookUrl": "https://hooks.slack.com/services/..."
  },
  "context": {
    "businessType": "saas",
    "goals": ["growth", "retention", "engagement"]
  }
}
```

## Data Sources

### Ralph Metrics (Built-in)

Automatically collects:
- Build success rates
- Token costs
- Guardrails learned
- Performance trends

```json
{
  "name": "ralph",
  "type": "ralph_metrics"
}
```

### PostgreSQL

```json
{
  "name": "database",
  "type": "postgresql",
  "connectionString": "postgresql://...",
  "queries": [
    {
      "name": "metric_name",
      "sql": "SELECT ...",
      "description": "What this metric measures"
    }
  ]
}
```

### MySQL

```json
{
  "name": "mysql",
  "type": "mysql",
  "connectionString": "mysql://...",
  "queries": [...]
}
```

### HTTP APIs

```json
{
  "name": "analytics",
  "type": "http_api",
  "headers": {
    "Authorization": "Bearer ..."
  },
  "endpoints": [
    {
      "name": "metrics",
      "url": "https://api.example.com/metrics",
      "method": "GET",
      "description": "Fetch analytics metrics"
    }
  ]
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required. Your Anthropic API key for Opus 4.5 |
| `DATABASE_URL` | PostgreSQL connection string (alternative to config) |
| `MYSQL_URL` | MySQL connection string (alternative to config) |
| `SMTP_HOST` | Email server hostname |
| `SMTP_PORT` | Email server port (default: 587) |
| `SMTP_USER` | Email server username |
| `SMTP_PASS` | Email server password |
| `SMTP_SECURE` | Set to "true" for TLS |
| `RALPH_NOTIFY_EMAIL` | Default recipient email |
| `SLACK_WEBHOOK` | Slack webhook URL |
| `SENDGRID_API_KEY` | SendGrid API key (alternative to SMTP) |

## Commands

### `ralph nightly run`

Run the analysis and generate a recommendation.

```bash
# Run and save report only
ralph nightly run

# Run and send email
ralph nightly run --email

# Run and post to Slack
ralph nightly run --slack

# Output as JSON
ralph nightly run --json

# Don't save markdown report
ralph nightly run --no-save
```

### `ralph nightly config`

Interactive configuration wizard.

```bash
ralph nightly config
```

### `ralph nightly schedule`

Set up automated nightly runs.

```bash
# Schedule for midnight (default)
ralph nightly schedule

# Schedule for 6 AM
ralph nightly schedule --time=06:00

# Use cron (Linux/macOS)
ralph nightly schedule --method=cron

# Use launchd (macOS)
ralph nightly schedule --method=launchd

# Generate GitHub Actions workflow
ralph nightly schedule --method=github-actions

# Remove schedule
ralph nightly schedule --uninstall
```

### `ralph nightly status`

Show current configuration and schedule status.

```bash
ralph nightly status
ralph nightly status --json
```

### `ralph nightly history`

View past recommendations.

```bash
ralph nightly history
ralph nightly history --limit=20
ralph nightly history --json
```

### `ralph nightly test`

Test configuration without sending notifications.

```bash
ralph nightly test
ralph nightly test --verbose
```

## Scheduling Options

### System Cron (Linux/macOS)

```bash
ralph nightly schedule --method=cron --time=00:00
```

Creates a crontab entry that runs at the specified time.

### Launchd (macOS)

```bash
ralph nightly schedule --method=launchd --time=06:00
```

Creates a launchd plist in `~/Library/LaunchAgents/`.

### GitHub Actions

```bash
ralph nightly schedule --method=github-actions
```

Creates `.github/workflows/nightly-recommendations.yml`.

Required secrets:
- `ANTHROPIC_API_KEY`
- `DATABASE_URL` (if using database)
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (if using email)

## Autonomous Implementation (Phase 2)

The system can automatically implement recommendations by creating PRs.

```bash
# Create a PR with the implementation
ralph nightly run --create-pr

# Auto-implement and create PR (use with caution)
ralph nightly run --auto-implement
```

### How It Works

1. Creates a feature branch (`nightly-impl/YYYY-MM-DD-title`)
2. Generates an implementation prompt from the recommendation
3. Invokes Claude to implement the changes
4. Runs tests and validation
5. Creates a draft PR for review

### Configuration

```json
{
  "baseBranch": "main",
  "pr": {
    "draft": true,
    "reviewers": ["username"],
    "labels": ["nightly-recommendation", "automated"]
  },
  "implementationContext": {
    "codebaseContext": "Node.js Express application with React frontend",
    "constraints": ["Follow existing patterns", "No new dependencies without approval"],
    "testRequirements": ["All tests must pass", "Add tests for new features"]
  }
}
```

## Report Format

Reports are saved to `.ralph/recommendations/recommendation-YYYY-MM-DD.md`.

Example structure:

```markdown
# AI Recommendation - Monday, January 20, 2025

## ⚡ Recommendation

### Improve User Onboarding Flow

**Priority:** HIGH
**Effort:** 🟡 MEDIUM

Reduce time-to-value for new users by simplifying the onboarding flow...

### Details
...

### Expected Impact
20% improvement in activation rate within 30 days.

### Key Data Points
- 40% drop-off rate at step 3
- Average onboarding time: 15 minutes
- Competitors average: 5 minutes

### Next Steps
1. Review current onboarding analytics
2. Identify and remove unnecessary steps
3. Add progress indicators

## Analysis Summary

### Key Insights
- High drop-off during profile setup
- Users who complete onboarding have 3x retention

### Positive Signals
- Good retention after activation
- High satisfaction scores from active users
```

## Best Practices

### Data Quality

The quality of recommendations depends on data quality:

1. **Include diverse metrics** - user activity, business metrics, technical health
2. **Use meaningful descriptions** for queries so the AI understands context
3. **Include time-based comparisons** (today vs. yesterday, this week vs. last week)

### Business Context

Help the AI understand your business:

```json
{
  "context": {
    "businessType": "saas",
    "stage": "growth",
    "goals": ["increase MRR", "reduce churn", "improve NPS"],
    "focusAreas": ["onboarding", "feature adoption"],
    "constraints": ["limited engineering resources", "no major architecture changes"]
  }
}
```

### Security

1. Use environment variables for sensitive data, not config files
2. Don't commit `.ralph/nightly-config.json` if it contains credentials
3. Add to `.gitignore`:
   ```
   .ralph/nightly-config.json
   ```

## Troubleshooting

### "ANTHROPIC_API_KEY not set"

Set your API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### "Database connection failed"

1. Check your connection string
2. Ensure the database is accessible from your machine
3. Test with: `psql $DATABASE_URL` or `mysql -u user -p`

### "Email failed to send"

1. Check SMTP settings
2. Try with SendGrid: `export SENDGRID_API_KEY=...`
3. Check firewall/network settings

### "No recommendations generated"

1. Ensure data sources are returning data: `ralph nightly test --verbose`
2. Check if queries are returning rows
3. Verify API endpoints are responding

### "Schedule not running"

For cron:
```bash
crontab -l  # Check if entry exists
tail -f /var/log/syslog | grep ralph  # Check logs (Linux)
```

For launchd:
```bash
launchctl list | grep ralph  # Check if loaded
cat ~/Library/LaunchAgents/com.ralph.nightly.*.plist  # Check config
```

## Integration Examples

### With Slack Reminders

Post to a dedicated channel each morning:

```json
{
  "slack": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/..."
  }
}
```

### With GitHub Actions + Auto-PR

`.github/workflows/nightly-recommendations.yml`:

```yaml
name: Nightly AI Recommendations

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

jobs:
  nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm install -g ralph-cli

      - name: Run nightly with auto-PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: ralph nightly run --create-pr

      - name: Commit reports
        run: |
          git config user.name "github-actions[bot]"
          git add .ralph/recommendations/
          git commit -m "chore: add nightly recommendation" || true
          git push
```

### With Email + Daily Standup

Configure email to arrive before your standup:

```bash
# 8:30 AM, 30 minutes before standup
ralph nightly schedule --time=08:30 --method=cron
```

## API Reference

### Collector Module

```javascript
const { collectAll, DATA_SOURCE_TYPES } = require('ralph-cli/lib/nightly');

const data = await collectAll([
  { type: DATA_SOURCE_TYPES.RALPH_METRICS },
  { type: DATA_SOURCE_TYPES.POSTGRESQL, connectionString: '...' },
]);
```

### Analyzer Module

```javascript
const { analyze } = require('ralph-cli/lib/nightly');

const result = await analyze(collectedData, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-5-20251101',
  context: { businessType: 'saas' },
});
```

### Reporter Module

```javascript
const { generateMarkdownReport, sendEmail, saveMarkdownReport } = require('ralph-cli/lib/nightly');

const markdown = generateMarkdownReport(analysisResult);
const saveResult = saveMarkdownReport(markdown, { outputDir: '.ralph/recommendations' });
const emailResult = await sendEmail(analysisResult, { to: 'user@example.com' });
```

### Executor Module

```javascript
const { execute, EXECUTION_MODES } = require('ralph-cli/lib/nightly');

const result = await execute(recommendation, analysisResult, {
  mode: EXECUTION_MODES.FULL_PR,
  baseBranch: 'main',
});
```
