/**
 * Navigation functionality for Ralph CLI Docs
 * Handles sidebar, ToC, search, breadcrumbs, and mobile menu
 */

(function() {
  'use strict';

  // ========================================
  // Collapsible Sidebar
  // ========================================
  function initSidebar() {
    const sidebar = document.querySelector('.docs-sidebar');
    if (!sidebar) return;

    // Collapse/expand sections
    const titles = sidebar.querySelectorAll('.docs-sidebar-title');
    titles.forEach(title => {
      title.addEventListener('click', () => {
        title.classList.toggle('collapsed');
        const items = title.nextElementSibling;
        if (items && items.classList.contains('docs-sidebar-items')) {
          items.classList.toggle('collapsed');

          // Store state in localStorage
          const sectionId = title.textContent.trim();
          const isCollapsed = title.classList.contains('collapsed');
          localStorage.setItem(`sidebar-${sectionId}`, isCollapsed);
        }
      });
    });

    // Restore collapsed state from localStorage
    titles.forEach(title => {
      const sectionId = title.textContent.trim();
      const isCollapsed = localStorage.getItem(`sidebar-${sectionId}`) === 'true';
      if (isCollapsed) {
        title.classList.add('collapsed');
        const items = title.nextElementSibling;
        if (items && items.classList.contains('docs-sidebar-items')) {
          items.classList.add('collapsed');
        }
      }
    });

    // Set max-height for smooth animation
    const itemLists = sidebar.querySelectorAll('.docs-sidebar-items');
    itemLists.forEach(list => {
      if (!list.classList.contains('collapsed')) {
        list.style.maxHeight = list.scrollHeight + 'px';
      }
    });

    // Highlight active page
    highlightActivePage();
  }

  function highlightActivePage() {
    const currentPath = window.location.pathname;
    const links = document.querySelectorAll('.docs-sidebar-link, .docs-header-link');

    links.forEach(link => {
      const linkPath = new URL(link.href).pathname;
      if (linkPath === currentPath) {
        link.classList.add('active');

        // Expand parent section if in sidebar
        if (link.classList.contains('docs-sidebar-link')) {
          const section = link.closest('.docs-sidebar-section');
          if (section) {
            const title = section.querySelector('.docs-sidebar-title');
            const items = section.querySelector('.docs-sidebar-items');
            if (title && items) {
              title.classList.remove('collapsed');
              items.classList.remove('collapsed');
              items.style.maxHeight = items.scrollHeight + 'px';
            }
          }
        }
      }
    });
  }

  // ========================================
  // Table of Contents
  // ========================================
  function initTableOfContents() {
    const toc = document.querySelector('.docs-toc-list');
    if (!toc) return;

    // Generate ToC from page headings
    const content = document.querySelector('.docs-main-content, main');
    if (!content) return;

    const headings = content.querySelectorAll('h2, h3');
    if (headings.length === 0) return;

    toc.innerHTML = '';
    headings.forEach((heading, index) => {
      const level = heading.tagName.toLowerCase();
      const text = heading.textContent;
      const id = heading.id || `heading-${index}`;

      // Ensure heading has an ID for anchor links
      if (!heading.id) {
        heading.id = id;
      }

      const item = document.createElement('li');
      item.className = `docs-toc-item level-${level.charAt(1)}`;

      const link = document.createElement('a');
      link.className = 'docs-toc-link';
      link.href = `#${id}`;
      link.textContent = text;

      item.appendChild(link);
      toc.appendChild(item);
    });

    // Highlight active section on scroll
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            const tocLinks = toc.querySelectorAll('.docs-toc-link');
            tocLinks.forEach(link => {
              if (link.getAttribute('href') === `#${id}`) {
                tocLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
              }
            });
          }
        });
      },
      {
        rootMargin: '-100px 0px -80% 0px'
      }
    );

    headings.forEach(heading => {
      observer.observe(heading);
    });

    // Smooth scroll for ToC links
    toc.addEventListener('click', (e) => {
      if (e.target.classList.contains('docs-toc-link')) {
        e.preventDefault();
        const targetId = e.target.getAttribute('href').slice(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          const headerHeight = 80;
          const elementPosition = targetElement.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerHeight;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }
    });
  }

  // ========================================
  // Global Search
  // ========================================
  function initGlobalSearch() {
    const searchOverlay = document.querySelector('.docs-global-search');
    const searchInput = document.querySelector('.docs-global-search .docs-search-input');
    const searchResults = document.querySelector('.docs-search-results');

    if (!searchOverlay || !searchInput) return;

    // Search index (in production, this would come from a JSON file)
    const searchIndex = [
      {
        title: 'Getting Started',
        path: '/docs/',
        excerpt: 'Learn how to install and set up Ralph CLI for your projects.',
        keywords: ['install', 'setup', 'start', 'begin', 'introduction']
      },
      {
        title: 'Interactive Tutorial',
        path: '/docs/tutorial.html',
        excerpt: 'Step-by-step guide to your first Ralph build with real examples.',
        keywords: ['tutorial', 'learn', 'guide', 'walkthrough', 'example']
      },
      {
        title: 'Command Reference',
        path: '/docs/commands.html',
        excerpt: 'Complete reference for all Ralph CLI commands with examples.',
        keywords: ['command', 'reference', 'cli', 'prd', 'plan', 'build', 'stream']
      },
      {
        title: 'Examples Gallery',
        path: '/docs/examples.html',
        excerpt: 'Real examples of Ralph builds from actual projects.',
        keywords: ['example', 'showcase', 'demo', 'case study', 'real']
      },
      {
        title: 'Tips & Best Practices',
        path: '/docs/tips.html',
        excerpt: 'Pro tips, common mistakes, and workflow optimization techniques.',
        keywords: ['tips', 'tricks', 'best practices', 'optimize', 'workflow']
      },
      {
        title: 'Troubleshooting',
        path: '/docs/troubleshooting.html',
        excerpt: 'Solutions to common issues and diagnostic guides.',
        keywords: ['troubleshoot', 'error', 'problem', 'fix', 'help', 'issue']
      }
    ];

    // Open search with keyboard shortcut (Cmd/Ctrl + K)
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
      }

      // Close with Escape
      if (e.key === 'Escape' && searchOverlay.classList.contains('active')) {
        closeSearch();
      }
    });

    // Close on overlay click
    searchOverlay.addEventListener('click', (e) => {
      if (e.target === searchOverlay) {
        closeSearch();
      }
    });

    // Search input handler
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      performSearch(query);
    });

    function openSearch() {
      searchOverlay.classList.add('active');
      searchInput.focus();
    }

    function closeSearch() {
      searchOverlay.classList.remove('active');
      searchInput.value = '';
      searchResults.innerHTML = '';
    }

    function performSearch(query) {
      if (!query) {
        searchResults.innerHTML = '<div class="docs-search-empty">Type to search documentation...</div>';
        return;
      }

      const results = searchIndex.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(query);
        const excerptMatch = item.excerpt.toLowerCase().includes(query);
        const keywordMatch = item.keywords.some(k => k.includes(query));
        return titleMatch || excerptMatch || keywordMatch;
      });

      if (results.length === 0) {
        searchResults.innerHTML = '<div class="docs-search-empty">No results found for "' + query + '"</div>';
        return;
      }

      searchResults.innerHTML = results.map(result => `
        <a href="${result.path}" class="docs-search-result-item">
          <div class="docs-search-result-title">${highlightMatch(result.title, query)}</div>
          <div class="docs-search-result-excerpt">${highlightMatch(result.excerpt, query)}</div>
          <div class="docs-search-result-path">${result.path}</div>
        </a>
      `).join('');
    }

    function highlightMatch(text, query) {
      const regex = new RegExp(`(${query})`, 'gi');
      return text.replace(regex, '<mark style="background: var(--docs-gold-light); color: var(--docs-text-primary); padding: 0 2px; border-radius: 2px;">$1</mark>');
    }

    // Add search trigger button to header if not exists
    addSearchTrigger();
  }

  function addSearchTrigger() {
    const header = document.querySelector('.docs-header-nav');
    if (!header || document.querySelector('.docs-search-trigger')) return;

    const trigger = document.createElement('button');
    trigger.className = 'docs-search-trigger';
    trigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      <span>Search</span>
      <kbd class="docs-search-kbd">⌘K</kbd>
    `;
    trigger.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--docs-bg-secondary);
      border: 1px solid var(--docs-border-light);
      border-radius: 6px;
      color: var(--docs-text-secondary);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;

    trigger.addEventListener('click', () => {
      document.querySelector('.docs-global-search').classList.add('active');
      document.querySelector('.docs-global-search .docs-search-input').focus();
    });

    header.appendChild(trigger);
  }

  // ========================================
  // Mobile Hamburger Menu
  // ========================================
  function initMobileMenu() {
    const hamburger = document.querySelector('.docs-hamburger');
    const sidebar = document.querySelector('.docs-sidebar');
    const overlay = document.querySelector('.docs-mobile-overlay');

    if (!hamburger || !sidebar) return;

    hamburger.addEventListener('click', () => {
      const isActive = hamburger.classList.contains('active');

      if (isActive) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    if (overlay) {
      overlay.addEventListener('click', closeMobileMenu);
    }

    function openMobileMenu() {
      hamburger.classList.add('active');
      sidebar.classList.add('active');
      if (overlay) overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeMobileMenu() {
      hamburger.classList.remove('active');
      sidebar.classList.remove('active');
      if (overlay) overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    // Close menu on navigation
    sidebar.addEventListener('click', (e) => {
      if (e.target.classList.contains('docs-sidebar-link')) {
        closeMobileMenu();
      }
    });
  }

  // ========================================
  // Breadcrumb Navigation
  // ========================================
  function initBreadcrumbs() {
    const breadcrumb = document.querySelector('.docs-breadcrumb');
    if (!breadcrumb) return;

    // Breadcrumbs are typically rendered server-side or by template
    // This function adds any dynamic behavior if needed

    // Example: highlight current page
    const currentItems = breadcrumb.querySelectorAll('.docs-breadcrumb-current');
    currentItems.forEach(item => {
      item.setAttribute('aria-current', 'page');
    });
  }

  // ========================================
  // Previous/Next Navigation
  // ========================================
  function initPageNavigation() {
    const pageNav = document.querySelector('.docs-page-nav');
    if (!pageNav) return;

    // Add keyboard navigation
    const navItems = pageNav.querySelectorAll('.docs-page-nav-item');
    navItems.forEach(item => {
      item.setAttribute('tabindex', '0');

      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        }
      });
    });
  }

  // ========================================
  // Initialize All
  // ========================================
  function init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    initSidebar();
    initTableOfContents();
    initGlobalSearch();
    initMobileMenu();
    initBreadcrumbs();
    initPageNavigation();

    // Smooth scroll for all anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href').slice(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          const headerHeight = 80;
          const elementPosition = targetElement.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerHeight;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      });
    });
  }

  // Start initialization
  init();

})();
