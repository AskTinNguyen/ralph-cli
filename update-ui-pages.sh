#!/bin/bash

# Update all remaining Ralph UI pages with Rams design system

# Helper function to create page with sidebar
create_page_with_sidebar() {
  local page_name=$1
  local page_title=$2
  local active_link=$3
  local breadcrumb=$4

  cat > "ui/public/${page_name}.html" << 'HTMLEOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ralph CLI - PAGETITLE</title>
  <link rel="stylesheet" href="/css/rams-ui.css">
  <script src="/js/htmx.min.js"></script>
</head>
<body class="rams-page">

  <!-- Persistent Sidebar -->
  <aside class="rams-sidebar">
    <div class="rams-sidebar-header">
      <div class="rams-logo">
        <div class="rams-logo-mark"></div>
        <span class="rams-logo-text">RALPH</span>
      </div>
    </div>

    <nav class="rams-nav">
      <div class="rams-nav-section">
        <div class="rams-nav-label">Main</div>
        <ul class="rams-nav-items">
          <li><a href="/" class="rams-nav-link ACTIVE_DASHBOARD">Dashboard</a></li>
          <li><a href="/streams.html" class="rams-nav-link ACTIVE_STREAMS">Streams</a></li>
        </ul>
      </div>

      <div class="rams-nav-section">
        <div class="rams-nav-label">Monitoring</div>
        <ul class="rams-nav-items">
          <li><a href="/logs.html" class="rams-nav-link ACTIVE_LOGS">Logs</a></li>
          <li><a href="/tokens.html" class="rams-nav-link ACTIVE_TOKENS">Tokens</a></li>
          <li><a href="/trends.html" class="rams-nav-link ACTIVE_TRENDS">Trends</a></li>
        </ul>
      </div>

      <div class="rams-nav-section">
        <div class="rams-nav-label">Tools</div>
        <ul class="rams-nav-items">
          <li><a href="/editor.html" class="rams-nav-link ACTIVE_EDITOR">Editor</a></li>
          <li><a href="/chat.html" class="rams-nav-link ACTIVE_CHAT">Chat</a></li>
        </ul>
      </div>
    </nav>

    <div class="rams-sidebar-footer">
      <div class="rams-version">v1.0.0</div>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="rams-main">

    <!-- Top Bar -->
    <div class="rams-topbar">
      <div class="rams-breadcrumb">
        <span class="rams-breadcrumb-current">BREADCRUMB</span>
      </div>
      <div class="rams-topbar-actions">
        <!-- Add page-specific actions here -->
      </div>
    </div>

    <!-- Content Area -->
    <article class="rams-content">
      <div
        id="page-content"
        hx-get="/api/partials/PAGENAME-content"
        hx-trigger="load"
        hx-swap="innerHTML"
      >
        <div class="rams-loading">
          <span class="rams-spinner"></span> Loading PAGETITLE...
        </div>
      </div>
    </article>

  </main>

  <script>
    // Page-specific JavaScript here
  </script>
</body>
</html>
HTMLEOF

  # Replace placeholders
  sed -i '' "s/PAGETITLE/${page_title}/g" "ui/public/${page_name}.html"
  sed -i '' "s/BREADCRUMB/${breadcrumb}/g" "ui/public/${page_name}.html"
  sed -i '' "s/PAGENAME/${page_name}/g" "ui/public/${page_name}.html"
  sed -i '' "s/ ACTIVE_${active_link}/ active/g" "ui/public/${page_name}.html"
  sed -i '' "s/ ACTIVE_[A-Z]*//g" "ui/public/${page_name}.html"
}

# Update each page
create_page_with_sidebar "logs" "Logs" "LOGS" "Logs"
create_page_with_sidebar "tokens" "Token Usage" "TOKENS" "Tokens"
create_page_with_sidebar "trends" "Trends" "TRENDS" "Trends"
create_page_with_sidebar "editor" "Editor" "EDITOR" "Editor"
create_page_with_sidebar "chat" "Chat" "CHAT" "Chat"

echo "✅ All UI pages updated with Rams design system"
