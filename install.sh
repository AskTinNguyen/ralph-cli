#!/bin/bash
# Ralph CLI - One-Command Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh | bash
#
# This script will:
# 1. Check for required dependencies (Node.js, npm, git)
# 2. Install missing dependencies (with user confirmation)
# 3. Clone ralph-cli repository
# 4. Install npm dependencies
# 5. Link ralph globally

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
RALPH_REPO="https://github.com/AskTinNguyen/ralph-cli.git"
RALPH_DIR="${RALPH_INSTALL_DIR:-$HOME/ralph-cli}"
MIN_NODE_VERSION=18

# Print functions
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step() { echo -e "\n${CYAN}${BOLD}==> $1${NC}"; }

# Banner
print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
    ____        __      __       _________    ____
   / __ \____ _/ /___  / /_     / ____/ /   /  _/
  / /_/ / __ `/ / __ \/ __ \   / /   / /    / /
 / _, _/ /_/ / / /_/ / / / /  / /___/ /____/ /
/_/ |_|\__,_/_/ .___/_/ /_/   \____/_____/___/
             /_/
EOF
    echo -e "${NC}"
    echo -e "${BOLD}One-Command Installer${NC}"
    echo ""
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) OS="macos" ;;
        Linux*)  OS="linux" ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *) OS="unknown" ;;
    esac

    # Detect architecture
    case "$(uname -m)" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) ARCH="x64" ;;
    esac
}

# Check if command exists
has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# Get Node.js version number
get_node_version() {
    if has_cmd node; then
        node -v 2>/dev/null | sed 's/v//' | cut -d. -f1
    else
        echo "0"
    fi
}

# Check Node.js version
check_node_version() {
    local version
    version=$(get_node_version)
    if [ "$version" -ge "$MIN_NODE_VERSION" ]; then
        return 0
    else
        return 1
    fi
}

# Install Node.js via package manager or nvm
install_node() {
    step "Installing Node.js"

    if [ "$OS" = "macos" ]; then
        if has_cmd brew; then
            info "Installing Node.js via Homebrew..."
            brew install node
        else
            warn "Homebrew not found. Installing via nvm..."
            install_node_via_nvm
        fi
    elif [ "$OS" = "linux" ]; then
        # Try to detect distro and use appropriate package manager
        if has_cmd apt-get; then
            info "Installing Node.js via apt (NodeSource)..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif has_cmd dnf; then
            info "Installing Node.js via dnf..."
            sudo dnf install -y nodejs npm
        elif has_cmd yum; then
            info "Installing Node.js via yum (NodeSource)..."
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
        elif has_cmd pacman; then
            info "Installing Node.js via pacman..."
            sudo pacman -S --noconfirm nodejs npm
        else
            warn "No supported package manager found. Installing via nvm..."
            install_node_via_nvm
        fi
    else
        install_node_via_nvm
    fi
}

# Install Node.js via nvm (fallback)
install_node_via_nvm() {
    info "Installing nvm (Node Version Manager)..."

    # Install nvm
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

    # Load nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    # Install latest LTS Node.js
    nvm install --lts
    nvm use --lts

    success "Node.js installed via nvm"
    warn "You may need to restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
}

# Install Homebrew (macOS)
install_homebrew() {
    step "Installing Homebrew"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to PATH for Apple Silicon Macs
    if [ "$ARCH" = "arm64" ] && [ -f "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
    fi
}

# Install Git
install_git() {
    step "Installing Git"

    if [ "$OS" = "macos" ]; then
        if has_cmd brew; then
            brew install git
        else
            # Xcode Command Line Tools includes git
            xcode-select --install 2>/dev/null || true
            info "Git will be installed with Xcode Command Line Tools"
        fi
    elif [ "$OS" = "linux" ]; then
        if has_cmd apt-get; then
            sudo apt-get update && sudo apt-get install -y git
        elif has_cmd dnf; then
            sudo dnf install -y git
        elif has_cmd yum; then
            sudo yum install -y git
        elif has_cmd pacman; then
            sudo pacman -S --noconfirm git
        fi
    fi
}

# Check all dependencies
check_dependencies() {
    step "Checking dependencies"

    local missing_deps=()

    # Check Git
    if has_cmd git; then
        success "Git: $(git --version)"
    else
        missing_deps+=("git")
        warn "Git: Not found"
    fi

    # Check Node.js
    if has_cmd node && check_node_version; then
        success "Node.js: $(node -v)"
    else
        if has_cmd node; then
            warn "Node.js: $(node -v) (need v${MIN_NODE_VERSION}+)"
        else
            warn "Node.js: Not found"
        fi
        missing_deps+=("node")
    fi

    # Check npm
    if has_cmd npm; then
        success "npm: $(npm -v)"
    else
        warn "npm: Not found (will be installed with Node.js)"
        if [[ ! " ${missing_deps[*]} " =~ " node " ]]; then
            missing_deps+=("node")
        fi
    fi

    echo "${missing_deps[@]}"
}

# Install missing dependencies
install_dependencies() {
    local deps=("$@")

    if [ ${#deps[@]} -eq 0 ]; then
        success "All dependencies satisfied"
        return 0
    fi

    step "Installing missing dependencies: ${deps[*]}"

    # On macOS, prefer Homebrew
    if [ "$OS" = "macos" ] && ! has_cmd brew; then
        read -p "Homebrew is recommended for installing dependencies. Install Homebrew? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            install_homebrew
        fi
    fi

    for dep in "${deps[@]}"; do
        case "$dep" in
            git)
                install_git
                ;;
            node)
                install_node
                ;;
        esac
    done

    # Verify installation
    if ! has_cmd node || ! check_node_version; then
        error "Node.js installation failed or version too old"
        error "Please install Node.js v${MIN_NODE_VERSION}+ manually: https://nodejs.org"
        exit 1
    fi

    if ! has_cmd git; then
        error "Git installation failed"
        error "Please install Git manually: https://git-scm.com"
        exit 1
    fi
}

# Clone or update ralph-cli
clone_ralph() {
    step "Setting up Ralph CLI"

    if [ -d "$RALPH_DIR" ]; then
        info "Ralph CLI directory exists at $RALPH_DIR"
        read -p "Update existing installation? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            info "Updating Ralph CLI..."
            cd "$RALPH_DIR"
            git fetch origin
            git pull origin main || git pull origin master
        fi
    else
        info "Cloning Ralph CLI to $RALPH_DIR..."
        git clone "$RALPH_REPO" "$RALPH_DIR"
    fi
}

# Install npm dependencies and link
install_ralph() {
    step "Installing Ralph CLI"

    cd "$RALPH_DIR"

    info "Installing npm dependencies..."
    npm install

    info "Linking ralph globally..."
    npm link

    success "Ralph CLI installed successfully!"
}

# Verify installation
verify_installation() {
    step "Verifying installation"

    if has_cmd ralph; then
        success "ralph command is available"
        echo ""
        ralph --help | head -20
    else
        warn "ralph command not found in PATH"
        info "You may need to:"
        echo "  1. Restart your terminal"
        echo "  2. Add npm global bin to PATH: export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
    fi
}

# Print post-install instructions
print_instructions() {
    echo ""
    echo -e "${GREEN}${BOLD}Installation Complete!${NC}"
    echo ""
    echo "Quick Start:"
    echo -e "  ${CYAN}cd your-project${NC}"
    echo -e "  ${CYAN}ralph install${NC}          # Install Ralph templates"
    echo -e "  ${CYAN}ralph prd${NC}              # Generate a PRD"
    echo -e "  ${CYAN}ralph plan${NC}             # Create implementation plan"
    echo -e "  ${CYAN}ralph build 5${NC}          # Run 5 build iterations"
    echo ""
    echo "Documentation:"
    echo -e "  ${CYAN}ralph help${NC}             # Show all commands"
    echo -e "  ${CYAN}https://github.com/AskTinNguyen/ralph-cli${NC}"
    echo ""
}

# Main installation flow
main() {
    print_banner
    detect_os

    info "Detected: $OS ($ARCH)"
    echo ""

    # Check if running in a pipe (non-interactive)
    if [ ! -t 0 ]; then
        info "Running in non-interactive mode"
        NONINTERACTIVE=1
    else
        NONINTERACTIVE=0
    fi

    # Check dependencies
    missing=($(check_dependencies))

    # Install missing dependencies
    if [ ${#missing[@]} -gt 0 ] && [ "${missing[0]}" != "" ]; then
        if [ "$NONINTERACTIVE" = "1" ]; then
            info "Installing missing dependencies automatically..."
            install_dependencies "${missing[@]}"
        else
            read -p "Install missing dependencies? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                install_dependencies "${missing[@]}"
            else
                error "Cannot proceed without required dependencies"
                exit 1
            fi
        fi
    fi

    # Clone ralph-cli
    clone_ralph

    # Install and link
    install_ralph

    # Verify
    verify_installation

    # Instructions
    print_instructions
}

# Run main
main "$@"
