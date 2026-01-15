/**
 * Sidebar Toggle Functionality
 * Click on the Ralph logo to collapse/expand the sidebar.
 * Logo flips upside down when sidebar is collapsed.
 */

// Toggle sidebar collapsed state
function toggleSidebar() {
  var sidebar = document.getElementById('rams-sidebar');
  var body = document.body;

  if (!sidebar) return;

  sidebar.classList.toggle('collapsed');
  body.classList.toggle('sidebar-collapsed');

  // Store state in localStorage
  var isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed);
}

// Initialize sidebar state from localStorage on page load
(function initSidebar() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applySidebarState);
  } else {
    applySidebarState();
  }

  function applySidebarState() {
    var isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      var sidebar = document.getElementById('rams-sidebar');
      var body = document.body;
      if (sidebar) {
        sidebar.classList.add('collapsed');
        body.classList.add('sidebar-collapsed');
      }
    }
  }
})();
