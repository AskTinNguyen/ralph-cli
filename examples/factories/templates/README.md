# Factory Templates

Pre-built factory templates for common workflow patterns.

## Available Templates

### 1. Simple Feature (`simple-feature.yaml`)
**Use case**: Single feature implementation with testing

**Pattern**: PRD → Plan → Build → Test → Deploy

**Best for**:
- Adding a new feature to existing project
- Quick prototypes
- Simple refactoring tasks

**How to use**:
```bash
# Copy template
cp .ralph/factory/templates/simple-feature.yaml .ralph/factory/my-feature.yaml

# Edit variables
# Update feature_request variable to describe your feature

# Run
ralph factory run my-feature --var="feature_request=Add user search functionality"
```

---

### 2. Self-Correcting (`self-correcting.yaml`)
**Use case**: Automated test-fix-retry loops

**Pattern**: PRD → Plan → Build → Test → [Fix Loop if failed] → Deploy

**Best for**:
- Complex features requiring iteration
- High test coverage requirements
- Automated quality gates

**Features**:
- Automatically retries up to 3 times on test failure
- Generates fix PRDs with failure context
- Enforces test coverage thresholds

**How to use**:
```bash
cp .ralph/factory/templates/self-correcting.yaml .ralph/factory/my-api.yaml
ralph factory run my-api --var="feature_request=Build REST API with auth"
```

---

### 3. Parallel Features (`parallel-features.yaml`)
**Use case**: Multiple independent features built concurrently

**Pattern**: [PRD1, PRD2, PRD3] → [Build1, Build2, Build3] → Integration → Test

**Best for**:
- Building multiple microservices
- Parallel feature development
- Large-scale refactoring

**Features**:
- Concurrent PRD generation and builds
- Uses git worktrees for isolation
- Integration stage merges all features
- Comprehensive integration testing

**How to use**:
```bash
cp .ralph/factory/templates/parallel-features.yaml .ralph/factory/my-features.yaml

# Edit variables to define your features
ralph factory run my-features
```

---

## Creating Custom Factories

### Basic Structure

```yaml
version: "1"
name: "my-factory"

variables:
  my_var: "value"

agents:
  default: claude

stages:
  - id: stage_name
    type: prd|plan|build|custom|factory
    depends_on: [other_stages]  # Optional
    condition: "{{ expression }}" # Optional

    # For prd/plan/build types
    input:
      request: "{{ variables.my_var }}"
    config:
      iterations: 10

    # For custom type
    command: "npm test"

    # Verification gates
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 10
```

### Stage Types

| Type | Description | Use Case |
|------|-------------|----------|
| `prd` | Generate PRD | Define requirements |
| `plan` | Create plan from PRD | Break into user stories |
| `build` | Execute stories | Implement features |
| `custom` | Run shell command | Tests, builds, deploys |
| `factory` | Nested factory | Complex workflows |

### Verification Types

| Type | Purpose | Example |
|------|---------|---------|
| `file_exists` | Files created | Check outputs exist |
| `git_commits` | Code committed | Verify work done |
| `test_suite` | Tests pass | Run Jest/Mocha/etc |
| `build_success` | Build completes | Run webpack/tsc |
| `lint_pass` | Linting passes | Run ESLint |

See [skills/factory/SKILL.md](../../../skills/factory/SKILL.md) for full documentation.

---

## Example: Customizing Simple Feature Template

```yaml
version: "1"
name: "add-dashboard"

variables:
  feature_request: "Add analytics dashboard with charts"
  max_iterations: 15
  min_tests: 20

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
      iterations: "{{ variables.max_iterations }}"

    verify:
      - type: git_commits
        min_commits: 1
        pattern: "dashboard"

      - type: test_suite
        command: "npm test -- --testPathPattern=dashboard"
        min_passing: "{{ variables.min_tests }}"
        max_failing: 0

      - type: build_success
        command: "npm run build"

      - type: lint_pass
        command: "npm run lint"
        max_errors: 0

  - id: run_tests
    type: custom
    depends_on: [build_feature]
    command: "npm test -- --coverage"

  - id: generate_docs
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.passed }}"
    input:
      request: "Document the analytics dashboard: usage guide and API reference"
```

---

## Tips

1. **Start Simple**: Use `simple-feature.yaml` for your first factory
2. **Add Verification**: Always include verification gates to prevent false positives
3. **Test Locally**: Run factories on small features first to validate configuration
4. **Use Variables**: Make factories reusable with variables
5. **Check Status**: Use `ralph factory status <name>` to monitor progress
6. **Resume on Failure**: Use `ralph factory resume <name>` if interrupted

---

## Common Patterns

### Conditional Branching
```yaml
- id: simple_build
  condition: "{{ stages.analyze.complexity <= 5 }}"
  config:
    iterations: 5

- id: complex_build
  condition: "{{ stages.analyze.complexity > 5 }}"
  config:
    iterations: 20
```

### Self-Correction Loop
```yaml
- id: fix_failures
  depends_on: [run_tests]
  condition: "{{ stages.run_tests.failed && recursion_count < 3 }}"
  loop_to: build_implementation
  max_loops: 3
```

### Parallel Execution
```yaml
- id: build_frontend
  depends_on: [setup]

- id: build_backend
  depends_on: [setup]

- id: integration
  depends_on: [build_frontend, build_backend]
```

---

## Troubleshooting

**Factory not starting**:
- Check YAML syntax: `ralph factory stages <name>`
- Verify all stage IDs are unique
- Ensure dependencies form a valid DAG (no cycles)

**Verification failing**:
- Check verification command works manually
- Review min/max thresholds
- Check file paths are correct

**Infinite loop**:
- Add `max_loops` to loop stages
- Add proper exit conditions
- Check `recursion_count` limits

---

For full documentation, see:
- [Factory Mode Skill](../../../skills/factory/SKILL.md)
- [Ralph CLI Documentation](../../../CLAUDE.md#factory-mode-meta-orchestration)
