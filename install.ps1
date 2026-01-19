# Ralph CLI - One-Command Installer for Windows
# Usage: iwr -useb https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.ps1 | iex
#
# This script will:
# 1. Check for required dependencies (Node.js, npm, git)
# 2. Install missing dependencies (via winget or chocolatey)
# 3. Clone ralph-cli repository
# 4. Install npm dependencies
# 5. Link ralph globally

#Requires -Version 5.1

$ErrorActionPreference = "Stop"

# Configuration
$RalphRepo = "https://github.com/AskTinNguyen/ralph-cli.git"
$RalphDir = if ($env:RALPH_INSTALL_DIR) { $env:RALPH_INSTALL_DIR } else { Join-Path $env:USERPROFILE "ralph-cli" }
$MinNodeVersion = 18

# Colors and formatting
function Write-ColorOutput($ForegroundColor, $Message) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    Write-Output $Message
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Info($Message) { Write-ColorOutput Blue "[INFO] $Message" }
function Write-Success($Message) { Write-ColorOutput Green "[OK] $Message" }
function Write-Warn($Message) { Write-ColorOutput Yellow "[WARN] $Message" }
function Write-Err($Message) { Write-ColorOutput Red "[ERROR] $Message" }
function Write-Step($Message) { Write-Output ""; Write-ColorOutput Cyan "==> $Message" }

# Banner
function Show-Banner {
    Write-ColorOutput Cyan @"

    ____        __      __       _________    ____
   / __ \____ _/ /___  / /_     / ____/ /   /  _/
  / /_/ / __ `/ / __ \/ __ \   / /   / /    / /
 / _, _/ /_/ / / /_/ / / / /  / /___/ /____/ /
/_/ |_|\__,_/_/ .___/_/ /_/   \____/_____/___/
             /_/

"@
    Write-Output "One-Command Installer for Windows"
    Write-Output ""
}

# Check if command exists
function Test-Command($Command) {
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Get Node.js major version
function Get-NodeVersion {
    if (Test-Command "node") {
        $version = (node -v) -replace 'v', ''
        [int]($version.Split('.')[0])
    } else {
        0
    }
}

# Check if winget is available
function Test-Winget {
    Test-Command "winget"
}

# Check if chocolatey is available
function Test-Chocolatey {
    Test-Command "choco"
}

# Install Chocolatey
function Install-Chocolatey {
    Write-Step "Installing Chocolatey Package Manager"
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# Install Node.js
function Install-Node {
    Write-Step "Installing Node.js"

    if (Test-Winget) {
        Write-Info "Installing Node.js via winget..."
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    } elseif (Test-Chocolatey) {
        Write-Info "Installing Node.js via Chocolatey..."
        choco install nodejs-lts -y
    } else {
        Write-Warn "No package manager found. Installing Chocolatey first..."
        Install-Chocolatey

        Write-Info "Installing Node.js via Chocolatey..."
        choco install nodejs-lts -y
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    # Verify installation
    if (-not (Test-Command "node")) {
        Write-Err "Node.js installation failed"
        Write-Info "Please install Node.js manually from https://nodejs.org"
        Write-Info "After installing, restart PowerShell and run this script again"
        exit 1
    }

    Write-Success "Node.js installed: $(node -v)"
}

# Install Git
function Install-Git {
    Write-Step "Installing Git"

    if (Test-Winget) {
        Write-Info "Installing Git via winget..."
        winget install Git.Git --silent --accept-package-agreements --accept-source-agreements
    } elseif (Test-Chocolatey) {
        Write-Info "Installing Git via Chocolatey..."
        choco install git -y
    } else {
        Write-Warn "No package manager found. Installing Chocolatey first..."
        Install-Chocolatey

        Write-Info "Installing Git via Chocolatey..."
        choco install git -y
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    # Verify installation
    if (-not (Test-Command "git")) {
        Write-Err "Git installation failed"
        Write-Info "Please install Git manually from https://git-scm.com"
        Write-Info "After installing, restart PowerShell and run this script again"
        exit 1
    }

    Write-Success "Git installed: $(git --version)"
}

# Check dependencies
function Test-Dependencies {
    Write-Step "Checking dependencies"

    $missing = @()

    # Check Git
    if (Test-Command "git") {
        Write-Success "Git: $(git --version)"
    } else {
        Write-Warn "Git: Not found"
        $missing += "git"
    }

    # Check Node.js
    $nodeVersion = Get-NodeVersion
    if ($nodeVersion -ge $MinNodeVersion) {
        Write-Success "Node.js: $(node -v)"
    } else {
        if ($nodeVersion -gt 0) {
            Write-Warn "Node.js: v$nodeVersion (need v$MinNodeVersion+)"
        } else {
            Write-Warn "Node.js: Not found"
        }
        $missing += "node"
    }

    # Check npm
    if (Test-Command "npm") {
        Write-Success "npm: $(npm -v)"
    } else {
        Write-Warn "npm: Not found (will be installed with Node.js)"
        if ($missing -notcontains "node") {
            $missing += "node"
        }
    }

    return $missing
}

# Install missing dependencies
function Install-Dependencies($deps) {
    if ($deps.Count -eq 0) {
        Write-Success "All dependencies satisfied"
        return
    }

    Write-Step "Installing missing dependencies: $($deps -join ', ')"

    # Check for package manager
    if (-not (Test-Winget) -and -not (Test-Chocolatey)) {
        Write-Info "No package manager found (winget or chocolatey)"
        $response = Read-Host "Install Chocolatey? [Y/n]"
        if ($response -notmatch '^[Nn]') {
            Install-Chocolatey
        } else {
            Write-Err "Cannot proceed without a package manager"
            exit 1
        }
    }

    foreach ($dep in $deps) {
        switch ($dep) {
            "git" { Install-Git }
            "node" { Install-Node }
        }
    }
}

# Clone or update ralph-cli
function Install-RalphRepository {
    Write-Step "Setting up Ralph CLI"

    if (Test-Path $RalphDir) {
        Write-Info "Ralph CLI directory exists at $RalphDir"
        $response = Read-Host "Update existing installation? [Y/n]"
        if ($response -notmatch '^[Nn]') {
            Write-Info "Updating Ralph CLI..."
            Push-Location $RalphDir
            git fetch origin
            git pull origin main 2>$null
            if ($LASTEXITCODE -ne 0) {
                git pull origin master
            }
            Pop-Location
        }
    } else {
        Write-Info "Cloning Ralph CLI to $RalphDir..."
        git clone $RalphRepo $RalphDir
    }
}

# Install npm dependencies and link
function Install-RalphCLI {
    Write-Step "Installing Ralph CLI"

    Push-Location $RalphDir

    Write-Info "Installing npm dependencies..."
    npm install

    Write-Info "Linking ralph globally..."
    npm link

    Pop-Location

    Write-Success "Ralph CLI installed successfully!"
}

# Verify installation with comprehensive checks
function Test-Installation {
    Write-Step "Verifying installation"

    # Refresh PATH to pick up npm global bin
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $checks = @{
        "ralph_available" = $false
        "ralph_help" = $false
        "git_config" = $false
        "templates_exist" = $false
    }

    # Check 1: ralph command available
    if (Test-Command "ralph") {
        Write-Success "ralph command is available"
        $checks["ralph_available"] = $true
    } else {
        Write-Warn "ralph command not found in PATH"
        Write-Info "You may need to:"
        Write-Output "  1. Restart PowerShell"
        Write-Output "  2. Ensure npm global bin is in PATH"

        # Try to find npm global path
        $npmPrefix = npm config get prefix 2>$null
        if ($npmPrefix) {
            Write-Info "Add to PATH: $npmPrefix"
        }
    }

    # Check 2: ralph help works
    if ($checks["ralph_available"]) {
        try {
            $helpOutput = ralph --help 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "ralph help command works"
                $checks["ralph_help"] = $true
            } else {
                Write-Warn "ralph help command failed"
            }
        } catch {
            Write-Warn "ralph help command failed: $_"
        }
    }

    # Check 3: Git is configured
    $gitUserName = git config --global user.name 2>$null
    $gitUserEmail = git config --global user.email 2>$null
    if ($gitUserName -and $gitUserEmail) {
        Write-Success "Git configured: $gitUserName <$gitUserEmail>"
        $checks["git_config"] = $true
    } else {
        Write-Warn "Git user not fully configured"
        if (-not $gitUserName) {
            Write-Info "  Run: git config --global user.name 'Your Name'"
        }
        if (-not $gitUserEmail) {
            Write-Info "  Run: git config --global user.email 'your@email.com'"
        }
    }

    # Check 4: Templates directory exists
    $templatesDir = Join-Path $RalphDir ".agents" "ralph"
    if (Test-Path $templatesDir) {
        Write-Success "Templates directory exists: $templatesDir"
        $checks["templates_exist"] = $true
    } else {
        Write-Warn "Templates directory not found: $templatesDir"
    }

    # Summary
    Write-Output ""
    Write-ColorOutput Cyan "Installation Summary:"
    $passedChecks = ($checks.Values | Where-Object { $_ -eq $true }).Count
    $totalChecks = $checks.Count

    foreach ($check in $checks.GetEnumerator()) {
        $status = if ($check.Value) { "[PASS]" } else { "[WARN]" }
        $color = if ($check.Value) { "Green" } else { "Yellow" }
        $name = $check.Key -replace "_", " "
        Write-ColorOutput $color "  $status $name"
    }

    Write-Output ""
    if ($passedChecks -eq $totalChecks) {
        Write-ColorOutput Green "All checks passed ($passedChecks/$totalChecks)"
    } else {
        Write-ColorOutput Yellow "$passedChecks/$totalChecks checks passed"
    }

    # Show ralph help output if available
    if ($checks["ralph_help"]) {
        Write-Output ""
        ralph --help | Select-Object -First 20
    }
}

# Check available agents
function Test-Agents {
    Write-Step "Checking available agents"

    $agentLinks = @{
        "claude" = "https://claude.ai/download"
        "codex" = "https://openai.com/codex"
        "droid" = "https://factory.ai"
    }

    $foundAgents = @()
    $missingAgents = @()

    # Check Claude Code (claude command)
    if (Test-Command "claude") {
        Write-Success "Claude Code: Available"
        $foundAgents += "claude"
    } else {
        Write-Warn "Claude Code: Not found"
        $missingAgents += "claude"
    }

    # Check Codex (codex command)
    if (Test-Command "codex") {
        Write-Success "Codex: Available"
        $foundAgents += "codex"
    } else {
        Write-Warn "Codex: Not found"
        $missingAgents += "codex"
    }

    # Check Droid (droid command)
    if (Test-Command "droid") {
        Write-Success "Droid: Available"
        $foundAgents += "droid"
    } else {
        Write-Warn "Droid: Not found"
        $missingAgents += "droid"
    }

    Write-Output ""

    if ($foundAgents.Count -gt 0) {
        Write-ColorOutput Green "Found $($foundAgents.Count) agent(s): $($foundAgents -join ', ')"
    }

    if ($missingAgents.Count -gt 0 -and $foundAgents.Count -eq 0) {
        Write-ColorOutput Yellow "No agents found. Install at least one:"
        foreach ($agent in $missingAgents) {
            Write-Output "  - $agent`: $($agentLinks[$agent])"
        }
    } elseif ($missingAgents.Count -gt 0) {
        Write-Info "Optional agents available:"
        foreach ($agent in $missingAgents) {
            Write-Output "  - $agent`: $($agentLinks[$agent])"
        }
    }
}

# Show auto-speak setup guidance
function Show-AutoSpeakSetup {
    Write-Output ""
    Write-ColorOutput Cyan "============================================="
    Write-ColorOutput White "  Auto-Speak Available"
    Write-ColorOutput Cyan "============================================="
    Write-Output ""
    Write-Output "Ralph can speak Claude's responses using TTS."
    Write-Output ""

    Write-ColorOutput White "Dependencies:"

    # Check Ollama
    if (Test-Command "ollama") {
        # Check for qwen model
        $ollamaList = ollama list 2>$null
        if ($ollamaList -match "qwen2.5:1.5b") {
            Write-ColorOutput Green "  [OK] Ollama with qwen2.5:1.5b (ready)"
        } else {
            Write-ColorOutput Yellow "  [  ] Ollama installed, but missing qwen2.5:1.5b"
            Write-ColorOutput Cyan "       Run: ollama pull qwen2.5:1.5b"
        }
    } else {
        Write-ColorOutput Yellow "  [  ] Ollama (not installed)"
        Write-ColorOutput Cyan "       Visit: https://ollama.com/install"
    }

    # Check jq
    if (Test-Command "jq") {
        Write-ColorOutput Green "  [OK] jq (installed)"
    } else {
        Write-ColorOutput Yellow "  [  ] jq (not installed)"
        if (Test-Winget) {
            Write-ColorOutput Cyan "       Run: winget install jqlang.jq"
        } elseif (Test-Chocolatey) {
            Write-ColorOutput Cyan "       Run: choco install jq"
        } else {
            Write-ColorOutput Cyan "       Install via winget or chocolatey"
        }
    }

    # Check TTS provider (Windows has SAPI built-in)
    Write-ColorOutput Green "  [OK] TTS (Windows SAPI available)"
    Write-Output ""

    Write-ColorOutput White "Setup:"
    Write-Output "  1. Install missing dependencies (see above)"
    Write-ColorOutput Cyan "  2. Run: cd your-project; ralph install"
    Write-Output "  3. Add hooks to Claude Code config"
    Write-ColorOutput Cyan "  4. Run: ralph speak --auto-on"
    Write-Output ""

    Write-ColorOutput White "Documentation:"
    Write-ColorOutput Cyan "  $RalphDir\docs\VOICE.md"
    Write-Output ""
}

# Print post-install instructions
function Show-Instructions {
    Write-Output ""
    Write-ColorOutput Green "Installation Complete!"
    Write-Output ""
    Write-Output "Quick Start:"
    Write-ColorOutput Cyan "  cd your-project"
    Write-ColorOutput Cyan "  ralph install          # Install Ralph templates"
    Write-ColorOutput Cyan "  ralph prd              # Generate a PRD"
    Write-ColorOutput Cyan "  ralph plan             # Create implementation plan"
    Write-ColorOutput Cyan "  ralph build 5          # Run 5 build iterations"
    Write-Output ""
    Write-Output "Documentation:"
    Write-ColorOutput Cyan "  ralph help             # Show all commands"
    Write-ColorOutput Cyan "  https://github.com/AskTinNguyen/ralph-cli"
    Write-Output ""

    # Note about bash requirement
    Write-Output "Note for Windows users:"
    Write-Output "  Ralph's build scripts require bash. Options:"
    Write-Output "  1. Git Bash (installed with Git)"
    Write-Output "  2. WSL (Windows Subsystem for Linux)"
    Write-Output "  3. Use Windows Terminal with Git Bash profile"
    Write-Output ""
}

# Main installation flow
function Main {
    Show-Banner

    Write-Info "Detected: Windows $([Environment]::Is64BitOperatingSystem ? 'x64' : 'x86')"
    Write-Output ""

    # Check admin privileges for package installation
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warn "Not running as Administrator. Package installation may require elevated privileges."
        Write-Info "If installation fails, try running PowerShell as Administrator"
        Write-Output ""
    }

    # Check dependencies
    $missing = Test-Dependencies

    # Install missing dependencies
    if ($missing.Count -gt 0) {
        $response = Read-Host "Install missing dependencies? [Y/n]"
        if ($response -notmatch '^[Nn]') {
            Install-Dependencies $missing
        } else {
            Write-Err "Cannot proceed without required dependencies"
            exit 1
        }
    }

    # Clone ralph-cli
    Install-RalphRepository

    # Install and link
    Install-RalphCLI

    # Verify
    Test-Installation

    # Check agents
    Test-Agents

    # Auto-speak setup
    Show-AutoSpeakSetup

    # Instructions
    Show-Instructions
}

# Run main
Main
