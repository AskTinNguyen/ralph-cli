# Ralph CLI Design System

## Overview

Ralph uses the **Rams Design System** - a minimalist, Dieter Rams-inspired design system with precise typography, subtle colors, and timeless elegance.

## File Locations

The design system CSS exists in **two locations**:

### 1. `/ui/public/docs/rams-design-system.css` (Primary - UI Server)
- Used by the UI server at `http://localhost:3000`
- Served to all documentation pages
- **This is the source of truth**

### 2. `/docs/docs/rams-design-system.css` (Mirror - Static Docs)
- Used when docs are served statically (e.g., GitHub Pages)
- **Should always mirror ui/public version**

## Why Two Files?

The duplication serves different deployment contexts:

- **UI Server Context** (`ui/public/docs/`) - Dynamic Next.js server with `/docs` route
- **Static Docs Context** (`docs/docs/`) - Standalone static site deployment

## Keeping Files in Sync

**IMPORTANT**: When updating the design system, update BOTH files:

```bash
# After editing ui/public/docs/rams-design-system.css
cp ui/public/docs/rams-design-system.css docs/docs/rams-design-system.css

# Or verify they're identical
diff ui/public/docs/rams-design-system.css docs/docs/rams-design-system.css
```

## Design System Features

### Core Variables (CSS Custom Properties)

```css
/* Typography */
--rams-font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display'...
--rams-font-mono: 'SF Mono', 'Menlo', 'Monaco'...

/* Colors */
--rams-accent: #1A4D2E  /* Deep forest green */
--rams-gray-50 through --rams-gray-900

/* Spacing (4px system) */
--rams-space-1: 4px
--rams-space-2: 8px
...up to --rams-space-12: 48px

/* Typography Scale */
--rams-text-xs: 0.75rem (12px)
--rams-text-sm: 0.875rem (14px)
--rams-text-base: 1rem (16px)
...up to --rams-text-4xl: 2.25rem (36px)

/* Layout */
--rams-sidebar-width: 260px
--rams-topbar-height: 81px
```

### Layout System

**Sidebar + Main Layout:**
- Fixed sidebar (260px width)
- Collapsible to 56px (icon-only mode)
- Main content area with automatic margin adjustment
- Sticky topbar (81px height)

**Sidebar Collapse Interaction:**
```javascript
// Click logo to toggle
document.querySelector('.rams-logo-mark').onclick = toggleSidebar;

// Logo rotates 180° when collapsed
.rams-sidebar.collapsed .rams-logo-mark { transform: rotate(180deg); }
```

### Compact Layout Variant

For reference-style pages (like Agent Guide), use the `.rams-compact` class:

```html
<body class="rams-page rams-compact">
```

This applies:
- Tighter spacing (12px/24px instead of 20px/32px)
- Smaller typography (13px base instead of 16px)
- Reduced margins/padding throughout
- Optimized for dense information display

### Typography Classes

```html
<!-- Headings -->
<h1 class="rams-h1">Main Title</h1>
<h2 class="rams-h2">Section Title</h2>
<h3 class="rams-h3">Subsection Title</h3>

<!-- Body Text -->
<p class="rams-text">Regular paragraph</p>
<p class="rams-text-sm">Small text</p>
<p class="rams-lead">Lead paragraph (intro text)</p>

<!-- Code -->
<code class="rams-code-inline">inline code</code>
<div class="rams-code-block">...</div>
```

### Component Classes

**Info Boxes:**
```html
<div class="rams-info-box">
  <div class="rams-info-icon">i</div>
  <div class="rams-info-content">
    <div class="rams-info-title">Note</div>
    <p class="rams-text">Content here</p>
  </div>
</div>
```

**Feature Cards:**
```html
<div class="rams-card-grid">
  <div class="rams-feature-card">
    <div class="rams-feature-icon">🎯</div>
    <h3 class="rams-h3">Feature Title</h3>
    <p class="rams-text">Description</p>
  </div>
</div>
```

**Navigation:**
```html
<nav class="rams-nav">
  <div class="rams-nav-section">
    <div class="rams-nav-label">Section</div>
    <ul class="rams-nav-items">
      <li><a href="#" class="rams-nav-link active">Active Link</a></li>
      <li><a href="#" class="rams-nav-link">Link</a></li>
    </ul>
  </div>
</nav>
```

## Customization Guidelines

### When to Edit the Design System

✅ **DO:**
- Add new utility classes (`.rams-*`)
- Extend color palette with new semantic colors
- Add component variants (`.rams-btn-tertiary`)
- Create new layout utilities

❌ **DON'T:**
- Change core variable values (breaks consistency)
- Add non-`rams-*` prefixed classes
- Use `!important` (except for print styles)
- Create inline styles (use classes instead)

### Adding New Components

1. Follow the Rams naming convention: `.rams-[component]-[variant]`
2. Use CSS custom properties for all values
3. Include hover/active/focus states
4. Add comments explaining complex interactions
5. Test in both regular and compact modes

Example:
```css
/* ========================================
   Alert Component
   ======================================== */
.rams-alert {
  padding: var(--rams-space-4);
  border: var(--rams-border-width) solid var(--rams-border-color);
  border-radius: var(--rams-radius-md);
  border-left: 3px solid var(--rams-accent);
}

.rams-alert-warning {
  border-left-color: var(--rams-warning);
  background: rgba(245, 158, 11, 0.04);
}

.rams-alert-error {
  border-left-color: var(--rams-error);
  background: rgba(239, 68, 68, 0.04);
}
```

## Accessibility

The design system includes:
- Focus-visible outlines (2px accent color)
- Prefers-reduced-motion support
- Semantic HTML structure
- ARIA-friendly navigation
- Sufficient color contrast ratios

## Dark Mode Support

Logo swaps to B&W version:
```css
@media (prefers-color-scheme: dark) {
  .rams-logo-mark {
    background-image: url('/ralph-logo-bw.png');
  }
}
```

Note: Full dark mode theming is not yet implemented.

## Responsive Breakpoints

```css
@media (max-width: 1024px) { /* Tablet */ }
@media (max-width: 768px) { /* Mobile */ }
```

Mobile behavior:
- Sidebar transforms off-screen
- Topbar becomes hamburger menu
- Main content spans full width
- Compact spacing on all elements

## Testing Changes

After modifying the design system:

1. **Verify both files are identical:**
   ```bash
   diff ui/public/docs/rams-design-system.css docs/docs/rams-design-system.css
   ```

2. **Test in UI server:**
   ```bash
   cd ui && npm run dev
   # Visit http://localhost:3000/docs/agent-guide.html
   ```

3. **Test sidebar collapse:**
   - Click logo mark
   - Verify smooth transition
   - Check logo rotation
   - Verify nav hides/shows

4. **Test compact mode:**
   - Visit agent-guide.html
   - Verify tighter spacing
   - Check no visual regressions

5. **Test responsive:**
   - Resize browser to mobile width
   - Verify sidebar behavior
   - Check touch interactions

## Version History

- **v1.0.0** - Initial Rams design system
- **v1.1.0** - Added sidebar collapse functionality
- **v1.2.0** - Added compact layout variant
- **v1.2.1** - Synchronized both CSS files, removed inline styles from agent-guide.html
