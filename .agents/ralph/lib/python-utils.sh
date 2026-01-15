#!/bin/bash
# Cross-platform Python detection
# Detects python3, python, or py -3 (Windows Python Launcher)
# Exports PYTHON_CMD variable for use by other scripts

detect_python_command() {
  # Try python3 first (Unix/Mac standard)
  if command -v python3 >/dev/null 2>&1; then
    python3 --version >/dev/null 2>&1 && echo "python3" && return 0
  fi

  # Try python (Windows standard + some Unix)
  if command -v python >/dev/null 2>&1; then
    # Verify it's Python 3.x
    local version
    version=$(python --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
    if [[ -n "$version" && "${version%%.*}" -ge 3 ]]; then
      echo "python"
      return 0
    fi
  fi

  # Try Windows Python Launcher
  if command -v py >/dev/null 2>&1; then
    py -3 --version >/dev/null 2>&1 && echo "py -3" && return 0
  fi

  echo ""
  return 1
}

# Export Python command (detect once at load time)
PYTHON_CMD=$(detect_python_command)
export PYTHON_CMD

# Backward compatibility flag
if [[ -z "$PYTHON_CMD" ]]; then
  PYTHON3_AVAILABLE=false
else
  PYTHON3_AVAILABLE=true
fi
export PYTHON3_AVAILABLE

# Helper to show platform-specific error message
show_python_error() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "ERROR: Python 3.8+ is required but not found." >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "" >&2

  # Detect OS and show appropriate instructions
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows (Git Bash)
    echo "📥 Install Python for Windows:" >&2
    echo "   1. Download from: https://www.python.org/downloads/" >&2
    echo "   2. Run installer and CHECK 'Add to PATH'" >&2
    echo "   3. Restart Git Bash/Terminal" >&2
    echo "   4. Verify: python --version" >&2
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "📥 Install Python on Mac:" >&2
    echo "   brew install python3" >&2
    echo "   OR download from: https://www.python.org/downloads/" >&2
  else
    # Linux
    echo "📥 Install Python on Linux:" >&2
    echo "   sudo apt install python3  # Debian/Ubuntu" >&2
    echo "   sudo yum install python3   # RedHat/CentOS" >&2
  fi

  echo "" >&2
  echo "For help: https://github.com/AskTinNguyen/ralph-cli#prerequisites" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
}

# Validate Python availability and show error if missing
validate_python() {
  if [[ "$PYTHON3_AVAILABLE" = "false" ]]; then
    show_python_error
    return 1
  fi
  return 0
}
