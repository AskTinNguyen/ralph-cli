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

# Verify installation
function Test-Installation {
    Write-Step "Verifying installation"

    # Refresh PATH to pick up npm global bin
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Command "ralph") {
        Write-Success "ralph command is available"
        Write-Output ""
        ralph --help | Select-Object -First 20
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

    # Instructions
    Show-Instructions
}

# Run main
Main
