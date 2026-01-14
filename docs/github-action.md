# Ralph GitHub Action

Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.

## Installation

Add the Ralph action to your GitHub workflow:

```yaml
- uses: AskTinNguyen/ralph-action@v1
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Quick Start

### Basic Build

```yaml
name: Ralph Build
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AskTinNguyen/ralph-action@v1
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          command: build
          iterations: '5'
```

### Issue-Driven Builds

Automatically convert GitHub issues to PRDs and build:

```yaml
name: Ralph Issue Build
on:
  issues:
    types: [labeled]

jobs:
  build:
    if: github.event.label.name == 'ralph'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AskTinNguyen/ralph-action@v1
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          issue-trigger: 'true'
```

### PR Validation

Run tests on pull requests:

```yaml
name: Ralph PR Validation
on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AskTinNguyen/ralph-action@v1
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          pr-validation: 'true'
          test-command: 'npm test'
          block-on-failure: 'true'
```

### Scheduled Builds

Run builds on a schedule, continuing from the last checkpoint:

```yaml
name: Ralph Scheduled Build
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for branch operations
      - uses: AskTinNguyen/ralph-action@v1
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          scheduled-build: 'true'
          target-branch: 'ralph-builds'
          notification-webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api-key` | Agent API key (e.g., ANTHROPIC_API_KEY for Claude) | Yes | - |
| `command` | Ralph command to run (build, plan, prd) | No | `build` |
| `iterations` | Number of build iterations | No | `5` |
| `agent` | AI agent to use (claude, codex, droid) | No | `claude` |
| `prd` | PRD number to build (uses latest if not specified) | No | - |
| `working-directory` | Working directory for ralph commands | No | `.` |
| `no-commit` | Skip automatic git commits during build | No | `false` |
| `issue-trigger` | Enable issue-driven builds | No | `false` |
| `issue-label` | Label that triggers issue-driven builds | No | `ralph` |
| `pr-validation` | Enable PR validation mode | No | `false` |
| `test-command` | Test command to run for PR validation | No | `npm test` |
| `block-on-failure` | Block merge on validation failure | No | `false` |
| `scheduled-build` | Enable scheduled build mode | No | `false` |
| `target-branch` | Branch to push scheduled build results to | No | `ralph-builds` |
| `notification-webhook` | Slack webhook URL for build notifications | No | - |
| `notification-channel` | Slack channel for notifications (without #) | No | - |

## Outputs

| Output | Description |
|--------|-------------|
| `success` | Whether the build completed successfully (true/false) |
| `stories-completed` | Number of user stories completed in this run |
| `duration` | Duration of the build in seconds |
| `exit-code` | Exit code from ralph command |
| `prd-number` | PRD number that was created/used |
| `comment-url` | URL of the comment posted to the issue |
| `check-run-id` | ID of the status check run created for PR validation |
| `test-output` | Output from test command (truncated) |
| `branch-pushed` | Branch that was pushed to (for scheduled builds) |
| `notification-sent` | Whether notification was sent (true/false) |

## Trigger Types

### 1. Issue-Driven Builds

When an issue is labeled with `ralph` (configurable via `issue-label` input):

1. Issue body is converted to PRD format
2. Ralph plan runs to create implementation plan
3. Ralph build executes the stories
4. Results are posted as a comment on the issue

**Issue format example:**

```markdown
## Overview
What we're building and why.

## Requirements
- Feature A
- Feature B

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

### 2. PR Validation

Triggered on pull request events:

1. Tests are run using `test-command`
2. Status check is created with results
3. Review comments are added for failures
4. Optionally blocks merge on failure

### 3. Scheduled Builds

Triggered by cron schedule:

1. Finds PRD with incomplete stories
2. Continues from last checkpoint (progress.md)
3. Pushes results to specified branch
4. Sends notification on completion

**Cron examples:**

```yaml
# Every 6 hours
- cron: '0 */6 * * *'

# Daily at midnight UTC
- cron: '0 0 * * *'

# Weekdays at 9am UTC
- cron: '0 9 * * 1-5'
```

### 4. Manual Dispatch

Trigger manually via GitHub Actions UI with customizable inputs.

## Notifications

### Slack

Set `notification-webhook` to your Slack incoming webhook URL:

```yaml
notification-webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
notification-channel: 'builds'  # Optional
```

Message includes:
- Build status (success/failure)
- PRD number
- Stories completed
- Duration
- Branch pushed
- Link to workflow run

### Discord

Discord webhooks are also supported - just use a Discord webhook URL:

```yaml
notification-webhook: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

## Secrets Setup

Add these secrets to your repository (Settings > Secrets):

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `OPENAI_API_KEY` | OpenAI API key (if using Codex) |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications |

## Troubleshooting

### Build fails with "No API key"

Ensure `api-key` input is set and the secret exists in your repository.

### Scheduled builds not running

- Check cron syntax is valid
- GitHub may delay scheduled runs during high load
- Scheduled workflows are disabled after 60 days of inactivity

### Tests fail but PR not blocked

Set `block-on-failure: 'true'` to require passing tests.

### Notifications not sending

- Verify webhook URL is correct
- Check webhook is not rate-limited
- Ensure secret is properly set

### Branch push fails

- Ensure `fetch-depth: 0` in checkout step
- Verify GITHUB_TOKEN has write permissions
- Check branch protection rules

## Example Workflows

See `.github/workflows/ralph-example.yml` for a complete example with all trigger types.
