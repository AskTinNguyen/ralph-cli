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

## MCP Integration Note

Current Slack MCP server lacks canvas methods. To add support:

1. Add `canvases.*` methods to MCP server
2. Add `conversations.info` for channel canvas lookup
3. Add `files.list` with canvas type filter

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
