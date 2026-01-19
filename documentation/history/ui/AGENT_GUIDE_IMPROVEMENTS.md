# Agent Guide Restructuring Summary

## Overview
Restructured `/ui/public/docs/agent-guide.html` to significantly improve agent parsing and information retrieval.

## Key Improvements

### 1. **Table of Contents** (NEW)
- Added comprehensive TOC at the top with 6 organized categories:
  - 🚨 Critical (red links for urgent info)
  - 🎯 Quick Start
  - 📖 Reference
  - 🔧 Debugging
  - 🔌 Integration
  - ✍️ Writing
- All links use anchor navigation for instant jump to sections

### 2. **Quick Start Summary** (NEW)
- Added visual quick-start box immediately after TOC
- Contains:
  - 🚨 4 critical rules (always headless, never auto-merge, git = truth, exit after completion)
  - ✅ 5 most common commands
  - Agent workflow summary (5-step process)
- Uses gradient background and clear visual hierarchy

### 3. **Section Anchors** (NEW)
- Added ID attributes to all major sections:
  - `#critical-nested-agent`
  - `#critical-merge-policy`
  - `#decision-tree`
  - `#common-patterns`
  - `#prd-modes`
  - `#file-structure`
  - `#critical-rules`
  - `#status-codes`
  - `#status-verification`
  - `#error-handling`
  - `#troubleshooting`
  - `#mcp-tools`
  - `#ui-testing`
  - `#response-templates`
  - `#writing-specs`
  - `#quick-reference`

### 4. **Section Pointers Table** (NEW)
- Added task-based lookup table at the end
- 16 common scenarios mapped to sections with direct links
- Format: "If you need to... → Go to section... → Jump link"
- Examples:
  - "Run `ralph prd` as an agent" → Nested Agent Warning
  - "Handle build failures" → Error Handling
  - "Test UI features" → UI Testing

### 5. **Visual Hierarchy Improvements**
- Color-coded TOC categories
- Critical sections highlighted in red (#DC2626)
- Quick start box uses gradient background
- Section pointers table uses alternating row colors
- Pro tip callout at end with bookmark suggestions

## Benefits for Agents

### Before (Issues):
- ❌ No way to quickly jump to specific information
- ❌ Critical rules scattered throughout document
- ❌ Unclear what's urgent vs. nice-to-know
- ❌ Had to read entire document to find relevant info
- ❌ No task-based navigation

### After (Improvements):
- ✅ Instant navigation via TOC and section pointers
- ✅ Critical info prominently displayed at top
- ✅ Clear visual indicators for importance
- ✅ Task-based lookup table for common scenarios
- ✅ Anchor links allow deep-linking to specific sections
- ✅ Quick-start summary provides essential info in 10 seconds

## Usage Examples

### Scenario 1: Agent needs to run `ralph prd`
**Before:** Read entire doc to find headless flag requirement
**After:**
1. See "ALWAYS use --headless" in quick-start box (top of page)
2. Or click "Nested Agent Warning" in TOC
3. Or use section pointers: "Run ralph prd as agent" → Jump link

### Scenario 2: Agent encounters build failure
**Before:** Search through document for error handling
**After:**
1. Check TOC → 🔧 Debugging → Error Codes
2. Or section pointers: "Handle build failures" → Error Handling
3. Direct jump to `#error-handling`

### Scenario 3: Agent needs to verify PRD status
**Before:** Unclear where to find status verification commands
**After:**
1. Section pointers: "Verify status via git commits" → Status Verification
2. Direct jump to `#status-verification`
3. Quick commands in quick-reference section

## File Location
`/ui/public/docs/agent-guide.html`

## Testing
View the improved guide at: http://localhost:3000/docs/agent-guide.html

## Next Steps (Optional Enhancements)
1. Add search functionality for command lookup
2. Add "collapse/expand" for verbose sections
3. Add copy-to-clipboard buttons for code blocks
4. Add keyboard shortcuts for navigation (e.g., `/` for search)
5. Add "Back to top" floating button
