# MCP Tools Reference

This document defines available MCP (Model Context Protocol) servers and how agents should use them.

## Available MCP Servers

### Notion
Access Notion workspaces, databases, pages, and blocks.

**Common Tools:**
- `mcp__notion__search` - Search for pages and databases
- `mcp__notion__get_page` - Retrieve a page by ID
- `mcp__notion__create_page` - Create a new page
- `mcp__notion__update_page` - Update page properties
- `mcp__notion__query_database` - Query a database with filters
- `mcp__notion__get_database` - Get database schema
- `mcp__notion__append_block_children` - Add content blocks to a page

**Use Cases:**
- Fetch project documentation from Notion
- Update task status in Notion databases
- Create meeting notes or documentation pages
- Query databases for project information

### Slack
Send and receive messages, manage channels, search conversations.

**Quick Reference Channels:**

| Channel ID | Channel Name |
|------------|--------------|
| C021YDBQM53 | general |
| C05V8KNACTU | leadership-team |
| C070Z0D2GQZ | life-at-ather-labs |
| C07L2GUNV6Y | s2-game |
| C034P04K6EA | metaverse-engineers |
| C04QKEKPD3M | learning-generative-ai |
| C0984SP6VCJ | s2-story-trailers-cinematic |
| C02RGAP67BL | art-wip-2dconcept |

**Common Tools:**
- `mcp__slack__send_message` - Send a message to a channel
- `mcp__slack__list_channels` - List available channels
- `mcp__slack__get_channel_history` - Get recent messages from a channel
- `mcp__slack__search_messages` - Search messages across workspace
- `mcp__slack__post_thread_reply` - Reply to a thread
- `mcp__slack__get_users` - List workspace users

**Use Cases:**
- Notify team of build completion
- Post status updates to project channels
- Search for context from previous discussions
- Alert on errors or important events

#### Slack Canvas API (via curl)

MCP doesn't include canvas methods. Use direct API calls:

**Create Canvas:**
```bash
curl -s -X POST "https://slack.com/api/canvases.create" \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Canvas Title",
    "document_content": {"type": "markdown", "markdown": "# Content"}
  }'
```

**Canvas URL Formats:**
```
# Short format
https://app.slack.com/docs/{team_id}/{canvas_id}

# Slack's internal format
https://app.slack.com/client/{team_id}/unified-files/doc/{canvas_id}
```
- Team ID: starts with `T` (e.g., T022R9VEBPA)
- Canvas ID: starts with `F` (e.g., F0A8D6U5MV1)
- Canvases stored in `unified-files` system as type `doc`
- Do NOT use `{workspace}.slack.com/docs/` - returns 404

**Canvas Methods:**
- `canvases.create` - Create standalone canvas
- `canvases.edit` - Update canvas content
- `canvases.delete` - Delete canvas
- `canvases.access.set` - Set permissions
- `canvases.sections.lookup` - Find sections

See `skills/slack-canvas/SKILL.md` for full reference.

### GitHub
Manage repositories, issues, pull requests, and code.

**Common Tools:**
- `mcp__github__create_issue` - Create a new issue
- `mcp__github__list_issues` - List repository issues
- `mcp__github__create_pull_request` - Create a PR
- `mcp__github__get_pull_request` - Get PR details
- `mcp__github__list_pull_requests` - List PRs
- `mcp__github__create_branch` - Create a new branch
- `mcp__github__search_code` - Search code across repos
- `mcp__github__get_file_contents` - Read file from repo

**Use Cases:**
- Create issues from discovered bugs
- Link PRs to user stories
- Search for code patterns across repositories
- Automate PR creation after builds

### Miro
Create and manage Miro boards for visual collaboration.

**Common Tools:**
- `mcp__miro__get_boards` - List available boards
- `mcp__miro__create_board` - Create a new board
- `mcp__miro__create_sticky_note` - Add sticky notes
- `mcp__miro__create_shape` - Add shapes to boards
- `mcp__miro__create_connector` - Connect elements
- `mcp__miro__get_items` - Get items from a board

**Use Cases:**
- Create architecture diagrams
- Build visual roadmaps
- Document workflows and processes
- Create sprint planning boards

## Agent Guidelines

### When to Use MCP Tools

1. **Notion** - When you need project context, documentation, or need to update task tracking
2. **Slack** - When you need to communicate status, ask questions, or search for context
3. **GitHub** - When managing code, issues, or pull requests beyond local git
4. **Miro** - When creating visual documentation or diagrams

### Best Practices

- Always check if the required environment variables are set before using MCP tools
- Handle errors gracefully - MCP servers may not always be available
- Use descriptive messages when posting to Slack channels
- Link GitHub issues/PRs to Notion tasks when possible
- Cache frequently accessed data to minimize API calls

### Error Handling

If an MCP tool fails:
1. Log the error to the activity log
2. Continue with the task if the MCP call was optional
3. Report the failure in progress.md if it blocks the task
4. Suggest manual intervention if required

## Environment Variables Required

Set these in your shell or `.env` file:

```bash
# Notion
export NOTION_API_KEY="secret_..."

# Slack
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_TEAM_ID="T..."

# GitHub
export GITHUB_TOKEN="ghp_..."

# Miro
export MIRO_API_TOKEN="..."
```
