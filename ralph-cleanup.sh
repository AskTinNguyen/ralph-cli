#!/bin/bash
# ralph-cleanup.sh - Execute all cleanup actions

set -e  # Exit on error

echo "🧹 Starting Ralph CLI cleanup..."
echo ""

# CRITICAL: Remove invalid/mystery files
echo "🔴 CRITICAL: Removing mystery and backup files..."
if [ -f "./-o" ]; then
    rm -f ./-o
    echo "   ✓ Removed mystery file: -o"
else
    echo "   ℹ File -o not found (already removed or never existed)"
fi

if [ -f "bin/ralph-original" ]; then
    rm -f bin/ralph-original
    echo "   ✓ Removed backup: bin/ralph-original"
else
    echo "   ℹ Backup file not found (already removed)"
fi

echo ""

# CRITICAL: Resolve documentation duplication
echo "🔴 CRITICAL: Removing duplicate documentation from /docs/..."
removed_docs=0
for doc in README.md TESTING.md DESIGN_SYSTEM.md DEPLOYMENT_GUIDE.md FOR_HUMAN_BEGINNERS_GUIDE.md ROADMAP.md AGENT_QUICKSTART.md; do
    if [ -f "docs/$doc" ]; then
        rm -f "docs/$doc"
        echo "   ✓ Removed: docs/$doc"
        ((removed_docs++))
    fi
done
if [ $removed_docs -eq 0 ]; then
    echo "   ℹ No duplicate docs found (already cleaned)"
fi

echo ""

# HIGH: Organize images
echo "🟡 HIGH: Organizing image files..."
mkdir -p assets/screenshots
mkdir -p assets/diagrams
echo "   ✓ Created: assets/screenshots/"
echo "   ✓ Created: assets/diagrams/"

# Move screenshots (if they exist - some are untracked)
screenshots=(
    "ralph-landing-final.png"
    "ralph-landing-page.png"
    "ralph-ui-streams.png"
    "ralph-ui-dashboard.png"
    "ralph-ui-logs.png"
    "ralph-docs-page.png"
    "logs-fresh.png"
    "hero-section.png"
    "hero-and-agents.png"
    "updated-philosophy.png"
    "philosophy-section.png"
    "visual-story-final.png"
)

moved_screenshots=0
for img in "${screenshots[@]}"; do
    if [ -f "$img" ]; then
        mv "$img" assets/screenshots/
        echo "   ✓ Moved: $img → assets/screenshots/"
        ((moved_screenshots++))
    fi
done
if [ $moved_screenshots -eq 0 ]; then
    echo "   ℹ No screenshots found to move (already organized)"
fi

# Move diagrams
diagrams=("diagram.svg" "ralph.webp" "visual-story.png")
moved_diagrams=0
for img in "${diagrams[@]}"; do
    if [ -f "$img" ]; then
        mv "$img" assets/diagrams/
        echo "   ✓ Moved: $img → assets/diagrams/"
        ((moved_diagrams++))
    fi
done
if [ $moved_diagrams -eq 0 ]; then
    echo "   ℹ No diagrams found to move (already organized)"
fi

echo ""

# HIGH: Remove duplicate images
echo "🟡 HIGH: Removing duplicate images..."
removed_dupes=0
if [ -f ".agents/ralph/ralph.webp" ]; then
    rm -f .agents/ralph/ralph.webp
    echo "   ✓ Removed: .agents/ralph/ralph.webp (duplicate)"
    ((removed_dupes++))
fi
if [ -f ".agents/ralph/diagram.svg" ]; then
    rm -f .agents/ralph/diagram.svg
    echo "   ✓ Removed: .agents/ralph/diagram.svg (duplicate)"
    ((removed_dupes++))
fi
if [ $removed_dupes -eq 0 ]; then
    echo "   ℹ No duplicate images found (already cleaned)"
fi

echo ""

# HIGH: Move test scripts
echo "🟡 HIGH: Relocating test scripts..."
moved_scripts=0
if [ -f "test-colors.sh" ]; then
    mv test-colors.sh scripts/
    echo "   ✓ Moved: test-colors.sh → scripts/"
    ((moved_scripts++))
fi
if [ -f "test-refactor.sh" ]; then
    mv test-refactor.sh scripts/
    echo "   ✓ Moved: test-refactor.sh → scripts/"
    ((moved_scripts++))
fi
if [ $moved_scripts -eq 0 ]; then
    echo "   ℹ No test scripts found to move (already organized)"
fi

echo ""

# MEDIUM: Clean macOS metadata
echo "🟠 MEDIUM: Cleaning macOS metadata..."
if [ -f ".agents/ralph/.DS_Store" ]; then
    rm -f .agents/ralph/.DS_Store
    echo "   ✓ Removed: .agents/ralph/.DS_Store"
else
    echo "   ℹ No .DS_Store found (already clean)"
fi

echo ""

# MEDIUM: Update .gitignore
echo "🟠 MEDIUM: Updating .gitignore..."
if ! grep -q ".DS_Store" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# macOS metadata" >> .gitignore
    echo ".DS_Store" >> .gitignore
    echo "**/.DS_Store" >> .gitignore
    echo "   ✓ Added .DS_Store rules to .gitignore"
else
    echo "   ℹ .gitignore already has .DS_Store rules"
fi

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📊 Summary:"
echo "   - Removed duplicate documentation files"
echo "   - Organized images into /assets/screenshots and /assets/diagrams"
echo "   - Removed duplicate images from .agents/ralph/"
echo "   - Moved test scripts to /scripts/"
echo "   - Cleaned macOS metadata"
echo "   - Updated .gitignore"
echo ""
echo "📝 Next steps:"
echo "1. Review changes: git status"
echo "2. Check moved files: ls -la assets/screenshots/ assets/diagrams/"
echo "3. Update image references in documentation (if needed)"
echo "4. Test that nothing broke: npm test"
echo "5. Commit: git add -A && git commit -m 'chore: organize directory structure'"
echo ""
