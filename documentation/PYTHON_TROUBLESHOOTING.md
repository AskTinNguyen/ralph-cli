# Python Troubleshooting Guide

## Windows-Specific Issues

### Error: "python3: command not found" or "python: command not found"

**Cause**: Python not installed OR not in PATH.

**Solution**:
1. **Install Python**:
   - Download from [python.org](https://www.python.org/downloads/)
   - During installation: **CHECK "Add to PATH"** checkbox
   - Restart Git Bash/Terminal

2. **Verify Installation**:
   ```bash
   python --version   # Should show Python 3.8+
   # OR
   python3 --version  # May work if you added symlink
   ```

3. **If Python installed but command not found**:
   - Add Python to PATH manually:
     - Search "Environment Variables" in Windows
     - Edit "Path" variable
     - Add `C:\Python3X` and `C:\Python3X\Scripts` (replace X with your version)
   - Restart terminal

### Git Bash Doesn't Include Python

**Important**: Git for Windows includes Git Bash but NOT Python. You must install Python separately.

Ralph will auto-detect these commands (in order):
1. `python3` (preferred on Mac/Linux)
2. `python` (standard on Windows)
3. `py -3` (Windows Python Launcher)

**No manual symlink needed** - Ralph detects available commands automatically.

## Mac/Linux Issues

### Error: "python3: command not found"

**Mac**:
```bash
brew install python3
# OR download from python.org
```

**Linux**:
```bash
# Debian/Ubuntu
sudo apt install python3

# RedHat/CentOS
sudo yum install python3
```

## Version Issues

### Python 2 vs Python 3

Ralph requires Python 3.8 or higher. Check your version:

```bash
python --version   # Windows
python3 --version  # Mac/Linux
```

If you have Python 2.x, install Python 3:
- Windows: python.org installer
- Mac: `brew install python3`
- Linux: `sudo apt install python3`

## Virtual Environment / Conda Issues

Ralph uses the Python found in your PATH. If you have conda/virtualenv:

**To use specific Python**:
```bash
# Activate environment first
conda activate myenv
# OR
source venv/bin/activate

# Then run Ralph
ralph build 5
```

Ralph will use the active environment's Python automatically.

## Verification Commands

Test if Ralph can find Python:
```bash
# This should print "python" or "python3"
command -v python || command -v python3 || command -v py

# Check Python works
python -c "import json; print('OK')"
```

If these commands work, Ralph should work.

## Still Having Issues?

1. Check Ralph's error message - it shows platform-specific install instructions
2. Make sure Git Bash is up to date
3. Try running Ralph with `bash -x` for debug output:
   ```bash
   bash -x .agents/ralph/loop.sh
   ```
4. Report issue at: https://github.com/AskTinNguyen/ralph-cli/issues
