# Factory Mode - Sprint 1 Implementation Plan

**Goal**: Validate Factory Mode with real-world end-to-end testing using a Wedding Planner website as the test case.

**Branch**: `feature/factory-sprint1-wedding-planner`

**Status**: ✅ Planning Complete - Ready for Execution

---

## 🎯 Sprint Objectives

1. ✅ Create comprehensive PRD→Plan→Build factory for complete web application
2. ✅ Add robust verification gates at critical stages
3. ✅ Create reusable factory templates for common patterns
4. ⏳ Execute factory end-to-end and validate all stages work
5. ⏳ Document learnings, failures, and success metrics

---

## 📁 Deliverables

### Factory Configuration Files

| File | Purpose | Status |
|------|---------|--------|
| `wedding-planner-website.yaml` | Main factory - Full-stack web app | ✅ Complete |
| `templates/simple-feature.yaml` | Basic PRD→Plan→Build pattern | ✅ Complete |
| `templates/self-correcting.yaml` | Test-fail-retry loop pattern | ✅ Complete |
| `templates/parallel-features.yaml` | Parallel PRD execution pattern | ✅ Complete |
| `templates/README.md` | Template usage guide | ✅ Complete |

### Documentation

| File | Purpose | Status |
|------|---------|--------|
| `SPRINT1_PLAN.md` (this file) | Sprint planning and tracking | ✅ Complete |
| `SPRINT1_RESULTS.md` | Execution results and learnings | ⏳ Pending |

---

## 🏗️ Wedding Planner Website Factory

### Architecture Overview

The factory builds a complete full-stack wedding planning application with:

**Components**:
- Database schema (PostgreSQL/MongoDB)
- Backend API (Node.js + Express + JWT auth)
- Frontend UI (React + TypeScript)
- Testing infrastructure (Jest + React Testing Library)
- Deployment configuration (Docker + CI/CD)
- Comprehensive documentation

**Execution Plan**: 20 stages across 19 levels
- **Sequential flow**: Project setup → Database → Backend → Frontend → Integration
- **Conditional branching**: Test success → Deploy | Test failure → Fix loop
- **Self-correction**: Max 2 retry loops if integration tests fail
- **Verification gates**: 15 verification checkpoints

### Stage Breakdown

#### Phase 1: Project Scaffolding (Stages 1-3)
```
setup_project (PRD) → plan_setup → build_setup
```
- Creates folder structure (frontend/, backend/, shared/)
- Sets up package.json, TypeScript, ESLint
- Configures testing infrastructure
- **Verification**: Files exist, build succeeds

#### Phase 2: Database Layer (Stages 4-6)
```
generate_database_prd → plan_database → build_database
```
- Designs schema for: users, guests, vendors, timeline, budget, todos
- Creates migrations and seed data
- Implements ORM/query builder
- **Verification**: Schema files exist, git commits present

#### Phase 3: Backend API (Stages 7-9)
```
generate_backend_prd → plan_backend → build_backend
```
- Implements RESTful API (auth, guests, vendors, timeline, budget)
- JWT authentication + middleware
- Input validation (Joi/Zod)
- API tests (Jest + Supertest)
- **Verification**: 10+ tests pass, build succeeds

#### Phase 4: Frontend UI (Stages 10-12)
```
generate_frontend_prd → plan_frontend → build_frontend
```
- React 18+ with TypeScript
- Pages: Dashboard, Guests, Vendors, Timeline, Budget, Todos
- State management (Context/Redux)
- Component tests
- **Verification**: Build succeeds, linting passes

#### Phase 5: Integration Testing (Stage 13)
```
run_integration_tests
```
- Starts backend server
- Runs frontend integration tests
- **Verification**: 5+ integration tests pass

#### Phase 6: Self-Correction Loop (Stage 14)
```
fix_test_failures (conditional) → loops back to plan_backend
```
- **Trigger**: `{{ stages.run_integration_tests.failed && recursion_count < 2 }}`
- Generates fix PRD with error context
- Loops back to backend planning
- **Max loops**: 2

#### Phase 7: Deployment (Stages 15-17)
```
generate_deployment_prd → plan_deployment → build_deployment
```
- **Trigger**: `{{ stages.run_integration_tests.passed }}`
- Docker configuration
- CI/CD pipeline (GitHub Actions)
- Environment management
- **Verification**: Docker Compose config valid

#### Phase 8: Documentation (Stages 18-20)
```
generate_docs_prd → plan_docs → build_docs
```
- README with features and setup
- API reference documentation
- Architecture diagrams
- User guide and contributing docs
- **Verification**: Files exist, content correct

---

## 🛡️ Verification Gates

### Summary

| Stage | Verifier Type | Purpose |
|-------|---------------|---------|
| `build_setup` | `file_exists` | Project files created |
| `build_setup` | `build_success` | TypeScript compiles |
| `build_database` | `file_exists` | Schema files present |
| `build_database` | `git_commits` | Database work committed |
| `build_backend` | `file_exists` | API files created |
| `build_backend` | `test_suite` | 10+ backend tests pass |
| `build_backend` | `build_success` | Backend builds |
| `build_frontend` | `file_exists` | UI components created |
| `build_frontend` | `build_success` | Frontend builds |
| `build_frontend` | `lint_pass` | Linting passes |
| `run_integration_tests` | `test_suite` | 5+ integration tests pass |
| `build_deployment` | `file_exists` | Docker files exist |
| `build_deployment` | `custom` | Docker Compose validates |
| `build_docs` | `file_exists` | Docs files created |
| `build_docs` | `file_contains` | Docs mention project |
| `build_docs` | `git_commits` | Docs work committed |

**Total verification points**: 15

### Why This Matters

- **Tamper-resistant**: Agents cannot fake success by outputting "All tests pass!"
- **Git-based**: Verifies actual commits exist, not just claims
- **Test execution**: Actually runs Jest/npm test, parses real results
- **Build validation**: Ensures code compiles and builds successfully
- **Quality gates**: Enforces minimum standards at each stage

---

## 📊 Expected Metrics

### Execution Time Estimates

| Phase | Stages | Est. Time | Reasoning |
|-------|--------|-----------|-----------|
| Scaffolding | 3 | 15-20 min | 8 build iterations |
| Database | 3 | 20-30 min | 10 build iterations |
| Backend | 3 | 30-45 min | 15 build iterations + tests |
| Frontend | 3 | 45-60 min | 20 build iterations + build |
| Integration | 1 | 5-10 min | Test execution |
| Deployment | 3 | 15-20 min | 8 build iterations |
| Docs | 3 | 10-15 min | 5 build iterations |

**Total estimated time**: 2.5 - 4 hours (without failures)
**With retry loops**: Add 20-30 min per retry cycle

### Success Criteria

- [ ] All 20 stages complete successfully
- [ ] All 15 verification gates pass
- [ ] No infinite loops (max 2 retries enforced)
- [ ] PRD artifacts created in `.ralph/PRD-X/` directories
- [ ] Git commits present for all build stages
- [ ] Final codebase builds and passes tests
- [ ] Docker Compose configuration valid

### Failure Scenarios to Test

1. **Verification gate failure**: If tests fail, does fix loop trigger?
2. **Max recursion**: Does factory stop after 2 retry loops?
3. **Dependency chain**: If early stage fails, do dependent stages skip?
4. **Conditional branching**: Does deployment skip if tests fail?

---

## 🚀 Execution Instructions

### Prerequisites

```bash
# Ensure Ralph CLI is installed
which ralph

# Ensure factory module is available
ralph factory --help

# Check factory configuration is valid
ralph factory stages wedding-planner-website

# Visualize dependency graph
ralph factory graph wedding-planner-website
```

### Execution Options

#### Option 1: Full Run (Recommended for first test)
```bash
# Run the complete factory
ralph factory run wedding-planner-website

# Monitor status in another terminal
watch -n 5 ralph factory status wedding-planner-website

# View learnings after completion
ralph factory learnings
```

#### Option 2: Dry Run (Test without commits)
```bash
# Add --dry-run flag if implementing this feature
ralph factory run wedding-planner-website --dry-run
```

#### Option 3: Resume on Failure
```bash
# If factory fails mid-execution
ralph factory resume wedding-planner-website

# Or specify run ID
ralph factory resume wedding-planner-website --run-id=run-XXXXX
```

### Monitoring Progress

```bash
# Check factory status
ralph factory status wedding-planner-website

# View execution graph with current state
ralph factory graph wedding-planner-website

# Tail the execution log
tail -f .ralph/factory/runs/run-*/execution.log

# Check specific stage result
cat .ralph/factory/runs/run-*/stages/build_backend/result.json
```

---

## 📝 Post-Execution Checklist

After the factory run completes:

- [ ] Review all PRD artifacts in `.ralph/PRD-*/`
- [ ] Check verification gate results
- [ ] Analyze any failures and retry cycles
- [ ] Document unexpected behaviors
- [ ] Create `SPRINT1_RESULTS.md` with:
  - Total execution time
  - Number of PRDs created
  - Number of commits
  - Verification pass/fail rates
  - Learnings and improvements for Sprint 2
- [ ] Screenshot of final factory status
- [ ] Test the generated wedding planner app manually
- [ ] Create GitHub PR with results

---

## 🎓 Learnings to Capture

### Technical Learnings

- Which verification types were most effective?
- Did conditional branching work correctly?
- How well did the self-correction loop perform?
- Were there any template resolution issues?
- How accurate were the time estimates?

### Factory Design Patterns

- What stage types were most useful?
- What dependencies made sense?
- What verification gates caught issues?
- What could be parallelized better?

### Improvements for Sprint 2

- Performance optimizations
- Better error messages
- Enhanced verification gates
- Additional stage types
- Parallel execution patterns

---

## 🔧 Troubleshooting

### If Factory Hangs

1. Check for process locks: `ps aux | grep ralph`
2. View factory status: `ralph factory status`
3. Stop if needed: `ralph factory stop wedding-planner-website`
4. Resume from checkpoint: `ralph factory resume`

### If Verification Fails

1. Check stage result: `cat .ralph/factory/runs/run-*/stages/<stage_id>/result.json`
2. Review verification details
3. Fix issue manually if needed
4. Use `ralph factory rerun <stage>` (when implemented)

### If Templates Don't Resolve

1. Check variable definitions in YAML
2. Verify template syntax: `{{ variable_name }}`
3. Review context in execution log

---

## 📦 Files Created

This sprint creates:

```
.ralph/factory/
├── wedding-planner-website.yaml        # Main factory
├── templates/
│   ├── README.md                       # Template guide
│   ├── simple-feature.yaml             # Basic pattern
│   ├── self-correcting.yaml            # Retry loop pattern
│   └── parallel-features.yaml          # Parallel execution
├── SPRINT1_PLAN.md                     # This file
└── runs/
    └── run-TIMESTAMP/                  # Execution artifacts
        ├── state.json
        ├── context.json
        └── stages/
            ├── setup_project/
            ├── build_backend/
            └── ... (20 total)
```

Expected PRD artifacts:

```
.ralph/
├── PRD-1/  # Project setup
├── PRD-2/  # Database schema
├── PRD-3/  # Backend API
├── PRD-4/  # Frontend UI
├── PRD-5/  # Deployment config
├── PRD-6/  # Documentation
└── (possibly PRD-7+ if retry loops triggered)
```

---

## 🎯 Success Definition

**Sprint 1 is successful if:**

1. ✅ Factory YAML is valid and parseable
2. ✅ Dependency graph visualizes correctly
3. ✅ Templates are reusable and documented
4. ⏳ Factory executes end-to-end without crashing
5. ⏳ At least 80% of stages complete successfully
6. ⏳ Verification gates catch actual issues (not all pass)
7. ⏳ Self-correction loop triggers at least once
8. ⏳ Learnings are documented for Sprint 2

**Bonus goals:**

- Generated codebase is actually functional
- All tests pass in generated code
- Docker Compose starts successfully
- Documentation is comprehensive

---

## 🔜 Next Steps

After Sprint 1 completion:

1. **Immediate**: Document results in `SPRINT1_RESULTS.md`
2. **Short-term**: Address any critical bugs found
3. **Medium-term**: Plan Sprint 2 based on learnings
4. **Long-term**: Merge to main and announce Factory Mode launch

---

**Created**: 2026-01-17
**Sprint Duration**: 1-2 weeks
**Primary Goal**: Validate Factory Mode with real-world usage
