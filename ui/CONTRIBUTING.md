# Contributing to Ralph CLI UI

This guide covers development and contribution guidelines for the Ralph CLI user interface and documentation website.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Git

### Installation
```bash
cd ui
npm install
```

### Running the Dev Server
```bash
npm run dev
```
The UI will be available at `http://localhost:3000`

### Build
```bash
npm run build
```

### Type Checking
```bash
npm run typecheck
```

## Link Validation Requirements

### Why Link Validation Matters

The Ralph CLI documentation website contains 15 HTML pages with 56+ internal links. Broken links create poor user experience, confuse users, and make documentation less accessible. **All HTML changes must pass link validation before being committed.**

### Before You Commit

Run link validation to ensure all internal links are functional:

```bash
npm run validate-links
```

**Expected output on success:**
```
=== Ralph CLI Link Validator ===

Found 15 HTML files
Extracted 290 links

=== VALIDATION RESULTS ===

✓ /index.html
✓ /editor.html
... (56 valid internal links)
✓ External: https://github.com/...
... (12 external links)

=== SUMMARY ===
Valid internal links: 56
External links: 12
Broken links: 0

✓ VALIDATION PASSED: All links are valid!
```

### If Validation Fails

If link validation fails, you'll see output like:
```
✗ BROKEN: /path/to/missing.html
  Referenced in:
    - index.html
    - editor.html
```

**Fix broken links by:**
1. Checking that the target file exists at the specified path
2. Verifying the href matches the actual filename
3. Creating missing pages if necessary
4. Updating incorrect href attributes

### Common Link Issues and Solutions

| Issue | Solution |
|-------|----------|
| Typo in filename (e.g., `integrations.html` → `integration.html`) | Check filename spelling, fix href attribute |
| Missing page (e.g., `/chat.html` referenced but doesn't exist) | Create the missing page in `ui/public/` |
| Incorrect path (e.g., `/docs/commands.html` but file in wrong location) | Move file to correct location or update href |
| Fragment link breaking (e.g., `#section-that-doesnt-exist`) | Ensure anchor ID exists in target page |
| External link broken | Verify URL is still valid, update if service moved |

## HTML Page Guidelines

### Adding a New Page

When adding a new HTML page:

1. **Create the file** in the appropriate location:
   - UI pages: `ui/public/*.html`
   - Documentation pages: `ui/public/docs/*.html`

2. **Use consistent navigation**:
   - UI pages should link to all other UI pages (index, editor, streams, logs, tokens, trends, chat)
   - Docs pages should link to all other docs pages
   - Cross-link between UI and docs sections appropriately

3. **Example header structure for UI pages:**
   ```html
   <nav>
     <a href="/index.html">Dashboard</a>
     <a href="/editor.html">Editor</a>
     <a href="/streams.html">Streams</a>
     <a href="/logs.html">Logs</a>
     <a href="/tokens.html">Tokens</a>
     <a href="/trends.html">Trends</a>
     <a href="/chat.html">Chat</a>
     <a href="/docs/index.html">Docs</a>
   </nav>
   ```

4. **Example header structure for docs pages:**
   ```html
   <nav class="docs-nav">
     <a href="/docs/index.html">Docs Home</a>
     <a href="/docs/commands.html">Commands</a>
     <a href="/docs/examples.html">Examples</a>
     <!-- etc -->
     <a href="/index.html">Back to UI</a>
   </nav>
   ```

5. **Validate before committing**:
   ```bash
   npm run validate-links
   ```

### Updating an Existing Page

When modifying href attributes:

1. **Check the target file exists** before committing
2. **Use absolute paths** starting with `/` (e.g., `/chat.html`, not `chat.html`)
3. **For docs pages**, use paths like `/docs/integration.html`
4. **For fragments**, ensure the target anchor exists in the destination page

Example link patterns:
```html
<!-- UI to UI -->
<a href="/index.html">Dashboard</a>

<!-- Docs to Docs -->
<a href="/docs/commands.html">Commands</a>

<!-- Cross-section -->
<a href="/docs/index.html">Documentation</a>

<!-- Fragment within page (for breadcrumbs with SPA) -->
<a href="/streams.html" onclick="hideDetail()">Streams</a>

<!-- External -->
<a href="https://github.com/AskTinNguyen/ralph-cli">GitHub</a>
```

## Common Development Tasks

### Testing a Page
```bash
# Start dev server
npm run dev

# Navigate to http://localhost:3000/<page>
# Manually click links to test navigation
```

### Checking All Links
```bash
# Run full validation
npm run validate-links

# View raw link extraction
npm run validate-links 2>&1 | grep "✓" | wc -l
```

### Finding Pages with Most Links
```bash
# This helps identify hub pages
node validate-links.js 2>&1 | grep "Referenced in:" -A 10
```

## Documentation Files

The following documentation files are maintained for link management:

- **SITEMAP.md** - Complete inventory of all 15 pages with hierarchy
- **LINK_RELATIONSHIPS.md** - Detailed mapping of which pages link to which
- **LINK_VALIDATION_REPORT.md** - Full audit report from last validation
- **PLACEHOLDER_LINKS_STATUS.md** - Status of placeholder links (currently none)
- **validate-links.js** - Automated validation script

Read these files to understand site structure before making changes.

## Validation Integration

### Pre-commit Hooks (Recommended)

To automatically validate links before commits, create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
cd ui
npm run validate-links
```

Make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

### CI/CD Integration

In your CI pipeline (GitHub Actions, etc.), add:

```yaml
- name: Validate documentation links
  run: cd ui && npm run validate-links
```

This ensures all PRs pass link validation before merging.

## Reporting Link Issues

If you find broken links:

1. **Run validation** to get detailed report:
   ```bash
   npm run validate-links
   ```

2. **Create an issue** with:
   - Broken link URL
   - Page where found
   - What it should link to
   - Proposed fix

3. **Fix in your PR**:
   - Create the missing page, OR
   - Correct the href attribute, OR
   - Update the reference

## Questions?

- See **LINK_RELATIONSHIPS.md** for site structure
- See **SITEMAP.md** for complete page inventory
- See **validate-links.js** for validation logic
- See **PLACEHOLDER_LINKS_STATUS.md** for placeholder tracking

## Review Checklist

Before submitting a PR that modifies HTML:

- [ ] All hrefs point to existing files or valid URLs
- [ ] No `href="#"` placeholders (except intentional SPA patterns)
- [ ] `npm run validate-links` passes
- [ ] New pages are linked from relevant index pages
- [ ] Navigation menus are consistent across section (UI or docs)
- [ ] Breadcrumbs (if present) point to valid pages
- [ ] External links are still valid

Thank you for contributing to Ralph CLI documentation!
