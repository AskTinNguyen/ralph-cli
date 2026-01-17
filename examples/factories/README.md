# Factory Mode Examples

This directory contains example factory configurations demonstrating Ralph's Factory Mode capabilities.

## What is Factory Mode?

Factory Mode is Ralph's meta-orchestration layer that enables declarative, multi-stage agent workflows. Think of it as a build pipeline for autonomous development - you define what needs to be built, and Ralph orchestrates the entire PRD→Plan→Build flow with verification gates and self-correction loops.

## Quick Start

```bash
# Copy an example to your .ralph/factory directory
cp examples/factories/templates/simple-feature.yaml .ralph/factory/my-feature.yaml

# Edit the variables to match your needs
# Then run:
ralph factory run my-feature
```

## Examples in This Directory

### 🏗️ Production Example: Wedding Planner Website

**File**: `wedding-planner-website.yaml`

A comprehensive example that builds a complete full-stack web application:
- Project scaffolding
- Database schema design
- Backend API (Node.js + Express)
- Frontend UI (React + TypeScript)
- Integration testing with self-correction loops
- Deployment configuration
- Documentation generation

**Stats**:
- 20 stages
- 15 verification gates
- Sequential execution with conditional branching
- Self-correcting test-fail-retry loop
- Est. execution time: 2.5-4 hours

**Use this to**:
- Learn how to structure complex multi-stage factories
- See verification gates in action
- Understand conditional branching and loops
- Validate Factory Mode end-to-end

### 📁 Templates

**Directory**: `templates/`

Reusable factory patterns for common scenarios:

#### 1. **simple-feature.yaml**
Basic PRD→Plan→Build→Test→Deploy pattern
- Single feature implementation
- Testing verification
- Build validation
- Git commit checks

#### 2. **self-correcting.yaml**
Automated test-fail-retry loops
- Runs tests after implementation
- Generates fix PRD on test failure
- Loops back to planning (max 3 times)
- Enforces test coverage requirements

#### 3. **parallel-features.yaml**
Multiple independent features built concurrently
- 3 parallel PRD→Plan→Build streams
- Uses git worktrees for isolation
- Integration stage merges all features
- Comprehensive integration testing

See `templates/README.md` for detailed usage instructions.

## Using These Examples

### Copy to Your Project

```bash
# Copy a template
cp examples/factories/templates/simple-feature.yaml .ralph/factory/add-auth.yaml

# Customize variables
# Edit .ralph/factory/add-auth.yaml

# Run
ralph factory run add-auth
```

### Learn from the Wedding Planner Example

```bash
# Visualize the execution plan
ralph factory graph wedding-planner-website

# See all 20 stages
ralph factory stages wedding-planner-website

# Copy and modify for your own project
cp examples/factories/wedding-planner-website.yaml .ralph/factory/my-app.yaml
```

## Factory Configuration Basics

```yaml
version: "1"
name: "my-factory"

variables:
  feature_request: "Add user authentication"

agents:
  default: claude

stages:
  - id: generate_prd
    type: prd
    input:
      request: "{{ variables.feature_request }}"

  - id: create_plan
    type: plan
    depends_on: [generate_prd]

  - id: build_feature
    type: build
    depends_on: [create_plan]
    config:
      iterations: 10

    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 5
```

## Key Concepts

### Stage Types

| Type | Purpose |
|------|---------|
| `prd` | Generate PRD document |
| `plan` | Create implementation plan |
| `build` | Execute build iterations |
| `custom` | Run shell command |
| `factory` | Nested factory |

### Verification Gates

Tamper-resistant checks that verify actual work:
- `file_exists` - Files were created
- `git_commits` - Code was committed
- `test_suite` - Tests actually pass
- `build_success` - Build completes
- `lint_pass` - Linting passes

### Dependencies

```yaml
depends_on: [stage1, stage2]  # Wait for both
```

### Conditional Execution

```yaml
condition: "{{ stages.run_tests.passed }}"
```

### Self-Correction Loops

```yaml
- id: fix_failures
  depends_on: [run_tests]
  condition: "{{ stages.run_tests.failed && recursion_count < 3 }}"
  loop_to: build_implementation
  max_loops: 3
```

## Documentation

For complete documentation, see:
- **[Factory Mode Skill](../../skills/factory/SKILL.md)** - Full reference
- **[Main Documentation](../../CLAUDE.md#factory-mode-meta-orchestration)** - Ralph CLI guide
- **[Sprint 1 Plan](SPRINT1_PLAN.md)** - Wedding planner case study

## Tips

1. **Start simple**: Begin with `simple-feature.yaml`
2. **Add verification**: Don't trust agent output - verify actual work
3. **Use variables**: Make factories reusable
4. **Test locally**: Validate with small features first
5. **Monitor progress**: Use `ralph factory status <name>`

## Troubleshooting

### Factory won't parse
```bash
ralph factory stages <name>  # Check YAML syntax
```

### Verification failing
```bash
# Check what command is running
cat .ralph/factory/<name>.yaml | grep -A 5 "verify:"

# Test verification command manually
npm test  # or whatever the command is
```

### Infinite loop
- Add `max_loops` to loop stages
- Check `recursion_count < X` in conditions

## Contributing

Have a useful factory pattern? Submit a PR with:
1. Your factory YAML in this directory
2. Documentation in this README
3. Expected execution time and success criteria

---

**Last Updated**: 2026-01-17
**Sprint**: Sprint 1 - Production Validation
