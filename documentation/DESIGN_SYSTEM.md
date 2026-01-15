# Ralph CLI Design System
## Dieter Rams + Intercontinental Hotel Aesthetic

**Created:** 2026-01-15
**Applied to:** Documentation site (`ui/public/docs/*`)
**Next target:** Ralph UI frontend for observations

---

## Design Philosophy

### Core Principle: "Less but better" (Dieter Rams)

**Dieter Rams' 10 Principles of Good Design:**
1. Good design is innovative
2. Good design makes a product useful
3. Good design is aesthetic
4. Good design makes a product understandable
5. Good design is unobtrusive
6. Good design is honest
7. Good design is long-lasting (timeless)
8. Good design is thorough down to the last detail
9. Good design is environmentally friendly
10. Good design is as little design as possible

### Visual Language

- **Swiss Precision**: Tight spacing, perfect alignment, systematic layouts
- **Functional Minimalism**: Every element serves a purpose, no decoration
- **Intercontinental Elegance**: Refined neutrals, understated luxury, timeless sophistication
- **Information Density**: Maximize content, minimize whitespace (but maintain breathing room)
- **Constant Wayfinding**: Persistent navigation, always know where you are

---

## Design System Reference

### Color Palette

```css
/* Neutral Grays - Primary palette */
--rams-white: #FFFFFF;
--rams-gray-50: #FAFAFA;
--rams-gray-100: #F5F5F5;
--rams-gray-200: #E5E5E5;
--rams-gray-300: #D4D4D4;
--rams-gray-400: #A3A3A3;
--rams-gray-500: #737373;
--rams-gray-600: #525252;
--rams-gray-700: #404040;
--rams-gray-800: #262626;
--rams-gray-900: #171717;
--rams-black: #000000;

/* Accent Color - Deep Forest Green (Intercontinental elegance) */
--rams-accent: #1A4D2E;           /* Primary green */
--rams-accent-light: #2D6A4F;     /* Hover state */
--rams-accent-lighter: #52B788;   /* Subtle highlights */
--rams-accent-dark: #0F2D1A;      /* Deep shadow */

/* Functional Colors */
--rams-success: #10B981;
--rams-warning: #F59E0B;
--rams-error: #EF4444;
--rams-info: #3B82F6;
```

**Usage:**
- **Backgrounds**: White (#FFFFFF) for content, Gray-50/100 for sections
- **Text**: Gray-900 for primary, Gray-700 for secondary, Gray-500 for muted
- **Accents**: Deep forest green for CTAs, active states, links
- **Borders**: Gray-200 for subtle, Gray-300 for emphasis

---

### Typography

```css
/* Font Families */
--rams-font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
--rams-font-mono: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;

/* Type Scale */
--rams-text-xs: 0.75rem;      /* 12px */
--rams-text-sm: 0.875rem;     /* 14px */
--rams-text-base: 1rem;       /* 16px */
--rams-text-lg: 1.125rem;     /* 18px */
--rams-text-xl: 1.25rem;      /* 20px */
--rams-text-2xl: 1.5rem;      /* 24px */
--rams-text-3xl: 1.875rem;    /* 30px */
--rams-text-4xl: 2.25rem;     /* 36px */

/* Line Heights */
--rams-leading-tight: 1.25;
--rams-leading-snug: 1.375;
--rams-leading-normal: 1.5;
--rams-leading-relaxed: 1.625;

/* Letter Spacing - CRITICAL for Rams aesthetic */
--rams-tracking-tight: -0.02em;   /* Headlines, body text */
--rams-tracking-normal: 0;
--rams-tracking-wide: 0.01em;     /* Small caps, labels */
```

**Key Principle:** Use **system fonts** for native feel and performance. Apply **tight letter spacing** (-0.02em) to body text for Swiss precision.

---

### Spacing System

**Precise 4px Grid:**

```css
--rams-space-1: 4px;    /* 0.25rem */
--rams-space-2: 8px;    /* 0.5rem */
--rams-space-3: 12px;   /* 0.75rem */
--rams-space-4: 16px;   /* 1rem */
--rams-space-5: 20px;   /* 1.25rem */
--rams-space-6: 24px;   /* 1.5rem */
--rams-space-8: 32px;   /* 2rem */
--rams-space-10: 40px;  /* 2.5rem */
--rams-space-12: 48px;  /* 3rem */
```

**Usage:**
- **Tight spacing**: Use space-2 to space-4 for component internals
- **Section spacing**: Use space-6 to space-10 for between sections
- **Page padding**: Use space-8 for main content areas
- **Never use arbitrary values** - stick to the 4px grid

---

### Layout Patterns

#### 1. Persistent Sidebar Navigation

```css
.rams-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 260px;  /* Fixed width */
  height: 100vh;
  background: var(--rams-white);
  border-right: 1px solid var(--rams-border-color);
  overflow-y: auto;
}

.rams-main {
  margin-left: 260px;  /* Offset by sidebar width */
}
```

**Key Features:**
- Always visible on desktop (use `transform: translateX(-100%)` to hide on mobile)
- Logo at top
- Hierarchical navigation with sections
- Active state with green accent and left border
- Version number in footer

#### 2. Top Bar with Breadcrumbs

```css
.rams-topbar {
  height: 56px;
  background: var(--rams-white);
  border-bottom: 1px solid var(--rams-border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--rams-space-8);
  position: sticky;
  top: 0;
  z-index: 50;
}
```

**Contains:**
- Breadcrumb navigation (left)
- Search/action buttons (right)

#### 3. Content Area

```css
.rams-content {
  padding: var(--rams-space-8);
  max-width: 920px;  /* Readable line length */
}
```

---

### Component Patterns

#### Buttons

```css
.rams-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--rams-space-2);
  padding: var(--rams-space-3) var(--rams-space-6);
  font-size: var(--rams-text-sm);
  font-weight: 500;
  border-radius: var(--rams-radius-md);  /* 4px */
  cursor: pointer;
  transition: all var(--rams-transition-fast);
  border: 1px solid transparent;
}

.rams-btn-primary {
  background: var(--rams-accent);
  color: var(--rams-white);
  border-color: var(--rams-accent);
}

.rams-btn-secondary {
  background: var(--rams-white);
  color: var(--rams-gray-900);
  border-color: var(--rams-border-color);
}
```

**Variants:**
- Primary: Green background, white text (CTAs)
- Secondary: White background, gray border (secondary actions)
- Icon: 36x36px square with icon only

#### Cards

```css
.rams-card {
  background: var(--rams-white);
  border: 1px solid var(--rams-border-color);
  border-radius: var(--rams-radius-lg);  /* 6px */
  padding: var(--rams-space-6);
  transition: all var(--rams-transition-normal);
}

.rams-card:hover {
  border-color: var(--rams-accent);
  box-shadow: var(--rams-shadow-sm);
}
```

#### Code Blocks

```css
.rams-code-block {
  background: var(--rams-gray-900);
  border-radius: var(--rams-radius-md);
  overflow: hidden;
  border: 1px solid var(--rams-gray-800);
}

.rams-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rams-space-3) var(--rams-space-4);
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.rams-code-content {
  padding: var(--rams-space-4);
  overflow-x: auto;
}

.rams-code-content pre {
  margin: 0;
  font-family: var(--rams-font-mono);
  font-size: var(--rams-text-sm);
  line-height: 1.6;
  color: #E5E5E5;
}
```

**Key Features:**
- Dark background (gray-900)
- Header with language label and copy button
- Monospace font
- Horizontal scroll for long lines

#### Info Boxes

```css
.rams-info-box {
  display: flex;
  gap: var(--rams-space-4);
  padding: var(--rams-space-4);
  background: rgba(26, 77, 46, 0.04);  /* Light green tint */
  border: 1px solid rgba(26, 77, 46, 0.15);
  border-radius: var(--rams-radius-md);
  border-left: 3px solid var(--rams-accent);  /* Green accent strip */
}
```

---

### Border Radius

**Minimal curves for precision:**

```css
--rams-radius-sm: 2px;   /* Small elements */
--rams-radius-md: 4px;   /* Buttons, inputs, cards */
--rams-radius-lg: 6px;   /* Large cards */
```

**Never use:** Large radius values (>8px). Keep corners subtle and precise.

---

### Shadows

**Subtle and refined:**

```css
--rams-shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--rams-shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
--rams-shadow-md: 0 2px 4px 0 rgba(0, 0, 0, 0.1);
--rams-shadow-lg: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
```

**Usage:**
- Default: No shadow or shadow-xs
- Hover states: shadow-sm
- Elevated cards: shadow-md
- Modals/overlays: shadow-lg

---

### Transitions

```css
--rams-transition-fast: 100ms cubic-bezier(0.4, 0, 0.2, 1);
--rams-transition-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1);
```

**Keep animations subtle and fast.** No flashy effects.

---

## Implementation Guidelines for Ralph UI

### 1. Structure

```html
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
      <!-- Navigation sections -->
    </nav>

    <div class="rams-sidebar-footer">
      <div class="rams-version">v1.0.0</div>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="rams-main">
    <!-- Top Bar -->
    <div class="rams-topbar">
      <div class="rams-breadcrumb">...</div>
      <div class="rams-topbar-actions">...</div>
    </div>

    <!-- Page Header -->
    <header class="rams-header">
      <h1 class="rams-h1">Page Title</h1>
      <p class="rams-lead">Lead paragraph</p>
    </header>

    <!-- Content -->
    <article class="rams-content">
      <!-- Your content here -->
    </article>
  </main>
</body>
```

### 2. CSS Classes Naming Convention

**Pattern:** `rams-{component}-{variant}`

Examples:
- `rams-btn`, `rams-btn-primary`, `rams-btn-secondary`
- `rams-card`, `rams-card-header`, `rams-card-body`
- `rams-nav`, `rams-nav-link`, `rams-nav-link.active`
- `rams-h1`, `rams-h2`, `rams-h3`, `rams-text`, `rams-text-sm`

### 3. Typography Hierarchy

```css
/* Headings */
.rams-h1 { font-size: 2.25rem; font-weight: 600; letter-spacing: -0.02em; }
.rams-h2 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
.rams-h3 { font-size: 1.125rem; font-weight: 600; letter-spacing: -0.02em; }

/* Body */
.rams-text { font-size: 1rem; line-height: 1.5; letter-spacing: -0.02em; }
.rams-text-sm { font-size: 0.875rem; }
.rams-lead { font-size: 1rem; line-height: 1.625; }  /* Intro text */

/* Labels */
.rams-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--rams-gray-500);
}
```

### 4. Navigation Active States

```css
.rams-nav-link {
  color: var(--rams-gray-700);
  border-left: 2px solid transparent;
  transition: all var(--rams-transition-fast);
}

.rams-nav-link:hover {
  color: var(--rams-gray-900);
  background: var(--rams-gray-50);
}

.rams-nav-link.active {
  color: var(--rams-accent);
  background: rgba(26, 77, 46, 0.04);
  border-left-color: var(--rams-accent);
  font-weight: 500;
}
```

### 5. Tables (for data display)

```css
.rams-table {
  width: 100%;
  border-collapse: collapse;
}

.rams-table th {
  text-align: left;
  padding: var(--rams-space-3) var(--rams-space-4);
  font-size: var(--rams-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--rams-gray-500);
  border-bottom: 1px solid var(--rams-border-color);
}

.rams-table td {
  padding: var(--rams-space-4);
  border-bottom: 1px solid var(--rams-gray-200);
}

.rams-table tbody tr:hover {
  background: var(--rams-gray-50);
}
```

---

## Key Differences from Previous Design

### Before (Editorial Theme)
- Playfair Display serif headings (decorative)
- Warm cream/burgundy palette
- Generous whitespace
- Magazine-style aesthetics
- Decorative elements

### After (Rams System)
- System fonts (functional)
- Cool neutrals + forest green
- Maximized information density
- Swiss precision
- No decoration, pure function

---

## File Reference

**Primary CSS File:** `ui/public/docs/rams-design-system.css` (1,222 lines)

**Key Sections:**
1. Design System Variables (lines 1-110)
2. Base Styles & Reset (lines 111-150)
3. Sidebar Navigation (lines 151-260)
4. Top Bar & Breadcrumbs (lines 261-320)
5. Typography (lines 321-400)
6. Buttons (lines 401-470)
7. Cards (lines 471-520)
8. Code Blocks (lines 521-600)
9. Tables (lines 601-650)
10. Responsive Design (lines 651-750)

---

## Responsive Breakpoints

```css
/* Desktop: Default (sidebar persistent) */
@media (min-width: 1025px) {
  .rams-sidebar { display: block; }
  .rams-main { margin-left: 260px; }
}

/* Tablet: Sidebar overlay */
@media (max-width: 1024px) {
  .rams-sidebar {
    transform: translateX(-100%);
    transition: transform 200ms;
  }
  .rams-sidebar.open {
    transform: translateX(0);
  }
  .rams-main { margin-left: 0; }
}

/* Mobile: Simplified layout */
@media (max-width: 768px) {
  .rams-header { padding: var(--rams-space-6); }
  .rams-h1 { font-size: 2rem; }
  .rams-content { padding: var(--rams-space-4); }
}
```

---

## Accessibility

**Focus States:**
```css
*:focus-visible {
  outline: 2px solid var(--rams-accent);
  outline-offset: 2px;
}
```

**Motion:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Next Steps for Ralph UI Frontend

### 1. Apply to Observation Dashboard
- Replace current styling with `rams-design-system.css`
- Implement persistent sidebar with stream/PRD navigation
- Use tables for data display (tokens, costs, status)
- Code blocks for log output
- Green accent for active builds/streams

### 2. Key Components to Build
- **Stream Status Table**: Show all PRDs with status badges
- **Token Metrics Cards**: Display usage data in clean cards
- **Build Logs**: Code block style with copy functionality
- **Progress Indicators**: Minimal progress bars (2px height)
- **Navigation**: Sidebar with PRD list, active highlighting

### 3. Maintain Consistency
- Use exact color values from design system
- Follow 4px spacing grid religiously
- Apply tight letter spacing (-0.02em) to all text
- Keep border radius minimal (2-6px max)
- System fonts only

---

## Design Mantras

1. **"Less but better"** - Remove anything that doesn't serve a purpose
2. **"Persistent wayfinding"** - User always knows where they are
3. **"Information density"** - Maximize useful content per viewport
4. **"Swiss precision"** - Perfect alignment, systematic spacing
5. **"Timeless elegance"** - No trends, no fads, just function

---

**Document Version:** 1.0
**Last Updated:** 2026-01-15
**Reference Implementation:** `ui/public/docs/*`
