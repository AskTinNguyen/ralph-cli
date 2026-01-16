---
name: slack-file
description: Download and manage files from Slack - retrieve file metadata, download content, list files by type or channel.
---

# Slack File API

Retrieve, list, and download files shared in Slack workspaces.

## API Methods

| Method | Purpose |
|--------|---------|
| `files.info` | Get file metadata and download URL |
| `files.list` | List files with filtering options |
| `files.upload` | Upload a file to Slack |
| `files.delete` | Delete a file |
| `files.sharedPublicURL` | Create public URL for file |
| `files.revokePublicURL` | Revoke public URL |

## Required Scopes

| Scope | Purpose |
|-------|---------|
| `files:read` | Read file metadata and download files |
| `files:write` | Upload and delete files |

## Token Types

Slack supports two token types with different access levels:

| Token Type | Prefix | Use Case |
|------------|--------|----------|
| **Bot Token** | `xoxb-` | Access files shared in channels where bot is a member |
| **User Token** | `xoxp-` | Access files the user has permission to see (broader access) |

**Important**: Some files (especially those shared in private channels or DMs) may only be accessible with a **user token**, not a bot token.

## File ID Format

- All Slack file IDs start with `F` (e.g., `F0A90QWS0F7`)
- Extract from URLs: `https://files.slack.com/files-pri/TEAM-FILEID/...`
- Found in canvas embeds, message attachments, and file shares

---

## Downloading Files

### Step 1: Get File Info

```bash
curl -s "https://slack.com/api/files.info?file=FILE_ID" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

**Response:**
```json
{
  "ok": true,
  "file": {
    "id": "F0A90QWS0F7",
    "name": "document.md",
    "title": "My Document",
    "mimetype": "text/markdown",
    "filetype": "markdown",
    "size": 10267,
    "url_private": "https://files.slack.com/files-pri/T022R9VEBPA-F0A90QWS0F7/document.md",
    "url_private_download": "https://files.slack.com/files-pri/T022R9VEBPA-F0A90QWS0F7/download/document.md",
    "channels": ["C07L2GUNV6Y"],
    "user": "U08NPJBQZLN"
  }
}
```

**Key fields:**
- `url_private_download` - Use this URL to download the file
- `url_private` - View URL (may render in browser)
- `mimetype` - File MIME type
- `channels` - Channels where file is shared
- `user` - User who uploaded the file

### Step 2: Download File Content

```bash
curl -s -L "$URL_PRIVATE_DOWNLOAD" \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -o "output_filename"
```

**Important flags:**
- `-L` - Follow redirects (required)
- `-o` - Output to file (or use `>` redirection)

---

## Complete Download Script

```bash
#!/bin/bash
# Download a file from Slack
# Usage: ./download_slack_file.sh FILE_ID [OUTPUT_DIR]

FILE_ID="${1:?Usage: $0 FILE_ID [OUTPUT_DIR]}"
OUTPUT_DIR="${2:-.}"
TOKEN="${SLACK_USER_TOKEN:-$SLACK_BOT_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN"
  exit 1
fi

# Get file info
echo "Fetching file info for $FILE_ID..."
RESPONSE=$(curl -s "https://slack.com/api/files.info?file=$FILE_ID" \
  -H "Authorization: Bearer $TOKEN")

# Check for errors
OK=$(echo "$RESPONSE" | grep -o '"ok":true' || true)
if [ -z "$OK" ]; then
  ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"$//')
  echo "Error: $ERROR"
  exit 1
fi

# Extract filename and download URL (avoiding jq for compatibility)
FILENAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"$//')
DOWNLOAD_URL=$(echo "$RESPONSE" | grep -o '"url_private_download":"[^"]*"' | head -1 | sed 's/"url_private_download":"//;s/"$//' | sed 's/\\//g')

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not extract download URL"
  exit 1
fi

# Download file
echo "Downloading: $FILENAME"
curl -s -L "$DOWNLOAD_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -o "$OUTPUT_DIR/$FILENAME"

echo "Saved to: $OUTPUT_DIR/$FILENAME"
ls -la "$OUTPUT_DIR/$FILENAME"
```

---

## Listing Files

### List All Files

```bash
curl -s "https://slack.com/api/files.list" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

### Filter by Type

```bash
# List only markdown/text files
curl -s "https://slack.com/api/files.list?types=text" \
  -H "Authorization: Bearer $SLACK_TOKEN"

# List only images
curl -s "https://slack.com/api/files.list?types=images" \
  -H "Authorization: Bearer $SLACK_TOKEN"

# List canvases (Slack docs)
curl -s "https://slack.com/api/files.list?types=spaces" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

**Available types:**
- `all` - All files
- `spaces` - Posts/Canvases
- `snippets` - Code snippets
- `images` - Image files
- `gdocs` - Google Docs
- `zips` - Zip files
- `pdfs` - PDF files

### Filter by Channel

```bash
curl -s "https://slack.com/api/files.list?channel=C07L2GUNV6Y" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

### Filter by User

```bash
curl -s "https://slack.com/api/files.list?user=U08NPJBQZLN" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

### Pagination

```bash
# First page (default 100 items)
curl -s "https://slack.com/api/files.list?count=100&page=1" \
  -H "Authorization: Bearer $SLACK_TOKEN"

# Next page
curl -s "https://slack.com/api/files.list?count=100&page=2" \
  -H "Authorization: Bearer $SLACK_TOKEN"
```

---

## Common File Types

| Filetype | MIME Type | Description |
|----------|-----------|-------------|
| `markdown` | `text/markdown` | Markdown documents |
| `text` | `text/plain` | Plain text files |
| `pdf` | `application/pdf` | PDF documents |
| `png`, `jpg`, `gif` | `image/*` | Image files |
| `mp4`, `mov` | `video/*` | Video files |
| `zip` | `application/zip` | Compressed archives |
| `slack_docs` / `quip` | `application/vnd.slack-docs` | Slack Canvases |
| `gdoc`, `gsheet` | `application/vnd.google-*` | Google Workspace files |

---

## Extracting Files from Canvas Embeds

When downloading a Slack Canvas, embedded files appear as:

```html
<p class='embedded-file'>File ID: F0A90QWS0F7, File URL: https://...</p>
```

**Extract and download embedded files:**

```bash
#!/bin/bash
# Extract embedded file IDs from canvas HTML and download them

CANVAS_HTML="canvas_content.html"
OUTPUT_DIR="./downloads"
TOKEN="$SLACK_USER_TOKEN"

mkdir -p "$OUTPUT_DIR"

# Extract file IDs from embedded-file elements
grep -o 'File ID: F[A-Z0-9]*' "$CANVAS_HTML" | sed 's/File ID: //' | while read FILE_ID; do
  echo "Downloading $FILE_ID..."

  RESPONSE=$(curl -s "https://slack.com/api/files.info?file=$FILE_ID" \
    -H "Authorization: Bearer $TOKEN")

  FILENAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"$//')
  DOWNLOAD_URL=$(echo "$RESPONSE" | grep -o '"url_private_download":"[^"]*"' | head -1 | sed 's/"url_private_download":"//;s/"$//' | sed 's/\\//g')

  if [ -n "$DOWNLOAD_URL" ]; then
    curl -s -L "$DOWNLOAD_URL" -H "Authorization: Bearer $TOKEN" -o "$OUTPUT_DIR/$FILENAME"
    echo "  -> Saved: $OUTPUT_DIR/$FILENAME"
  else
    echo "  -> Failed to download $FILE_ID"
  fi
done
```

---

## Bot Token vs User Token

### When to Use Bot Token (`xoxb-`)

- Files shared in **public channels** where bot is a member
- Files explicitly shared with the bot
- Automated workflows and integrations

### When to Use User Token (`xoxp-`)

- Files in **private channels** or DMs
- Files uploaded by other users not shared with bot
- Files embedded in canvases (often requires user token)
- Broader access to workspace files

### Token Selection Logic

```bash
# Prefer user token, fall back to bot token
TOKEN="${SLACK_USER_TOKEN:-$SLACK_BOT_TOKEN}"

# Or try bot first, then user
download_file() {
  local file_id="$1"

  # Try bot token first
  RESPONSE=$(curl -s "https://slack.com/api/files.info?file=$file_id" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN")

  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "Using bot token"
    echo "$RESPONSE"
    return 0
  fi

  # Fall back to user token
  RESPONSE=$(curl -s "https://slack.com/api/files.info?file=$file_id" \
    -H "Authorization: Bearer $SLACK_USER_TOKEN")

  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "Using user token"
    echo "$RESPONSE"
    return 0
  fi

  echo "Failed with both tokens"
  return 1
}
```

---

## Troubleshooting

### Error: `file_not_found`

**Causes:**
1. File ID is incorrect
2. File was deleted
3. Token lacks access to the file

**Solutions:**
```bash
# Verify file ID format (should start with F)
echo "$FILE_ID" | grep -E '^F[A-Z0-9]+$'

# Try with user token instead of bot token
curl -s "https://slack.com/api/files.info?file=$FILE_ID" \
  -H "Authorization: Bearer $SLACK_USER_TOKEN"

# List files to verify file exists
curl -s "https://slack.com/api/files.list" \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" | grep "$FILE_ID"
```

### Error: `not_authed`

**Cause:** Invalid or expired token

**Solution:**
```bash
# Test authentication
curl -s "https://slack.com/api/auth.test" \
  -H "Authorization: Bearer $TOKEN"
```

### Error: `missing_scope`

**Cause:** Token lacks `files:read` scope

**Solution:**
1. Go to Slack App settings → OAuth & Permissions
2. Add `files:read` scope
3. Reinstall app to workspace
4. Get new token

### Download Returns Empty/HTML Error

**Cause:** Missing `-L` flag or wrong URL

**Solution:**
```bash
# Always use -L to follow redirects
curl -s -L "$DOWNLOAD_URL" -H "Authorization: Bearer $TOKEN"

# Use url_private_download, not url_private
```

### JSON Parse Errors with jq

**Cause:** Response contains control characters

**Solution:**
```bash
# Strip control characters before parsing
curl -s "https://slack.com/api/files.info?file=$FILE_ID" \
  -H "Authorization: Bearer $TOKEN" | tr -d '\000-\037' | jq .

# Or use grep/sed instead of jq
FILENAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"$//')
```

---

## Environment Setup

Add to your `.env` file:

```bash
# Slack tokens
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_USER_TOKEN=xoxp-your-user-token
SLACK_TEAM_ID=T022R9VEBPA
```

**Required scopes for bot:**
- `files:read` - Read and download files
- `files:write` - Upload files (optional)

**Required scopes for user token:**
- `files:read` - Read and download files
- Access to private channels/DMs where files are shared

---

## References

- https://api.slack.com/methods/files.info
- https://api.slack.com/methods/files.list
- https://api.slack.com/methods/files.upload
- https://api.slack.com/types/file
