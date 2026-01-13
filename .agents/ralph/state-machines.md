# Ralph State Machine Diagrams

This document explains how Ralph works through state machine diagrams.

## 1. High-Level System State Machine

Ralph operates in three main modes that form a sequential workflow:

```mermaid
stateDiagram-v2
    [*] --> PRD_Generation

    PRD_Generation --> Planning: ralph plan

    Planning --> Build_Loop: ralph build
    Planning --> Planning: iterate refinement

    Build_Loop --> Story_Selection
    Story_Selection --> Story_Implementation
    Story_Implementation --> Story_Complete

    Story_Complete --> Story_Selection: more stories
    Story_Complete --> [*]: all stories done

    note right of PRD_Generation
        Input: User request
        Output: .agents/tasks/prd.md
        Command: ralph prd
        Agent: Interactive mode
    end note

    note right of Planning
        Input: PRD
        Output: .ralph/IMPLEMENTATION_PLAN.md
        Command: ralph plan [n]
        Mode: Read-only exploration
    end note

    note right of Build_Loop
        Input: PRD + Plan
        Output: Code changes + commits
        Command: ralph build [n]
        Mode: Implementation
    end note
```

## 2. PRD Generation State Machine

```mermaid
stateDiagram-v2
    [*] --> Check_Input

    Check_Input --> Load_Agent: request provided
    Check_Input --> Prompt_User: no request

    Prompt_User --> Cancelled: user cancels
    Prompt_User --> Load_Agent: user provides request

    Load_Agent --> Select_Agent_Type
    Select_Agent_Type --> Run_PRD_Skill: agent configured

    Run_PRD_Skill --> Generate_PRD
    Generate_PRD --> Write_PRD_File
    Write_PRD_File --> [*]

    Cancelled --> [*]

    note right of Check_Input
        Files checked:
        - PRD_REQUEST_PATH
        - PRD_INLINE text
    end note

    note right of Select_Agent_Type
        Agents supported:
        - codex (default)
        - claude
        - droid
        Uses interactive mode
    end note

    note right of Run_PRD_Skill
        Prompt template:
        "Use $prd skill to create PRD
        Save to: PRD_PATH
        Do NOT implement"
    end note

    note right of Write_PRD_File
        Format:
        ### [ ] US-001: Story
        - [ ] Acceptance criteria
        ### [ ] US-002: Story
        ...
    end note
```

## 3. Planning Iteration State Machine

```mermaid
stateDiagram-v2
    [*] --> Init_Planning

    Init_Planning --> Check_Prerequisites
    Check_Prerequisites --> Missing_PRD: PRD not found
    Check_Prerequisites --> Load_Config: PRD exists

    Missing_PRD --> [*]: exit error

    Load_Config --> Create_State_Files
    Create_State_Files --> Start_Iteration

    Start_Iteration --> Max_Reached: i > MAX_ITERATIONS
    Start_Iteration --> Render_Prompt: i <= MAX_ITERATIONS

    Render_Prompt --> Log_Start
    Log_Start --> Capture_Git_State
    Capture_Git_State --> Run_Agent

    Run_Agent --> Agent_Success
    Run_Agent --> Agent_Error
    Run_Agent --> Agent_Interrupted

    Agent_Success --> Capture_Results
    Agent_Error --> Log_Error
    Agent_Interrupted --> [*]: exit

    Log_Error --> Capture_Results

    Capture_Results --> Write_Run_Meta
    Write_Run_Meta --> Append_Activity_Summary
    Append_Activity_Summary --> Next_Iteration

    Next_Iteration --> Start_Iteration

    Max_Reached --> [*]: done

    note right of Render_Prompt
        Template: PROMPT_plan.md
        Variables replaced:
        - PRD_PATH
        - PLAN_PATH
        - GUARDRAILS_PATH
        - ERRORS_LOG_PATH
        - etc.
    end note

    note right of Run_Agent
        Agent task:
        1. Read PRD
        2. Read guardrails
        3. Inspect code
        4. Create/update plan
        No implementation!
    end note

    note right of Capture_Results
        Git tracking:
        - HEAD before/after
        - Commits made
        - Files changed
        - Dirty files
    end note
```

## 4. Build Iteration State Machine (Story-Based)

```mermaid
stateDiagram-v2
    [*] --> Init_Build

    Init_Build --> Check_Prerequisites
    Check_Prerequisites --> Missing_PRD: PRD missing
    Check_Prerequisites --> Missing_Plan: Plan missing
    Check_Prerequisites --> Load_Config: All files exist

    Missing_PRD --> [*]: exit error
    Missing_Plan --> [*]: exit error

    Load_Config --> Create_State_Files
    Create_State_Files --> Start_Iteration

    Start_Iteration --> Max_Reached: i > MAX_ITERATIONS
    Start_Iteration --> Select_Story: i <= MAX_ITERATIONS

    Select_Story --> Parse_Stories
    Parse_Stories --> No_Stories: parsing failed
    Parse_Stories --> All_Done: remaining = 0
    Parse_Stories --> Story_Found: remaining > 0

    No_Stories --> [*]: exit error
    All_Done --> [*]: success

    Story_Found --> Extract_Story_Block
    Extract_Story_Block --> Render_Prompt

    Render_Prompt --> Log_Start
    Log_Start --> Capture_Git_Before
    Capture_Git_Before --> Run_Agent

    Run_Agent --> Agent_Success
    Run_Agent --> Agent_Error
    Run_Agent --> Agent_Interrupted

    Agent_Interrupted --> [*]: exit

    Agent_Success --> Check_Completion_Signal
    Agent_Error --> Log_Error_Event

    Log_Error_Event --> Check_Uncommitted

    Check_Completion_Signal --> Complete_Signal: <promise>COMPLETE</promise>
    Check_Completion_Signal --> Check_Uncommitted: no signal

    Complete_Signal --> Verify_All_Done
    Verify_All_Done --> [*]: all stories checked
    Verify_All_Done --> Continue: stories remain

    Check_Uncommitted --> Uncommitted_Warning: dirty files & !NO_COMMIT
    Check_Uncommitted --> Capture_Git_After: clean or NO_COMMIT

    Uncommitted_Warning --> Log_Warning
    Log_Warning --> Capture_Git_After

    Capture_Git_After --> Write_Run_Meta
    Write_Run_Meta --> Append_Activity_Summary
    Append_Activity_Summary --> Recheck_Stories

    Recheck_Stories --> Next_Iteration
    Continue --> Next_Iteration

    Next_Iteration --> Start_Iteration

    Max_Reached --> [*]: max iterations

    note right of Parse_Stories
        Pattern:
        ### [status] US-NNN: Title

        Status:
        - [ ] = pending
        - [x] = done
    end note

    note right of Extract_Story_Block
        Extracts:
        - Story ID (US-NNN)
        - Story title
        - All lines until next story

        Selects first unchecked story
    end note

    note right of Run_Agent
        Agent workflow:
        1. Read guardrails
        2. Read errors log
        3. Read PRD
        4. Read plan section for story
        5. Audit code
        6. Implement story
        7. Run verification
        8. Update plan (mark tasks)
        9. Update PRD (check criteria)
        10. Commit (if !NO_COMMIT)
        11. Append to progress.md
    end note

    note right of Check_Completion_Signal
        Completion signal:
        <promise>COMPLETE</promise>

        Only when ALL stories
        in PRD are checked [x]
    end note
```

## 5. Story Implementation Workflow (Agent Perspective)

```mermaid
stateDiagram-v2
    [*] --> Read_Guardrails

    Read_Guardrails --> Read_Errors_Log
    Read_Errors_Log --> Read_PRD
    Read_PRD --> Read_Plan

    Read_Plan --> Story_In_Plan: story section exists
    Read_Plan --> Create_Story_Section: no section

    Create_Story_Section --> Audit_Code
    Story_In_Plan --> Audit_Code

    Audit_Code --> Read_All_Files
    Read_All_Files --> Understand_Context
    Understand_Context --> Read_Agents_MD: AGENTS.md exists
    Understand_Context --> Implement: no AGENTS.md

    Read_Agents_MD --> Implement

    Implement --> Run_Verification
    Run_Verification --> Verification_Pass
    Run_Verification --> Verification_Fail

    Verification_Fail --> Debug_Fix
    Debug_Fix --> Run_Verification

    Verification_Pass --> Update_Plan
    Update_Plan --> Mark_Tasks_Done
    Mark_Tasks_Done --> Update_PRD_Criteria

    Update_PRD_Criteria --> All_Criteria_Done: all acceptance criteria checked
    Update_PRD_Criteria --> Some_Pending: some pending

    Some_Pending --> Should_Commit: work done
    All_Criteria_Done --> Mark_Story_Complete

    Mark_Story_Complete --> Should_Commit

    Should_Commit --> Skip_Commit: NO_COMMIT = true
    Should_Commit --> Stage_Changes: NO_COMMIT = false

    Skip_Commit --> Write_Progress_Entry

    Stage_Changes --> Git_Add_All
    Git_Add_All --> Commit_Changes
    Commit_Changes --> Verify_Clean

    Verify_Clean --> Working_Tree_Dirty: git status shows files
    Verify_Clean --> Capture_Commit_Hash: clean

    Working_Tree_Dirty --> Log_Warning_Dirty
    Log_Warning_Dirty --> Write_Progress_Entry

    Capture_Commit_Hash --> Write_Progress_Entry

    Write_Progress_Entry --> Append_Progress
    Append_Progress --> Check_All_Stories

    Check_All_Stories --> All_Stories_Done: no unchecked stories
    Check_All_Stories --> Stories_Remain: unchecked stories exist

    All_Stories_Done --> Output_Complete_Signal
    Stories_Remain --> [*]

    Output_Complete_Signal --> [*]

    note right of Read_Guardrails
        File: .ralph/guardrails.md
        Contains "Signs" - lessons
        learned from failures
    end note

    note right of Audit_Code
        CRITICAL:
        "Do NOT assume missing
        functionality; confirm
        by reading code"
    end note

    note right of Update_PRD_Criteria
        Mark each criterion:
        - [ ] → - [x]

        Only mark story heading
        complete when ALL
        criteria are checked
    end note

    note right of Git_Add_All
        git add -A

        Includes:
        - Source code
        - PRD updates
        - Plan updates
        - Progress log
    end note

    note right of Output_Complete_Signal
        <promise>COMPLETE</promise>

        Triggers early exit
        from build loop
    end note
```

## 6. File State Management

```mermaid
stateDiagram-v2
    [*] --> Check_State_Files

    Check_State_Files --> Progress_Missing: progress.md missing
    Check_State_Files --> Guardrails_Missing: guardrails.md missing
    Check_State_Files --> Errors_Missing: errors.log missing
    Check_State_Files --> Activity_Missing: activity.log missing
    Check_State_Files --> All_Exist: all exist

    Progress_Missing --> Create_Progress
    Guardrails_Missing --> Create_Guardrails
    Errors_Missing --> Create_Errors_Log
    Activity_Missing --> Create_Activity_Log

    Create_Progress --> Initialize_Progress_Template
    Create_Guardrails --> Initialize_Guardrails_Template
    Create_Errors_Log --> Initialize_Errors_Template
    Create_Activity_Log --> Initialize_Activity_Template

    Initialize_Progress_Template --> All_Exist
    Initialize_Guardrails_Template --> All_Exist
    Initialize_Errors_Template --> All_Exist
    Initialize_Activity_Template --> All_Exist

    All_Exist --> Ready
    Ready --> [*]

    note right of Create_Progress
        .ralph/progress.md

        Format:
        # Progress Log
        Started: [date]

        ## Codebase Patterns

        ---

        [append-only entries]
    end note

    note right of Create_Guardrails
        .ralph/guardrails.md

        Initial "Signs":
        - Read Before Writing
        - Test Before Commit

        Agent adds learned
        failures here
    end note

    note right of Create_Errors_Log
        .ralph/errors.log

        Timestamped failures:
        [YYYY-MM-DD HH:MM:SS] message

        Used to avoid
        repeated mistakes
    end note

    note right of Create_Activity_Log
        .ralph/activity.log

        ## Run Summary
        - [date] | run=ID | iter=N ...

        ## Events
        [YYYY-MM-DD HH:MM:SS] message
    end note
```

## 7. Agent Selection & Execution

```mermaid
stateDiagram-v2
    [*] --> Check_Agent_Override

    Check_Agent_Override --> CLI_Override: --agent flag
    Check_Agent_Override --> Env_Override: AGENT_CMD set
    Check_Agent_Override --> Load_Config: no override

    CLI_Override --> Resolve_Agent_Command
    Env_Override --> Resolve_Agent_Command

    Load_Config --> Read_Agents_SH: agents.sh exists
    Load_Config --> Use_Default: no agents.sh

    Read_Agents_SH --> Parse_Agent_Vars
    Parse_Agent_Vars --> Resolve_Agent_Command

    Use_Default --> Select_Codex
    Select_Codex --> Resolve_Agent_Command

    Resolve_Agent_Command --> Codex_Cmd: agent=codex
    Resolve_Agent_Command --> Claude_Cmd: agent=claude
    Resolve_Agent_Command --> Droid_Cmd: agent=droid

    Codex_Cmd --> Check_Agent_Installed
    Claude_Cmd --> Check_Agent_Installed
    Droid_Cmd --> Check_Agent_Installed

    Check_Agent_Installed --> Agent_Missing: command not found
    Check_Agent_Installed --> Determine_Mode: agent available

    Agent_Missing --> Print_Install_Hint
    Print_Install_Hint --> [*]: exit error

    Determine_Mode --> Interactive_Mode: prd command
    Determine_Mode --> Headless_Mode: build/plan

    Interactive_Mode --> Use_Interactive_Cmd
    Headless_Mode --> Use_Headless_Cmd

    Use_Interactive_Cmd --> Render_Prompt_File
    Use_Headless_Cmd --> Render_Prompt_File

    Render_Prompt_File --> Check_Prompt_Style
    Check_Prompt_Style --> File_Input: {prompt} placeholder
    Check_Prompt_Style --> Stdin_Input: no placeholder

    File_Input --> Substitute_Prompt_Path
    Stdin_Input --> Pipe_To_Agent

    Substitute_Prompt_Path --> Execute_Command
    Pipe_To_Agent --> Execute_Command

    Execute_Command --> Capture_Output
    Capture_Output --> [*]

    note right of Resolve_Agent_Command
        Default commands:

        codex (headless):
        codex exec --yolo
        --skip-git-repo-check -

        claude (headless):
        claude -p
        --dangerously-skip-permissions
        "$(cat {prompt})"

        droid (headless):
        droid exec
        --skip-permissions-unsafe
        -f {prompt}
    end note

    note right of Render_Prompt_File
        Python template engine:

        Replace {{VAR}}:
        - PRD_PATH
        - PLAN_PATH
        - STORY_ID
        - STORY_TITLE
        - STORY_BLOCK
        - RUN_ID
        - ITERATION
        - etc.
    end note

    note right of Execute_Command
        Output captured to:
        .ralph/runs/run-TAG-iter-N.log

        Also streamed to terminal
        via `tee`

        Exit code tracked
    end note
```

## Key Concepts

### Memory Model
Ralph treats **files and git** as memory, not model context:
- Each iteration starts fresh with a new agent session
- State persists only in files (`.ralph/` directory)
- Git commits serve as checkpoints

### Story Format
Stories in PRD must follow this exact pattern:
```markdown
### [ ] US-001: Story Title
- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

When complete:
```markdown
### [x] US-001: Story Title
- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
```

### State Files (.ralph/)
- `IMPLEMENTATION_PLAN.md` - Task plan grouped by story
- `progress.md` - Append-only progress log
- `guardrails.md` - "Signs" (lessons learned)
- `activity.log` - Activity + timing log
- `errors.log` - Repeated failures and notes
- `runs/` - Raw run logs + summaries

### Control Flow
1. **PRD Generation**: User request → Agent + skill → PRD file
2. **Planning**: PRD → Agent reads code → Creates implementation plan
3. **Build Loop**: For each story → Agent implements → Commits → Updates PRD/plan
4. **Completion**: When all stories marked `[x]` → `<promise>COMPLETE</promise>` → Exit

### Error Handling
- Non-zero exit codes logged to `errors.log`
- Uncommitted files after build iteration trigger warnings
- Guardrails updated with learned failures
- Iterations continue unless interrupted (SIGINT/SIGTERM)
