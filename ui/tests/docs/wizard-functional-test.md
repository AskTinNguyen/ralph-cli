# New Stream Wizard - Functional Test Prompt

## Overview
This prompt triggers end-to-end functional testing of the New Stream Wizard, including API calls that execute actual `ralph stream` commands.

---

## Test Execution Instructions

### Prerequisites
1. UI server running: `cd ui && npm run dev` (port 3000)
2. Ralph CLI installed and configured in the project
3. Browser automation (Playwright MCP) available

---

## Test Scenarios

### Test 1: Wizard Step 1 - Feature Description Input

**Steps:**
1. Navigate to `http://localhost:3000/streams.html`
2. Click the "+ New Stream" button
3. Verify wizard modal opens with Step 1 active
4. Enter feature description (minimum 20 characters):
   ```
   Build a user notification system that supports email, SMS, and push notifications. Users should be able to configure their notification preferences and view notification history.
   ```
5. Verify character count updates correctly
6. Click "Generate PRD" button

**Expected Results:**
- Wizard modal opens with 5-step progress indicator
- Step 1 shows "Describe" as active
- Character counter shows count >= 20
- "Generate PRD" button is enabled

---

### Test 2: API Call - Create Stream and Generate PRD

**API Endpoint:** `POST /api/stream/wizard/start`

**Request Body:**
```json
{
  "description": "Build a user notification system that supports email, SMS, and push notifications. Users should be able to configure their notification preferences and view notification history."
}
```

**Manual Test via curl:**
```bash
curl -X POST http://localhost:3000/api/stream/wizard/start \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Build a user notification system that supports email, SMS, and push notifications. Users should be able to configure their notification preferences and view notification history."
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "streamId": 44,
  "prdPath": ".ralph/PRD-44/prd.md",
  "message": "Stream PRD-44 created successfully"
}
```

**Verify PRD Created:**
```bash
# Check PRD folder exists
ls -la .ralph/PRD-44/

# Check prd.md was created with content
cat .ralph/PRD-44/prd.md
```

---

### Test 3: PRD Generation with Real Ralph Command

**API Endpoint:** `POST /api/stream/:id/generate-prd`

This endpoint should trigger the actual `ralph prd` command to generate a proper PRD document.

**Manual Test:**
```bash
# Direct ralph command (what the API should execute)
cd /path/to/project && ralph prd

# Or via API
curl -X POST http://localhost:3000/api/stream/44/generate-prd \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Build a user notification system..."
  }'
```

**Expected Behavior:**
- PRD-N folder created in `.ralph/`
- `prd.md` file populated with generated content
- User stories extracted and formatted

---

### Test 4: Plan Generation

**API Endpoint:** `POST /api/stream/:id/generate-plan`

**Manual Test:**
```bash
# Direct ralph command
ralph plan --prd=44

# Or via API
curl -X POST http://localhost:3000/api/stream/44/generate-plan
```

**Expected Response:**
```json
{
  "success": true,
  "streamId": 44,
  "planPath": ".ralph/PRD-44/plan.md",
  "stories": [
    { "id": "US-001", "title": "User notification preferences" },
    { "id": "US-002", "title": "Email notification delivery" }
  ]
}
```

---

### Test 5: Stream Initialization (Worktree)

**API Endpoint:** `POST /api/stream/:id/init`

**Manual Test:**
```bash
# Direct ralph command
ralph stream init 44

# Or via API
curl -X POST http://localhost:3000/api/stream/44/init
```

**Expected Results:**
- Git worktree created at `.ralph/worktrees/PRD-44/`
- Branch `prd-44` created
- Stream status changes to "initialized"

---

### Test 6: Stream Build Execution

**API Endpoint:** `POST /api/stream/:id/build`

**Request Body:**
```json
{
  "iterations": 5,
  "agent": "claude",
  "noCommit": false
}
```

**Manual Test:**
```bash
# Direct ralph command
ralph stream build 44 5

# Or via API
curl -X POST http://localhost:3000/api/stream/44/build \
  -H "Content-Type: application/json" \
  -d '{
    "iterations": 5,
    "agent": "claude"
  }'
```

**Expected Behavior:**
- Build process starts in background
- Status updates via SSE at `/api/stream/:id/build-status`
- Progress tracked in `.ralph/PRD-44/progress.md`

---

## Full End-to-End Browser Test Script

```javascript
// Playwright test script
async function testWizardE2E(page) {
  // Step 1: Open wizard
  await page.goto('http://localhost:3000/streams.html');
  await page.click('button:has-text("+ New Stream")');

  // Verify wizard opened
  const wizardTitle = await page.textContent('.wizard-header h2');
  console.assert(wizardTitle === 'Create New Stream', 'Wizard should open');

  // Step 2: Enter description
  const description = `Build a user notification system that supports email, SMS, and push notifications.
    Users should be able to configure their notification preferences and view notification history.
    The system should integrate with existing user accounts and provide real-time delivery status.`;

  await page.fill('textarea', description);

  // Verify character count
  const charCount = await page.textContent('.wizard-char-count');
  console.assert(charCount.includes('characters'), 'Character count should update');

  // Step 3: Generate PRD
  await page.click('button:has-text("Generate PRD")');

  // Wait for generation (this triggers actual ralph command)
  await page.waitForSelector('.wizard-step-2', { timeout: 120000 });

  // Verify PRD content loaded
  const prdContent = await page.textContent('.prd-preview');
  console.assert(prdContent.includes('User Stories'), 'PRD should contain user stories');

  // Step 4: Accept PRD and generate plan
  await page.click('button:has-text("Accept")');
  await page.click('button:has-text("Generate Plan")');

  // Wait for plan generation
  await page.waitForSelector('.wizard-step-4', { timeout: 120000 });

  // Step 5: Configure build
  await page.fill('input[name="iterations"]', '3');
  await page.click('input[value="isolated"]'); // Worktree mode

  // Step 6: Start build
  await page.click('button:has-text("Start Building")');

  // Verify redirect to stream detail
  await page.waitForURL(/stream-detail/);

  console.log('E2E Wizard Test PASSED');
}
```

---

## API Endpoints Reference

| Endpoint | Method | Description | Ralph Command |
|----------|--------|-------------|---------------|
| `/api/stream/wizard/start` | POST | Create PRD folder with description | `mkdir .ralph/PRD-N` |
| `/api/stream/:id/generate-prd` | POST | Generate full PRD document | `ralph prd` |
| `/api/stream/:id/generate-plan` | POST | Generate implementation plan | `ralph plan --prd=N` |
| `/api/stream/:id/init` | POST | Initialize git worktree | `ralph stream init N` |
| `/api/stream/:id/build` | POST | Start build iterations | `ralph stream build N [iterations]` |
| `/api/stream/:id/generation-stream` | GET (SSE) | Real-time generation output | stdout pipe |
| `/api/stream/:id/build-status` | GET (SSE) | Real-time build progress | stdout pipe |

---

## Verification Commands

```bash
# Check stream status
ralph stream status

# List all PRDs
ralph stream list

# Check specific PRD files
ls -la .ralph/PRD-*/

# View generation logs
cat .ralph/PRD-N/runs/*.log

# Check worktree status
git worktree list
```

---

## Error Scenarios to Test

1. **Empty description** - Should show validation error
2. **Description < 20 chars** - "Generate PRD" button disabled
3. **PRD generation timeout** - Show retry option after 120s
4. **Plan generation failure** - Show error with manual edit option
5. **Build already running** - Disable "Start Build" button
6. **Worktree conflict** - Show merge instructions

---

## Notes

- PRD generation can take 30-60+ seconds depending on Claude's response time
- Plan generation typically takes 20-40 seconds
- Build iterations run asynchronously with progress updates via SSE
- All ralph commands should be executed in the project root directory
