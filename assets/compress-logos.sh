#!/bin/bash
# Compress Ralph CLI logos for web use
# Creates multiple sizes for different use cases

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Ralph CLI Logo Compression ==="
echo ""

# Create output directories
mkdir -p compressed
mkdir -p compressed/favicon
mkdir -p compressed/web

# Source files
COLORED="RalphCLI_Colored_Logo.png"
BW="RalphCLI_BlackWhite_Logo.png"

# Check source files exist
if [[ ! -f "$COLORED" ]] || [[ ! -f "$BW" ]]; then
    echo "Error: Source logo files not found in $SCRIPT_DIR"
    exit 1
fi

echo "Original file sizes:"
ls -lh "$COLORED" "$BW" | awk '{print "  " $9 ": " $5}'
echo ""

# Function to compress and resize
compress_logo() {
    local src="$1"
    local name="$2"
    local size="$3"
    local output="$4"

    echo "  Creating ${name} (${size}px)..."
    sips -Z "$size" "$src" --out "$output" 2>/dev/null
}

echo "Creating compressed versions..."
echo ""

# Colored logo variants
echo "Colored Logo:"
compress_logo "$COLORED" "favicon-32" 32 "compressed/favicon/ralph-colored-32.png"
compress_logo "$COLORED" "favicon-64" 64 "compressed/favicon/ralph-colored-64.png"
compress_logo "$COLORED" "small-128" 128 "compressed/web/ralph-colored-128.png"
compress_logo "$COLORED" "medium-256" 256 "compressed/web/ralph-colored-256.png"
compress_logo "$COLORED" "large-512" 512 "compressed/web/ralph-colored-512.png"
echo ""

# Black & White logo variants
echo "Black & White Logo:"
compress_logo "$BW" "favicon-32" 32 "compressed/favicon/ralph-bw-32.png"
compress_logo "$BW" "favicon-64" 64 "compressed/favicon/ralph-bw-64.png"
compress_logo "$BW" "small-128" 128 "compressed/web/ralph-bw-128.png"
compress_logo "$BW" "medium-256" 256 "compressed/web/ralph-bw-256.png"
compress_logo "$BW" "large-512" 512 "compressed/web/ralph-bw-512.png"
echo ""

# Copy standard sizes to ui/public for dashboard
if [[ -d "../ui/public" ]]; then
    echo "Copying logos to UI dashboard..."
    cp "compressed/web/ralph-colored-256.png" "../ui/public/ralph-logo.png"
    cp "compressed/web/ralph-bw-256.png" "../ui/public/ralph-logo-bw.png"
    cp "compressed/favicon/ralph-colored-64.png" "../ui/public/favicon.png"
    echo "  Copied to ui/public/"
fi

echo ""
echo "=== Compression Complete ==="
echo ""
echo "Compressed file sizes:"
find compressed -name "*.png" -exec ls -lh {} \; | awk '{print "  " $9 ": " $5}'
echo ""
echo "Files created:"
echo "  compressed/favicon/  - 32px and 64px icons"
echo "  compressed/web/      - 128px, 256px, 512px for web use"
if [[ -d "../ui/public" ]]; then
    echo "  ui/public/           - Dashboard logos"
fi
