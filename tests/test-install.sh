#!/bin/bash
# Test script for Ralph CLI one-click installation
# This script validates the end-to-end installation flow including UI setup

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Test configuration
TEST_DIR=$(mktemp -d -t ralph-install-test-XXXXXX)
TEST_PROJECT_NAME="test-project"
TEST_PROJECT_DIR="$TEST_DIR/$TEST_PROJECT_NAME"
RALPH_CLI_DIR="$TEST_DIR/ralph-cli"

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Print functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; PASSED=$((PASSED + 1)); }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; WARNINGS=$((WARNINGS + 1)); }
log_step() { echo -e "\n${CYAN}${BOLD}==> $1${NC}"; }

# Cleanup function
cleanup() {
    log_step "Cleaning up test environment"
    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        log_info "Removed test directory: $TEST_DIR"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Banner
print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
╔═══════════════════════════════════════════╗
║   Ralph CLI Installation Test Suite      ║
╚═══════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# Check if command exists
has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"

    local all_good=true

    if has_cmd git; then
        log_success "Git is installed"
    else
        log_error "Git is not installed"
        all_good=false
    fi

    if has_cmd node; then
        log_success "Node.js is installed ($(node -v))"
    else
        log_error "Node.js is not installed"
        all_good=false
    fi

    if has_cmd npm; then
        log_success "npm is installed ($(npm -v))"
    else
        log_error "npm is not installed"
        all_good=false
    fi

    if [ "$all_good" = false ]; then
        log_error "Prerequisites not met. Cannot continue."
        exit 1
    fi
}

# Test 1: Global installation (simulated)
test_global_install() {
    log_step "Test 1: Simulating global installation"

    # Instead of running the actual install script, we'll clone the repo
    # This simulates what install.sh does

    log_info "Cloning Ralph CLI repository..."
    if git clone --quiet "$(git -C "$(pwd)" rev-parse --show-toplevel)" "$RALPH_CLI_DIR" 2>/dev/null; then
        log_success "Ralph CLI repository cloned"
    else
        log_error "Failed to clone Ralph CLI repository"
        return 1
    fi

    log_info "Installing npm dependencies..."
    if (cd "$RALPH_CLI_DIR" && npm install --silent --no-progress 2>/dev/null); then
        log_success "npm dependencies installed"
    else
        log_error "Failed to install npm dependencies"
        return 1
    fi

    log_info "Linking ralph globally (simulated)..."
    # We'll use the local path instead of npm link for testing
    export PATH="$RALPH_CLI_DIR/bin:$PATH"

    if [ -x "$RALPH_CLI_DIR/bin/ralph" ]; then
        log_success "ralph binary is executable"
    else
        log_error "ralph binary is not executable"
        return 1
    fi

    # Test ralph command
    if "$RALPH_CLI_DIR/bin/ralph" --version >/dev/null 2>&1; then
        log_success "ralph command works"
    else
        log_error "ralph command failed"
        return 1
    fi
}

# Test 2: Project installation
test_project_install() {
    log_step "Test 2: Project installation (ralph install)"

    # Create a test project
    log_info "Creating test project directory..."
    mkdir -p "$TEST_PROJECT_DIR"
    cd "$TEST_PROJECT_DIR"

    # Initialize git repo (required for ralph)
    git init --quiet
    git config user.name "Test User"
    git config user.email "test@example.com"

    log_success "Test project created and initialized"

    # Run ralph install (non-interactive)
    log_info "Running 'ralph install'..."

    # Mock the install by copying files directly
    if "$RALPH_CLI_DIR/bin/ralph" install --force 2>&1 | grep -q "Installed"; then
        log_success "ralph install completed"
    else
        log_warn "ralph install may have issues (check output)"
    fi

    # Verify .agents/ralph exists
    if [ -d ".agents/ralph" ]; then
        log_success ".agents/ralph directory created"
    else
        log_error ".agents/ralph directory not found"
        return 1
    fi

    # Verify key files exist
    local required_files=(
        ".agents/ralph/loop.sh"
        ".agents/ralph/stream.sh"
        ".agents/ralph/config.sh"
        ".agents/ralph/PROMPT_build.md"
        ".agents/ralph/PROMPT_plan.md"
    )

    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "Found: $file"
        else
            log_error "Missing: $file"
        fi
    done
}

# Test 3: UI dependencies check
test_ui_dependencies() {
    log_step "Test 3: UI dependencies and installation"

    local ui_dir="$RALPH_CLI_DIR/ui"

    # Check if UI directory exists
    if [ -d "$ui_dir" ]; then
        log_success "UI directory exists"
    else
        log_error "UI directory not found"
        return 1
    fi

    # Check package.json
    if [ -f "$ui_dir/package.json" ]; then
        log_success "UI package.json exists"
    else
        log_error "UI package.json not found"
        return 1
    fi

    # Check if node_modules exists (from previous install)
    if [ -d "$ui_dir/node_modules" ]; then
        log_success "UI dependencies already installed"
    else
        log_warn "UI dependencies not installed - user must run: cd ui && npm install"
        log_info "Installing UI dependencies now for testing..."

        if (cd "$ui_dir" && npm install --silent --no-progress 2>/dev/null); then
            log_success "UI dependencies installed successfully"
        else
            log_error "Failed to install UI dependencies"
            return 1
        fi
    fi

    # Check server file
    if [ -f "$ui_dir/src/server.ts" ]; then
        log_success "UI server file exists"
    else
        log_error "UI server file not found"
        return 1
    fi

    # Check if tsx is available (needed to run TypeScript)
    if (cd "$ui_dir" && npx tsx --version >/dev/null 2>&1); then
        log_success "tsx is available for running TypeScript"
    else
        log_warn "tsx may not be available"
    fi
}

# Test 4: UI server startup (quick test)
test_ui_server_startup() {
    log_step "Test 4: UI server startup test"

    local ui_dir="$RALPH_CLI_DIR/ui"
    local test_port=13000

    log_info "Attempting to start UI server on port $test_port (will timeout after 10s)..."

    # Start server in background
    (
        cd "$ui_dir"
        export RALPH_ROOT="$TEST_PROJECT_DIR"
        export PORT="$test_port"
        npx tsx src/server.ts > /tmp/ralph-ui-test.log 2>&1
    ) &

    local server_pid=$!

    # Set up a timeout killer in background
    (
        sleep 10
        kill $server_pid 2>/dev/null || true
    ) &
    local timeout_pid=$!

    # Wait for server to start (max 8 seconds)
    local waited=0
    local max_wait=8
    local server_started=false

    while [ $waited -lt $max_wait ]; do
        if curl -s "http://localhost:$test_port/api/status" >/dev/null 2>&1; then
            server_started=true
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # Kill the server and timeout process
    kill $server_pid 2>/dev/null || true
    kill $timeout_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true
    wait $timeout_pid 2>/dev/null || true

    if [ "$server_started" = true ]; then
        log_success "UI server started successfully"
    else
        log_error "UI server failed to start within ${max_wait}s"
        log_info "Check /tmp/ralph-ui-test.log for details"
        return 1
    fi
}

# Test 5: Interactive prompts simulation
test_interactive_prompts() {
    log_step "Test 5: Interactive installation prompts"

    log_info "Checking if install script supports interactive mode..."

    # Check if install.sh has interactive prompts
    local install_script="$RALPH_CLI_DIR/install.sh"

    if [ -f "$install_script" ]; then
        if grep -q "read -p" "$install_script"; then
            log_success "install.sh has interactive prompts"
        else
            log_warn "install.sh may not have interactive prompts"
        fi
    else
        log_error "install.sh not found"
        return 1
    fi

    # Check if ralph install supports interactive mode
    if grep -q "@clack/prompts" "$RALPH_CLI_DIR/lib/commands/install.js"; then
        log_success "ralph install uses interactive prompts (@clack/prompts)"
    else
        log_warn "ralph install may not have interactive prompts"
    fi
}

# Test 6: Skills installation
test_skills_installation() {
    log_step "Test 6: Skills installation"

    cd "$TEST_PROJECT_DIR"

    # Test skills directory
    local skills_dir="$RALPH_CLI_DIR/skills"

    if [ -d "$skills_dir" ]; then
        log_success "Skills directory exists"
    else
        log_error "Skills directory not found"
        return 1
    fi

    # Check for key skills
    local key_skills=("commit" "dev-browser" "prd")

    for skill in "${key_skills[@]}"; do
        if [ -d "$skills_dir/$skill" ]; then
            log_success "Skill found: $skill"
        else
            log_warn "Skill not found: $skill"
        fi
    done
}

# Test 7: Documentation availability
test_documentation() {
    log_step "Test 7: Documentation and guides"

    # Check for key documentation files
    local doc_files=(
        "$RALPH_CLI_DIR/README.md"
        "$RALPH_CLI_DIR/CLAUDE.md"
        "$RALPH_CLI_DIR/docs/guides/testing/TESTING.md"
    )

    for doc in "${doc_files[@]}"; do
        if [ -f "$doc" ]; then
            log_success "Found: $(basename "$doc")"
        else
            log_warn "Missing: $(basename "$doc")"
        fi
    done
}

# Print summary
print_summary() {
    log_step "Test Summary"

    echo ""
    echo -e "${BOLD}Results:${NC}"
    echo -e "  ${GREEN}Passed:${NC}   $PASSED"
    echo -e "  ${RED}Failed:${NC}   $FAILED"
    echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}${BOLD}✓ All critical tests passed!${NC}"

        if [ $WARNINGS -gt 0 ]; then
            echo -e "${YELLOW}⚠ Some warnings were raised - review above${NC}"
        fi

        return 0
    else
        echo -e "${RED}${BOLD}✗ Some tests failed - review above${NC}"
        return 1
    fi
}

# Main test flow
main() {
    print_banner

    log_info "Test directory: $TEST_DIR"
    log_info "This test will create a temporary installation and clean up after"
    echo ""

    check_prerequisites
    test_global_install || true
    test_project_install || true
    test_ui_dependencies || true
    test_ui_server_startup || true
    test_interactive_prompts || true
    test_skills_installation || true
    test_documentation || true

    echo ""
    print_summary
    local exit_code=$?

    echo ""
    log_info "Test environment will be cleaned up automatically"

    exit $exit_code
}

# Run tests
main "$@"
