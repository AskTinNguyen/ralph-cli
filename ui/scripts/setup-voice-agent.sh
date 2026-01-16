#!/bin/bash
# Voice Agent Setup Script
# Run from ui/ directory: ./scripts/setup-voice-agent.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UI_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Voice Agent Setup"
echo "========================================"
echo ""

# Check we're in the right directory
if [[ ! -f "$UI_DIR/package.json" ]]; then
    echo "Error: Run this script from the ui/ directory"
    exit 1
fi

cd "$UI_DIR"

# Step 1: Check Python
echo "1. Checking Python..."
if ! command -v python3 &> /dev/null; then
    echo "   ERROR: Python3 not found. Please install Python 3.10+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
echo "   Found: $PYTHON_VERSION"

# Step 2: Install Python dependencies
echo ""
echo "2. Installing Python dependencies..."
if [[ ! -d "python/venv" ]]; then
    echo "   Creating virtual environment..."
    python3 -m venv python/venv
fi
source python/venv/bin/activate
pip install -q --upgrade pip
pip install -q -r python/requirements.txt
echo "   Python dependencies installed"

# Step 3: Check Ollama
echo ""
echo "3. Checking Ollama..."
if ! command -v ollama &> /dev/null; then
    echo "   ERROR: Ollama not found."
    echo "   Install from: https://ollama.ai"
    exit 1
fi
echo "   Found: $(ollama --version)"

# Step 4: Check/pull qwen2.5 model
echo ""
echo "4. Checking qwen2.5 model..."
if ! ollama list | grep -q "qwen2.5"; then
    echo "   Pulling qwen2.5 model (this may take a few minutes)..."
    ollama pull qwen2.5
else
    echo "   qwen2.5 model already available"
fi

# Step 5: Install Node dependencies
echo ""
echo "5. Checking Node.js dependencies..."
if [[ ! -d "node_modules" ]]; then
    echo "   Installing Node.js dependencies..."
    npm install
else
    echo "   Node.js dependencies already installed"
fi

echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "To start the voice agent, run these commands in separate terminals:"
echo ""
echo "  Terminal 1 (STT Server):"
echo "    cd $UI_DIR"
echo "    source python/venv/bin/activate"
echo "    python python/stt_server.py"
echo ""
echo "  Terminal 2 (Ollama - if not running):"
echo "    ollama serve"
echo ""
echo "  Terminal 3 (UI Server):"
echo "    cd $UI_DIR"
echo "    npm run dev"
echo ""
echo "Then open: http://localhost:3000/voice.html"
echo ""
