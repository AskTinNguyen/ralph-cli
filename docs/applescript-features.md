# AppleScript Features - What's Possible

## ✅ Currently Implemented

- **Basic app control**: open, close, quit, activate
- **Window management**: hide, show, minimize, fullscreen
- **Media controls**: play, pause, stop, next, previous (Spotify/Music)
- **System volume**: volume up/down, mute
- **Running apps detection**: Check if apps are running

---

## 🚀 High-Value Features (Recommended Next)

### 1. **Browser Control** (Safari, Chrome)
**Use cases**: Voice-driven web navigation, productivity

```applescript
# Open URL
tell application "Safari" to open location "https://google.com"

# New tab
tell application "Safari" to make new document

# Refresh page
tell application "Safari" to do JavaScript "location.reload()" in current tab

# Navigate history
tell application "Safari" to go back
tell application "Safari" to go forward

# Close tab
tell application "Safari" to close current tab
```

**Voice commands**:
- "open google.com"
- "new tab"
- "refresh page"
- "go back"
- "close tab"

---

### 2. **Clipboard & Text Manipulation**
**Use cases**: Copy/paste, text selection, clipboard history

```applescript
# Copy selected text
tell application "System Events" to keystroke "c" using command down

# Paste from clipboard
tell application "System Events" to keystroke "v" using command down

# Get clipboard content
the clipboard

# Set clipboard content
set the clipboard to "Hello World"

# Select all
tell application "System Events" to keystroke "a" using command down
```

**Voice commands**:
- "copy that"
- "paste"
- "select all"
- "what's on the clipboard"

---

### 3. **Window Positioning & Multi-Monitor**
**Use cases**: Window tiling, multi-monitor workflows

```applescript
# Move window to left half
tell application "System Events" to tell process "Chrome"
    set position of window 1 to {0, 25}
    set size of window 1 to {960, 1055}
end tell

# Move to right half
tell application "System Events" to tell process "Chrome"
    set position of window 1 to {960, 25}
    set size of window 1 to {960, 1055}
end tell

# Move to next display
tell application "System Events" to keystroke "m" using {command down, option down}

# Center window
tell application "System Events" to tell process "Chrome"
    set {screenWidth, screenHeight} to size of window 1 of desktop
    set position of window 1 to {(screenWidth - width) / 2, (screenHeight - height) / 2}
end tell
```

**Voice commands**:
- "move window to left"
- "snap window right"
- "center window"
- "move to next display"
- "fullscreen mode"

---

### 4. **System Notifications**
**Use cases**: Voice feedback, reminders, alerts

```applescript
# Simple notification
display notification "Build complete!" with title "Ralph CLI"

# With subtitle and sound
display notification "5 stories completed" with title "Ralph Build" subtitle "PRD-3" sound name "Glass"

# With action buttons (macOS 10.14+)
display notification "Tests failed" with title "Ralph CLI" buttons {"Retry", "Cancel"}
```

**Voice commands**:
- "remind me in 10 minutes"
- "notify when build finishes"
- "alert me when done"

---

### 5. **Finder Operations**
**Use cases**: File navigation, folder management

```applescript
# Open folder
tell application "Finder" to open folder "Documents" of home

# New Finder window
tell application "Finder" to make new Finder window

# Search in Finder
tell application "Finder" to search folder "Documents" of home for "*.js"

# Go to specific path
tell application "Finder" to open POSIX file "/Users/username/Projects"

# Get current folder
tell application "Finder" to get POSIX path of (target of front window as alias)

# Eject all disks
tell application "Finder" to eject (every disk whose ejectable is true)
```

**Voice commands**:
- "open documents folder"
- "new finder window"
- "go to projects"
- "search for javascript files"
- "eject all drives"

---

### 6. **Keyboard Shortcuts & Custom Combos**
**Use cases**: Trigger any app functionality via shortcuts

```applescript
# Cmd+Shift+P (VS Code command palette)
tell application "System Events" to keystroke "p" using {command down, shift down}

# Multiple keystrokes
tell application "System Events"
    keystroke "k" using command down
    keystroke "t" using command down
end tell

# Function keys
tell application "System Events" to key code 122 # F11

# Arrow keys
tell application "System Events" to key code 124 # Right arrow
```

**Voice commands**:
- "command palette"
- "open terminal" (Cmd+Shift+T)
- "save file"
- "undo"

---

## 🎯 Productivity Features

### 7. **Calendar & Reminders**
```applescript
# Create calendar event
tell application "Calendar"
    tell calendar "Work"
        make new event with properties {summary:"Team Meeting", start date:date "Monday, 1/20/2026 2:00:00 PM"}
    end tell
end tell

# Get today's events
tell application "Calendar"
    get summary of events of calendar "Work" whose start date > (current date)
end tell

# Create reminder
tell application "Reminders"
    tell list "Work"
        make new reminder with properties {name:"Review PR", due date:date "1/21/2026"}
    end tell
end tell
```

**Voice commands**:
- "add meeting at 2pm tomorrow"
- "what's on my calendar today"
- "remind me to review PR"

---

### 8. **Messages (iMessage)**
```applescript
# Send message
tell application "Messages"
    send "Hey, running late!" to buddy "John Doe"
end tell

# Send to phone number
tell application "Messages"
    send "Meeting in 5" to participant "+1234567890"
end tell
```

**Voice commands**:
- "text John hey running late"
- "send message to mom"

---

### 9. **Mail**
```applescript
# Send email
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"Quick update", content:"Status report attached", visible:true}
    tell newMessage
        make new to recipient with properties {address:"colleague@company.com"}
    end tell
    send newMessage
end tell

# Get unread count
tell application "Mail"
    count (messages of inbox whose read status is false)
end tell
```

**Voice commands**:
- "send email to [name]"
- "how many unread emails"
- "check inbox"

---

### 10. **Screenshot**
```applescript
# Screenshot entire screen
do shell script "screencapture ~/Desktop/screenshot.png"

# Screenshot specific window (interactive)
do shell script "screencapture -w ~/Desktop/window.png"

# Screenshot selection
do shell script "screencapture -i ~/Desktop/selection.png"

# Copy to clipboard
do shell script "screencapture -c"
```

**Voice commands**:
- "take screenshot"
- "capture window"
- "screenshot selection"

---

## 🔧 System Control Features

### 11. **Display & Brightness**
```applescript
# Set brightness (requires sudo/permissions)
do shell script "brightness 0.5"

# Toggle Night Shift
tell application "System Events"
    tell appearance preferences
        set dark mode to not dark mode
    end tell
end tell
```

**Voice commands**:
- "dim screen"
- "brighten screen"
- "toggle dark mode"

---

### 12. **Focus Modes / Do Not Disturb**
```applescript
# Enable Do Not Disturb (macOS Monterey+)
do shell script "shortcuts run 'Turn on Do Not Disturb'"

# Or via System Events
tell application "System Events"
    tell process "Control Center"
        click menu bar item "Do Not Disturb"
    end tell
end tell
```

**Voice commands**:
- "enable do not disturb"
- "turn on focus mode"

---

### 13. **Spotlight Search**
```applescript
# Open Spotlight
tell application "System Events" to keystroke space using command down

# Search for file
tell application "System Events"
    keystroke space using command down
    delay 0.2
    keystroke "meeting notes"
end tell
```

**Voice commands**:
- "spotlight search for [query]"
- "find file [name]"

---

### 14. **Mission Control / Exposé**
```applescript
# Show all windows (Mission Control)
tell application "System Events" to key code 126 using control down

# Show desktop
tell application "System Events" to key code 103 # F11

# Application windows
tell application "System Events" to keystroke tab using control down
```

**Voice commands**:
- "show all windows"
- "show desktop"
- "app windows"

---

## 📱 App-Specific Automation

### 15. **VS Code / Cursor**
```applescript
# Open file
tell application "Visual Studio Code"
    open "/path/to/file.js"
end tell

# Run command
do shell script "code --goto /path/to/file.js:42:10"

# Open terminal in VS Code
tell application "System Events" to tell process "Visual Studio Code"
    keystroke "`" using control down
end tell
```

**Voice commands**:
- "open file in vscode"
- "go to line 42"
- "open terminal"

---

### 16. **Slack**
```applescript
# Send message to channel
tell application "Slack"
    activate
end tell
tell application "System Events"
    keystroke "k" using command down
    keystroke "#general"
    keystroke return
    keystroke "Hello team!"
    keystroke return
end tell
```

**Voice commands**:
- "message #general channel"
- "send slack message"

---

### 17. **Zoom**
```applescript
# Join meeting
tell application "zoom.us"
    activate
end tell
tell application "System Events"
    keystroke "j" using {command down, control down}
    keystroke "123456789"
    keystroke return
end tell

# Toggle mute
tell application "System Events" to tell process "zoom.us"
    keystroke "a" using {command down, shift down}
end tell
```

**Voice commands**:
- "join zoom meeting [ID]"
- "toggle mute"
- "leave meeting"

---

## 🎨 Advanced Features

### 18. **Dock Management**
```applescript
# Show/hide Dock
tell application "System Events"
    tell dock preferences
        set autohide to true
    end tell
end tell

# Add app to Dock
do shell script "defaults write com.apple.dock persistent-apps -array-add '<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>/Applications/Safari.app</string></dict></dict></dict>'"
do shell script "killall Dock"
```

---

### 19. **System Preferences Panes**
```applescript
# Open specific preference pane
tell application "System Preferences"
    reveal pane id "com.apple.preference.sound"
    activate
end tell

# Common pane IDs:
# - com.apple.preference.sound (Sound)
# - com.apple.preference.network (Network)
# - com.apple.preference.displays (Displays)
# - com.apple.preference.security (Security & Privacy)
```

**Voice commands**:
- "open sound settings"
- "open network preferences"

---

## 💡 Recommended Implementation Priority

Based on usefulness and frequency:

1. **🥇 Window Management** - Snap left/right, center, multi-monitor
2. **🥈 Browser Control** - Open URLs, navigate, tabs
3. **🥉 Clipboard** - Copy/paste voice feedback
4. **4️⃣ Finder** - Navigate folders, open locations
5. **5️⃣ Notifications** - System alerts for Ralph builds
6. **6️⃣ Calendar/Reminders** - Quick event creation
7. **7️⃣ Screenshot** - Quick captures
8. **8️⃣ Messages** - Send quick texts
9. **9️⃣ Focus Modes** - Do Not Disturb control
10. **🔟 Keyboard Shortcuts** - Universal app control

---

## 🛠️ Implementation Approach

Each feature would need:

1. **AppleScript function** in `applescript-executor.ts`
2. **Intent pattern** in Stage 1 regex detection
3. **Entity extraction** in Stage 2 for parameters
4. **Safety checks** (permissions, validation)
5. **Tests** for reliability

---

## 🤔 Which Features Interest You Most?

I'd recommend starting with:
- **Window management** (very useful for productivity)
- **Browser control** (common use case)
- **Notifications** (integrate with Ralph builds!)

Would you like me to implement any of these? Let me know which ones sound most useful to you!
