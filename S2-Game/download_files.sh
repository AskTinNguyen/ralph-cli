#!/bin/bash

USER_TOKEN="xoxp-2093335487792-2054760699847-10304389005265-a7aecd97908f146cc08e27655f842682"
OUTPUT_DIR="$(dirname "$0")"

download_file() {
    local file_id="$1"
    echo "Fetching $file_id..."

    # Get file info
    local response=$(curl -s "https://slack.com/api/files.info?file=$file_id" \
        -H "Authorization: Bearer $USER_TOKEN")

    # Extract filename and download URL using grep/sed (avoiding jq parse issues)
    local filename=$(echo "$response" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"$//')
    local download_url=$(echo "$response" | grep -o '"url_private_download":"[^"]*"' | head -1 | sed 's/"url_private_download":"//;s/"$//' | sed 's/\\//g')

    if [ -n "$download_url" ] && [ "$download_url" != "null" ]; then
        echo "  -> Downloading: $filename"
        curl -s -L "$download_url" -H "Authorization: Bearer $USER_TOKEN" -o "$OUTPUT_DIR/$filename"
        echo "  -> Saved to: $OUTPUT_DIR/$filename"
    else
        echo "  -> Failed to get download URL"
        echo "  -> Response preview: ${response:0:200}"
    fi
}

download_file "F0A90QWS0F7"
download_file "F0A947VD5SN"
download_file "F0A8XSCTMU3"

echo ""
echo "Files downloaded:"
ls -la "$OUTPUT_DIR"/*.md 2>/dev/null || echo "No .md files found"
