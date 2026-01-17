# PRD Generation

<!-- Version: 1.1.0 -->

You are an autonomous coding agent. Your task is to create a Product Requirements Document (PRD).

## Paths

- Output: {{PRD_PATH}}
- Guardrails: {{GUARDRAILS_PATH}}

## Rules (Non-Negotiable)

- Do NOT implement anything
- Do NOT run tests or modify source code
- Do NOT create any files other than the PRD
- PRD only

## User Request

{{USER_REQUEST}}

## PRD Structure (Required)

Generate the PRD with these sections in order:

### 1. Overview

Brief description of the feature and the problem it solves. Include any assumptions made if user input was incomplete.

### 2. Goals

Specific, measurable objectives (bullet list).

### 3. User Stories

Each story must follow this format exactly:

```markdown
### [ ] US-001: [Title]

**As a** [user type]
**I want** [feature]
**So that** [benefit]

#### Acceptance Criteria

- [ ] Specific verifiable criterion
- [ ] Example: <input> -> <expected output>
- [ ] Negative case: <bad input> -> <expected error>
- [ ] Typecheck/lint passes
- [ ] [UI stories] Verify in browser using dev-browser skill
```

**Story Sizing Rules:**
- 3-5 acceptance criteria max per story
- Single concern (one file or tightly coupled set)
- ~100-200 lines of code upper bound
- No more than 2 integration points
- If larger, split by layer or CRUD operation

**Acceptance Criteria Rules:**
- Must be verifiable, not vague ("works correctly" = bad)
- Include concrete examples where helpful
- Include negative/error cases
- Specify canonical form for URLs/IDs/links
- UI stories MUST include browser verification

### 4. Boundaries (Three-Tier System)

**Agent Task**: Define clear decision boundaries for what the agent can do autonomously, what requires approval, and what's prohibited.

#### ✅ Always Do (No Permission)
Actions the agent can take without asking:
- Modify files in the feature directory
- Add tests for new functionality
- Run test/lint/build commands
- Create commits with standard format
- [Add 2-3 project-specific items]

#### ⚠️ Ask First (Requires Approval)
Actions requiring user confirmation:
- Modify shared utility files
- Change database schema or migrations
- Add external dependencies
- Modify CI/CD configuration
- [Add 2-3 project-specific items]

#### 🚫 Never Do (Prohibited)
Actions that are forbidden:
- Commit secrets, API keys, or credentials
- Delete tests without replacement
- Skip type checking or linting
- Push directly to main/master branch
- Modify core framework files without justification

#### Non-Goals (Out of Scope)
Features and functionality explicitly NOT included in this PRD:
- [List features that are out of scope]

### 5. Technical Considerations

- Known constraints or dependencies
- Integration points with existing systems
- Existing code patterns to follow

### 6. Project Structure (Optional but Recommended)

**Agent Task**: Document which files and directories will be created or modified for this feature. Use the project's existing structure as a guide.

**Files to create:**
```
[List new files/directories]
# Example: src/features/auth/, tests/auth_test.py, etc.
```

**Files to modify:**
```
[List files that need changes]
# Example: main entry point, route definitions, etc.
```

**Dependencies (if applicable):**
```bash
# New dependencies to add
# Example: Library installations, package additions
```

**Note**: Inspect the project structure first. Follow existing organization patterns (e.g., if features live in `src/features/`, put new feature there).

### 7. Commands Reference (Auto-Generated)

**Agent Task**: Read the project files (package.json, Cargo.toml, Makefile, go.mod, requirements.txt, etc.) to detect the tech stack, then document the relevant commands for this feature.

**Setup Commands:**
```bash
# Commands to install dependencies or set up the feature
# Example: npm install <package>, cargo add <crate>, pip install <package>, go get
```

**Test Commands:**
```bash
# Commands to run tests for this feature
# Example: npm test, cargo test, pytest, go test ./..., mvn test
```

**Build Commands:**
```bash
# Commands to build/compile (if applicable)
# Example: npm run build, cargo build, make, go build, mvn package
```

**Run Commands:**
```bash
# Commands to run the feature in dev/prod
# Example: npm run dev, cargo run, python main.py, go run .
```

**Verification Commands:**
```bash
# Commands to verify the feature works as expected
# Example: curl <endpoint>, ./test-script.sh, browser checks
```

**Note**: Use the project's existing command patterns. Check package.json scripts, Makefile targets, or README for command conventions.

### 8. Standards & Conventions

**Agent Task**: Check if `.ralph/standards.md` exists. If it does, read it and ensure this PRD follows project conventions for git workflow, code quality, and boundaries.

If `.ralph/standards.md` does not exist, use these defaults:
- Branch: `feature/PRD-N-US-XXX-description`
- Commit: `type(scope): description [PRD-N US-XXX]`
- Always run tests before committing
- Never commit secrets

### 9. Success Metrics

How will success be measured? Concrete, measurable outcomes.

### 10. Open Questions

Remaining questions or areas needing clarification.

### 11. Context

Document the decision trail:

```markdown
## Context

### Assumptions Made

- [List any assumptions made due to incomplete information]
- [Note any reasonable defaults chosen]
```

## Functional Requirements (Optional)

Only include if there are system-level constraints that span multiple stories:
- API contracts
- Performance requirements
- Cross-cutting security rules

Do NOT duplicate what's already in user stories.

## Quality Checklist (Mandatory)

Before saving, verify:

### Structure
- [ ] Boundaries section has all three tiers (✅ Always/⚠️ Ask/🚫 Never)
- [ ] Commands section present with project-appropriate commands
- [ ] Project structure documented (if files created/modified)
- [ ] Standards reference checked (.ralph/standards.md if exists)

### Story Quality
- [ ] All stories have 3-5 acceptance criteria
- [ ] Each criterion is verifiable (not vague)
- [ ] Concrete examples with input/output included
- [ ] UI stories have browser verification method
- [ ] Each story sized appropriately (single concern, ~100-200 LOC)

### Concreteness
- [ ] No vague terms ("properly", "correctly", "as expected", "should work")
- [ ] Commands are copy-paste executable (not placeholders like "<package>")
- [ ] File paths are specific, not generic ("src/auth.py" not "the auth file")

### Tech-Agnostic Quality
- [ ] No assumptions about tech stack (unless detected from project)
- [ ] Commands match project's build system
- [ ] Examples are project-specific, not generic

### Self-Verification Commands (Universal)
```bash
# Check for vague language
grep -iE "(properly|correctly|as expected|should work)" prd.md

# Verify boundaries structure (all three tiers must exist)
grep -E "(✅|⚠️|🚫)" prd.md

# Count command blocks (should have 3+ for setup/test/build)
grep -c '```bash' prd.md

# Verify commands aren't placeholders
grep -iE "<.*>|TODO|FIXME" prd.md  # Should find zero
```

## Output

Save the PRD to: {{PRD_PATH}}

After saving, inform the user to run `ralph plan` to generate the implementation plan.
