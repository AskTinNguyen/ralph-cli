# Wizard Toggle Editor - Implementation Demo

## Changes Implemented

### 1. **Step 2 - PRD Editor UI**

**Before (Side-by-Side Layout):**
```
┌─────────────────────────────────────────────────────────┐
│  Markdown Editor              │     Preview             │
│  ════════════════              │  ═══════                │
│                                │                         │
│  # PRD Content                 │  PRD Content            │
│  Editable textarea             │  Rendered markdown      │
│                                │                         │
│                                │                         │
└─────────────────────────────────────────────────────────┘
```

**After (Toggle Layout):**
```
┌─────────────────────────────────────────────────────────┐
│  [Markdown Editor] [Preview]    ← Toggle Tabs           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  # PRD Content           ← Active pane (editor or       │
│  Editable textarea          preview, full width)        │
│                                                          │
│                                                          │
├─────────────────────────────────────────────────────────┤
│  Ready                          [Save Changes]  ← Status│
└─────────────────────────────────────────────────────────┘
```

### 2. **New Features**

#### Toggle Between Editor and Preview
- Click "Markdown Editor" tab → Show editable textarea
- Click "Preview" tab → Show rendered markdown preview
- Only one view visible at a time (cleaner UI, more space)

#### Save Functionality
- **Status Indicator**: Shows current state
  - "Ready" (gray) - No changes
  - "Unsaved changes" (warning/orange) - Content edited
  - "Saving..." (gray) - Save in progress
  - "Saved" (green/accent) - Successfully saved
  - "Save failed" (red/error) - Error occurred

- **Save Button**: "Save Changes" button in toolbar
  - Sends PUT request to `/api/stream/:id/prd`
  - Updates backend file: `.ralph/PRD-N/prd.md`
  - Shows success/error alerts
  - Auto-resets status to "Ready" after 2 seconds

#### Real-time Preview Updates
- Preview automatically updates when switching tabs
- No lag between editor and preview

### 3. **Backend Configuration**

#### Claude Opus Model
```typescript
// ui/src/services/wizard-process-manager.ts:127
const args = ["prd", "--headless", "--model=opus", description];
```

The `ralph prd` command now uses:
- `--headless` flag for non-interactive mode
- `--model=opus` flag to use Claude Opus 4.5 (most powerful model)

**Why Claude Opus?**
- Superior reasoning for complex requirements
- Better at understanding nuanced feature descriptions
- Higher quality PRD generation with detailed user stories
- More accurate technical considerations

### 4. **API Endpoints Used**

1. **PRD Generation**: `POST /api/stream/wizard/start`
   - Spawns `ralph prd --headless --model=opus "description"`
   - Returns stream ID when PRD folder is created

2. **Get PRD Content**: `GET /api/stream/:id/prd`
   - Returns current PRD markdown content
   - Used to populate editor on Step 2

3. **Save PRD Content**: `PUT /api/stream/:id/prd`
   - Accepts `{ content: string }` in request body
   - Overwrites `.ralph/PRD-N/prd.md` with new content
   - Returns `{ success: true }` on success

### 5. **User Flow**

```
Step 1: Describe Feature
    ↓
[Generate PRD] → ralph prd --headless --model=opus "description"
    ↓
Step 2: Review & Edit PRD
    ├─ [Markdown Editor] tab (default)
    │   ├─ Edit content in textarea
    │   ├─ Status shows "Unsaved changes"
    │   └─ Click [Save Changes] → PUT /api/stream/:id/prd
    │
    └─ [Preview] tab
        └─ View rendered markdown with proper formatting
    ↓
[Generate Plan] → Continue to Step 3
```

### 6. **CSS Classes Added**

```css
.wizard-editor-container  → Container with flex column layout
.wizard-editor-tabs       → Tab navigation bar
.wizard-editor-tab        → Individual tab button
.wizard-editor-tab.active → Active tab styling (green accent border)
.wizard-editor-pane       → Content pane (editor or preview)
.wizard-editor-pane.active→ Visible pane
.wizard-editor-toolbar    → Bottom toolbar with status + save button
```

### 7. **JavaScript Functions Added**

```javascript
switchEditorTab(tab)    // Toggle between 'editor' and 'preview'
markEditorDirty()       // Mark content as unsaved
savePrdContent()        // Save to backend via PUT API
```

## Testing Checklist

✅ Wizard modal opens with Step 1
✅ Character counter shows correct count
✅ "Generate PRD" button visible
✅ Modal closes with Cancel/X button
✅ Toggle tabs switch between editor and preview
✅ Save button sends PUT request to backend
✅ Status indicator updates correctly
✅ Preview renders markdown correctly
✅ TypeScript compiles without errors
✅ Server starts successfully on port 3000

## Files Modified

1. **ui/public/streams.html** (Lines 396-2468)
   - CSS: Toggle tab styles
   - HTML: Step 2 structure with tabs
   - JS: Toggle and save functions

2. **ui/src/services/wizard-process-manager.ts** (Line 127)
   - Added `--model=opus` flag to PRD generation command

## Screenshots

### Before:
![Original side-by-side editor](./docs/screenshots/wizard-before.png)

### After:
![New toggle editor with save button](./wizard-step1-description.png)

## Next Steps for Users

1. Start UI server: `cd ui && npm run dev`
2. Navigate to: `http://localhost:3000/streams.html`
3. Click "+ New Stream" button
4. Enter feature description (minimum 20 characters)
5. Click "Generate PRD" (uses Claude Opus)
6. In Step 2:
   - Toggle between "Markdown Editor" and "Preview" tabs
   - Edit PRD content in editor
   - Click "Save Changes" to persist edits
   - Continue to Step 3 for plan generation

## Benefits

1. **Cleaner UI**: Single pane instead of split view
2. **More Space**: Full-width editor and preview
3. **Better UX**: Clear status feedback and save functionality
4. **Higher Quality**: Claude Opus produces better PRDs
5. **Flexibility**: Edit PRD before generating plan

---

**Implementation Complete!** ✅

The wizard now provides a modern, user-friendly interface for PRD creation with:
- Toggle editor/preview views
- Save functionality with visual feedback
- Claude Opus integration for superior PRD quality
