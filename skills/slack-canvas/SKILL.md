---
name: slack-canvas
description: Work with Slack Canvases via the API - create, edit, delete, and find canvases in channels.
---

# Slack Canvas API

Canvases are collaborative documents built into Slack. This skill covers API methods for managing them.

## API Methods

| Method                          | Purpose                   |
| ------------------------------- | ------------------------- |
| `canvases.create`               | Create standalone canvas  |
| `canvases.edit`                 | Update existing canvas    |
| `canvases.delete`               | Delete a canvas           |
| `canvases.access.set`           | Set access permissions    |
| `canvases.access.delete`        | Remove access             |
| `canvases.sections.lookup`      | Find sections by criteria |
| `conversations.canvases.create` | Create channel canvas     |

## Finding Canvases

### In a Channel

```
conversations.info -> channel.properties.canvas
```

Returns `file_id`, `is_empty`, `quip_thread_id`.

### List All Canvases

```
files.list with type=canvas
```

## Creating a Canvas

```json
{
  "title": "My Canvas",
  "document_content": {
    "type": "markdown",
    "markdown": "# Heading\n\nContent here"
  },
  "channel_id": "C07L2GUNV6Y" // optional: auto-add to channel
}
```

Response returns `canvas_id`.

## Editing a Canvas

```json
{
  "canvas_id": "F0166DCSTS7",
  "changes": [
    {
      "operation": "insert_after",
      "section_id": "section_id_here",
      "document_content": {
        "type": "markdown",
        "markdown": "New content"
      }
    }
  ]
}
```

## Supported Content

- Headings, paragraphs, lists
- Code blocks, tables (max 300 cells)
- @mentions, embeds
- **No Block Kit support**

## Required Scopes

- `canvases:read` - Read canvas content
- `canvases:write` - Create/edit canvases
- `files:read` - **Required for reading canvas content** (see Reading Canvas Content below)

## Reading Canvas Content

**Important**: Slack Canvas API has NO public endpoint to read full canvas content programmatically. The `canvases.sections.lookup` method only returns section IDs, not actual content.

**Working Approach**: Use `files.info` to get canvas metadata, then download via `url_private_download`.

### Prerequisites

1. **Bot token** with `files:read` and `canvases:read` scopes
2. **Canvas must be shared** to a channel/space where bot has access
3. Canvas ID (starts with `F`, e.g., `F0A74QAKG01`)

### Step-by-Step Workflow

#### 1. Test Bot Authentication

```bash
curl -X POST "https://slack.com/api/auth.test" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

**Expected response:**
```json
{
  "ok": true,
  "url": "https://yourworkspace.slack.com/",
  "team": "Your Team",
  "user": "ralph-bot",
  "team_id": "T022R9VEBPA",
  "user_id": "U03ABC123"
}
```

#### 2. Get Canvas File Info

```bash
curl -X GET "https://slack.com/api/files.info?file=F0A74QAKG01" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

**Expected response:**
```json
{
  "ok": true,
  "file": {
    "id": "F0A74QAKG01",
    "name": "My Canvas",
    "title": "My Canvas",
    "mimetype": "application/vnd.slack-docs",
    "filetype": "slack_docs",
    "url_private": "https://files.slack.com/files-pri/T022R9VEBPA-F0A74QAKG01/canvas",
    "url_private_download": "https://files.slack.com/files-pri/T022R9VEBPA-F0A74QAKG01/download/canvas",
    "channels": ["C05V8KNACTU"],
    "is_public": false
  }
}
```

**Key fields:**
- `url_private_download` - Use this URL to download canvas content
- `channels` - Canvas must be shared to at least one channel where bot has access
- `mimetype: application/vnd.slack-docs` - Confirms this is a canvas

#### 3. Download Canvas Content

```bash
curl -L "https://files.slack.com/files-pri/T022R9VEBPA-F0A74QAKG01/download/canvas" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

**Output**: Canvas content as HTML with section IDs

```html
<div class="canvas-section" data-section-id="section_001">
  <h1>My Heading</h1>
  <p>Canvas content here...</p>
</div>
```

### Complete Example Script

```bash
#!/bin/bash
# Download Slack Canvas content

SLACK_BOT_TOKEN="xoxb-your-bot-token"
CANVAS_ID="F0A74QAKG01"

# 1. Test authentication
echo "Testing bot authentication..."
curl -s -X POST "https://slack.com/api/auth.test" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq .

# 2. Get canvas metadata
echo -e "\nFetching canvas metadata..."
CANVAS_INFO=$(curl -s -X GET "https://slack.com/api/files.info?file=$CANVAS_ID" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN")

echo "$CANVAS_INFO" | jq .

# 3. Extract download URL
DOWNLOAD_URL=$(echo "$CANVAS_INFO" | jq -r '.file.url_private_download')

# 4. Download canvas content
echo -e "\nDownloading canvas content..."
curl -s -L "$DOWNLOAD_URL" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" > canvas_content.html

echo "Canvas saved to canvas_content.html"
```

### Key Limitations

1. **Canvas must be shared to bot-accessible channel** - If canvas is private/unshared, `files.info` returns `file_not_found`
2. **Bot needs `files:read` scope** - Not just `canvases:read`
3. **Content is HTML format** - Requires parsing to extract structured data
4. **Section IDs included** - Use `data-section-id` attributes for targeted edits via `canvases.edit`

## MCP Integration Note

Current Slack MCP server lacks canvas methods. While the MCP cannot directly read canvas content, you can use the **files.info + download approach** as a workaround:

### Using MCP + Bash for Canvas Reading

1. Use MCP to list channels and find canvas references
2. Use bash/curl to call `files.info` and download canvas
3. Parse HTML to extract content
4. Use MCP canvas methods for editing (if available)

### Recommended MCP Additions

To add full canvas support to MCP server:

1. Add `files.info` method to get canvas metadata
2. Add canvas download helper using `url_private_download`
3. Add HTML parser for canvas content extraction
4. Add `conversations.info` for channel canvas lookup
5. Add `files.list` with canvas type filter

## Troubleshooting

### Error: `not_authed`

**Cause**: Invalid or missing bot token

**Fix**:
```bash
# Verify token is set
echo $SLACK_BOT_TOKEN

# Test authentication
curl -X POST "https://slack.com/api/auth.test" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

### Error: `file_not_found`

**Cause**: Canvas not shared to bot-accessible channel, or invalid canvas ID

**Fix**:
1. Share canvas to a channel where bot is a member
2. Verify canvas ID starts with `F`
3. Check bot has `files:read` scope

```bash
# List bot's available files
curl -X GET "https://slack.com/api/files.list?types=slack_docs" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

### Error: `missing_scope`

**Cause**: Bot token lacks required OAuth scopes

**Fix**:
1. Go to Slack App settings → OAuth & Permissions
2. Add scopes: `files:read`, `canvases:read`, `canvases:write`
3. Reinstall app to workspace
4. Update bot token

### Canvas Download Returns Empty HTML

**Cause**: Canvas is empty or bot lacks permissions

**Fix**:
1. Check canvas has content via Slack UI
2. Verify bot is member of channel where canvas is shared
3. Use `files.info` to check `channels` array includes bot-accessible channel

## Important Dates

- **April 9, 2025**: Channel/DM canvases convert to canvases-in-tabs

## Canvas URL Format

**Two valid formats:**

```
# Short format
https://app.slack.com/docs/{team_id}/{canvas_id}

# Slack's internal format (unified-files)
https://app.slack.com/client/{team_id}/unified-files/doc/{canvas_id}
```

Example:

```
https://app.slack.com/docs/T022R9VEBPA/F0A8D6U5MV1
https://app.slack.com/client/T022R9VEBPA/unified-files/doc/F0A8D6U5MV1
```

**Key insights**:

- Canvases are stored in `unified-files` system with type `doc`
- Canvas IDs start with `F` (same as files)
- Team ID starts with `T`
- Do NOT use `https://{workspace}.slack.com/docs/{canvas_id}` - returns 404

## References

- https://docs.slack.dev/surfaces/canvases/
- https://docs.slack.dev/reference/methods/canvases.create/
- https://docs.slack.dev/reference/methods/canvases.edit/
- https://api.slack.com/methods/conversations.info
